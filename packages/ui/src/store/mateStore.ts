import { create } from "zustand";
import type { AssistantMode } from "@drora/shared";
import type { AssistantResult, IAssistantTicketService } from "@drora/services";

import { logger } from "@/logger.js";
import type { MateFilter, MateLocalUiState } from "@/mate/index.js";

// Mate 工单 store（照 offPeakTaskStore 形态：create 单对象、service 作方法参数注入、
// single-flight+代际丢弃）。与 offPeak 的关键差异：快照本体不进 store——唯一业务事实
// 是 IAssistantTicketService 的 onDidChange 推送（useAssistantTickets 订阅），本 store
// 只存 01 详设 §5 指定的三件 UI 局部态，不复制快照、不建第二条业务状态。
// 三件局部态按 workspace 分域（键=tab.workspaceKey，即 workspaceIdentity?.trim()||
// workspacePath 的 AGENTS 身份键规则）：mate tab 每 workspace 一个且 side pane 对全部
// tab 常挂载，单例不分域会跨 workspace 串扰（PR-1B 二审发现 6）。
// 契约边界见 packages/ui/src/mate/CONTRACT.md（ui-mate 模块）。

/** recordTrigger 入参（类型跟随服务接口，不在 UI 侧另立形状）。 */
type MateRecordTriggerInput = Parameters<IAssistantTicketService["recordTrigger"]>[0];
/** approveDecision 入参（permissionTier 类型层已排除 yolo）。 */
type MateApproveDecisionInput = Parameters<IAssistantTicketService["approveDecision"]>[0];
/** ignoreDecision 入参。 */
type MateIgnoreDecisionInput = Parameters<IAssistantTicketService["ignoreDecision"]>[0];
/** P10b manage 臂人工放行入参（决策卡 Y——事务翻 managed 后异步执行，结果经快照回写）。 */
type MateApproveManageInput = Parameters<IAssistantTicketService["approveManageDecision"]>[0];
/** dismissObservation 入参。 */
type MateDismissObservationInput = Parameters<IAssistantTicketService["dismissObservation"]>[0];
/** P4 第二棒：工件核验人工确认入参。 */
type MateConfirmOutputInput = Parameters<IAssistantTicketService["confirmTicketOutput"]>[0];
/** P4 第二棒：换代增量确认入参。 */
type MateConfirmIncrementsInput = Parameters<IAssistantTicketService["confirmTicketIncrements"]>[0];

/** 无记录 workspace 的初始局部态（模块级常量：zustand 选择器回退需稳定引用防重渲染）。 */
export const EMPTY_MATE_WORKSPACE_STATE: MateLocalUiState = {
  filter: "decision",
  selectedTicketId: null,
  expandedDecisionId: null,
  expandedWorkKeys: [],
};

interface MateState {
  /** 三件 UI 局部态按 workspace 分域；未写入过的 workspace 读到 EMPTY_MATE_WORKSPACE_STATE。 */
  byWorkspace: Record<string, MateLocalUiState>;

  setFilter(workspaceKey: string, filter: MateFilter): void;
  selectTicket(workspaceKey: string, ticketId: string | null): void;
  expandDecision(workspaceKey: string, decisionId: number | null): void;
  /** P8b（09 详设 §1.7）：总览卡 workspace 组展开/收起（幂等 toggle）。 */
  toggleWorkWorkspace(workspaceKey: string, groupKey: string): void;

  /** 本地触发（双测试按钮）；动作经 service，结果由调用方消费（toast 等）。 */
  recordTrigger(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: MateRecordTriggerInput,
  ): Promise<AssistantResult<{ triggerId: string; outcome: string }>>;
  /** 决策卡放行（Y/E 追加说明后放行）；成功后按代际折叠本 workspace 的本卡。 */
  approveDecision(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: MateApproveDecisionInput,
  ): Promise<AssistantResult<{ ticketId: string; sessionId: string }>>;
  /** 决策卡忽略（N）；成功后按代际折叠本 workspace 的本卡。 */
  ignoreDecision(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: MateIgnoreDecisionInput,
  ): Promise<AssistantResult<{ ok: true }>>;
  /**
   * P10b manage 臂人工放行（Y；10 号详设 §3.1）：管理动作批准入口——服务事务翻
   * managed 后异步经既有 harness 服务面执行，结果经快照 manageExecution 回写呈现；
   * 成功后按代际折叠本 workspace 的本卡（approveDecision 同款收尾）。
   */
  approveManageDecision(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: MateApproveManageInput,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** 观察行忽略（would-accept 行 N）。 */
  dismissObservation(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: MateDismissObservationInput,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** 停止工单 mandate（工单行/汇报卡的停止动作）。 */
  stopMandate(
    service: IAssistantTicketService,
    workspaceKey: string,
    ticketId: string,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** 模式切换（auto 由服务侧 P1 恒拒：mate.auto.locked）。 */
  setMode(
    service: IAssistantTicketService,
    workspaceKey: string,
    mode: AssistantMode,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** 名单编辑（每行一个 identity；由调用方拆分传入）。 */
  setAllowlist(
    service: IAssistantTicketService,
    workspaceKey: string,
    identities: readonly string[],
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P7（08 号详设 §3.4）：查询答复卡 dismiss（status_replied → ignored 出清）。 */
  dismissQueryReply(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: { decisionId: number },
  ): Promise<AssistantResult<{ ok: true }>>;
  /** W1 worktree 用户开关（spec §9 W2 兜底；只影响之后的派发规划）。 */
  setWorktreeDisabled(
    service: IAssistantTicketService,
    workspaceKey: string,
    disabled: boolean,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P5 设置中心（06 号详设）：软预算写入（bounds 校验在服务侧 fail-closed）。 */
  setBudget(
    service: IAssistantTicketService,
    workspaceKey: string,
    maxActivePerWorkspace: number,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P5：信任门阈值部分更新（只写传入键）。 */
  setTrustGateThresholds(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: { minRate?: number; minSamples?: number },
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P5：watchdog 轮询间隔（分钟）。 */
  setWatchdogIntervalMinutes(
    service: IAssistantTicketService,
    workspaceKey: string,
    minutes: number,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P9（09 详设 §2.3 闸 5）：自主观察总闸（autonomy_enabled kv；缺省 true）。 */
  setAutonomyEnabled(
    service: IAssistantTicketService,
    workspaceKey: string,
    enabled: boolean,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P9：自主心跳间隔（分钟；bounds=ASSISTANT_CONFIG_LIMITS.autonomyIntervalMinutes）。 */
  setAutonomyIntervalMinutes(
    service: IAssistantTicketService,
    workspaceKey: string,
    minutes: number,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P5：Source 开关配置整体替换（publish 即 reconcile 即时生效）。 */
  setSourcesConfig(
    service: IAssistantTicketService,
    workspaceKey: string,
    config: { feishu?: { enabled: boolean }; phone?: { enabled: boolean }; github?: { enabled: boolean; repo?: string; mentionName?: string } },
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P5：Source 身份映射整体替换（feishu/github 两子表，合并 ≤50 条）。 */
  setSourceIdentityMap(
    service: IAssistantTicketService,
    workspaceKey: string,
    map: { feishu?: Record<string, string>; github?: Record<string, string> },
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P5：大副模型偏好（null=清除回落 CLI 缺省；下一次建会话生效）。 */
  setModelPreference(
    service: IAssistantTicketService,
    workspaceKey: string,
    preference: { providerId: string; modelId: string; reasoningLevel?: string } | null,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P4 第二棒（04 详设 §3）：工件核验人工确认（awaiting_output → done+终态钩子）。 */
  confirmTicketOutput(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: MateConfirmOutputInput,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P4 第二棒（04 详设 §3）：换代增量人工确认（置 increments_confirmed_ms，横幅出清）。 */
  confirmTicketIncrements(
    service: IAssistantTicketService,
    workspaceKey: string,
    input: MateConfirmIncrementsInput,
  ): Promise<AssistantResult<{ ok: true }>>;
  /** P4 配额中心（04 详设 §4）：次日摘要投递回执（MateDigestCard「标记已投递」）。 */
  markDailyDigestDelivered(
    service: IAssistantTicketService,
    workspaceKey: string,
  ): Promise<AssistantResult<{ ok: true }>>;
}

// ---------------------------------------------------------------------------
// 并发纪律（照 offPeakTaskStore 的 single-flight+代际丢弃形态，落在模块级而非 store 态——
// 在途/代际是过程量，不是 UI 局部状态）：
// - single-flight：同 key（workspace+动作+目标内容）的并发调用共享同一在途 Promise——
//   同卡双击只发一次 RPC（P1 验收 4「同卡二次 Y 不二派」的 UI 侧防线；服务侧
//   dispatchIndex 幂等仍兜底）。key 含 workspaceKey：不同 workspace 连不同 Host 服务，
//   admission_decision.id 是每库自增 rowid，跨 workspace 同号不得误并；key 含完整入参，
//   E 改单后的追加段不同不误并。
// - 代际丢弃：动作序号单调递增；动作对 store 局部态的收尾（折叠已处置卡）只在
//   「自己仍是最新动作」时执行——Y 后立刻 N 时，Y 的迟到 ack 不得折叠 N 正在操作的卡。
// ---------------------------------------------------------------------------
let actionGeneration = 0;
const inFlightByKey = new Map<string, Promise<AssistantResult<unknown>>>();

function runSingleFlight<T>(
  key: string,
  run: (generation: number) => Promise<AssistantResult<T>>,
): Promise<AssistantResult<T>> {
  const existing = inFlightByKey.get(key);
  if (existing) return existing as Promise<AssistantResult<T>>;
  const generation = ++actionGeneration;
  const pending = run(generation)
    .catch((error: unknown) => {
      // 传输层异常（服务结果臂之外的 throw）：留 UI 日志后原样上抛，不吞不转义——
      // AssistantResult 的错误码是封闭集合，不能把任意异常硬塞进伪 code。
      logger.warn(`[mate] 动作 ${key} 传输失败`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      if (inFlightByKey.get(key) === pending) inFlightByKey.delete(key);
    });
  inFlightByKey.set(key, pending);
  return pending;
}

export const useMateStore = create<MateState>((set, get) => {
  /** 动作成功后的本地收尾：仍指向本卡且本动作未被更新动作取代时才折叠（只动本 workspace 域）。 */
  function settleExpandedDecision(
    workspaceKey: string,
    generation: number,
    decisionId: number,
  ): void {
    if (generation !== actionGeneration) return; // 代际丢弃：已有更新的动作接管
    if (get().byWorkspace[workspaceKey]?.expandedDecisionId !== decisionId) return; // 用户已转向其他卡片
    set((state) => ({
      byWorkspace: {
        ...state.byWorkspace,
        [workspaceKey]: {
          ...(state.byWorkspace[workspaceKey] ?? EMPTY_MATE_WORKSPACE_STATE),
          expandedDecisionId: null,
        },
      },
    }));
  }

  return {
    byWorkspace: {},

    setFilter(workspaceKey, filter) {
      set((state) => ({
        byWorkspace: {
          ...state.byWorkspace,
          [workspaceKey]: {
            ...(state.byWorkspace[workspaceKey] ?? EMPTY_MATE_WORKSPACE_STATE),
            filter,
          },
        },
      }));
    },

    selectTicket(workspaceKey, ticketId) {
      set((state) => ({
        byWorkspace: {
          ...state.byWorkspace,
          [workspaceKey]: {
            ...(state.byWorkspace[workspaceKey] ?? EMPTY_MATE_WORKSPACE_STATE),
            selectedTicketId: ticketId,
          },
        },
      }));
    },

    expandDecision(workspaceKey, decisionId) {
      set((state) => ({
        byWorkspace: {
          ...state.byWorkspace,
          [workspaceKey]: {
            ...(state.byWorkspace[workspaceKey] ?? EMPTY_MATE_WORKSPACE_STATE),
            expandedDecisionId: decisionId,
          },
        },
      }));
    },

    // P8b（09 详设 §1.7）：总览卡组展开 toggle——组键集替换写（不复制快照，只存键集）。
    toggleWorkWorkspace(workspaceKey, groupKey) {
      set((state) => {
        const current =
          state.byWorkspace[workspaceKey] ?? EMPTY_MATE_WORKSPACE_STATE;
        const expanded = current.expandedWorkKeys.includes(groupKey)
          ? current.expandedWorkKeys.filter((key) => key !== groupKey)
          : [...current.expandedWorkKeys, groupKey];
        return {
          byWorkspace: {
            ...state.byWorkspace,
            [workspaceKey]: { ...current, expandedWorkKeys: expanded },
          },
        };
      });
    },

    recordTrigger(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:trigger:${input.simulated}:${input.text}:${
        input.targetWorkspaceIdentity ?? ""
      }`;
      return runSingleFlight(key, () => service.recordTrigger(input));
    },

    approveDecision(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:approve:${input.decisionId}:${input.briefAppendix ?? ""}:${
        input.permissionTier ?? "build"
      }:${input.targetWorkspaceIdentity ?? ""}`;
      return runSingleFlight(key, async (generation) => {
        const result = await service.approveDecision(input);
        if (result.ok) settleExpandedDecision(workspaceKey, generation, input.decisionId);
        return result;
      });
    },

    ignoreDecision(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:ignore:${input.decisionId}`;
      return runSingleFlight(key, async (generation) => {
        const result = await service.ignoreDecision(input);
        if (result.ok) settleExpandedDecision(workspaceKey, generation, input.decisionId);
        return result;
      });
    },

    // P10b（10 号详设 §3.1）：manage 放行——single-flight+代际丢弃同款纪律（同卡双击
    // 只发一次 RPC；服务侧事务幂等兜底）。
    approveManageDecision(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:approveManage:${input.decisionId}`;
      return runSingleFlight(key, async (generation) => {
        const result = await service.approveManageDecision(input);
        if (result.ok) settleExpandedDecision(workspaceKey, generation, input.decisionId);
        return result;
      });
    },

    dismissObservation(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:dismiss:${input.triggerId}`;
      return runSingleFlight(key, () => service.dismissObservation(input));
    },

    stopMandate(service, workspaceKey, ticketId) {
      const key = `ws:${workspaceKey}:stop:${ticketId}`;
      return runSingleFlight(key, () => service.stopMandate({ ticketId }));
    },

    setMode(service, workspaceKey, mode) {
      const key = `ws:${workspaceKey}:mode:${mode}`;
      return runSingleFlight(key, () => service.setMode(mode));
    },

    setAllowlist(service, workspaceKey, identities) {
      const key = `ws:${workspaceKey}:allowlist:${identities.join("\n")}`;
      return runSingleFlight(key, () => service.setAllowlist(identities));
    },

    setWorktreeDisabled(service, workspaceKey, disabled) {
      const key = `ws:${workspaceKey}:worktreeDisabled:${disabled ? "1" : "0"}`;
      return runSingleFlight(key, () => service.setWorktreeDisabled(disabled));
    },

    dismissQueryReply(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:queryDismiss:${input.decisionId}`;
      return runSingleFlight(key, () => service.dismissQueryReply(input));
    },

    // P5 设置中心（06 号详设 §2）：六 setter 薄封装——single-flight 同款纪律，
    // key 含参数摘要防并发重复提交；失败按 AssistantResult 透传（UI 出 role=alert）。
    setBudget(service, workspaceKey, maxActivePerWorkspace) {
      const key = `ws:${workspaceKey}:budget:${maxActivePerWorkspace}`;
      return runSingleFlight(key, () => service.setBudget({ maxActivePerWorkspace }));
    },

    setTrustGateThresholds(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:trustThresholds:${input.minRate ?? ""}:${input.minSamples ?? ""}`;
      return runSingleFlight(key, () => service.setTrustGateThresholds(input));
    },

    setWatchdogIntervalMinutes(service, workspaceKey, minutes) {
      const key = `ws:${workspaceKey}:watchdogInterval:${minutes}`;
      return runSingleFlight(key, () => service.setWatchdogIntervalMinutes({ minutes }));
    },

    // P9 节奏区两动作（09 详设 §2；single-flight 同款纪律，key 含参数摘要）。
    setAutonomyEnabled(service, workspaceKey, enabled) {
      const key = `ws:${workspaceKey}:autonomyEnabled:${enabled ? "1" : "0"}`;
      return runSingleFlight(key, () => service.setAutonomyEnabled({ enabled }));
    },

    setAutonomyIntervalMinutes(service, workspaceKey, minutes) {
      const key = `ws:${workspaceKey}:autonomyInterval:${minutes}`;
      return runSingleFlight(key, () => service.setAutonomyIntervalMinutes({ minutes }));
    },

    setSourcesConfig(service, workspaceKey, config) {
      const key = `ws:${workspaceKey}:sourcesConfig:${JSON.stringify(config)}`;
      return runSingleFlight(key, () => service.setSourcesConfig(config));
    },

    setSourceIdentityMap(service, workspaceKey, map) {
      const key = `ws:${workspaceKey}:identityMap:${JSON.stringify(map)}`;
      return runSingleFlight(key, () => service.setSourceIdentityMap(map));
    },

    setModelPreference(service, workspaceKey, preference) {
      const key = `ws:${workspaceKey}:modelPreference:${preference ? `${preference.providerId}/${preference.modelId}/${preference.reasoningLevel ?? ""}` : "clear"}`;
      return runSingleFlight(key, () => service.setModelPreference(preference));
    },

    // P4 第二棒（04 详设 §3/§4）：人工确认/摘要回执动作——single-flight 同款纪律，
    // key 含 ticketId（跨 workspace 同 id 工单是同库同行，但 key 域隔离仍按 workspace）。
    confirmTicketOutput(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:confirmOutput:${input.ticketId}`;
      return runSingleFlight(key, () => service.confirmTicketOutput(input));
    },

    confirmTicketIncrements(service, workspaceKey, input) {
      const key = `ws:${workspaceKey}:confirmIncrements:${input.ticketId}`;
      return runSingleFlight(key, () => service.confirmTicketIncrements(input));
    },

    markDailyDigestDelivered(service, workspaceKey) {
      const key = `ws:${workspaceKey}:digestDelivered`;
      return runSingleFlight(key, () => service.markDailyDigestDelivered());
    },
  };
});
