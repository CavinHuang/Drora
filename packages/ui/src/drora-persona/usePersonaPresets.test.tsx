// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERSONA_ERROR_CODES,
  PERSONA_PRESETS,
  PERSONA_PREFERENCE_KEYS,
  type PersonaPreferenceKey,
} from "@drora/shared";
import type { PersonaControlService } from "./usePersonaCoreEditor.js";
import { matchesPresetCore, usePersonaPresets } from "./usePersonaPresets.js";

/**
 * 人设预设应用状态机守护（specs/drora-persona-system.md §13 第十五批）：
 * - 正常序列：getPersonaCore（未初始化先 initializePersona）→ updatePersonaCore（五字段
 *   全量 patch＋CAS）→ listPreferences → 逐键 savePreference（槽缺席 expectedRevision=0）；
 * - CAS 冲突：自动重读一次再试（core 与单键各一次），仍冲突计入失败如实回报；
 * - 部分失败：核心已更新而偏好键失败 → status=partial（非原子语义的诚实呈现）；
 * - 「使用中」判定＝core 五字段全等，偏好漂移不参与。
 */

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

function err(code: string): { ok: false; code: string } {
  return { ok: false, code };
}

function createService(overrides?: {
  coreState?: "current" | "uninitialized";
  updateResults?: Array<{ ok: false; code: string } | { ok: true; value: { status: string } }>;
  listResult?:
    | { ok: false; code: string }
    | { ok: true; value: { preferences: Array<{ key: PersonaPreferenceKey; revision: number }> } };
  saveResults?: Partial<
    Record<
      PersonaPreferenceKey,
      Array<{ ok: false; code: string } | { ok: true; value: { status: string } }>
    >
  >;
}): {
  service: PersonaControlService;
  calls: { update: number; save: Map<PersonaPreferenceKey, number>; list: number; init: number };
} {
  const calls = { update: 0, save: new Map<PersonaPreferenceKey, number>(), list: 0, init: 0 };
  const coreState = overrides?.coreState ?? "current";
  let coreRevision = coreState === "current" ? 3 : 0;
  const updateResults = overrides?.updateResults ?? [];
  const saveResults = overrides?.saveResults ?? {};
  const service = {
    getPersonaOverview: vi.fn(async () => ok({ state: "initialized" })),
    getPersonaCore: vi.fn(async () =>
      coreState === "current" || calls.init > 0
        ? ok({ state: "current", coreRevision, core: PERSONA_PRESETS[3]!.core })
        : ok({ state: "built_in_preview", core: PERSONA_PRESETS[3]!.core }),
    ),
    initializePersona: vi.fn(async () => {
      calls.init += 1;
      coreRevision = 0;
      return ok({ status: "created" });
    }),
    updatePersonaCore: vi.fn(async () => {
      calls.update += 1;
      const next = updateResults[calls.update - 1] ?? ok({ status: "saved" });
      return next as never;
    }),
    resetPersonaCore: vi.fn(async () => ok({ status: "saved" })),
    previewPersona: vi.fn(async () => ok({ text: "preview" })),
    getPersonaApplication: vi.fn(async () => ok({ status: "not_available" })),
    setPersonalPolicy: vi.fn(async () => ok({ status: "saved" })),
    listPreferences: vi.fn(async () => {
      calls.list += 1;
      const fallback = ok({
        preferences: [
          { key: PERSONA_PREFERENCE_KEYS.replyLanguage, revision: 2 },
          { key: PERSONA_PREFERENCE_KEYS.explanationDetail, revision: 0 },
        ],
      });
      return (overrides?.listResult ?? fallback) as never;
    }),
    savePreference: vi.fn(async (input: { key: PersonaPreferenceKey }) => {
      const count = (calls.save.get(input.key) ?? 0) + 1;
      calls.save.set(input.key, count);
      const results = saveResults[input.key] ?? [];
      const next = results[count - 1] ?? ok({ status: "saved" });
      return next as never;
    }),
    forgetPreference: vi.fn(async () => ok({ status: "forgotten" })),
    allowLearningForKey: vi.fn(async () => ok({ status: "saved" })),
    getPersonaLearningOverview: vi.fn(async () => ok({ state: "initialized" })),
    preparePersonaExport: vi.fn(async () => ok({ format: "json" })),
  } as unknown as PersonaControlService;
  return { service, calls };
}

describe("usePersonaPresets（spec §13 第十五批）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常序列：core 五字段全量＋四键显式覆盖，槽缺席键 expectedRevision=0", async () => {
    const { service, calls } = createService();
    const { result } = renderHook(() => usePersonaPresets(service));
    const whale = PERSONA_PRESETS[0]!;

    let applyResult: Awaited<ReturnType<typeof result.current.applyPreset>>;
    await act(async () => {
      applyResult = await result.current.applyPreset(whale)!;
    });

    expect(applyResult!.status).toBe("applied");
    expect(applyResult!.coreUpdated).toBe(true);
    expect(applyResult!.appliedKeys).toHaveLength(4);
    expect(calls.update).toBe(1);
    expect(calls.save.size).toBe(4);
    const saveCalls = (service.savePreference as ReturnType<typeof vi.fn>).mock.calls;
    for (const [input] of saveCalls) {
      if (input.key === PERSONA_PREFERENCE_KEYS.replyLanguage) {
        expect(input.expectedRevision).toBe(2);
      } else if (input.key === PERSONA_PREFERENCE_KEYS.explanationDetail) {
        expect(input.expectedRevision).toBe(0);
      }
    }
  });

  it("未初始化：先 initializePersona 再走更新序列", async () => {
    const { service, calls } = createService({ coreState: "uninitialized" });
    const { result } = renderHook(() => usePersonaPresets(service));
    await act(async () => {
      const applied = await result.current.applyPreset(PERSONA_PRESETS[4]!);
      expect(applied?.status).toBe("applied");
    });
    expect(calls.init).toBe(1);
    expect(calls.update).toBeGreaterThanOrEqual(1);
  });

  it("core CAS 冲突：自动重读一次后成功；仍冲突则 failed 且不动偏好", async () => {
    const { service, calls } = createService({
      updateResults: [err(PERSONA_ERROR_CODES.revisionConflict), ok({ status: "saved" })],
    });
    const { result } = renderHook(() => usePersonaPresets(service));
    let applied: Awaited<ReturnType<typeof result.current.applyPreset>>;
    await act(async () => {
      applied = await result.current.applyPreset(PERSONA_PRESETS[1]!)!;
    });
    expect(applied!.status).toBe("applied");
    expect(calls.update).toBe(2);

    const { service: stuck, calls: stuckCalls } = createService({
      updateResults: [
        err(PERSONA_ERROR_CODES.revisionConflict),
        err(PERSONA_ERROR_CODES.revisionConflict),
      ],
    });
    const { result: stuckResult } = renderHook(() => usePersonaPresets(stuck));
    let failed: Awaited<ReturnType<typeof stuckResult.current.applyPreset>>;
    await act(async () => {
      failed = await stuckResult.current.applyPreset(PERSONA_PRESETS[1]!)!;
    });
    expect(failed!.status).toBe("failed");
    expect(failed!.coreUpdated).toBe(false);
    expect(stuckCalls.save.size).toBe(0);
  });

  it("单键 CAS 冲突重试一次后成功；持续失败 → partial 如实回报", async () => {
    const { service } = createService({
      saveResults: {
        [PERSONA_PREFERENCE_KEYS.preferredAddress]: [
          err(PERSONA_ERROR_CODES.revisionConflict),
          ok({ status: "saved" }),
        ],
        [PERSONA_PREFERENCE_KEYS.collaborationStyle]: [
          err(PERSONA_ERROR_CODES.revisionConflict),
          err(PERSONA_ERROR_CODES.revisionConflict),
        ],
      },
    });
    const { result } = renderHook(() => usePersonaPresets(service));
    let applied: Awaited<ReturnType<typeof result.current.applyPreset>>;
    await act(async () => {
      applied = await result.current.applyPreset(PERSONA_PRESETS[0]!)!;
    });
    expect(applied!.status).toBe("partial");
    expect(applied!.coreUpdated).toBe(true);
    expect(applied!.appliedKeys).toHaveLength(3);
    expect(applied!.failedKeys).toEqual([
      {
        key: PERSONA_PREFERENCE_KEYS.collaborationStyle,
        code: PERSONA_ERROR_CODES.revisionConflict,
      },
    ]);
  });

  it("在途互斥：应用中再次调用返回 null", async () => {
    const { service } = createService();
    const { result } = renderHook(() => usePersonaPresets(service));
    let second: Awaited<ReturnType<typeof result.current.applyPreset>> | undefined;
    const first = result.current.applyPreset(PERSONA_PRESETS[0]!);
    await act(async () => {
      second = await result.current.applyPreset(PERSONA_PRESETS[1]!)!;
      await first;
    });
    expect(second).toBeNull();
  });

  it("matchesPresetCore：五字段全等；偏好漂移不参与判定", () => {
    const workmate = PERSONA_PRESETS.find((preset) => preset.id === "workmate")!;
    expect(matchesPresetCore(workmate.core, workmate)).toBe(true);
    expect(
      matchesPresetCore(
        { ...workmate.core, selfDescription: `${workmate.core.selfDescription}。` },
        workmate,
      ),
    ).toBe(false);
  });

  it("applyingPresetId 状态随应用置起与复位", async () => {
    const { service } = createService();
    // 受控延迟：挡住首个 updatePersonaCore，保证 applying 态可观察（mock 秒回会赶在
    // waitFor 轮询前复位，属测试竞态而非 hook 行为）。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = service.updatePersonaCore.bind(service);
    (service as { updatePersonaCore: unknown }).updatePersonaCore = vi.fn(
      async (input: unknown) => {
        await gate;
        return original(input as never);
      },
    );
    const { result } = renderHook(() => usePersonaPresets(service));
    const applying = result.current.applyPreset(PERSONA_PRESETS[5]!);
    await waitFor(() => expect(result.current.applyingPresetId).toBe(PERSONA_PRESETS[5]!.id));
    await act(async () => {
      release();
      await applying;
    });
    expect(result.current.applyingPresetId).toBeNull();
  });
});
