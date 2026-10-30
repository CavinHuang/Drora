import { useCallback, useEffect, useRef, useState } from "react";
import type { IDroraAgentService } from "@drora/services";
import {
  PERSONA_ERROR_CODES,
  type PersonaCoreSnapshot,
  type PersonaEditableCore,
  type PersonaOverviewInitialized,
  type PersonaProductTemplateSummary,
} from "@drora/shared";
import { runUserAction, runUserActionAsync } from "@/lib/userActionTelemetry.js";

/**
 * Drora 人格身份编辑的状态机（specs/drora-persona-system.md §10、合同 §2/§3）：
 * 已保存快照（服务权威）、局部草稿（seed+seedRevision 做 CAS 基线）、CAS 冲突保留草稿、
 * focus/显式刷新重读不覆盖脏草稿、确定性预览去抖。展示层（PersonaSettingsSection）只消费本 hook。
 */

export type PersonaControlService = Pick<
  IDroraAgentService,
  | "getPersonaOverview"
  | "initializePersona"
  | "getPersonaCore"
  | "updatePersonaCore"
  | "resetPersonaCore"
  | "previewPersona"
  | "getPersonaApplication"
  // P1a 交流默认/策略/导出（合同 §1.2/§3）：类型收集到同一 Pick，让 PersonaSettingsSection
  // 的 personaService 属性同时满足 P0 编辑器与 P1a 偏好区（usePersonaPreferences）的服务面。
  | "setPersonalPolicy"
  | "savePreference"
  | "forgetPreference"
  | "listPreferences"
  | "preparePersonaExport"
>;

export interface PersonaSavedSnapshot {
  /** false = 服务返回 uninitialized，当前使用产品内置资料（built_in_preview）。 */
  initialized: boolean;
  /** 已保存 revision；未初始化时为 0（占位，不可作为 CAS 预期）。 */
  revision: number;
  core: PersonaEditableCore;
  template: PersonaProductTemplateSummary;
}

export interface PersonaDraftState {
  core: PersonaEditableCore;
  /** 草稿开始编辑时的基线；保存以它的 revision 做 CAS（expectedRevision）。 */
  seed: PersonaEditableCore;
  seedRevision: number;
}

export type PersonaNotice =
  | { tone: "success"; kind: "saved" }
  | { tone: "success"; kind: "unchanged" }
  | { tone: "info"; kind: "initialized" }
  | { tone: "info"; kind: "outcomeUnknown" }
  | { tone: "error"; kind: "conflict" }
  | { tone: "error"; kind: "uninitialized" }
  | { tone: "error"; kind: "code"; code: string }
  | { tone: "error"; kind: "rpc"; message: string };

export interface PersonaPreviewState {
  text: string;
  templateVersion: number;
  compilerVersion: number;
}

export function personaCoreEquals(left: PersonaEditableCore, right: PersonaEditableCore): boolean {
  return (
    left.displayName === right.displayName &&
    left.selfDescription === right.selfDescription &&
    left.warmth === right.warmth &&
    left.directness === right.directness &&
    left.humor === right.humor
  );
}

function createMutationId(): string {
  // mutationId 每次用户提交新生成（合同 §2）；opaque，不从昵称/cwd/用户文本推导。
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") return cryptoRef.randomUUID();
  return `mutation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toSavedSnapshot(
  overview: PersonaOverviewInitialized | { state: "uninitialized" },
  core: PersonaCoreSnapshot,
): PersonaSavedSnapshot {
  if (core.state === "current") {
    return {
      initialized: true,
      revision: core.coreRevision,
      core: core.core,
      template: core.template,
    };
  }
  // built_in_preview：未初始化的确定默认预览（不落库、无已存 revision）。
  return {
    initialized: overview.state === "initialized",
    revision: 0,
    core: core.core,
    template: core.template,
  };
}

export function usePersonaCoreEditor(personaService: PersonaControlService) {
  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null);
  const [saved, setSaved] = useState<PersonaSavedSnapshot | null>(null);
  const [draftState, setDraftState] = useState<PersonaDraftState | null>(null);
  const [notice, setNotice] = useState<PersonaNotice | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [initializePending, setInitializePending] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<PersonaPreviewState | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewErrorCode, setPreviewErrorCode] = useState<string | null>(null);
  // 请求 generation（合同 §3：UI 的 request generation 防止旧响应覆盖新 authority/页面）。
  const reloadGenRef = useRef(0);
  const previewGenRef = useRef(0);
  // 「保留草稿继续编辑」后记录已承认的服务 revision；revision 再前进才重新提示分歧。
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<number | null>(null);
  // 合同 §2/PM53：写请求返回 outcome_unknown（含 RPC 断线/超时，结果未知）后保留
  // mutationId——同 ID 同摘要幂等回放，用户重试不换新 ID 重写；确定性结果（成功、
  // CAS 冲突、校验/未初始化拒绝）后清除，下一次用户提交换新 ID。按操作分别登记。
  const liveMutationIdsRef = useRef<{ update?: string; initialize?: string; reset?: string }>({});

  const draftDirty = draftState !== null && !personaCoreEquals(draftState.core, draftState.seed);
  const savedDiverged = draftDirty && saved !== null && saved.revision !== draftState.seedRevision;
  const showDivergence = savedDiverged && saved.revision !== acknowledgedRevision;

  /**
   * 读取服务权威快照（getPersonaOverview + getPersonaCore）。
   * reseed=true（保存/初始化/恢复默认之后，或显式放弃草稿）时草稿无条件跟随服务值；
   * reseed=false（focus/显式刷新）只在草稿未改动时静默跟随，脏草稿原样保留，
   * 由 revision 分歧面板提示（跨窗口以服务 revision 为权威，但不静默覆盖编辑）。
   */
  const reload = useCallback(
    async (options: { reseed: boolean }): Promise<void> => {
      const generation = ++reloadGenRef.current;
      setLoadPhase("loading");
      setLoadErrorCode(null);
      try {
        const [overviewResult, coreResult] = await Promise.all([
          personaService.getPersonaOverview(),
          personaService.getPersonaCore(),
        ]);
        if (generation !== reloadGenRef.current) return;
        if (!overviewResult.ok) {
          setLoadPhase("error");
          setLoadErrorCode(overviewResult.code);
          return;
        }
        if (!coreResult.ok) {
          setLoadPhase("error");
          setLoadErrorCode(coreResult.code);
          return;
        }
        const nextSaved = toSavedSnapshot(overviewResult.value, coreResult.value);
        setSaved(nextSaved);
        setDraftState((current) => {
          const draftClean = !current || personaCoreEquals(current.core, current.seed);
          if (options.reseed || draftClean) {
            return {
              core: nextSaved.core,
              seed: nextSaved.core,
              seedRevision: nextSaved.revision,
            };
          }
          return current;
        });
        setLoadPhase("ready");
      } catch (cause) {
        if (generation !== reloadGenRef.current) return;
        // 旧 CLI / 控制端口缺席 / 断线都落在 RPC 错误：按不可用诚实降级，不试发 persona 方法。
        setLoadPhase("error");
        setLoadErrorCode(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [personaService],
  );

  // 进入分区读取一次（只打开页面不启用执行/学习：这里只有读，不初始化、不写任何设置）。
  useEffect(() => {
    void reload({ reseed: true });
  }, [reload]);

  // focus 重读（spec §10：focus/显式刷新重读；不覆盖脏草稿）。
  useEffect(() => {
    const handleFocus = (): void => {
      void reload({ reseed: false });
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [reload]);

  // 确定性预览：本地模板编译（previewPersona 零存储访问、不请求模型），草稿变化后去抖刷新。
  useEffect(() => {
    if (!draftState) return;
    const draft = draftState.core;
    const generation = ++previewGenRef.current;
    setPreviewPending(true);
    const timer = setTimeout(() => {
      personaService
        .previewPersona({ draft: { ...draft } })
        .then((result) => {
          if (generation !== previewGenRef.current) return;
          setPreviewPending(false);
          if (result.ok) {
            setPreview(result.value);
            setPreviewErrorCode(null);
          } else {
            setPreview(null);
            setPreviewErrorCode(result.code);
          }
        })
        .catch((cause: unknown) => {
          if (generation !== previewGenRef.current) return;
          setPreviewPending(false);
          setPreview(null);
          setPreviewErrorCode(cause instanceof Error ? cause.message : String(cause));
        });
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [draftState?.core, personaService]);

  const handleSave = useCallback(async () => {
    if (!draftState || savePending) return;
    if (!saved?.initialized) {
      setNotice({ tone: "error", kind: "uninitialized" });
      return;
    }
    setSavePending(true);
    setNotice(null);
    try {
      await runUserActionAsync({
        input: {
          featureId: "settings.drora",
          action: "save_persona_core",
          trigger: "button",
        },
        operation: async () => {
          // 结果未知的上一次尝试在途：重试必须复用同一 mutationId（合同 §2 幂等回放）。
          const mutationId = liveMutationIdsRef.current.update ?? createMutationId();
          liveMutationIdsRef.current.update = mutationId;
          const result = await personaService.updatePersonaCore({
            expectedRevision: draftState.seedRevision,
            patch: { ...draftState.core },
            mutationId,
          });
          if (!result.ok) {
            if (result.code === PERSONA_ERROR_CODES.revisionConflict) {
              // CAS 冲突：确定性拒绝（不写 receipt），清除在途 ID，保留草稿并拉取最新版本。
              delete liveMutationIdsRef.current.update;
              await reload({ reseed: false });
              setNotice({ tone: "error", kind: "conflict" });
            } else if (result.code === PERSONA_ERROR_CODES.uninitialized) {
              delete liveMutationIdsRef.current.update;
              setNotice({ tone: "error", kind: "uninitialized" });
            } else if (result.code === PERSONA_ERROR_CODES.outcomeUnknown) {
              // 结果未知：保留同一 mutationId，重试同 ID 幂等回放，不显示失败后换新 ID 重写。
              setNotice({ tone: "info", kind: "outcomeUnknown" });
            } else {
              // 其余封闭错误码是确定性拒绝：清除在途 ID，下次提交换新 ID。
              delete liveMutationIdsRef.current.update;
              setNotice({ tone: "error", kind: "code", code: result.code });
            }
            return;
          }
          delete liveMutationIdsRef.current.update;
          setNotice(
            result.value.status === "saved"
              ? { tone: "success", kind: "saved" }
              : { tone: "success", kind: "unchanged" },
          );
          // 保存成功后重读版本（spec §10），草稿基线对齐新 revision。
          await reload({ reseed: true });
        },
        completed: { resultSource: "authority_ack" },
        failureStage: "persona_commit",
      });
    } catch (cause) {
      // RPC 层失败（断线/超时）同样结果未知：保留 mutationId 供重试同 ID 回放（合同 §2）。
      setNotice({
        tone: "error",
        kind: "rpc",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setSavePending(false);
    }
  }, [draftState, savePending, saved?.initialized, personaService, reload]);

  const handleCancelDraft = useCallback(() => {
    setDraftState((current) =>
      current
        ? { core: current.seed, seed: current.seed, seedRevision: current.seedRevision }
        : current,
    );
    setNotice(null);
    setAcknowledgedRevision(null);
  }, []);

  const handleInitialize = useCallback(async () => {
    if (initializePending) return;
    setInitializePending(true);
    setNotice(null);
    try {
      await runUserActionAsync({
        input: {
          featureId: "settings.drora",
          action: "initialize_persona",
          trigger: "button",
        },
        operation: async () => {
          // 结果未知的上一次尝试在途：重试必须复用同一 mutationId（合同 §2 幂等回放）。
          const mutationId = liveMutationIdsRef.current.initialize ?? createMutationId();
          liveMutationIdsRef.current.initialize = mutationId;
          const result = await personaService.initializePersona({ mutationId });
          if (!result.ok) {
            if (result.code === PERSONA_ERROR_CODES.outcomeUnknown) {
              setNotice({ tone: "info", kind: "outcomeUnknown" });
            } else {
              // 确定性拒绝（校验/未初始化/存储等）：清除在途 ID，下次提交换新 ID。
              delete liveMutationIdsRef.current.initialize;
              setNotice({ tone: "error", kind: "code", code: result.code });
            }
            return;
          }
          delete liveMutationIdsRef.current.initialize;
          setNotice({ tone: "info", kind: "initialized" });
          // 初始化后草稿基线对齐服务事实；脏草稿保留，由 revision 分歧面板引导。
          await reload({ reseed: !draftDirty });
        },
        completed: { resultSource: "authority_ack" },
        failureStage: "persona_commit",
      });
    } catch (cause) {
      // RPC 层失败（断线/超时）同样结果未知：保留 mutationId 供重试同 ID 回放（合同 §2）。
      setNotice({
        tone: "error",
        kind: "rpc",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setInitializePending(false);
    }
  }, [initializePending, personaService, reload, draftDirty]);

  const handleResetDefaults = useCallback(async () => {
    if (resetPending || !draftState) return;
    setResetPending(true);
    setNotice(null);
    try {
      await runUserActionAsync({
        input: {
          featureId: "settings.drora",
          action: "reset_persona_core",
          trigger: "button",
        },
        operation: async () => {
          // 结果未知的上一次尝试在途：重试必须复用同一 mutationId（合同 §2 幂等回放）。
          const mutationId = liveMutationIdsRef.current.reset ?? createMutationId();
          liveMutationIdsRef.current.reset = mutationId;
          const result = await personaService.resetPersonaCore({
            expectedRevision: draftState.seedRevision,
            mutationId,
          });
          if (!result.ok) {
            if (result.code === PERSONA_ERROR_CODES.revisionConflict) {
              delete liveMutationIdsRef.current.reset;
              await reload({ reseed: false });
              setNotice({ tone: "error", kind: "conflict" });
            } else if (result.code === PERSONA_ERROR_CODES.outcomeUnknown) {
              // 结果未知：保留同一 mutationId，重试同 ID 幂等回放（PM53）。
              setNotice({ tone: "info", kind: "outcomeUnknown" });
            } else {
              delete liveMutationIdsRef.current.reset;
              setNotice({ tone: "error", kind: "code", code: result.code });
            }
            return;
          }
          delete liveMutationIdsRef.current.reset;
          // 恢复产品默认是明确的 Core 更新（合同 §1.1）：只动五字段，不改 E/U/L、不删偏好。
          setNotice({ tone: "success", kind: "saved" });
          await reload({ reseed: true });
        },
        completed: { resultSource: "authority_ack" },
        failureStage: "persona_commit",
      });
    } catch (cause) {
      // RPC 层失败（断线/超时）同样结果未知：保留 mutationId 供重试同 ID 回放（合同 §2）。
      setNotice({
        tone: "error",
        kind: "rpc",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setResetPending(false);
      setResetConfirmOpen(false);
    }
  }, [resetPending, draftState, personaService, reload]);

  const handleDiscardDraftAndReload = useCallback(async () => {
    setAcknowledgedRevision(null);
    setNotice(null);
    await runUserActionAsync({
      input: {
        featureId: "settings.drora",
        action: "discard_persona_draft",
        trigger: "button",
      },
      operation: () => reload({ reseed: true }),
      completed: { resultSource: "local_commit" },
      failureStage: "local_commit",
    });
  }, [reload]);

  const handleKeepDraft = useCallback(() => {
    runUserAction({
      input: {
        featureId: "settings.drora",
        action: "keep_persona_draft",
        trigger: "button",
      },
      operation: () => {
        if (saved) setAcknowledgedRevision(saved.revision);
        setNotice(null);
      },
      completed: { resultSource: "local_commit" },
      failureStage: "local_commit",
    });
  }, [saved]);

  const handleRefresh = useCallback(() => {
    // 显式刷新（focus 重读不包遥测：那是被动重读，不是用户动作）。
    void runUserActionAsync({
      input: {
        featureId: "settings.drora",
        action: "refresh_persona",
        trigger: "button",
      },
      operation: () => reload({ reseed: false }),
      completed: { resultSource: "authority_ack" },
      failureStage: "persona_read",
    });
  }, [reload]);

  const updateDraftField = useCallback((patch: Partial<PersonaEditableCore>) => {
    setDraftState((current) =>
      current ? { ...current, core: { ...current.core, ...patch } } : current,
    );
  }, []);

  return {
    loadPhase,
    loadErrorCode,
    saved,
    draftState,
    notice,
    savePending,
    initializePending,
    resetPending,
    resetConfirmOpen,
    setResetConfirmOpen,
    preview,
    previewPending,
    previewErrorCode,
    draftDirty,
    showDivergence,
    reload,
    handleSave,
    handleCancelDraft,
    handleInitialize,
    handleResetDefaults,
    handleDiscardDraftAndReload,
    handleKeepDraft,
    handleRefresh,
    updateDraftField,
  };
}

export type PersonaCoreEditor = ReturnType<typeof usePersonaCoreEditor>;
