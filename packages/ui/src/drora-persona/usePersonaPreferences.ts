import { useCallback, useEffect, useRef, useState } from "react";
import type { IDroraAgentService } from "@drora/services";
import type { SaveFileRequest, SaveFileResult } from "@drora/shared";
import {
  PERSONA_ERROR_CODES,
  PERSONA_POLICY_DEFAULTS,
  PERSONA_PREFERENCE_KEYS,
  type PersonaExportPayload,
  type PersonaLearningOverview,
  type PersonaPreferenceFacts,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { logger } from "@/logger.js";
import { runUserActionAsync } from "@/lib/userActionTelemetry.js";

/**
 * Drora Persona「交流默认、使用策略与有限学习管理」的状态机（specs/drora-persona-system.md
 * §5/§8/§9/§10、docs/design/drora-persona-data-contracts-2026-10-29.md §1.2/§2/§3/§4.2/§7）。
 * 复用 usePersonaCoreEditor 的模式：服务权威值 + 局部草稿（seedRevision 做 CAS 基线）、
 * 冲突保留草稿并重读比较、outcome_unknown 保留同一 mutationId 幂等回放（PM53）、
 * 每个键（以及 U/L 策略、解除抑制、导出）各自独立的在途 mutationId。
 * P1b：getPersonaLearningOverview 提供策略当前值（U/L）读路径与预算/来源/计数概览——
 * P1a 时代「本页不读取 U 全局当前值」的 workaround 由该读侧方法替代。
 */

export type PersonaPreferencesService = Pick<
  IDroraAgentService,
  | "getPersonaOverview"
  | "listPreferences"
  | "setPersonalPolicy"
  | "savePreference"
  | "forgetPreference"
  | "allowLearningForKey"
  | "getPersonaLearningOverview"
  | "preparePersonaExport"
>;

/** 平台另存为端口（IPlatformService.saveFile，仅桌面实现；Web 缺席时导出如实降级）。 */
export type PersonaSaveFilePort = (payload: SaveFileRequest) => Promise<SaveFileResult>;

/** 导出文件名（spec §9：既有 IPlatformService.saveFile 负责保存；固定名便于识别）。 */
export const PERSONA_EXPORT_FILE_NAME = "drora-persona-export.json";

const PREFERENCE_KEY_LIST = [
  PERSONA_PREFERENCE_KEYS.replyLanguage,
  PERSONA_PREFERENCE_KEYS.explanationDetail,
  PERSONA_PREFERENCE_KEYS.preferredAddress,
  PERSONA_PREFERENCE_KEYS.collaborationStyle,
] as const satisfies readonly PersonaPreferenceKey[];

export type PersonaPreferenceNotice =
  | { tone: "success"; kind: "saved" }
  | { tone: "success"; kind: "unchanged" }
  | { tone: "info"; kind: "forgotten" }
  | { tone: "info"; kind: "outcomeUnknown" }
  | { tone: "error"; kind: "conflict" }
  | { tone: "error"; kind: "uninitialized" }
  | { tone: "error"; kind: "code"; code: string }
  | { tone: "error"; kind: "rpc"; message: string };

/** 单键草稿：value 为编辑值；seed 值/revision 是草稿开始编辑时的基线（保存 CAS 预期）。 */
export interface PersonaPreferenceDraft {
  value: string;
  seedValue: string;
  seedRevision: number;
}

export interface PersonaPreferenceSlot {
  /** 服务权威值（listPreferences）；null = 该键槽缺席（未设置或已忘记）。 */
  saved: PersonaPreferenceFacts | null;
  draft: PersonaPreferenceDraft | null;
  notice: PersonaPreferenceNotice | null;
  pending: boolean;
  forgetPending: boolean;
  /** 解除抑制（allowLearningForKey）在途；与保存/忘记互斥（同一槽的串行编辑）。 */
  allowPending: boolean;
  /** 「保留草稿」后已承认的服务 revision；revision 再前进才重新提示分歧。 */
  acknowledgedRevision: number | null;
}

/** U/L 两个策略开关共享同一 policy 行（同一 CAS/mutation 域），switch 区分展示归属。 */
export type PersonaPolicySwitch = "usePreferences" | "autoLearn";

export interface PersonaPolicyState {
  /**
   * 本会话最近一次确定性策略操作结果（含开关归属）。当前值以 learningOverview.policy 为准
   * （getPersonaLearningOverview 读路径）；本字段只陈述「本会话提交过什么」。
   */
  lastOperation: {
    switch: PersonaPolicySwitch;
    value: boolean;
    kind: "saved" | "unchanged";
  } | null;
  notice: PersonaPreferenceNotice | null;
  pending: boolean;
  /** 在途操作的目标：哪个开关正在提交什么值；null=空闲。 */
  pendingTarget: { switch: PersonaPolicySwitch; value: boolean } | null;
}

export type PersonaExportNotice =
  | { tone: "success"; kind: "saved"; path: string | null }
  | { tone: "info"; kind: "canceled" }
  | { tone: "info"; kind: "noData" }
  | { tone: "error"; kind: "unsupported" }
  | { tone: "error"; kind: "failed"; message: string }
  | { tone: "error"; kind: "code"; code: string }
  | { tone: "error"; kind: "rpc"; message: string };

function createEmptySlots(): Record<PersonaPreferenceKey, PersonaPreferenceSlot> {
  const slots = {} as Record<PersonaPreferenceKey, PersonaPreferenceSlot>;
  for (const key of PREFERENCE_KEY_LIST) {
    slots[key] = {
      saved: null,
      draft: null,
      notice: null,
      pending: false,
      forgetPending: false,
      allowPending: false,
      acknowledgedRevision: null,
    };
  }
  return slots;
}

function createMutationId(): string {
  // mutationId 每次用户提交新生成（合同 §2）；opaque，不从昵称/cwd/用户文本推导。
  // 与 usePersonaCoreEditor 同规则；该文件未导出此工具，这里保持各自文件私有。
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") return cryptoRef.randomUUID();
  return `mutation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** 草稿是否有待保存的实际改动（改回基线值视为未改动）。 */
export function isPreferenceSlotDirty(slot: PersonaPreferenceSlot): boolean {
  return slot.draft !== null && slot.draft.value !== slot.draft.seedValue;
}

/**
 * CAS 分歧：草稿基线 revision 与服务当前 revision 不一致（含基线值已被忘记/其他窗口
 * 修改），且未对当前 revision 做过「保留草稿」承认。展示层据此给出「已保存 vs 草稿」比较。
 */
export function isPreferenceSlotDiverged(slot: PersonaPreferenceSlot): boolean {
  if (!slot.draft) return false;
  const savedRevision = slot.saved?.revision ?? 0;
  return savedRevision !== slot.draft.seedRevision && savedRevision !== slot.acknowledgedRevision;
}

/** 2 空格缩进 JSON 的 UTF-8 字节（合同 §7 冻结快照；不经此函数之外的地方序列化）。 */
function encodeExportPayload(payload: PersonaExportPayload): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function usePersonaPreferences(
  personaService: PersonaPreferencesService,
  saveFile?: PersonaSaveFilePort,
) {
  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [slots, setSlots] =
    useState<Record<PersonaPreferenceKey, PersonaPreferenceSlot>>(createEmptySlots);
  const [policy, setPolicy] = useState<PersonaPolicyState>({
    lastOperation: null,
    notice: null,
    pending: false,
    pendingTarget: null,
  });
  /**
   * P1b 读侧概览（getPersonaLearningOverview）：策略当前值（U/L）、当日预算台账、inferred
   * 槽合并来源定位与本进程计数。读取失败（旧 wire/断线）不阻塞偏好区：置 null 并按
   * 「当前生效值未知」诚实降级，不试发写方法。
   */
  const [learningOverview, setLearningOverview] = useState<PersonaLearningOverview | null>(null);
  const [exportPending, setExportPending] = useState(false);
  const [exportNotice, setExportNotice] = useState<PersonaExportNotice | null>(null);
  const [forgetCandidate, setForgetCandidate] = useState<PersonaPreferenceKey | null>(null);
  // 请求 generation：进区读取与冲突重读的迟到响应不覆盖新页面（合同 §3）。
  const reloadGenRef = useRef(0);
  // PM53：写请求 outcome_unknown 后保留同一 mutationId 供重试幂等回放；确定性结果后清除。
  // save/forget/allow 共用 preference receipt scope，但 requestDigest 含操作名，各留一套
  // 在途 ID，避免「保存未知后改点忘记」把同 ID 不同摘要的请求送上 mutation_conflict。
  const liveSaveMutationIdsRef = useRef<Partial<Record<PersonaPreferenceKey, string>>>({});
  const liveForgetMutationIdsRef = useRef<Partial<Record<PersonaPreferenceKey, string>>>({});
  const liveAllowMutationIdsRef = useRef<Partial<Record<PersonaPreferenceKey, string>>>({});
  const livePolicyMutationIdRef = useRef<string | undefined>(undefined);
  // 策略 CAS 基线：learningOverview.policy.policyRevision（读路径与写路径同源）；
  // 概览缺席时回落 PERSONA_POLICY_DEFAULTS.policyRevision（策略行缺席时正确）。
  const policyRevisionRef = useRef<number>(PERSONA_POLICY_DEFAULTS.policyRevision);

  /** 只刷新学习概览（不碰 loadPhase）：冲突后重新预读策略版本号，保留用户意图。 */
  const refreshLearningOverview = useCallback(
    async (generation: number): Promise<void> => {
      try {
        const result = await personaService.getPersonaLearningOverview();
        if (generation !== reloadGenRef.current) return;
        if (result.ok && result.value.state === "initialized") {
          setLearningOverview(result.value);
          policyRevisionRef.current = result.value.policy.policyRevision;
        } else {
          setLearningOverview(null);
        }
      } catch (cause) {
        if (generation !== reloadGenRef.current) return;
        logger.warn("[persona] 学习概览读取失败，U/L 当前值按未知展示", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        setLearningOverview(null);
      }
    },
    [personaService],
  );

  /**
   * 读取服务权威状态：getPersonaOverview（初始化事实）+ listPreferences（偏好当前值；
   * 未初始化时服务返回空答案，不是错误）+ getPersonaLearningOverview（P1b 策略当前值与
   * 预算/来源/计数；失败不阻塞）。草稿原样保留——脏草稿不被重读覆盖，
   * 由 revision 分歧比较提示（与 usePersonaCoreEditor 的 reseed=false 同语义）。
   */
  const reload = useCallback(async (): Promise<void> => {
    const generation = ++reloadGenRef.current;
    setLoadPhase("loading");
    setLoadErrorCode(null);
    try {
      const [overviewResult, listResult] = await Promise.all([
        personaService.getPersonaOverview(),
        personaService.listPreferences(),
      ]);
      if (generation !== reloadGenRef.current) return;
      if (!overviewResult.ok) {
        setLoadPhase("error");
        setLoadErrorCode(overviewResult.code);
        return;
      }
      if (!listResult.ok) {
        setLoadPhase("error");
        setLoadErrorCode(listResult.code);
        return;
      }
      const byKey = new Map(listResult.value.preferences.map((entry) => [entry.key, entry]));
      setInitialized(overviewResult.value.state === "initialized");
      setSlots((current) => {
        const next = {} as Record<PersonaPreferenceKey, PersonaPreferenceSlot>;
        for (const key of PREFERENCE_KEY_LIST) {
          const previous = current[key];
          next[key] = {
            saved: byKey.get(key) ?? null,
            draft: previous?.draft ?? null,
            notice: previous?.notice ?? null,
            pending: previous?.pending ?? false,
            forgetPending: previous?.forgetPending ?? false,
            allowPending: previous?.allowPending ?? false,
            acknowledgedRevision: previous?.acknowledgedRevision ?? null,
          };
        }
        return next;
      });
      setLoadPhase("ready");
      if (overviewResult.value.state === "initialized") {
        await refreshLearningOverview(generation);
      } else {
        setLearningOverview(null);
      }
    } catch (cause) {
      if (generation !== reloadGenRef.current) return;
      // 旧 CLI / 控制端口缺席 / 断线都落在 RPC 错误：按不可用诚实降级，不试发 persona 写方法。
      setLoadPhase("error");
      setLoadErrorCode(cause instanceof Error ? cause.message : String(cause));
    }
  }, [personaService, refreshLearningOverview]);

  // 进入分区读取一次；只读，不写任何设置、不为导出/偏好初始化资料（spec §9）。
  useEffect(() => {
    void reload();
  }, [reload]);

  const patchSlot = useCallback(
    (key: PersonaPreferenceKey, patch: Partial<PersonaPreferenceSlot>) => {
      setSlots((current) => {
        const slot = current[key];
        if (!slot) return current;
        return { ...current, [key]: { ...slot, ...patch } };
      });
    },
    [],
  );

  const updatePreferenceDraft = useCallback((key: PersonaPreferenceKey, value: string) => {
    setSlots((current) => {
      const slot = current[key];
      if (!slot) return current;
      const draft = slot.draft ?? {
        value,
        seedValue: slot.saved?.value ?? "",
        seedRevision: slot.saved?.revision ?? 0,
      };
      return { ...current, [key]: { ...slot, draft: { ...draft, value }, notice: null } };
    });
  }, []);

  const cancelPreferenceDraft = useCallback(
    (key: PersonaPreferenceKey) => {
      patchSlot(key, { draft: null, notice: null, acknowledgedRevision: null });
    },
    [patchSlot],
  );

  const keepPreferenceDraft = useCallback((key: PersonaPreferenceKey) => {
    // 保留草稿：承认当前服务 revision；revision 再前进才重新提示分歧。
    setSlots((current) => {
      const slot = current[key];
      if (!slot) return current;
      return {
        ...current,
        [key]: { ...slot, acknowledgedRevision: slot.saved?.revision ?? 0, notice: null },
      };
    });
  }, []);

  /**
   * slot mutation 的统一失败映射（save/forget/allow 共用）：CAS 冲突重读并保留草稿；
   * uninitialized 如实提示；outcome_unknown 保留在途 ID 供同 ID 幂等回放（PM53）；
   * 其余封闭错误码是确定性拒绝（清除在途 ID，下次提交换新 ID）。
   */
  const applySlotMutationFailure = useCallback(
    async (
      key: PersonaPreferenceKey,
      code: string,
      liveIds: Partial<Record<PersonaPreferenceKey, string>>,
    ): Promise<void> => {
      if (code === PERSONA_ERROR_CODES.revisionConflict) {
        delete liveIds[key];
        await reload();
        patchSlot(key, { notice: { tone: "error", kind: "conflict" } });
      } else if (code === PERSONA_ERROR_CODES.uninitialized) {
        delete liveIds[key];
        patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
      } else if (code === PERSONA_ERROR_CODES.outcomeUnknown) {
        patchSlot(key, { notice: { tone: "info", kind: "outcomeUnknown" } });
      } else {
        delete liveIds[key];
        patchSlot(key, { notice: { tone: "error", kind: "code", code } });
      }
    },
    [reload, patchSlot],
  );

  /** 单键保存：CAS 携带草稿基线 revision（槽缺席=0）与本键在途/新 mutationId；成功后重读。 */
  const handleSavePreference = useCallback(
    async (key: PersonaPreferenceKey): Promise<void> => {
      const slot = slots[key];
      const draft = slot?.draft;
      if (!slot || !draft || slot.pending || slot.forgetPending || slot.allowPending) return;
      if (!initialized) {
        patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
        return;
      }
      patchSlot(key, { pending: true, notice: null });
      try {
        await runUserActionAsync({
          input: {
            featureId: "settings.drora",
            action: "save_persona_preference",
            trigger: "button",
          },
          operation: async () => {
            // 结果未知的上一次尝试在途：重试必须复用同一 mutationId（合同 §2/PM53）。
            const mutationId = liveSaveMutationIdsRef.current[key] ?? createMutationId();
            liveSaveMutationIdsRef.current[key] = mutationId;
            const result = await personaService.savePreference({
              key,
              value: draft.value,
              expectedRevision: draft.seedRevision,
              mutationId,
            });
            if (!result.ok) {
              await applySlotMutationFailure(key, result.code, liveSaveMutationIdsRef.current);
              return;
            }
            delete liveSaveMutationIdsRef.current[key];
            patchSlot(key, {
              notice: {
                tone: "success",
                kind: result.value.status === "saved" ? "saved" : "unchanged",
              },
              // 确定性成功后草稿基线对齐服务值：清草稿，控件回到已保存值。
              draft: null,
              acknowledgedRevision: null,
            });
            // 保存成功后重读（spec §10）：以服务为权威刷新全部键的当前值。
            await reload();
          },
          completed: { resultSource: "authority_ack" },
          failureStage: "persona_commit",
        });
      } catch (cause) {
        // RPC 层失败（断线/超时）同样结果未知：保留 mutationId 供重试同 ID 回放（合同 §2）。
        patchSlot(key, {
          notice: {
            tone: "error",
            kind: "rpc",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      } finally {
        patchSlot(key, { pending: false });
      }
    },
    [slots, initialized, personaService, reload, patchSlot, applySlotMutationFailure],
  );

  /** 单键忘记：需确认（逻辑撤销范围见确认文案）；CAS 槽缺席=0；成功后重读。 */
  const handleForgetPreference = useCallback(
    async (key: PersonaPreferenceKey): Promise<void> => {
      const slot = slots[key];
      if (!slot || slot.forgetPending || slot.pending || slot.allowPending) return;
      if (!initialized) {
        patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
        return;
      }
      setForgetCandidate(null);
      // 忘记使草稿失去意义：连同草稿与分歧承认一起清除。
      patchSlot(key, {
        forgetPending: true,
        notice: null,
        draft: null,
        acknowledgedRevision: null,
      });
      try {
        await runUserActionAsync({
          input: {
            featureId: "settings.drora",
            action: "forget_persona_preference",
            trigger: "button",
          },
          operation: async () => {
            const mutationId = liveForgetMutationIdsRef.current[key] ?? createMutationId();
            liveForgetMutationIdsRef.current[key] = mutationId;
            const result = await personaService.forgetPreference({
              key,
              expectedRevision: slot.saved?.revision ?? 0,
              mutationId,
            });
            if (!result.ok) {
              await applySlotMutationFailure(key, result.code, liveForgetMutationIdsRef.current);
              return;
            }
            delete liveForgetMutationIdsRef.current[key];
            // 忘记是逻辑撤销（generation++ 屏障），不承诺介质擦除或删除聊天记录（spec §9）。
            patchSlot(key, { notice: { tone: "info", kind: "forgotten" } });
            await reload();
          },
          completed: { resultSource: "authority_ack" },
          failureStage: "persona_commit",
        });
      } catch (cause) {
        patchSlot(key, {
          notice: {
            tone: "error",
            kind: "rpc",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      } finally {
        patchSlot(key, { forgetPending: false });
      }
    },
    [slots, initialized, personaService, reload, patchSlot, applySlotMutationFailure],
  );

  /**
   * 解除该键自动学习抑制（合同 §3 allowLearningForKey、§4.2）：CAS 携带该键当前
   * generation；成功（saved/unchanged）后重读。争议不由它解决——保存/忘记才是
   * 争议解决路径（合同 §8），界面不提供「解除争议」按钮。
   */
  const handleAllowLearning = useCallback(
    async (key: PersonaPreferenceKey): Promise<void> => {
      const slot = slots[key];
      if (!slot || slot.allowPending || slot.pending || slot.forgetPending) return;
      if (!initialized) {
        patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
        return;
      }
      patchSlot(key, { allowPending: true, notice: null });
      try {
        await runUserActionAsync({
          input: {
            featureId: "settings.drora",
            action: "allow_persona_learning",
            trigger: "button",
          },
          operation: async () => {
            const mutationId = liveAllowMutationIdsRef.current[key] ?? createMutationId();
            liveAllowMutationIdsRef.current[key] = mutationId;
            const result = await personaService.allowLearningForKey({
              key,
              expectedGeneration: slot.saved?.keyGeneration ?? 0,
              mutationId,
            });
            if (!result.ok) {
              await applySlotMutationFailure(key, result.code, liveAllowMutationIdsRef.current);
              return;
            }
            delete liveAllowMutationIdsRef.current[key];
            patchSlot(key, {
              notice: {
                tone: "success",
                kind: result.value.status === "saved" ? "saved" : "unchanged",
              },
            });
            await reload();
          },
          completed: { resultSource: "authority_ack" },
          failureStage: "persona_commit",
        });
      } catch (cause) {
        patchSlot(key, {
          notice: {
            tone: "error",
            kind: "rpc",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      } finally {
        patchSlot(key, { allowPending: false });
      }
    },
    [slots, initialized, personaService, reload, patchSlot, applySlotMutationFailure],
  );

  /**
   * U/L 策略开关（spec §5）：两态按钮各自发起 setPersonalPolicy；当前值以
   * learningOverview.policy 为准（getPersonaLearningOverview 读路径）。
   * - 开启 L：同时携带 usePreferences=true（学习前置＝U&&L，一次 CAS 完成一致状态）；
   * - 关闭 L：保持 overview 观察到的 U 值不变（不知道 U 时按钮禁用，不用猜测值发请求）；
   * - 关闭 U：只提交 usePreferences=false——级联（同事务关 L、撤租约、清未提交候选/负载）
   *   由 CLI 存储侧执行（合同 §4.2）；重新开启 U 不恢复 L。
   */
  const handleSetPolicy = useCallback(
    async (usePreferences: boolean, autoLearn?: boolean): Promise<void> => {
      if (policy.pending) return;
      if (!initialized) {
        setPolicy((current) => ({
          ...current,
          notice: { tone: "error", kind: "uninitialized" },
        }));
        return;
      }
      const targetSwitch: PersonaPolicySwitch =
        autoLearn === undefined ? "usePreferences" : "autoLearn";
      setPolicy((current) => ({
        ...current,
        pending: true,
        pendingTarget: { switch: targetSwitch, value: autoLearn ?? usePreferences },
        notice: null,
      }));
      try {
        await runUserActionAsync({
          input: {
            featureId: "settings.drora",
            action: "set_persona_policy",
            trigger: "button",
          },
          operation: async () => {
            const mutationId = livePolicyMutationIdRef.current ?? createMutationId();
            livePolicyMutationIdRef.current = mutationId;
            const result = await personaService.setPersonalPolicy({
              expectedPolicyRevision: policyRevisionRef.current,
              usePreferences,
              // P1b patch 语义：autoLearn 缺席＝保持当前值；关闭 U 时不发明该键。
              ...(autoLearn === undefined ? {} : { autoLearn }),
              mutationId,
            });
            if (!result.ok) {
              if (result.code === PERSONA_ERROR_CODES.revisionConflict) {
                delete livePolicyMutationIdRef.current;
                // 其他窗口已推进策略：重新预读版本号，保留用户意图，由用户显式再次点击；
                // 不静默重试，也不以本地值覆盖服务事实（禁止 last-write-wins）。
                await refreshLearningOverview(reloadGenRef.current);
                setPolicy((current) => ({
                  ...current,
                  notice: { tone: "error", kind: "conflict" },
                }));
              } else if (result.code === PERSONA_ERROR_CODES.uninitialized) {
                delete livePolicyMutationIdRef.current;
                setPolicy((current) => ({
                  ...current,
                  notice: { tone: "error", kind: "uninitialized" },
                }));
              } else if (result.code === PERSONA_ERROR_CODES.outcomeUnknown) {
                // 结果未知：保留同一 mutationId，重试同 ID 幂等回放（PM53）。
                setPolicy((current) => ({
                  ...current,
                  notice: { tone: "info", kind: "outcomeUnknown" },
                }));
              } else {
                delete livePolicyMutationIdRef.current;
                setPolicy((current) => ({
                  ...current,
                  notice: { tone: "error", kind: "code", code: result.code },
                }));
              }
              return;
            }
            delete livePolicyMutationIdRef.current;
            if (result.value.status === "saved") {
              policyRevisionRef.current = result.value.policyRevision;
            }
            setPolicy((current) => ({
              ...current,
              lastOperation: {
                switch: targetSwitch,
                value: autoLearn ?? usePreferences,
                kind: result.value.status,
              },
              notice: {
                tone: "success",
                kind: result.value.status === "saved" ? "saved" : "unchanged",
              },
            }));
            // 策略提交成功后重读概览：当前值/预算/学习域屏障值回到服务权威。
            await refreshLearningOverview(reloadGenRef.current);
          },
          completed: { resultSource: "authority_ack" },
          failureStage: "persona_commit",
        });
      } catch (cause) {
        setPolicy((current) => ({
          ...current,
          notice: {
            tone: "error",
            kind: "rpc",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        }));
      } finally {
        setPolicy((current) => ({ ...current, pending: false, pendingTarget: null }));
      }
    },
    [policy.pending, initialized, personaService, refreshLearningOverview],
  );

  /**
   * 只读导出（合同 §7）：preparePersonaExport 成功后把 payload 以 2 空格缩进 JSON 经
   * IPlatformService.saveFile 保存；uninitialized 显示「尚无资料」，不为导出初始化；
   * 取消/失败如实提示，不自动重试、不上传。
   */
  const handleExport = useCallback(async (): Promise<void> => {
    if (exportPending) return;
    setExportPending(true);
    setExportNotice(null);
    try {
      await runUserActionAsync({
        input: {
          featureId: "settings.drora",
          action: "export_persona_snapshot",
          trigger: "button",
        },
        operation: async () => {
          const result = await personaService.preparePersonaExport();
          if (!result.ok) {
            setExportNotice(
              result.code === PERSONA_ERROR_CODES.uninitialized
                ? { tone: "info", kind: "noData" }
                : { tone: "error", kind: "code", code: result.code },
            );
            return;
          }
          if (!saveFile) {
            // 普通 Web 无原生另存为端口：如实说明，不虚报已保存。
            setExportNotice({ tone: "error", kind: "unsupported" });
            return;
          }
          const saved = await saveFile({
            data: encodeExportPayload(result.value),
            suggestedName: PERSONA_EXPORT_FILE_NAME,
          });
          if (saved.success) {
            setExportNotice({ tone: "success", kind: "saved", path: saved.path ?? null });
          } else if (saved.canceled) {
            // 用户取消另存为对话框：未保存任何文件，如实提示，不自动重试。
            setExportNotice({ tone: "info", kind: "canceled" });
          } else {
            setExportNotice({ tone: "error", kind: "failed", message: saved.error ?? "" });
          }
        },
        completed: { resultSource: "platform_result" },
        failureStage: "persona_export",
      });
    } catch (cause) {
      setExportNotice({
        tone: "error",
        kind: "rpc",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setExportPending(false);
    }
  }, [exportPending, personaService, saveFile]);

  const cancelForget = useCallback(() => setForgetCandidate(null), []);

  return {
    loadPhase,
    loadErrorCode,
    initialized,
    slots,
    policy,
    learningOverview,
    exportPending,
    exportNotice,
    forgetCandidate,
    reload,
    updatePreferenceDraft,
    cancelPreferenceDraft,
    keepPreferenceDraft,
    handleSavePreference,
    requestForget: setForgetCandidate,
    cancelForget,
    handleForgetPreference,
    handleAllowLearning,
    handleSetPolicy,
    handleExport,
  };
}

export type PersonaPreferences = ReturnType<typeof usePersonaPreferences>;
