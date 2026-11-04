import { useCallback, useEffect, useRef, useState } from "react";
import type { IDroraAgentService } from "@drora/services";
import {
  PERSONA_ERROR_CODES,
  type PersonaCoreSnapshot,
  type PersonaEditableCore,
  type PersonaOverviewInitialized,
  type PersonaProductTemplateSummary,
} from "@drora/shared";
import {
  runUserAction,
  runUserActionAsync,
  type UserActionTrigger,
} from "@/lib/userActionTelemetry.js";

/**
 * Drora 人格身份编辑的状态机（specs/drora-persona-system.md §10、合同 §2/§3）：
 * 已保存快照（服务权威）、局部草稿（seed+seedRevision 做 CAS 基线）、CAS 冲突保留草稿、
 * focus/显式刷新重读不覆盖脏草稿、确定性预览去抖。展示层（PersonaSettingsSection）只消费本 hook。
 *
 * 即时保存（spec §10 第十六批）：不再提供整块保存按钮——离散选择（warmth/directness/humor）
 * 变更即提交，文本字段（displayName/selfDescription）失焦或停顿约 1 秒后提交，分区卸载前
 * flush 未落盘文本。提交复用既有写路径与幂等契约（mutationId、CAS expectedRevision、
 * outcome_unknown 同 ID 回放），只改触发时机不改语义。服务 revision ≠ 草稿基线（CAS 分歧
 * 未解决）时暂停自动提交，由分歧面板引导；分歧中的后续编辑保持面板可见。未初始化不自动提交。
 * 保存成功后按字段做三路合并再变基（草稿基线对齐新 revision，同时保留保存期间的新编辑），
 * 编辑在写入在途期间不会丢失。
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
  // P1b 有限学习管理（合同 §3 allowLearningForKey＋读侧概览；spec §5/§8）。
  | "allowLearningForKey"
  | "getPersonaLearningOverview"
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

const CORE_FIELD_KEYS = [
  "displayName",
  "selfDescription",
  "warmth",
  "directness",
  "humor",
] as const satisfies readonly (keyof PersonaEditableCore)[];
type CoreFieldKey = (typeof CORE_FIELD_KEYS)[number];

/** 离散选择字段：变更即提交（即时保存的「选择即存」路径，spec §10 第十六批）。 */
const DISCRETE_CORE_FIELDS: readonly CoreFieldKey[] = ["warmth", "directness", "humor"];

/** 文本字段自动提交的去抖间隔（spec §10「停顿约 1 秒」）。 */
const AUTOSAVE_IDLE_MS = 1000;
/** 写入在途时自动提交的顺延重试间隔（不并发两条写，顺延到在途完成后结算）。 */
const AUTOSAVE_PENDING_RETRY_MS = 400;

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

  // 即时保存的同步镜像：定时器/flush/卸载回调运行时读 ref 而不是闭包 state，
  // 保证「改完立即提交」「停顿后提交」「卸载 flush」拿到的都是最新草稿与权威快照。
  const draftRef = useRef<PersonaDraftState | null>(null);
  const savedRef = useRef<PersonaSavedSnapshot | null>(null);
  const savePendingRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<(trigger?: UserActionTrigger) => Promise<void>>(async () => {});
  const flushRef = useRef<(trigger?: UserActionTrigger) => Promise<void>>(async () => {});

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const scheduleAutosave = useCallback(
    (delay: number = AUTOSAVE_IDLE_MS) => {
      clearAutosaveTimer();
      autosaveTimerRef.current = setTimeout(() => {
        autosaveTimerRef.current = null;
        if (savePendingRef.current) {
          // 写入在途：不并发第二条写，顺延到在途完成后结算（草稿仍在 ref 中，不会丢）。
          scheduleAutosave(AUTOSAVE_PENDING_RETRY_MS);
          return;
        }
        void flushRef.current("keyboard");
      }, delay);
    },
    [clearAutosaveTimer],
  );

  const draftDirty = draftState !== null && !personaCoreEquals(draftState.core, draftState.seed);
  const savedDiverged = draftDirty && saved !== null && saved.revision !== draftState.seedRevision;
  const showDivergence = savedDiverged && saved.revision !== acknowledgedRevision;

  /**
   * 读取服务权威快照（getPersonaOverview + getPersonaCore），返回新快照供调用方变基。
   * reseed=true（保存/初始化/恢复默认之后，或显式放弃草稿）时草稿无条件跟随服务值；
   * reseed=false（focus/显式刷新）只在草稿未改动时静默跟随，脏草稿原样保留，
   * 由 revision 分歧面板提示（跨窗口以服务 revision 为权威，但不静默覆盖编辑）。
   */
  const reload = useCallback(
    async (options: { reseed: boolean }): Promise<PersonaSavedSnapshot | null> => {
      const generation = ++reloadGenRef.current;
      setLoadPhase("loading");
      setLoadErrorCode(null);
      try {
        const [overviewResult, coreResult] = await Promise.all([
          personaService.getPersonaOverview(),
          personaService.getPersonaCore(),
        ]);
        if (generation !== reloadGenRef.current) return null;
        if (!overviewResult.ok) {
          setLoadPhase("error");
          setLoadErrorCode(overviewResult.code);
          return null;
        }
        if (!coreResult.ok) {
          setLoadPhase("error");
          setLoadErrorCode(coreResult.code);
          return null;
        }
        const nextSaved = toSavedSnapshot(overviewResult.value, coreResult.value);
        setSaved(nextSaved);
        savedRef.current = nextSaved;
        const current = draftRef.current;
        const draftClean = !current || personaCoreEquals(current.core, current.seed);
        if (options.reseed || draftClean) {
          const reseeded = {
            core: nextSaved.core,
            seed: nextSaved.core,
            seedRevision: nextSaved.revision,
          };
          draftRef.current = reseeded;
          setDraftState(reseeded);
        } else {
          setDraftState(current);
        }
        setLoadPhase("ready");
        return nextSaved;
      } catch (cause) {
        if (generation !== reloadGenRef.current) return null;
        // 旧 CLI / 控制端口缺席 / 断线都落在 RPC 错误：按不可用诚实降级，不试发 persona 方法。
        setLoadPhase("error");
        setLoadErrorCode(cause instanceof Error ? cause.message : String(cause));
        return null;
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

  /**
   * 提交当前草稿（自动保存与显式重试共用同一条写路径）。触发时机由调度层决定：
   * select=离散选择即存、keyboard=文本失焦/停顿/卸载 flush、button=保留给显式重试。
   * 成功后重读并按字段三路合并变基：保存期间的新编辑不丢，脏合并结果重新调度提交。
   */
  const handleSave = useCallback(
    async (trigger: UserActionTrigger = "keyboard"): Promise<void> => {
      const draft = draftRef.current;
      if (!draft || savePendingRef.current) return;
      if (!savedRef.current?.initialized) {
        // 未初始化不自动提交（spec §10 第十六批）；初始化是显式动作。
        setNotice({ tone: "error", kind: "uninitialized" });
        return;
      }
      savePendingRef.current = true;
      setSavePending(true);
      setNotice(null);
      const savedCoreAtStart = { ...draft.core };
      try {
        await runUserActionAsync({
          input: {
            featureId: "settings.drora",
            action: "save_persona_core",
            trigger,
          },
          operation: async () => {
            // 结果未知的上一次尝试在途：重试必须复用同一 mutationId（合同 §2 幂等回放）。
            const mutationId = liveMutationIdsRef.current.update ?? createMutationId();
            liveMutationIdsRef.current.update = mutationId;
            const result = await personaService.updatePersonaCore({
              expectedRevision: draft.seedRevision,
              patch: { ...draft.core },
              mutationId,
            });
            if (!result.ok) {
              if (result.code === PERSONA_ERROR_CODES.revisionConflict) {
                // CAS 冲突：确定性拒绝（不写 receipt），清除在途 ID，保留草稿并拉取最新版本；
                // 分歧面板为唯一解决面，自动提交从此暂停（flush 的 diverged 守卫）。
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
            // 保存成功后重读版本（spec §10），草稿基线对齐新 revision；按字段三路合并保留
            // 保存期间的新编辑（快速连续修改不丢），合并后仍脏则重新调度自动提交。
            // 在途编辑必须在 reload 前捕获——reseed 会先重置草稿。
            const draftDuringSave = draftRef.current;
            const nextSaved = await reload({ reseed: true });
            if (!nextSaved) return;
            const mergedCore: PersonaEditableCore = { ...nextSaved.core };
            if (draftDuringSave) {
              for (const key of CORE_FIELD_KEYS) {
                const duringValue = draftDuringSave.core[key];
                if (duringValue !== savedCoreAtStart[key]) {
                  // 在途编辑的值来自合法的 PersonaEditableCore；泛型键索引丢失字面量收窄，
                  // 这里经 Record 视图回写（运行时值必为该字段的合法成员）。
                  (mergedCore as Record<CoreFieldKey, string>)[key] = duringValue;
                }
              }
            }
            const rebased = {
              core: mergedCore,
              seed: nextSaved.core,
              seedRevision: nextSaved.revision,
            };
            draftRef.current = rebased;
            setDraftState(rebased);
            if (!personaCoreEquals(rebased.core, rebased.seed)) {
              scheduleAutosave();
            }
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
        savePendingRef.current = false;
        setSavePending(false);
      }
    },
    [personaService, reload, scheduleAutosave],
  );

  useEffect(() => {
    commitRef.current = handleSave;
  }, [handleSave]);

  /**
   * 立即结算当前草稿（失焦/离散选择/卸载 flush 共用）。守卫顺序：在途并发、未初始化、
   * 无实际改动、CAS 分歧未解决（自动提交暂停，分歧面板引导）。
   */
  const flushDraftSave = useCallback(
    async (trigger: UserActionTrigger = "keyboard") => {
      clearAutosaveTimer();
      const draft = draftRef.current;
      if (!draft || savePendingRef.current) return;
      const savedNow = savedRef.current;
      if (!savedNow?.initialized) return;
      if (personaCoreEquals(draft.core, draft.seed)) return;
      if (savedNow.revision !== draft.seedRevision) return;
      await commitRef.current(trigger);
    },
    [clearAutosaveTimer],
  );

  useEffect(() => {
    flushRef.current = flushDraftSave;
  }, [flushDraftSave]);

  // 分区卸载前提交未落盘文本（spec §10 第十六批）；定时器一并清理，防止卸载后触发。
  useEffect(() => {
    return () => {
      clearAutosaveTimer();
      const draft = draftRef.current;
      if (!draft || savePendingRef.current) return;
      const savedNow = savedRef.current;
      if (!savedNow?.initialized) return;
      if (personaCoreEquals(draft.core, draft.seed)) return;
      if (savedNow.revision !== draft.seedRevision) return;
      void commitRef.current("keyboard");
    };
  }, [clearAutosaveTimer]);

  /** 单字段回退（替代整块「放弃修改」按钮，spec §10 第十六批）：该字段回到已保存值。 */
  const revertField = useCallback((field: CoreFieldKey) => {
    const current = draftRef.current;
    if (!current) return;
    const next = {
      ...current,
      core: { ...current.core, [field]: current.seed[field] } as PersonaEditableCore,
    };
    draftRef.current = next;
    setDraftState(next);
    // 其余字段若仍有未落盘改动则立即结算；全部干净时 flush 自行空转。
    void flushRef.current("keyboard");
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
    const draftAtStart = draftRef.current;
    if (resetPending || !draftAtStart) return;
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
            expectedRevision: draftAtStart.seedRevision,
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
  }, [resetPending, personaService, reload]);

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
        if (savedRef.current) setAcknowledgedRevision(savedRef.current.revision);
        setNotice(null);
      },
      completed: { resultSource: "local_commit" },
      failureStage: "local_commit",
    });
  }, []);

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

  const updateDraftField = useCallback(
    (patch: Partial<PersonaEditableCore>) => {
      const current = draftRef.current;
      if (!current) return;
      const next = { ...current, core: { ...current.core, ...patch } };
      draftRef.current = next;
      // 分歧未解决时清除「保留草稿」承认：后续编辑保持分歧面板可见（spec §10 第十六批）。
      const savedNow = savedRef.current;
      if (savedNow && savedNow.revision !== current.seedRevision) {
        setAcknowledgedRevision(null);
      }
      setDraftState(next);
      // 离散选择即存（trigger=select）；文本字段去抖（trigger=keyboard），失焦由展示层 flush。
      const discrete = DISCRETE_CORE_FIELDS.some((field) => field in patch);
      if (discrete) {
        void flushRef.current("select");
      } else {
        scheduleAutosave();
      }
    },
    [scheduleAutosave],
  );

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
    flushDraftSave,
    revertField,
    handleInitialize,
    handleResetDefaults,
    handleDiscardDraftAndReload,
    handleKeepDraft,
    handleRefresh,
    updateDraftField,
  };
}

export type PersonaCoreEditor = ReturnType<typeof usePersonaCoreEditor>;
