// P5c 首页 sessions-index 实时任务活性 store（specs/mobile-relay-r3-frontend.md §19/P5c
// 范围细化第 1 条）。纯逻辑：不依赖 React、不发起网络 IO；wire 候选解码复用 shared
// TopicWireFrameAssembler（sessionsIndexTopicFrameSchema），帧应用与桌面
// packages/ui/src/v4/sessionsIndexStore.ts 同不变量、移动端最小化（无 recovery flight /
// runtime lifecycle 面——断档收敛由桥层 resyncSessionsIndexV4 裁决）：
//   1. subscriptionId 不匹配（含 ACK 尚未返回时）或 topic 非本工作区 → 静默丢弃；
//   2. snapshot 载荷帧 → 整包替换（sessionId → summary），记 seq = frame.toSeq、
//      logEpoch = snapshot.logEpoch，重置 resync 闩锁；
//   3. delta 帧 toSeq <= seq → 迟到/重复，静默丢弃（不消费闩锁）；
//   4. delta 帧 fromSeq !== seq（或尚无已应用基线）→ 断档不猜，触发 onResync（闩锁：
//      恰一次，直到新订阅 ACK / snapshot 帧重置），不应用该帧；
//   5. 合法 delta 帧 → session.upserted 按 sessionId 覆盖 / session.removed 删除，
//      seq = frame.toSeq。
// 活性映射与合并（同文件纯函数，供 HomeScreen 接线与单测）：phase→status 五相位映射与
// 桌面 mapSessionSummaryToTaskMeta.phaseToStatus 同规；合并以 bootstrap/list 投影为主，
// sessions-index 只并活性字段（status/updatedAt 覆盖，title 以 titleSource==="custom"
// 为权威），draft 剔除、投影外行不新增。
import {
  sessionsIndexTopic,
  sessionsIndexTopicFrameSchema,
  TopicWireFrameAssembler,
  type SessionPhase,
  type SessionSummary,
  type SessionsIndexTopicFrame,
  type TopicWireFrameCandidate,
} from "@drora/shared/drora-protocol-v4";
import type { ProjectedWorkspace } from "./entry.js";

/** sessions-index 订阅 ACK（shared transport.ts subscribeAckSchema 形状）。 */
export interface SessionsIndexSubscriptionAck {
  subscriptionId: string;
  mode: "snapshot" | "resume";
  logEpoch: string;
}

export interface HomeSessionsIndexState {
  /** 订阅纪元：先取 ACK，snapshot 帧到达后以载荷为准（同一纪元内两者一致）。 */
  readonly logEpoch: string | null;
  /** 帧区间水位（snapshot 帧 = frame.toSeq；delta 帧应用后 = frame.toSeq）。 */
  readonly seq: number;
  readonly subscriptionId: string | null;
  /** 当前订阅的首个权威状态帧是否已收敛（未收敛前 delta 一律按断档处理）。 */
  readonly ready: boolean;
}

export interface SessionsIndexStoreOptions {
  /** 工作区身份 key（AGENTS 规则 workspaceIdentity?.trim() || workspacePath；topic 后缀）。 */
  workspaceKey: string;
  /** 断档/无基线时触发（闩锁内恰一次）；调用方应发起 resyncSessionsIndexV4，不得自行猜帧。 */
  onResync?: () => void;
}

export interface SessionsIndexStore {
  /** 订阅 ACK 到达时登记纪元；也用于 resync ACK（重置闩锁并作废旧纪元分片）。 */
  setSubscription(ack: SessionsIndexSubscriptionAck): void;
  /** wire 候选入口（complete | fragment 二形）；非本订阅/非本 topic 静默丢弃。 */
  acceptWireFrame(candidate: unknown): void;
  /** 已知会话摘要（lastActivityAt 降序；缓存稳定引用，内容不变不新建数组）。 */
  getSessionSummaries(): SessionSummary[];
  /** 单会话摘要查询（活性合并按 sessionId 定位）。 */
  getSummary(sessionId: string): SessionSummary | null;
  /** 通知面：快照/增量应用即触发。返回解绑函数。 */
  subscribe(listener: () => void): () => void;
  getState(): HomeSessionsIndexState;
}

export function createSessionsIndexStore(options: SessionsIndexStoreOptions): SessionsIndexStore {
  // topic 与 CLI 侧一致：sessions-index/<workspaceKey>（桌面 agentSessionsIndexTransport
  // 同构：sessionsIndexTopic(identity?.trim() || path)）。
  const topic = sessionsIndexTopic(options.workspaceKey);
  let seq = 0;
  let logEpoch: string | null = null;
  let subscriptionId: string | null = null;
  let ready = false;
  /** 断档 resync 闩锁：触发一次后保持，直到 setSubscription / snapshot 帧重置。 */
  let resyncPending = false;
  let sessions = new Map<string, SessionSummary>();
  let cachedList: SessionSummary[] | null = null;
  const listeners = new Set<() => void>();
  // assembler 实例由 store 持有；setSubscription（含 resync ACK）时 clear，旧纪元分片作废。
  const assembler = new TopicWireFrameAssembler(sessionsIndexTopicFrameSchema);

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function requestResync(): void {
    if (resyncPending) return;
    resyncPending = true;
    options.onResync?.();
  }

  function acceptLogicalFrame(frame: SessionsIndexTopicFrame): void {
    if (frame.topic !== topic) return;
    if (frame.payload.kind === "snapshot") {
      // snapshot 整包替换（initial / online / recovery 同权；用途由 publisher 标记，
      // RPC 时序不可证——桌面/任务面 store 同规则）。水位与纪元以帧载荷为准。
      const snapshot = frame.payload.snapshot;
      const next = new Map<string, SessionSummary>();
      for (const summary of snapshot.sessions) next.set(summary.sessionId, summary);
      sessions = next;
      seq = frame.toSeq;
      logEpoch = snapshot.logEpoch;
      ready = true;
      resyncPending = false;
      cachedList = null;
      notify();
      return;
    }
    // delta 帧：无已应用基线 = 退化断档，同样不猜（依赖 initial snapshot 或 resync 收敛）。
    if (!ready) {
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
    const next = new Map(sessions);
    for (const delta of frame.payload.deltas) {
      if (delta.op === "session.upserted") next.set(delta.session.sessionId, delta.session);
      else next.delete(delta.sessionId);
    }
    sessions = next;
    seq = frame.toSeq;
    cachedList = null;
    notify();
  }

  return {
    setSubscription(ack: SessionsIndexSubscriptionAck): void {
      subscriptionId = ack.subscriptionId;
      logEpoch = ack.logEpoch;
      // 新纪元（首订或 resync ACK）：旧分片/闩锁一律作废；已收敛状态保留到新快照整包替换。
      assembler.clear();
      resyncPending = false;
      notify();
    },

    acceptWireFrame(candidate: unknown): void {
      // ownership 过滤先于 assembler（与任务面 conversationStore 同序）：非对象、非本订阅、
      // 非本 topic 的候选在这里静默丢弃。首页桥在 ACK 前暂存并在登记订阅后回放；
      // store 自身无订阅所有权时仍必须拒绝候选，不能把传输暂存当作业务状态。
      if (typeof candidate !== "object" || candidate === null) return;
      const wire = candidate as { kind?: unknown; topic?: unknown; subscriptionId?: unknown };
      if (wire.kind !== "complete" && wire.kind !== "fragment") return;
      if (typeof wire.subscriptionId !== "string" || typeof wire.topic !== "string") return;
      if (subscriptionId === null || wire.subscriptionId !== subscriptionId) return;
      if (wire.topic !== topic) return;
      for (const event of assembler.accept(candidate as TopicWireFrameCandidate)) {
        if (event.kind === "complete") {
          // deliveryKind（initial/online/recovery）只由 publisher 标记用途；snapshot 载荷
          // 同权整包替换，delta 载荷同走水位守卫，故此处不按用途分支（桌面同构）。
          acceptLogicalFrame(event.frame);
        }
        // assembly fault：静默丢弃（断档由帧守卫经 onResync 兜底）。
      }
    },

    getSessionSummaries(): SessionSummary[] {
      if (cachedList === null) {
        cachedList = [...sessions.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      }
      return cachedList;
    },

    getSummary(sessionId: string): SessionSummary | null {
      return sessions.get(sessionId) ?? null;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getState(): HomeSessionsIndexState {
      return { logEpoch, seq, subscriptionId, ready };
    },
  };
}

// —— 活性映射与合并（桌面 mapSessionSummaryToTaskMeta.phaseToStatus 同规）——

/** 任务行活性状态（running/completed/error 三值；draft 无活性语义）。 */
export type HomeTaskLivenessStatus = "running" | "completed" | "error";

/**
 * SessionSummary.phase → 任务行活性状态；draft → null（剔除）。
 * 六相位闭集（shared snapshot.ts sessionPhaseSchema）到三状态 + 剔除的映射，
 * 与桌面 packages/ui/src/v4/mapSessionSummaryToTaskMeta.ts 逐相位同规。
 */
export function mapSessionPhaseToStatus(phase: SessionPhase): HomeTaskLivenessStatus | null {
  switch (phase) {
    case "running":
    case "prewarming":
      return "running";
    case "completedSuccess":
    case "completedInterrupted":
      return "completed";
    case "error":
      return "error";
    default:
      return null; // draft：纯内存态（CLI 重启即消失），无持久行活性语义。
  }
}

/** 活性合并后的任务行（bootstrap 投影字段 + sessions-index 活性覆盖；status 三值保真）。 */
export interface LivenessMergedTask {
  sessionId: string;
  title: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  status: HomeTaskLivenessStatus;
}

/** 活性合并后的工作区投影（工作区自身字段原样保留，仅 tasks 逐行合并活性）。 */
export interface LivenessMergedWorkspace {
  workspaceKey: string;
  name: string;
  kind: "local" | "remote";
  path: string;
  updatedAtMs: number | null;
  tasks: LivenessMergedTask[];
}

/**
 * 单工作区活性合并：数据源以 bootstrap/list 投影为主（左表），sessions-index 摘要只
 * 合并活性字段——status 按 phase 映射覆盖、updatedAtMs 以 lastActivityAt 覆盖、title 仅在
 * titleSource==="custom"（用户显式重命名）时以摘要为权威。draft 相位的行剔除；
 * 投影外（摘要独有）的会话不新增行（sessions-index 不决定行存在性，桌面同语义）。
 * 入参 summaries 必须是**该工作区**的 sessions-index 摘要（不同工作区 sessionId 可能
 * 同名，跨工作区按 sessionId 合并会串行）。
 */
export function mergeHomeWorkspaceLiveness(
  workspace: ProjectedWorkspace,
  summaries: readonly SessionSummary[],
): LivenessMergedWorkspace {
  const bySessionId = new Map(summaries.map((summary) => [summary.sessionId, summary]));
  const tasks: LivenessMergedTask[] = [];
  for (const task of workspace.tasks) {
    const summary = bySessionId.get(task.sessionId);
    if (!summary) {
      // 无实时摘要：保持投影原样（bootstrap/list 仍是权威数据源）。
      tasks.push({
        sessionId: task.sessionId,
        title: task.title,
        createdAtMs: task.createdAtMs,
        updatedAtMs: task.updatedAtMs,
        status: task.status,
      });
      continue;
    }
    const status = mapSessionPhaseToStatus(summary.phase);
    if (status === null) continue; // draft：剔除任务行。
    tasks.push({
      sessionId: task.sessionId,
      // title 以 titleSource==="custom" 为权威（桌面 mapSessionSummaryToTaskMeta 同规：
      // default/generated 都不是产品语义上的手动标题）；空串回落投影标题。
      title:
        summary.titleSource === "custom" && summary.title.length > 0 ? summary.title : task.title,
      createdAtMs: task.createdAtMs,
      updatedAtMs: summary.lastActivityAt || task.updatedAtMs,
      status,
    });
  }
  return {
    workspaceKey: workspace.workspaceKey,
    name: workspace.name,
    kind: workspace.kind,
    path: workspace.path,
    updatedAtMs: workspace.updatedAtMs,
    tasks,
  };
}
