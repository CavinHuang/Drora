import { useCallback, useRef, useState } from "react";
import {
  PERSONA_ERROR_CODES,
  PERSONA_PREFERENCE_KEYS,
  type PersonaEditableCore,
  type PersonaPreset,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { logger } from "@/logger.js";
import { runUserActionAsync } from "@/lib/userActionTelemetry.js";
import type { PersonaControlService } from "./usePersonaCoreEditor.js";

/**
 * 人设预设应用状态机（specs/drora-persona-system.md §13 第十五批）。
 *
 * 应用＝updatePersonaCore（五字段全量 patch＋CAS）＋savePreference×4（显式覆盖→
 * explicit/pinned，被覆盖键自动学习停止——用户裁定，UI 明示）。多步 CAS 是**非原子**
 * 组合：中途失败保留部分状态并如实回报（applied/partial/failed）；每步 mutationId
 * 独立 UUID，失败后重试点击＝新序列（服务端以 digest+mutationId 幂等去重同请求）。
 * CAS 冲突（跨窗口并发）自动重读一次再试，仍冲突则该步计入失败键。
 */

export interface PersonaPresetApplyResult {
  readonly status: "applied" | "partial" | "failed";
  /** 人格核心五字段是否已成功落库。 */
  readonly coreUpdated: boolean;
  readonly appliedKeys: readonly PersonaPreferenceKey[];
  readonly failedKeys: ReadonlyArray<{ readonly key: PersonaPreferenceKey; readonly code: string }>;
  /** applyCore（读/初始化/写五字段）失败的封闭错误码；core 成功时缺席。 */
  readonly failedCoreCode?: string;
}

/** 「使用中」判定＝core 五字段与预设全等（偏好/学习漂移不参与，spec 第十五批）。 */
export function matchesPresetCore(core: PersonaEditableCore, preset: PersonaPreset): boolean {
  return (
    core.displayName === preset.core.displayName &&
    core.selfDescription === preset.core.selfDescription &&
    core.warmth === preset.core.warmth &&
    core.directness === preset.core.directness &&
    core.humor === preset.core.humor
  );
}

function createMutationId(): string {
  return crypto.randomUUID();
}

async function readCoreRevision(
  personaService: PersonaControlService,
): Promise<{ ok: true; revision: number } | { ok: false; code: string }> {
  const core = await personaService.getPersonaCore();
  if (!core.ok) return { ok: false, code: core.code };
  if (core.value.state === "current") return { ok: true, revision: core.value.coreRevision };
  // 未初始化：先初始化（预设应用是明确的用户意图），再读 revision。
  const initialized = await personaService.initializePersona({ mutationId: createMutationId() });
  if (!initialized.ok) return { ok: false, code: initialized.code };
  const reread = await personaService.getPersonaCore();
  if (!reread.ok) return { ok: false, code: reread.code };
  if (reread.value.state !== "current") {
    return { ok: false, code: PERSONA_ERROR_CODES.uninitialized };
  }
  return { ok: true, revision: reread.value.coreRevision };
}

async function applyCore(
  personaService: PersonaControlService,
  preset: PersonaPreset,
): Promise<{ ok: true } | { ok: false; code: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const revision = await readCoreRevision(personaService);
    if (!revision.ok) return { ok: false, code: revision.code };
    const result = await personaService.updatePersonaCore({
      expectedRevision: revision.revision,
      patch: { ...preset.core },
      mutationId: createMutationId(),
    });
    if (result.ok) return { ok: true };
    if (result.code === PERSONA_ERROR_CODES.revisionConflict && attempt === 0) continue;
    return { ok: false, code: result.code };
  }
  return { ok: false, code: PERSONA_ERROR_CODES.revisionConflict };
}

async function slotRevisions(
  personaService: PersonaControlService,
): Promise<Map<PersonaPreferenceKey, number> | undefined> {
  const list = await personaService.listPreferences();
  if (!list.ok) return undefined;
  const map = new Map<PersonaPreferenceKey, number>();
  for (const slot of list.value.preferences) map.set(slot.key, slot.revision);
  return map;
}

async function applyPreferences(
  personaService: PersonaControlService,
  preset: PersonaPreset,
): Promise<PersonaPresetApplyResult> {
  const keys = Object.keys(PERSONA_PREFERENCE_KEYS) as PersonaPreferenceKey[];
  const applied: PersonaPreferenceKey[] = [];
  const failed: Array<{ key: PersonaPreferenceKey; code: string }> = [];
  for (const key of keys) {
    const value = preset.preferenceDefaults[key];
    let handled = false;
    for (let attempt = 0; attempt < 2 && !handled; attempt += 1) {
      const revisions = await slotRevisions(personaService);
      if (!revisions) {
        failed.push({ key, code: PERSONA_ERROR_CODES.storageUnavailable });
        handled = true;
        break;
      }
      const result = await personaService.savePreference({
        key,
        value,
        expectedRevision: revisions.get(key) ?? 0,
        mutationId: createMutationId(),
      });
      if (result.ok) {
        applied.push(key);
        handled = true;
      } else if (result.code === PERSONA_ERROR_CODES.revisionConflict && attempt === 0) {
        continue;
      } else {
        failed.push({ key, code: result.code });
        handled = true;
      }
    }
  }
  return {
    status: failed.length === 0 ? "applied" : applied.length > 0 ? "partial" : "failed",
    coreUpdated: true,
    appliedKeys: applied,
    failedKeys: failed,
  };
}

export function usePersonaPresets(personaService: PersonaControlService) {
  const [applyingPresetId, setApplyingPresetId] = useState<PersonaPreset["id"] | null>(null);
  const inFlightRef = useRef(false);

  const applyPreset = useCallback(
    async (preset: PersonaPreset): Promise<PersonaPresetApplyResult | null> => {
      if (inFlightRef.current) return null;
      inFlightRef.current = true;
      setApplyingPresetId(preset.id);
      try {
        return await runUserActionAsync({
          input: {
            featureId: "settings.drora",
            action: "apply_persona_preset",
            trigger: "button",
          },
          failureStage: "apply_persona_preset",
          operation: async () => {
            const core = await applyCore(personaService, preset);
            if (!core.ok) {
              // 失败码必须透传：静默丢弃会让「应用失败」无从定位（诚实呈现，合同 §2）。
              logger.warn("persona preset apply failed at core step", {
                presetId: preset.id,
                code: core.code,
              });
              return {
                status: "failed",
                coreUpdated: false,
                appliedKeys: [],
                failedKeys: [],
                failedCoreCode: core.code,
              } satisfies PersonaPresetApplyResult;
            }
            const result = await applyPreferences(personaService, preset);
            if (result.status !== "applied") {
              logger.warn("persona preset apply not fully applied", {
                presetId: preset.id,
                status: result.status,
                failedKeys: result.failedKeys.map((entry) => `${entry.key}:${entry.code}`),
              });
            }
            return result;
          },
        });
      } catch (error) {
        logger.warn("persona preset apply failed", {
          error: error instanceof Error ? error.message : String(error),
          presetId: preset.id,
        });
        return {
          status: "failed",
          coreUpdated: false,
          appliedKeys: [],
          failedKeys: [],
          failedCoreCode: error instanceof Error ? error.message : String(error),
        };
      } finally {
        inFlightRef.current = false;
        setApplyingPresetId(null);
      }
    },
    [personaService],
  );

  return { applyPreset, applyingPresetId };
}

export type PersonaPresets = ReturnType<typeof usePersonaPresets>;
