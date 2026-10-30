import { useCallback, useEffect, useRef, useState } from "react";
import type { IDroraAgentService } from "@drora/services";
import type { SaveFileRequest, SaveFileResult } from "@drora/shared";
import {
  PERSONA_ERROR_CODES,
  PERSONA_POLICY_DEFAULTS,
  PERSONA_PREFERENCE_KEYS,
  type PersonaExportPayload,
  type PersonaPreferenceFacts,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { logger } from "@/logger.js";
import { runUserActionAsync } from "@/lib/userActionTelemetry.js";

/**
 * Drora Persona P1a「交流默认与导出」的状态机（specs/drora-persona-system.md §9/§10、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1.2/§2/§4.2/§7）。
 * 复用 usePersonaCoreEditor 的模式：服务权威值 + 局部草稿（seedRevision 做 CAS 基线）、
 * 冲突保留草稿并重读比较、outcome_unknown 保留同一 mutationId 幂等回放（PM53）、
 * 每个键（以及 U 策略、导出）各自独立的在途 mutationId。
 */

export type PersonaPreferencesService = Pick<
  IDroraAgentService,
  | "getPersonaOverview"
  | "listPreferences"
  | "setPersonalPolicy"
  | "savePreference"
  | "forgetPreference"
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
  /** 「保留草稿」后已承认的服务 revision；revision 再前进才重新提示分歧。 */
  acknowledgedRevision: number | null;
}

export interface PersonaPolicyState {
  /**
   * 本会话最近一次确定性策略操作结果。shared 没有暴露 policy 查询方法（listPreferences
   * 只含偏好），所以不冒充「全局当前值」：null 表示本会话尚无事实，展示为「当前生效值未知，
   * 以服务为准」；unchanged 结果可如实断言服务当前值（CAS 已比对一致）。
   */
  lastOperation: { value: boolean; kind: "saved" | "unchanged" } | null;
  notice: PersonaPreferenceNotice | null;
  pending: boolean;
  /** 在途操作的目标值：true=正在提交开启，false=正在提交关闭，null=空闲。 */
  pendingTarget: boolean | null;
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
  const [exportPending, setExportPending] = useState(false);
  const [exportNotice, setExportNotice] = useState<PersonaExportNotice | null>(null);
  const [forgetCandidate, setForgetCandidate] = useState<PersonaPreferenceKey | null>(null);
  // 请求 generation：进区读取与冲突重读的迟到响应不覆盖新页面（合同 §3）。
  const reloadGenRef = useRef(0);
  // PM53：写请求 outcome_unknown 后保留同一 mutationId 供重试幂等回放；确定性结果后清除。
  // save 与 forget 共用 preference receipt scope，但 requestDigest 含操作名，各留一套在途 ID，
  // 避免「保存未知后改点忘记」把同 ID 不同摘要的请求送上 mutation_conflict。
  const liveSaveMutationIdsRef = useRef<Partial<Record<PersonaPreferenceKey, string>>>({});
  const liveForgetMutationIdsRef = useRef<Partial<Record<PersonaPreferenceKey, string>>>({});
  const livePolicyMutationIdRef = useRef<string | undefined>(undefined);
  // 策略 CAS 基线：进区预读（initialized 时）、保存成功回填、冲突后重新预读；无渲染依赖。
  const policyRevisionRef = useRef<number>(PERSONA_POLICY_DEFAULTS.policyRevision);

  /**
   * 预取策略 CAS 版本号。shared 契约没有 policy 查询方法，P1a wire 上唯一的策略读路径是
   * preparePersonaExport 快照里的 policyRevision：只取该数字做 setPersonalPolicy 的
   * expectedPolicyRevision 基线，不从中推断 usePreferences 的当前值（那个不展示、不断言）。
   * 读取失败不阻塞界面：基线回落到 PERSONA_POLICY_DEFAULTS.policyRevision（策略行缺席时
   * 正确）；若行已存在则提交会得到 revision_conflict，由冲突路径重新预读后请用户显式重试。
   */
  const armPolicyRevision = useCallback(
    async (generation: number): Promise<void> => {
      try {
        const result = await personaService.preparePersonaExport();
        if (generation !== reloadGenRef.current) return;
        if (result.ok) {
          policyRevisionRef.current = result.value.policyRevision;
        } else {
          logger.warn("[persona] 策略版本号预读失败，U 提交将以缺省 revision 为基线", {
            code: result.code,
          });
        }
      } catch (cause) {
        if (generation !== reloadGenRef.current) return;
        logger.warn("[persona] 策略版本号预读失败，U 提交将以缺省 revision 为基线", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [personaService],
  );

  /**
   * 读取服务权威状态：getPersonaOverview（初始化事实）+ listPreferences（偏好当前值；
   * 未初始化时服务返回空答案，不是错误）。草稿原样保留——脏草稿不被重读覆盖，
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
            acknowledgedRevision: previous?.acknowledgedRevision ?? null,
          };
        }
        return next;
      });
      setLoadPhase("ready");
      if (overviewResult.value.state === "initialized") {
        void armPolicyRevision(generation);
      }
    } catch (cause) {
      if (generation !== reloadGenRef.current) return;
      // 旧 CLI / 控制端口缺席 / 断线都落在 RPC 错误：按不可用诚实降级，不试发 persona 写方法。
      setLoadPhase("error");
      setLoadErrorCode(cause instanceof Error ? cause.message : String(cause));
    }
  }, [personaService, armPolicyRevision]);

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

  /** 单键保存：CAS 携带草稿基线 revision（槽缺席=0）与本键在途/新 mutationId；成功后重读。 */
  const handleSavePreference = useCallback(
    async (key: PersonaPreferenceKey): Promise<void> => {
      const slot = slots[key];
      const draft = slot?.draft;
      if (!slot || !draft || slot.pending || slot.forgetPending) return;
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
              if (result.code === PERSONA_ERROR_CODES.revisionConflict) {
                // CAS 冲突：确定性拒绝，清除在途 ID；保留草稿并重读，由分歧比较引导。
                delete liveSaveMutationIdsRef.current[key];
                await reload();
                patchSlot(key, { notice: { tone: "error", kind: "conflict" } });
              } else if (result.code === PERSONA_ERROR_CODES.uninitialized) {
                delete liveSaveMutationIdsRef.current[key];
                patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
              } else if (result.code === PERSONA_ERROR_CODES.outcomeUnknown) {
                // 结果未知：保留同一 mutationId，重试同 ID 幂等回放。
                patchSlot(key, { notice: { tone: "info", kind: "outcomeUnknown" } });
              } else {
                // 其余封闭错误码是确定性拒绝：清除在途 ID，下次提交换新 ID。
                delete liveSaveMutationIdsRef.current[key];
                patchSlot(key, { notice: { tone: "error", kind: "code", code: result.code } });
              }
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
    [slots, initialized, personaService, reload, patchSlot],
  );

  /** 单键忘记：需确认（逻辑撤销范围见确认文案）；CAS 槽缺席=0；成功后重读。 */
  const handleForgetPreference = useCallback(
    async (key: PersonaPreferenceKey): Promise<void> => {
      const slot = slots[key];
      if (!slot || slot.forgetPending || slot.pending) return;
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
              if (result.code === PERSONA_ERROR_CODES.revisionConflict) {
                delete liveForgetMutationIdsRef.current[key];
                await reload();
                patchSlot(key, { notice: { tone: "error", kind: "conflict" } });
              } else if (result.code === PERSONA_ERROR_CODES.uninitialized) {
                delete liveForgetMutationIdsRef.current[key];
                patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
              } else if (result.code === PERSONA_ERROR_CODES.outcomeUnknown) {
                patchSlot(key, { notice: { tone: "info", kind: "outcomeUnknown" } });
              } else {
                delete liveForgetMutationIdsRef.current[key];
                patchSlot(key, { notice: { tone: "error", kind: "code", code: result.code } });
              }
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
    [slots, initialized, personaService, reload, patchSlot],
  );

  /**
   * U 使用许可（spec §5）：两态按钮各自发起 setPersonalPolicy；开启/关闭都是显式用户提交。
   * 当前值不做全局断言（无查询方法）：界面只展示本会话最近一次确定性操作结果。
   */
  const handleSetPolicy = useCallback(
    async (usePreferences: boolean): Promise<void> => {
      if (policy.pending) return;
      if (!initialized) {
        setPolicy((current) => ({
          ...current,
          notice: { tone: "error", kind: "uninitialized" },
        }));
        return;
      }
      setPolicy((current) => ({
        ...current,
        pending: true,
        pendingTarget: usePreferences,
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
              mutationId,
            });
            if (!result.ok) {
              if (result.code === PERSONA_ERROR_CODES.revisionConflict) {
                delete livePolicyMutationIdRef.current;
                // 其他窗口已推进策略：重新预读版本号，保留用户意图，由用户显式再次点击；
                // 不静默重试，也不以本地值覆盖服务事实（禁止 last-write-wins）。
                await armPolicyRevision(reloadGenRef.current);
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
              lastOperation: { value: usePreferences, kind: result.value.status },
              notice: {
                tone: "success",
                kind: result.value.status === "saved" ? "saved" : "unchanged",
              },
            }));
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
    [policy.pending, initialized, personaService, armPolicyRevision],
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
    handleSetPolicy,
    handleExport,
  };
}

export type PersonaPreferences = ReturnType<typeof usePersonaPreferences>;
