// R3 P3a 任务面流式 store（spec：specs/mobile-relay-r3-frontend.md §14 第 1 条）。
// 纯逻辑：不依赖 React、不发起网络 IO；wire 候选解码复用 shared TopicWireFrameAssembler，
// 行应用复用 shared applyConversationDeltas（不复制 reducer）。所有权：本 store 是任务面
// snapshot/seq/logEpoch/subscriptionId 的唯一所有者；TaskSession 只负责订阅生命周期。
//
// 帧守卫不变量（与桌面 packages/ui/src/v4/conversationProjectionStore.ts applyFrame 同构，
// 移动端最小化）：
//   1. subscriptionId 不匹配（含 ACK 尚未返回时）→ 静默丢弃；
//   2. snapshot 载荷帧 → 整包替换，记 seq = frame.toSeq、logEpoch = snapshot.logEpoch；
//   3. delta 帧 toSeq <= seq → 迟到/重复，静默丢弃；
//   4. delta 帧 fromSeq !== seq（或尚无已应用基线）→ 断档不猜，触发 onResync（闩锁：至多
//      一次，直到新订阅 ACK / snapshot 帧重置），不应用该帧；
//   5. 合法 delta 帧 → 过滤 workflowRun.* 两 op（spec §14 有意分歧：移动端不做 dwf 面）、
//      state.updated 的 workflowRuns 键整键剥除（不做深合并，协议外状态不落 store）后交给
//      shared applyConversationDeltas，随后 seq = frame.toSeq。
import {
  TopicWireFrameAssembler,
  applyConversationDeltas,
  conversationTopicFrameSchema,
  type ActiveWorkSummary,
  type ConversationDelta,
  type ConversationRow,
  type ConversationSnapshot,
  type ConversationTopicFrame,
  type InteractionAutoResolution,
  type ModelSelection,
  type PendingInteraction,
  type PermissionRequestPayload,
  type QueueState,
  type SessionControl,
  type SessionPhase,
  type StatePatch,
  type TopicWireFrameCandidate,
  type UserInputOptionPayload,
  type UserInputQuestionPayload,
  type UserInputRequestPayload,
} from "@zcode/shared/zcode-protocol-v4";

// 阻塞交互面的类型与常量单一出处是 shared zcode-protocol-v4（snapshot.ts）；本 store 只做
// 派生选择器，re-export 供 src/ui 交互卡消费，避免 UI 直接深挖 shared 内部路径。
export type {
  InteractionAutoResolution,
  PendingInteraction,
  PermissionRequestPayload,
  UserInputOptionPayload,
  UserInputQuestionPayload,
  UserInputRequestPayload,
} from "@zcode/shared/zcode-protocol-v4";
export {
  MAX_PERMISSION_FEEDBACK_CHARS,
  PERMISSION_FULL_ACCESS_OPTION_ID,
} from "@zcode/shared/zcode-protocol-v4";

export interface ConversationSubscriptionAck {
  subscriptionId: string;
  mode: "snapshot" | "resume";
  logEpoch: string;
}

export interface ConversationStoreState {
  readonly snapshot: ConversationSnapshot | null;
  /** 帧水位（snapshot 帧 = frame.toSeq；delta 帧应用后 = frame.toSeq）。 */
  readonly seq: number;
  /** 订阅纪元：先取 ACK，snapshot 帧到达后以载荷为准（同一纪元内两者一致）。 */
  readonly logEpoch: string | null;
  readonly subscriptionId: string | null;
  /** 当前订阅的首个权威状态帧是否已收敛。 */
  readonly ready: boolean;
}

/** composer 状态驱动的派生面（spec §14 第 3 条），全部从 snapshot.control/queue 浅取。 */
export interface ConversationControlState {
  phase: SessionPhase | null;
  canStop: boolean;
  stopState: SessionControl["stopState"] | null;
  activeWorks: ActiveWorkSummary[];
  queueItemCount: number;
  /** queue.items 非空（驱动 chat.placeholder.followUpQueue 占位文案切换）。 */
  queuePending: boolean;
}

/** 队列状态派生面（spec §15 第 4 条），从 snapshot.queue 浅取。 */
export interface ConversationQueueState {
  itemCount: number;
  autoDrain: boolean;
  /** undefined = 无暂停原因（旧快照缺省或未暂停）；值域由 shared queueStateSchema 收口。 */
  pauseReason: QueueState["pauseReason"];
}

/**
 * 模型选择/上下文用量派生面（spec §16 第 2/3 条），全部从 snapshot.config /
 * availability / usage 浅取，不新增订阅（store 已整包持有 snapshot）。
 * ModelSelection 单一出处 = shared model-selection（zcode-protocol-v4 re-export）。
 */
/** 空快照派生态（无快照/任务面未开时 UI 的缺省，与 ModelSelectionState 空值语义一致）。 */
export const EMPTY_MODEL_SELECTION_STATE: ModelSelectionState = {
  current: null,
  fallback: null,
  thoughtLevels: [],
  availability: null,
  usage: null,
};

export interface ModelSelectionState {
  /** 会话已接受的稀疏选择意图（config.modelSelection；无快照或缺省 = null）。 */
  current: ModelSelection | null;
  /** config effective 投影回落（provider/model/thought 仅为 UI 展示事实，session-config schema 注释）。 */
  fallback: { provider: string; model: string; thought: string } | null;
  /** 当前模型思考档位集合（config.thoughtLevels；view 缺 optionSpecs 时 UI 回落用）。 */
  thoughtLevels: string[];
  /** switchModelConfig 可用性（snapshot.availability.switchModelConfig；无快照 = null）。 */
  availability: { allowed: boolean; reasonCode?: string } | null;
  /**
   * 上下文窗口用量（snapshot.usage.contextWindow）。判空同桌面
   * getRenderableTaskUsage（packages/ui/src/chat-input-toolbar/contextUsage.tsx）：
   * null / 非有限值 / 非正数一律 null，避免把初始化兜底渲染成误导性的 0%。
   */
  usage: { usedTokens: number; maxTokens: number } | null;
}

export interface ConversationStoreOptions {
  sessionId: string;
  /** 断档/无基线时触发（闩锁内至多一次）；调用方应发起 resyncConversationV4，不得自行猜帧。 */
  onResync?: () => void;
}

export interface ConversationStore {
  /** 订阅 ACK 到达时登记纪元；也用于 resync ACK（重置闩锁并 clear assembler）。 */
  setSubscription(ack: ConversationSubscriptionAck): void;
  /** wire 候选入口（complete | fragment 二形）；不合法/非本订阅静默丢弃。 */
  acceptWireFrame(candidate: unknown): void;
  /** rowsRange 回补入口；atLogEpoch 与当前订阅纪元不一致则拒绝。返回是否被接受。 */
  replaceRows(rows: readonly ConversationRow[], atSeq: number, atLogEpoch: string): boolean;
  /** 通知面：快照/行列表/派生状态变化即触发。返回解绑函数。 */
  subscribe(listener: () => void): () => void;
  getState(): ConversationStoreState;
  getRows(): ConversationRow[];
  getControlState(): ConversationControlState;
  /**
   * 快照对齐 revision（CAS 命令 baseRevision 用，spec §16 第 3 条；switchModelConfig
   * 信封必带 baseRevision）。无快照 = 0（与 host sendHostCasCommandV4 首发探测语义一致）。
   */
  getRevision(): number;
  /** 模型选择/上下文用量派生面（spec §16 第 2/3 条）；thoughtLevels 数组引用归快照所有。 */
  getModelSelectionState(): ModelSelectionState;
  /**
   * 阻塞交互选择器（spec §15 第 1 条）：浅取 snapshot.pendingInteractions，空快照返回 []。
   * 数组引用归快照所有（快照整包替换、原地不可变），消费方不得改写；
   * workspaceHookReview 类是否渲染由 UI 决定（spec §15 有意分歧：本轮不渲染）。
   */
  getPendingInteractions(): PendingInteraction[];
  /** 队列状态选择器（spec §15 第 4 条）：itemCount/autoDrain/pauseReason 三字段。 */
  getQueueState(): ConversationQueueState;
}

/** state.updated 的 workflowRuns 键整键剥除（有意分歧：移动端只认全量快照里的该键）。 */
function stripWorkflowRunsFromPatch(patch: StatePatch): StatePatch {
  if (patch.workflowRuns === undefined) return patch;
  const next = { ...patch };
  delete next.workflowRuns;
  return next;
}

/** 组装本订阅可应用的 delta 序列：workflowRun.* 整类跳过，state.updated 剥 workflowRuns 键。 */
function toApplicableDeltas(deltas: readonly ConversationDelta[]): ConversationDelta[] {
  const applicable: ConversationDelta[] = [];
  for (const delta of deltas) {
    if (delta.op === "workflowRun.updated" || delta.op === "workflowRun.removed") continue;
    if (delta.op === "state.updated") {
      applicable.push({ ...delta, patch: stripWorkflowRunsFromPatch(delta.patch) });
      continue;
    }
    applicable.push(delta);
  }
  return applicable;
}

export function createConversationStore(options: ConversationStoreOptions): ConversationStore {
  const topic = `conversation/${options.sessionId}`;
  let snapshot: ConversationSnapshot | null = null;
  let seq = 0;
  let logEpoch: string | null = null;
  let subscriptionId: string | null = null;
  let hasAppliedBase = false;
  /** 断档 resync 闩锁：触发一次后保持，直到 setSubscription / snapshot 帧重置。 */
  let resyncPending = false;
  /** 首帧收敛前的 rowsRange 回补窗口（snapshot 到达后即被整包替换取代）。 */
  let backfillRows: ConversationRow[] | null = null;
  const listeners = new Set<() => void>();
  // assembler 实例由 store 持有；setSubscription（含 resync ACK）时 clear，旧纪元分片作废。
  const assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function requestResync(): void {
    if (resyncPending) return;
    resyncPending = true;
    options.onResync?.();
  }

  function acceptLogicalFrame(frame: ConversationTopicFrame): void {
    if (frame.topic !== topic) return;
    if (frame.payload.kind === "snapshot") {
      // 规则：snapshot 整包替换（initial / online / recovery 同权；用途由 publisher 标记，
      // RPC 时序不可证——桌面同规则）。水位与纪元以帧载荷为准。
      snapshot = frame.payload.snapshot;
      seq = frame.toSeq;
      logEpoch = frame.payload.snapshot.logEpoch;
      hasAppliedBase = true;
      resyncPending = false;
      backfillRows = null;
      notify();
      return;
    }
    // delta 帧：无已应用基线 = 退化断档，同样不猜（依赖 initial snapshot 或 resync 收敛）。
    if (!hasAppliedBase || snapshot === null) {
      requestResync();
      return;
    }
    // 迟到/重复帧永远静默丢弃（不消费闩锁、不通知）。
    if (frame.toSeq <= seq) return;
    if (frame.fromSeq !== seq) {
      // 断档不猜：本地状态仍是 seq 时刻的一致投影，base 合法，交由 resync 裁决续传/全量。
      requestResync();
      return;
    }
    const current = snapshot;
    const next = applyConversationDeltas(current, toApplicableDeltas(frame.payload.deltas));
    snapshot = { ...next, seq: frame.toSeq };
    seq = frame.toSeq;
    hasAppliedBase = true;
    notify();
  }

  return {
    setSubscription(ack: ConversationSubscriptionAck): void {
      subscriptionId = ack.subscriptionId;
      logEpoch = ack.logEpoch;
      // 新纪元（首订或 resync ACK）：旧分片/闩锁一律作废；已收敛状态保留到新快照整包替换。
      assembler.clear();
      resyncPending = false;
      notify();
    },

    acceptWireFrame(candidate: unknown): void {
      // ownership 过滤先于 assembler（与桌面 decoder 同序）：非对象、非本订阅、非本 topic
      // 的候选在这里静默丢弃；ACK 未返回时（subscriptionId=null）一律丢弃（无 barrier 暂存，
      // spec §14 有意分歧：依赖 initial snapshot 收敛）。
      if (typeof candidate !== "object" || candidate === null) return;
      const wire = candidate as { kind?: unknown; topic?: unknown; subscriptionId?: unknown };
      if (wire.kind !== "complete" && wire.kind !== "fragment") return;
      if (typeof wire.subscriptionId !== "string" || typeof wire.topic !== "string") return;
      if (subscriptionId === null || wire.subscriptionId !== subscriptionId) return;
      if (wire.topic !== topic) return;
      for (const event of assembler.accept(candidate as TopicWireFrameCandidate)) {
        if (event.kind === "complete") {
          // deliveryKind（initial/online/recovery）只由 publisher 标记用途；snapshot 载荷
          // 同权整包替换，delta 载荷同走水位守卫，故此处不再按用途分支（桌面同构）。
          acceptLogicalFrame(event.frame);
        }
        // assembly fault：最小实现静默丢弃（断档由帧守卫经 onResync 兜底）。
      }
    },

    replaceRows(rows: readonly ConversationRow[], atSeq: number, atLogEpoch: string): boolean {
      // 回补只认同一纪元：无订阅或纪元不一致一律拒绝，防跨代拼接。
      if (logEpoch === null || atLogEpoch !== logEpoch) return false;
      if (hasAppliedBase && snapshot !== null) {
        // 已收敛后回补：读水位超前于已应用水位时，(seq, atSeq] 的增量会被二次应用
        // （row.appended 产生重复 rowId），拒绝并等待流式帧或 resync 收敛。
        if (atSeq > seq) return false;
        snapshot = { ...snapshot, rows: { ...snapshot.rows, window: [...rows] } };
        backfillRows = null;
      } else {
        // 首帧收敛前的尾窗回补：snapshot 到达即被整包替换。
        backfillRows = [...rows];
      }
      notify();
      return true;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getState(): ConversationStoreState {
      return { snapshot, seq, logEpoch, subscriptionId, ready: hasAppliedBase };
    },

    getRows(): ConversationRow[] {
      return snapshot?.rows.window ?? backfillRows ?? [];
    },

    getControlState(): ConversationControlState {
      const control = snapshot?.control;
      const queue = snapshot?.queue;
      const queueItemCount = queue?.items.length ?? 0;
      return {
        phase: control?.phase ?? null,
        canStop: control?.canStop ?? false,
        stopState: control?.stopState ?? null,
        activeWorks: control?.activeWorks ?? [],
        queueItemCount,
        queuePending: queueItemCount > 0,
      };
    },

    getPendingInteractions(): PendingInteraction[] {
      // 快照前 = 尚无阻塞交互事实；snapshot.pendingInteractions 缺省只可能出现在
      // schema 兼容层（新 CLI 始终携带该字段），同样按空处理。
      return snapshot?.pendingInteractions ?? [];
    },

    getQueueState(): ConversationQueueState {
      const queue = snapshot?.queue;
      return {
        itemCount: queue?.items.length ?? 0,
        // 无快照 = 尚无队列事实，按「未暂停」呈现（与 getControlState 空态一致，
        // 不把「还没连上」误报成「已暂停」）。
        autoDrain: queue?.autoDrain ?? true,
        pauseReason: queue?.pauseReason,
      };
    },

    getRevision(): number {
      return snapshot?.revision ?? 0;
    },

    getModelSelectionState(): ModelSelectionState {
      const snap = snapshot;
      if (!snap) {
        return {
          current: null,
          fallback: null,
          thoughtLevels: [],
          availability: null,
          usage: null,
        };
      }
      const config = snap.config;
      const switchAvailability = snap.availability.switchModelConfig;
      const contextWindow = snap.usage.contextWindow;
      return {
        current: config.modelSelection ?? null,
        fallback: { provider: config.provider, model: config.model, thought: config.thought },
        thoughtLevels: config.thoughtLevels,
        availability: switchAvailability.allowed
          ? { allowed: true }
          : { allowed: false, reasonCode: switchAvailability.reasonCode },
        usage:
          contextWindow &&
          Number.isFinite(contextWindow.usedTokens) &&
          Number.isFinite(contextWindow.maxTokens) &&
          contextWindow.usedTokens > 0 &&
          contextWindow.maxTokens > 0
            ? { usedTokens: contextWindow.usedTokens, maxTokens: contextWindow.maxTokens }
            : null,
      };
    },
  };
}
