import { useCallback, useEffect, useRef, useState } from "react";
import {
  PERSONA_ERROR_CODES,
  PERSONA_POLICY_DEFAULTS,
  PERSONA_PREFERENCE_KEYS,
  type PersonaLearningOverview,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { logger } from "@/logger.js";
import { runUserActionAsync, type UserActionTrigger } from "@/lib/userActionTelemetry.js";
import {
  PREFERENCE_KEY_LIST,
  PERSONA_EXPORT_FILE_NAME,
  createEmptySlots,
  encodeExportPayload,
  isPreferenceSlotDirty,
  type PersonaExportNotice,
  type PersonaPolicyState,
  type PersonaPolicySwitch,
  type PersonaPreferenceSlot,
  type PersonaPreferencesService,
  type PersonaSaveFilePort,
} from "./personaPreferenceModel.js";

/**
 * Drora Persona「交流默认、使用策略与有限学习管理」的状态机（specs/drora-persona-system.md
 * §5/§8/§9/§10、docs/design/drora-persona-data-contracts-2026-10-29.md §1.2/§2/§3/§4.2/§7）。
 * 复用 usePersonaCoreEditor 的模式：服务权威值 + 局部草稿（seedRevision 做 CAS 基线）、
 * 冲突保留草稿并重读比较、outcome_unknown 保留同一 mutationId 幂等回放（PM53）、
 * 每键独立在途 mutationId；P1b 概览读路径见合同 §3。
 * 即时保存（spec §10 第十六批）：下拉键变更即提交，称呼文本失焦/停顿约 1 秒提交，卸载前
 * flush；服务 revision ≠ 草稿基线（分歧未解决）时暂停自动提交。保存成功后若草稿在同一
 * 基线上又出现新编辑，变基到本次成功写入的新基线（中间写入是自己的保存，不覆盖他窗值）；
 * 基线不一致的草稿交由分歧流程，不做 last-write-wins。类型与纯函数见 personaPreferenceModel.ts。
 */

/** 文本输入键：即时保存走失焦/停顿去抖；其余键是受控下拉，变更即提交（spec §10 第十六批）。 */
const TEXT_PREFERENCE_KEYS: readonly PersonaPreferenceKey[] = [
  PERSONA_PREFERENCE_KEYS.preferredAddress,
];

/** 文本键自动提交的去抖间隔（spec §10「停顿约 1 秒」）。 */
const AUTOSAVE_IDLE_MS = 1000;
/** 该键写入在途时自动提交的顺延重试间隔（同一槽串行编辑，不并发两条写）。 */
const AUTOSAVE_PENDING_RETRY_MS = 400;

function createMutationId(): string {
  // mutationId 每次用户提交新生成（合同 §2）；opaque，不从昵称/cwd/用户文本推导。
  // 与 usePersonaCoreEditor 同规则；该文件未导出此工具，这里保持各自文件私有。
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") return cryptoRef.randomUUID();
  return `mutation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** 该键的自动提交是否被暂停：服务 revision ≠ 草稿基线（CAS 分歧未解决，面板引导）。 */
function isSlotAutosavePaused(slot: PersonaPreferenceSlot): boolean {
  if (!slot.draft) return false;
  return (slot.saved?.revision ?? 0) !== slot.draft.seedRevision;
}

export function usePersonaPreferences(
  personaService: PersonaPreferencesService,
  saveFile?: PersonaSaveFilePort,
) {
  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "error">("loading");
  const [loadErrorCode, setLoadErrorCode] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const initializedRef = useRef(false);
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
  // 即时保存的同步镜像：定时器/flush/卸载回调读 ref 而不是闭包 state（与 usePersonaCoreEditor 同模式）。
  const slotsRef = useRef<Record<PersonaPreferenceKey, PersonaPreferenceSlot>>(createEmptySlots());
  const prefTimersRef = useRef<
    Partial<Record<PersonaPreferenceKey, ReturnType<typeof setTimeout>>>
  >({});
  const commitPreferenceRef = useRef<
    (key: PersonaPreferenceKey, trigger?: UserActionTrigger) => Promise<void>
  >(async () => {});

  /** slots 的唯一写入通道：同步推进 ref 再落 state，供调度层读到最新槽状态。 */
  const applySlots = useCallback(
    (
      updater: (
        current: Record<PersonaPreferenceKey, PersonaPreferenceSlot>,
      ) => Record<PersonaPreferenceKey, PersonaPreferenceSlot>,
    ) => {
      const next = updater(slotsRef.current);
      slotsRef.current = next;
      setSlots(next);
    },
    [],
  );

  const clearPrefTimer = useCallback((key: PersonaPreferenceKey) => {
    const timer = prefTimersRef.current[key];
    if (timer !== undefined) {
      clearTimeout(timer);
      delete prefTimersRef.current[key];
    }
  }, []);

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
      initializedRef.current = overviewResult.value.state === "initialized";
      applySlots((current) => {
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
  }, [personaService, refreshLearningOverview, applySlots]);

  // 进入分区读取一次；只读，不写任何设置、不为导出/偏好初始化资料（spec §9）。
  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 立即结算该键草稿（自动保存共用路径）。守卫顺序：在途互斥、未初始化（不自动提交）、
   * 无实际改动、CAS 分歧未解决（自动提交暂停，分歧面板为唯一解决面）。
   */
  const flushPreferenceSave = useCallback(
    async (key: PersonaPreferenceKey, trigger: UserActionTrigger = "keyboard"): Promise<void> => {
      clearPrefTimer(key);
      const slot = slotsRef.current[key];
      if (!slot?.draft) return;
      if (slot.pending || slot.forgetPending || slot.allowPending) return;
      if (!initializedRef.current) return;
      if (!isPreferenceSlotDirty(slot)) return;
      if (isSlotAutosavePaused(slot)) return;
      // 称呼清空不算一次提交意图（清空语义走「忘记」按钮）；与旧版客户端禁存口径一致。
      if (
        key === PERSONA_PREFERENCE_KEYS.preferredAddress &&
        slot.draft.value.trim().length === 0
      ) {
        return;
      }
      await commitPreferenceRef.current(key, trigger);
    },
    [clearPrefTimer],
  );

  const flushPreferenceRef = useRef(flushPreferenceSave);
  useEffect(() => {
    flushPreferenceRef.current = flushPreferenceSave;
  }, [flushPreferenceSave]);

  const schedulePreferenceSave = useCallback(
    (key: PersonaPreferenceKey, delay: number = AUTOSAVE_IDLE_MS) => {
      clearPrefTimer(key);
      prefTimersRef.current[key] = setTimeout(() => {
        delete prefTimersRef.current[key];
        const slot = slotsRef.current[key];
        if (slot?.pending || slot?.forgetPending || slot?.allowPending) {
          // 该键写入在途：顺延到在途完成后结算（草稿仍在槽里，不会丢）。
          schedulePreferenceSave(key, AUTOSAVE_PENDING_RETRY_MS);
          return;
        }
        void flushPreferenceRef.current(key, "keyboard");
      }, delay);
    },
    [clearPrefTimer],
  );

  // 分区卸载前提交未落盘的文本键草稿（spec §10 第十六批）；定时器一并清理。
  useEffect(() => {
    return () => {
      for (const key of PREFERENCE_KEY_LIST) {
        clearPrefTimer(key);
      }
      for (const key of PREFERENCE_KEY_LIST) {
        const slot = slotsRef.current[key];
        if (!slot?.draft) continue;
        if (slot.pending || slot.forgetPending || slot.allowPending) continue;
        if (!initializedRef.current) continue;
        if (!isPreferenceSlotDirty(slot)) continue;
        if (isSlotAutosavePaused(slot)) continue;
        void commitPreferenceRef.current(key, "keyboard");
      }
    };
  }, [clearPrefTimer]);

  const patchSlot = useCallback(
    (key: PersonaPreferenceKey, patch: Partial<PersonaPreferenceSlot>) => {
      applySlots((current) => {
        const slot = current[key];
        if (!slot) return current;
        return { ...current, [key]: { ...slot, ...patch } };
      });
    },
    [applySlots],
  );

  const updatePreferenceDraft = useCallback(
    (key: PersonaPreferenceKey, value: string) => {
      applySlots((current) => {
        const slot = current[key];
        if (!slot) return current;
        const draft = slot.draft ?? {
          value,
          seedValue: slot.saved?.value ?? "",
          seedRevision: slot.saved?.revision ?? 0,
        };
        // 分歧未解决时清除「保留草稿」承认：后续编辑保持分歧面板可见（spec §10 第十六批）。
        const diverged = (slot.saved?.revision ?? 0) !== draft.seedRevision;
        return {
          ...current,
          [key]: {
            ...slot,
            draft: { ...draft, value },
            notice: null,
            acknowledgedRevision: diverged ? null : slot.acknowledgedRevision,
          },
        };
      });
      // 即时保存调度（spec §10 第十六批）：下拉键变更即提交；文本键去抖；在途时顺延结算。
      const slot = slotsRef.current[key];
      const busy = slot?.pending || slot?.forgetPending || slot?.allowPending;
      if (TEXT_PREFERENCE_KEYS.includes(key) || busy) {
        schedulePreferenceSave(key);
      } else {
        void flushPreferenceRef.current(key, "select");
      }
    },
    [applySlots, schedulePreferenceSave],
  );

  const cancelPreferenceDraft = useCallback(
    (key: PersonaPreferenceKey) => {
      clearPrefTimer(key);
      patchSlot(key, { draft: null, notice: null, acknowledgedRevision: null });
    },
    [patchSlot, clearPrefTimer],
  );

  const keepPreferenceDraft = useCallback(
    (key: PersonaPreferenceKey) => {
      // 保留草稿：承认当前服务 revision；revision 再前进才重新提示分歧。
      // 自动提交保持暂停（分歧守卫按原始 revision 比较），面板是唯一解决面。
      applySlots((current) => {
        const slot = current[key];
        if (!slot) return current;
        return {
          ...current,
          [key]: { ...slot, acknowledgedRevision: slot.saved?.revision ?? 0, notice: null },
        };
      });
    },
    [applySlots],
  );

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

  /**
   * 单键保存：CAS 携带草稿基线 revision（槽缺席=0）与本键在途/新 mutationId；成功后重读。
   * 成功后的草稿结算：草稿仍是刚保存的值 → 清空结算完成；保存期间在同一基线上又出现新编辑
   * → 变基到本次成功写入的新基线（中间写入是自己的保存，变基不覆盖他窗值）并继续调度；
   * 基线不一致的草稿保持原样，由分歧流程引导。
   */
  const handleSavePreference = useCallback(
    async (key: PersonaPreferenceKey, trigger: UserActionTrigger = "button"): Promise<void> => {
      const slot = slotsRef.current[key];
      const draft = slot?.draft;
      if (!slot || !draft || slot.pending || slot.forgetPending || slot.allowPending) return;
      if (!initializedRef.current) {
        patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
        return;
      }
      const attemptedValue = draft.value;
      const attemptedSeedRevision = draft.seedRevision;
      patchSlot(key, { pending: true, notice: null });
      try {
        await runUserActionAsync({
          input: {
            featureId: "settings.drora",
            action: "save_persona_preference",
            trigger,
          },
          operation: async () => {
            // 结果未知的上一次尝试在途：重试必须复用同一 mutationId（合同 §2/PM53）。
            const mutationId = liveSaveMutationIdsRef.current[key] ?? createMutationId();
            liveSaveMutationIdsRef.current[key] = mutationId;
            const result = await personaService.savePreference({
              key,
              value: attemptedValue,
              expectedRevision: attemptedSeedRevision,
              mutationId,
            });
            if (!result.ok) {
              await applySlotMutationFailure(key, result.code, liveSaveMutationIdsRef.current);
              return;
            }
            delete liveSaveMutationIdsRef.current[key];
            // 通知先贴；草稿不在此时清空——保存期间可能已有新编辑，重读后统一结算。
            patchSlot(key, {
              notice: {
                tone: "success",
                kind: result.value.status === "saved" ? "saved" : "unchanged",
              },
            });
            // 保存成功后重读（spec §10）：以服务为权威刷新全部键的当前值。
            await reload();
            // 草稿结算（见函数注释）：仍是刚保存的值→清空；同一基线上的新编辑→变基到
            // 本次成功写入的新基线（中间写入是自己的保存）并继续调度；基线不一致→交分歧流程。
            applySlots((current) => {
              const fresh = current[key];
              if (!fresh) return current;
              let nextDraft = fresh.draft;
              if (nextDraft && nextDraft.value === attemptedValue) {
                nextDraft = null;
              } else if (nextDraft && nextDraft.seedRevision === attemptedSeedRevision) {
                nextDraft = {
                  ...nextDraft,
                  seedValue: fresh.saved?.value ?? "",
                  seedRevision: fresh.saved?.revision ?? 0,
                };
              }
              return {
                ...current,
                [key]: { ...fresh, draft: nextDraft, acknowledgedRevision: null },
              };
            });
            const after = slotsRef.current[key];
            if (after?.draft && isPreferenceSlotDirty(after) && !isSlotAutosavePaused(after)) {
              schedulePreferenceSave(key);
            }
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
    [
      personaService,
      reload,
      patchSlot,
      applySlotMutationFailure,
      applySlots,
      schedulePreferenceSave,
    ],
  );

  useEffect(() => {
    commitPreferenceRef.current = handleSavePreference;
  }, [handleSavePreference]);

  /** 单键忘记：需确认（逻辑撤销范围见确认文案）；CAS 槽缺席=0；成功后重读。 */
  const handleForgetPreference = useCallback(
    async (key: PersonaPreferenceKey): Promise<void> => {
      const slot = slotsRef.current[key];
      if (!slot || slot.forgetPending || slot.pending || slot.allowPending) return;
      if (!initializedRef.current) {
        patchSlot(key, { notice: { tone: "error", kind: "uninitialized" } });
        return;
      }
      clearPrefTimer(key);
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
    [personaService, reload, patchSlot, applySlotMutationFailure, clearPrefTimer],
  );

  /**
   * 解除该键自动学习抑制（合同 §3 allowLearningForKey、§4.2）：CAS 携带该键当前
   * generation；成功（saved/unchanged）后重读。争议不由它解决——保存/忘记才是
   * 争议解决路径（合同 §8），界面不提供「解除争议」按钮。
   */
  const handleAllowLearning = useCallback(
    async (key: PersonaPreferenceKey): Promise<void> => {
      const slot = slotsRef.current[key];
      if (!slot || slot.allowPending || slot.pending || slot.forgetPending) return;
      if (!initializedRef.current) {
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
    [personaService, reload, patchSlot, applySlotMutationFailure],
  );

  /**
   * U/L 策略开关（spec §5）：两态各自显式提交 setPersonalPolicy；当前值以
   * learningOverview.policy 为准（getPersonaLearningOverview 读路径）。
   * - 开启 L：同时携带 usePreferences=true（学习前置＝U&&L，一次 CAS 完成一致状态）；
   * - 关闭 L：保持 overview 观察到的 U 值不变（不知道 U 时按钮禁用，不用猜测值发请求）；
   * - 关闭 U：只提交 usePreferences=false——级联（同事务关 L、撤租约、清未提交候选/负载）
   *   由 CLI 存储侧执行（合同 §4.2）；重新开启 U 不恢复 L。
   */
  const handleSetPolicy = useCallback(
    async (usePreferences: boolean, autoLearn?: boolean): Promise<void> => {
      if (policy.pending) return;
      if (!initializedRef.current) {
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
            trigger: "switch",
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
    [policy.pending, personaService, refreshLearningOverview],
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
    flushPreferenceSave,
    requestForget: setForgetCandidate,
    cancelForget,
    handleForgetPreference,
    handleAllowLearning,
    handleSetPolicy,
    handleExport,
  };
}

export type PersonaPreferences = ReturnType<typeof usePersonaPreferences>;
