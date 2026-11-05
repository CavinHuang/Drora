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
/** dismissObservation 入参。 */
type MateDismissObservationInput = Parameters<IAssistantTicketService["dismissObservation"]>[0];

/** 无记录 workspace 的初始局部态（模块级常量：zustand 选择器回退需稳定引用防重渲染）。 */
export const EMPTY_MATE_WORKSPACE_STATE: MateLocalUiState = {
  filter: "decision",
  selectedTicketId: null,
  expandedDecisionId: null,
};

interface MateState {
  /** 三件 UI 局部态按 workspace 分域；未写入过的 workspace 读到 EMPTY_MATE_WORKSPACE_STATE。 */
  byWorkspace: Record<string, MateLocalUiState>;

  setFilter(workspaceKey: string, filter: MateFilter): void;
  selectTicket(workspaceKey: string, ticketId: string | null): void;
  expandDecision(workspaceKey: string, decisionId: number | null): void;

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
  /** W1 worktree 用户开关（spec §9 W2 兜底；只影响之后的派发规划）。 */
  setWorktreeDisabled(
    service: IAssistantTicketService,
    workspaceKey: string,
    disabled: boolean,
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
  };
});
