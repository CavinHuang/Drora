/**
 * assistant-tickets 的 host 装配端口族（01 详设 §6 派发端口纪律的 P2 扩展）。
 *
 * 分层纪律（照 P1）：本模块不 import drora-agent / git / fs——所有对真实通道
 * （v4 命令、会话索引、git worktree、workspace 探测）的适配都在装配层（services/node.ts
 * 经 set* 注入）；服务与引擎闭包直读模块级端口，未注入时按各自语义诚实降级
 * （派发=dispatch.rejected、Router=无建议（Tier3）、会话索引=候选空集、探测=plan 失败）。
 *
 * 单测以 fake 端口注入验证幂等/失败/降级路径（P1 先例）。
 */
import type { AssistantPermissionTier } from "@drora/shared";
import type { AssistantResult } from "./assistantTickets.js";
import type { AssistantWriteDomain, WorkspaceProbe } from "./writeDomain.js";
import type { AnchorProbe } from "./incarnation.js";

// ---------------------------------------------------------------------------
// 派发端口（Mode A/B：v4 createSession + sendText；02 详设 §1.3/§5）
// ---------------------------------------------------------------------------

export interface AssistantDispatchRequest {
  readonly ticketId: string;
  /** 完整 brief（verbatim 原文 + 附录/换代浓缩段；Mode B 时已含 /team 指示）。 */
  readonly brief: string;
  readonly targetWorkspaceIdentity: string;
  readonly permissionTier: Exclude<AssistantPermissionTier, "yolo">;
  /**
   * 幂等键（P2 升级：`<ticketId>-<投递序号>`，02 §3）；=CLI sendText 的 inputId，
   * 服务侧在派发成功后记入 incarnation.anchorCommandId（锚）。
   */
  readonly commandId: string;
  /** A=独立单工单；B=建队（prompt 驱动 /team，spec §7）。 */
  readonly dispatchMode: "A" | "B";
  /**
   * 会话落位目录（W1=worktree 真实路径；缺省=装配层按 identity 解析、再退共享对话目录
   * ——P1 形态）。workspaceIdentity/hostPath 语义不混用：identity 是隔离键，path 是 cwd。
   */
  readonly hostPath?: string;
}

export interface AssistantDispatchResultValue {
  readonly ticketId: string;
  readonly sessionId: string;
}

export type AssistantDispatchResult = AssistantResult<AssistantDispatchResultValue>;

export type AssistantDispatchPort = (
  request: AssistantDispatchRequest,
) => Promise<AssistantDispatchResult>;

// ---------------------------------------------------------------------------
// 附着端口（Mode C / follow-up：同一 v4 sendText 通道投既有会话；02 详设 §2）
// ---------------------------------------------------------------------------

export interface AssistantAttachRequest {
  readonly ticketId: string;
  readonly text: string;
  readonly targetWorkspaceIdentity: string;
  /** 既存目标会话（busy 投递合法：heldQueueDisposition="keepQueueAndSend" 保序排队）。 */
  readonly sessionId: string;
  /** 幂等键（同 §3 带序规则）。 */
  readonly commandId: string;
  /** 会话落位目录（附着用户会话=用户 workspace 真实路径；缺省同派发端口语义）。 */
  readonly hostPath?: string;
}

export type AssistantAttachResult = AssistantResult<AssistantDispatchResultValue>;

export type AssistantAttachPort = (request: AssistantAttachRequest) => Promise<AssistantAttachResult>;

// ---------------------------------------------------------------------------
// 帧源端口（conversation 帧；P2 增加 hostPath 定位——W1 会话落位 worktree 目录）
// ---------------------------------------------------------------------------

export interface AssistantFrameSourcePort {
  /**
   * 订阅一个会话的 conversation 帧。candidate 为上游 safeParse 通过的 wire 帧
   * （droraAgentService.ts fire 前已验），callback 内部只做防御式解析。
   * hostPath 与派发/附着的 hostPath 同形——resolveWorkspaceKey 两侧一致帧才会汇同。
   */
  subscribe(
    sessionId: string,
    workspaceIdentity: string | undefined,
    hostPath: string | undefined,
    onFrame: (candidate: unknown) => void,
  ): { dispose(): void };
}

// ---------------------------------------------------------------------------
// Router 端口（候选卡循环；02 详设 §1.3。轮转壳/会话生命周期由装配层实现，
// 服务只见「送入候选卡全文 → 拿回该轮输出文本」纯语义；解析与降级在服务侧）
// ---------------------------------------------------------------------------

export type AssistantRouterPort = (input: {
  /** composeCandidateCard 的完整首条输入（约言+卡文+Tier2 候选集）。 */
  readonly card: string;
}) => Promise<{ ok: true; output: string } | { ok: false; reason: string }>;

// ---------------------------------------------------------------------------
// 会话索引端口（Tier2 候选集 / 锚对账 / Mode B teamActivity / 生命周期事件；02 §2/§3/§5）
// ---------------------------------------------------------------------------

/** 有界会话摘要（host 侧投影；字段对齐 SessionSummary 的子集）。 */
export interface AssistantSessionSummaryLite {
  readonly sessionId: string;
  readonly title: string;
  readonly phase: string;
  /** 已结束会话不可作附着目标（Tier2 硬过滤）。 */
  readonly sessionEnded: boolean;
  readonly updatedAtMs: number;
  /** sessions-index teamActivity 摘要（Mode B 第三信号源；无 team=undefined）。 */
  readonly teamActivity?: { readonly status: string; readonly name?: string };
}

export type AssistantSessionsIndexWatchDelta =
  | { readonly kind: "upserted"; readonly summary: AssistantSessionSummaryLite }
  | { readonly kind: "removed"; readonly sessionId: string };

export interface AssistantSessionsIndexPort {
  /**
   * workspace 会话快照（Tier2 候选集原料）：调用方（routerEvaluation 候选卡组装）以
   * routerShell.filterAttachCandidates 纯函数做会话级硬过滤（busy/已结束/无转录/过期
   * >7d）与有界截断；跨 identity 由本端口按 (workspaceIdentity, hostPath) 作用域保证。
   * hostPath=会话落位目录（worktree 时为 worktree 路径；缺省=装配层按 identity 回退）。
   * 通道未装配/不可用 → { ok:false }（诚实降级 Tier3，不猜候选）。
   */
  listSessions(
    workspaceIdentity: string,
    hostPath?: string,
  ): Promise<{ ok: true; sessions: readonly AssistantSessionSummaryLite[] } | { ok: false; reason: string }>;
  /**
   * 锚对账（02 §3 触发源①②；优先 reconcile 单会话持久事实，缺席快照≠删除）。
   * hostPath 与派发/附着同形；通道不可用 → unavailable（调用方按不可校验处置：直投
   * 降级问人/如实报错）。
   */
  probeSession(workspaceIdentity: string, sessionId: string, hostPath?: string): Promise<AnchorProbe>;
  /** 订阅 workspace 会话摘要增量（Mode B teamActivity + session.removed 生命周期）。 */
  watchSessions(
    workspaceIdentity: string,
    hostPath: string | undefined,
    onDelta: (delta: AssistantSessionsIndexWatchDelta) => void,
  ): { dispose(): void };
}

// ---------------------------------------------------------------------------
// workspace 探测与 git worktree 端口（写域 W1；02 详设 §4）
// ---------------------------------------------------------------------------

/** identity → 真实路径 + git 根判定（装配层经 botRemoteWorkspaceService/git 服务解析）。 */
export type AssistantWorkspaceProbePort = (identity: string) => Promise<WorkspaceProbe>;

export interface AssistantGitWorktreePort {
  /**
   * `git worktree add <path> -b <branch>`（02 §4）。幂等：路径已检出（换代续用）→ ok，
   * 不重复 add；分支已存在且未检出 → 复用分支检出；真实冲突 → ok:false+reason。
   */
  addWorktree(params: {
    workspacePath: string;
    path: string;
    branch: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** `git worktree remove <path>`（终态清理；分支保留）。失败 → ok:false+reason（台账留痕）。 */
  removeWorktree(params: { path: string }): Promise<{ ok: true } | { ok: false; reason: string }>;
}

// ---------------------------------------------------------------------------
// 模块级注入点（装配层 set*；服务/引擎闭包直读）
// ---------------------------------------------------------------------------

let dispatchPort: AssistantDispatchPort | null = null;
let attachPort: AssistantAttachPort | null = null;
let frameSource: AssistantFrameSourcePort | null = null;
let routerPort: AssistantRouterPort | null = null;
let sessionsIndexPort: AssistantSessionsIndexPort | null = null;
let workspaceProbePort: AssistantWorkspaceProbePort | null = null;
let gitWorktreePort: AssistantGitWorktreePort | null = null;

export function setAssistantDispatchPort(port: AssistantDispatchPort | null): void {
  dispatchPort = port;
}

export function setAssistantAttachPort(port: AssistantAttachPort | null): void {
  attachPort = port;
}

export function setAssistantFrameSource(port: AssistantFrameSourcePort | null): void {
  frameSource = port;
}

export function setAssistantRouterPort(port: AssistantRouterPort | null): void {
  routerPort = port;
}

export function setAssistantSessionsIndexPort(port: AssistantSessionsIndexPort | null): void {
  sessionsIndexPort = port;
}

export function setAssistantWorkspaceProbePort(port: AssistantWorkspaceProbePort | null): void {
  workspaceProbePort = port;
}

export function setAssistantGitWorktreePort(port: AssistantGitWorktreePort | null): void {
  gitWorktreePort = port;
}

/** 服务/引擎闭包读取（模块内；不外泄 setter 以外的写路径）。 */
export function getAssistantPorts(): {
  readonly dispatch: AssistantDispatchPort | null;
  readonly attach: AssistantAttachPort | null;
  readonly frameSource: AssistantFrameSourcePort | null;
  readonly router: AssistantRouterPort | null;
  readonly sessionsIndex: AssistantSessionsIndexPort | null;
  readonly workspaceProbe: AssistantWorkspaceProbePort | null;
  readonly gitWorktree: AssistantGitWorktreePort | null;
} {
  return {
    dispatch: dispatchPort,
    attach: attachPort,
    frameSource,
    router: routerPort,
    sessionsIndex: sessionsIndexPort,
    workspaceProbe: workspaceProbePort,
    gitWorktree: gitWorktreePort,
  };
}

/** 引擎/服务用的写域类型与锚探测类型再导出（装配层一处可见图景）。 */
export type { AssistantWriteDomain, WorkspaceProbe, AnchorProbe };
