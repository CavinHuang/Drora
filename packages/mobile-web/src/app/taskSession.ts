/* eslint-disable max-lines -- 移动端 relay 服务面单一装配模块（任务会话 + 首页搜索 + P5c
   首页 sessions-index 专用桥）：三条链共用同一条 workspace 桥生命周期（open/握手/帧面/
   退订/释放）与同一 accessor 装配，拆文件会把一条桥的所有权拆散（packages/ui/src/v4/
   sessionsIndexStore.ts 同款豁免先例）。 */
// R3 P2a/P3a/P3b/P3c 任务会话面：workspace-bridge-open → 服务面（与 renderer 同源
// RemoteServiceAccess，D8）。读路径 = v4 rows 分页（conversationRowsRangeV4，首帧收敛前的
// 回补入口）+ P3a 流式订阅（subscribeConversationV4 → onDynamicConversationFrame →
// conversationStore，spec §14 第 1 条）+ P3b 文件变更只读查询（conversationFileChangesV4，
// spec §15 第 3 条）+ P3c 模型清单（modelSelectionService.getView，spec §16 第 3 条）；
// 写路径 = v4 命令（CommandEnvelope，shared 单一出处）：sendText、stop、
// resolveInteraction（阻塞交互应答，spec §15 第 1 条）、switchModelConfig（CAS，
// spec §16 第 3 条）。
//
// 事件顺序（open）：bridge → hello/clientHello 握手 → 挂 onDynamicConversationFrame 事件面
// → subscribeConversationV4（ACK-only，transport.ts:440-447）→ store.setSubscription(ack)
// → reloadRows() 回补尾窗。ACK 前到达的帧因 subscriptionId 未登记被 store 静默丢弃
// （spec §14 有意分歧：不做 ackActivationBarrier 暂存，依赖 initial snapshot 收敛；若
// initial 丢失，store 断档守卫经 onResync → resync()（forceSnapshot）兜底）。
import type { IServiceAccessor, ModelSelectionView } from "@drora/services";
import {
  MAX_PERMISSION_FEEDBACK_CHARS,
  V4_WIRE_PROTOCOL_VERSION,
  sessionsIndexTopic,
  type ClientHello,
  type CommandAck,
  type CommandEnvelope,
  type ConversationRow,
  type ConversationRowTarget,
  type V4ConversationFileChangesResult,
} from "@drora/shared/drora-protocol-v4";
import type { IDisposable } from "@drora/rpc";
import type { RelayClient } from "@drora/relay-client";
import { connectViaProtocol } from "@drora/client";
import { createRelayMessageProtocol } from "./protocolAdapter.js";
import { createConversationStore, type ConversationStore } from "./conversationStore.js";
import { createInitialFrameGate } from "./sessionsIndexInitialFrameGate.js";
import { createSessionsIndexStore, type SessionsIndexStore } from "./sessionsIndexStore.js";

export interface TaskSessionTarget {
  workspacePath: string;
  /** 工作区身份（远程工作区必带；本地缺省）。AGENTS.md Workspace Identity 规则。 */
  workspaceIdentity?: string;
  sessionId: string;
}

/** 模型/档位切换意图（spec §16 第 3 条；UI 组装，命令 payload 投影在本模块 CAS 提交内）。 */
export interface SwitchModelSelection {
  providerId: string;
  modelId: string;
  /**
   * 显式思考档；缺省 = 命令层 thought ""（v4 命令不补档，目标模型按默认档收敛，
   * spec §16：跨模型切档丢弃源 thought 用目标模型默认档）。
   */
  thoughtLevel?: string;
}

export interface SwitchModelResult {
  /** accepted/duplicate/noop 视为成功（与 host assertV4CommandAckOk 同口径）。 */
  ok: boolean;
  /** 首发 stale 后以 ACK.revisionAtDecision 收敛重试过一次。 */
  staleRetried: boolean;
}

/** switchModelConfig stale 收敛上限：首发 + revisionAtDecision 单次重试（spec §16 第 3 条）。 */
const SWITCH_MODEL_MAX_ATTEMPTS = 2;

/**
 * v4 switchModelConfig 的 CAS 提交核心（纯函数，可单测；与 host 侧
 * sendHostCasCommandV4 同构但更收敛：baseRevision 由调用方在「读快照时点」取
 * store.revision，stale ACK 用 revisionAtDecision 单次重发）。每次尝试新 commandId
 * （stale 裁决不进幂等表，语义等价且避免歧义）；rejected/failed/二次 stale 均为
 * ok:false，transport 异常上抛由 TaskSession.switchModel 收敛。
 */
export async function sendSwitchModelConfigCas(input: {
  send: (envelope: CommandEnvelope) => Promise<CommandAck>;
  sessionId: string;
  clientId: string;
  /** 读快照时点的 store revision（无快照 = 0，host 同款探测语义）。 */
  baseRevision: number;
  command: SwitchModelSelection;
}): Promise<SwitchModelResult> {
  const payload = {
    provider: input.command.providerId,
    model: input.command.modelId,
    thought: input.command.thoughtLevel ?? "",
  };
  let baseRevision = input.baseRevision;
  let staleRetried = false;
  for (let attempt = 0; attempt < SWITCH_MODEL_MAX_ATTEMPTS; attempt += 1) {
    const envelope: CommandEnvelope = {
      commandId: crypto.randomUUID(),
      clientId: input.clientId,
      sessionId: input.sessionId,
      baseRevision,
      type: "switchModelConfig",
      payload,
      issuedAt: Date.now(),
    };
    const ack = await input.send(envelope);
    if (ack.status === "stale") {
      if (staleRetried) return { ok: false, staleRetried };
      // stale ACK 必带 revisionAtDecision（shared command.ts）；以服务端裁决时点
      // 的 revision 单次收敛重发。
      staleRetried = true;
      baseRevision = ack.revisionAtDecision;
      continue;
    }
    return {
      ok: ack.status === "accepted" || ack.status === "duplicate" || ack.status === "noop",
      staleRetried,
    };
  }
  return { ok: false, staleRetried };
}

export class TaskSession {
  private olderRequestPending = false;
  private constructor(
    readonly accessor: IServiceAccessor,
    readonly target: TaskSessionTarget,
    private readonly client: RelayClient,
    /** workspace-bridge-ready 回声的桥 id；close() 据此反注册桥通道。 */
    private readonly bridgeSessionId: string,
    /** 流式状态唯一所有者（spec §14：snapshot/seq/logEpoch/subscriptionId 都在 store）。 */
    private readonly store: ConversationStore,
    /** workspace 级帧事件句柄；close() 先 dispose 再退订（桌面 transport 同构）。 */
    private frameSubscription: IDisposable | null,
  ) {}

  /** 行只读出口；store 单一所有者（快照窗口优先，首帧收敛前回落 rowsRange 回补窗口）。 */
  get rows(): ConversationRow[] {
    return this.store.getRows();
  }

  /** 时间线全序行数由 Host 快照提供；首帧前只展示当前回补窗口。 */
  get totalRowCount(): number {
    return this.store.getState().snapshot?.rows.totalCount ?? this.store.getRows().length;
  }

  get canLoadOlder(): boolean {
    const firstRowId = this.store.getState().snapshot?.rows.firstRowId;
    const currentFirst = this.store.getRows()[0]?.rowId;
    return (
      firstRowId !== null &&
      firstRowId !== undefined &&
      currentFirst !== undefined &&
      currentFirst > firstRowId
    );
  }

  /** 时间线向上翻页：只前插同一订阅纪元和当前游标的历史行。 */
  async loadOlder(): Promise<void> {
    if (this.olderRequestPending || !this.canLoadOlder) return;
    const beforeRowId = this.store.getRows()[0]?.rowId;
    const startEpoch = this.store.getState().logEpoch;
    if (beforeRowId === undefined || startEpoch === null) return;
    this.olderRequestPending = true;
    try {
      const result = await this.accessor.droraAgentService.conversationRowsRangeV4({
        ...this.workspaceRef(),
        sessionId: this.target.sessionId,
        beforeRowId,
        limit: 200,
      });
      const state = this.store.getState();
      if (
        result.atLogEpoch !== startEpoch ||
        state.logEpoch !== startEpoch ||
        result.atSeq > state.seq ||
        this.store.getRows()[0]?.rowId !== beforeRowId ||
        result.rows.length === 0
      )
        return;
      this.store.replaceRows(
        [...result.rows, ...this.store.getRows()],
        result.atSeq,
        result.atLogEpoch,
      );
    } finally {
      this.olderRequestPending = false;
    }
  }

  /** 开桥 + v4 握手（hello → clientHello）+ 流式订阅 + 尾窗行回补。 */
  static async open(
    client: RelayClient,
    target: TaskSessionTarget,
    appVersion: string,
  ): Promise<TaskSession> {
    const bridge = await client.openWorkspaceBridge({
      workspaceKey: target.workspaceIdentity?.trim() || target.workspacePath,
      taskId: target.sessionId,
    });
    const accessor = connectViaProtocol(createRelayMessageProtocol(bridge));
    const agent = accessor.droraAgentService;
    // 可信 hello → clientHello（clientKind=mobileRemote；能力位缺省 = 旧客户端语义，
    // 不声明 strict 未知键，老 Host 可握手）。
    await agent.helloConversationV4();
    const clientHello: ClientHello = {
      kind: "clientHello",
      protocolVersion: V4_WIRE_PROTOCOL_VERSION,
      clientId: `drora-mobile-${target.sessionId}`,
      clientKind: "mobileRemote",
      appVersion,
    };
    await agent.initializeConversationV4(clientHello);
    // store 在 session 构造前创建：onResync 回调经引用反查 session.resync()（断档不猜，
    // 由 resyncConversationV4 裁决续传/全量）。失败静默：store 闩锁保持至下一纪元/快照帧，
    // 不做无退避重试（P3a 最小实现）。
    let session: TaskSession | null = null;
    const store = createConversationStore({
      sessionId: target.sessionId,
      onResync: () => {
        session?.resync().catch(() => {});
      },
    });
    session = new TaskSession(
      accessor,
      target,
      client,
      bridge.identity.bridgeSessionId,
      store,
      null,
    );
    await session.beginStreaming();
    await session.reloadRows();
    return session;
  }

  /** workspace 服务引用（identity 缺省省略；Workspace Identity 规则单一出处）。 */
  private workspaceRef() {
    return {
      workspacePath: this.target.workspacePath,
      ...(this.target.workspaceIdentity
        ? { workspaceIdentity: this.target.workspaceIdentity }
        : {}),
    };
  }

  /** P3a 流式链：先挂 workspace 帧事件面，再订阅（句柄先就位，缩小 ACK 竞窗，桌面同构）。 */
  private async beginStreaming(): Promise<void> {
    const agent = this.accessor.droraAgentService;
    const workspace = this.workspaceRef();
    this.frameSubscription = agent.onDynamicConversationFrame(workspace)((frame) => {
      // wire 候选（complete|fragment）直接交给 store：解码/分片重组/守卫都在 store 内。
      this.store.acceptWireFrame(frame);
    });
    const result = await agent
      .subscribeConversationV4({
        ...workspace,
        sessionId: this.target.sessionId,
        visibility: "foreground",
      })
      .catch((error: unknown) => {
        // 订阅失败：先解绑事件面再上抛，避免半初始化 session 在 open() 失败后漏挂句柄。
        this.frameSubscription?.dispose();
        this.frameSubscription = null;
        throw error;
      });
    this.store.setSubscription(result.ack);
  }

  /** 尾窗行（rows/range，limit 200 上限内取 100）→ store 回补入口（校验 atLogEpoch）。 */
  async reloadRows(): Promise<void> {
    const result = await this.accessor.droraAgentService.conversationRowsRangeV4({
      ...this.workspaceRef(),
      sessionId: this.target.sessionId,
      limit: 100,
    });
    // 回补只认同一纪元；store 拒绝时保留现状态（跨代读不拼接，行等流式帧/resync 收敛）。
    this.store.replaceRows(result.rows, result.atSeq, result.atLogEpoch);
  }

  /** same-sub 恢复：base 一律从 store 水位取（不猜）；forceSnapshot 让服务端直接给全量。 */
  async resync(): Promise<void> {
    const state = this.store.getState();
    if (!state.subscriptionId) return;
    const result = await this.accessor.droraAgentService.resyncConversationV4({
      ...this.workspaceRef(),
      subscriptionId: state.subscriptionId,
      base: state.logEpoch === null ? null : { logEpoch: state.logEpoch, seq: state.seq },
      forceSnapshot: true,
    });
    // resync ACK 与 subscribe ACK 同形：重置 store 纪元（clear assembler + resync 闩锁）。
    this.store.setSubscription(result.ack);
  }

  /** 发送用户输入（v4 sendText 命令；admission 由 CLI CommandInbox 串行，AGENTS 不变量）。 */
  async sendText(text: string): Promise<void> {
    const envelope = {
      // uuid v7 语义：客户端生成、重试不变（此处 P2a 无重试，uuid 即可）。
      commandId: crypto.randomUUID(),
      clientId: `drora-mobile-${this.target.sessionId}`,
      sessionId: this.target.sessionId,
      type: "sendText" as const,
      payload: { text },
      issuedAt: Date.now(),
    };
    await this.accessor.droraAgentService.sendConversationCommandV4({
      ...this.workspaceRef(),
      envelope,
    });
  }

  /**
   * 停止生成（v4 stop 命令，spec §14 第 3 条）。expectedForegroundExecutionId 取自
   * control.activeWorks 的前台执行（shared command.ts：CLI 用它拒绝误杀后续无关
   * 执行的迟到 stop）；无法定位前台执行时省略该键（stop 不在 CAS 命令集）。
   */
  async sendStop(): Promise<void> {
    const control = this.store.getControlState();
    const expected = control.activeWorks.find(
      (work) => typeof work.foregroundExecutionId === "string",
    )?.foregroundExecutionId;
    const envelope = {
      commandId: crypto.randomUUID(),
      clientId: `drora-mobile-${this.target.sessionId}`,
      sessionId: this.target.sessionId,
      type: "stop" as const,
      payload: typeof expected === "string" ? { expectedForegroundExecutionId: expected } : {},
      issuedAt: Date.now(),
    };
    await this.accessor.droraAgentService.sendConversationCommandV4({
      ...this.workspaceRef(),
      envelope,
    });
  }

  /**
   * 阻塞交互应答（v4 resolveInteraction 命令，spec §15 第 1 条）。permission/userInput 卡
   * 的 optionId 或 freeText 二选一（schema 允许同时携带；移动端 UI 一次只提交一种，本方法
   * 原样透传，不做仲裁）。elicitation 的 action/content 扩展本轮不用（spec §15 有意分歧）。
   * 先到先得：晚到的重复应答由 CLI 侧 noop（reasonCode=proto.alreadyResolved）。
   */
  async resolveInteraction(
    interactionId: string,
    answer: { optionId?: string; freeText?: string },
  ): Promise<void> {
    // freeText 防御性截断：v4 command schema 对 freeText 无 max 约束，
    // MAX_PERMISSION_FEEDBACK_CHARS（4096）是产品输入上限。截断单点收在本方法：
    // 交互卡（UI）负责输入期计数与提示，这里保证无论调用方如何组装，出站载荷不超限——
    // 两个职责分层而不是互相依赖（调用方漏计数也不会把超长文本打进 wire）。
    const freeText =
      answer.freeText === undefined
        ? undefined
        : answer.freeText.slice(0, MAX_PERMISSION_FEEDBACK_CHARS);
    const envelope = {
      commandId: crypto.randomUUID(),
      clientId: `drora-mobile-${this.target.sessionId}`,
      sessionId: this.target.sessionId,
      type: "resolveInteraction" as const,
      payload: {
        interactionId,
        answer: {
          ...(answer.optionId === undefined ? {} : { optionId: answer.optionId }),
          ...(freeText === undefined ? {} : { freeText }),
        },
      },
      issuedAt: Date.now(),
    };
    await this.accessor.droraAgentService.sendConversationCommandV4({
      ...this.workspaceRef(),
      envelope,
    });
  }

  /**
   * 文件变更只读查询（v4 conversationFileChanges，spec §15 第 3 条；打开任务面拉取一次 +
   * 发送后刷新，单次拉取即弃，不缓存不重试）。
   *
   * target 锚点 = 尾窗内最新一个带 entityId 的 turnHeader 行：v4 gateway 对 fileChanges 的
   * target 是闭集要求（product-projection resolveRowActionTarget：非 turnHeader 一律
   * guard.actionUnavailable），且行摘要语义按轮计（checkpoints 按 target 轮的 messageId
   * 圈定），与桌面 ConversationFileSummaryPanel 的锚点构造同构。baseRevision/baseLogEpoch
   * 取当前 store 快照（gateway 与其当前投影逐字段比对，staleRevision/staleLogEpoch 即拒绝；
   * 桌面 SessionPane 同构）。查询与订阅水位无关（rows/range 同族，不校验拼接纪元）。
   *
   * 失败语义：无快照 / 无可用锚点 / 网络失败 / stale 拒绝 / 能力不支持 一律返回 null 不抛——
   * 只读查询按「无数据显示」降级，调用方不得据此打断会话面。
   */
  async fetchFileChanges(): Promise<V4ConversationFileChangesResult | null> {
    const snap = this.store.getState().snapshot;
    if (!snap) return null;
    let anchor: ConversationRowTarget | null = null;
    for (let index = snap.rows.window.length - 1; index >= 0; index -= 1) {
      const row = snap.rows.window[index];
      if (row && row.kind === "turnHeader" && typeof row.entityId === "string") {
        anchor = { rowId: row.rowId, entityId: row.entityId };
        break;
      }
    }
    if (!anchor) return null;
    try {
      return await this.accessor.droraAgentService.conversationFileChangesV4({
        ...this.workspaceRef(),
        sessionId: this.target.sessionId,
        target: anchor,
        baseRevision: snap.revision,
        baseLogEpoch: snap.logEpoch,
      });
    } catch {
      // 只读查询降级：stale/unsupported/桥断开都不上抛（理由见方法注释）。
      return null;
    }
  }

  /** 流式状态派生面（composer 状态驱动；P3a 第 3 条消费）。 */
  getControlState() {
    return this.store.getControlState();
  }

  /** 状态面板只读事实；快照仍由 conversation store 独占，App 只保留渲染镜像。 */
  getStatusSnapshot() {
    return this.store.getState().snapshot;
  }

  /** 阻塞交互选择器（spec §15 第 1 条；转发 store，UI 交互卡消费）。 */
  getPendingInteractions() {
    return this.store.getPendingInteractions();
  }

  /** 队列状态选择器（spec §15 第 4 条；转发 store）。 */
  getQueueState() {
    return this.store.getQueueState();
  }

  /** 模型选择/上下文用量派生面（spec §16 第 2/3 条；转发 store，App/菜单消费）。 */
  getModelSelectionState() {
    return this.store.getModelSelectionState();
  }

  /**
   * 模型清单视图（spec §16 第 3 条）：accessor.modelSelectionService.getView，
   * selection 传 store 当前 config.modelSelection（Host 据此解析 effective 高亮）。
   * 失败（桥断开/目标缺席等）返回 null 不抛——UI 按 targetMissing/loadFailedRetry
   * 呈现，不打断会话面；桌面 useModelSelectionView 的有界瞬时重读归 App 集成层。
   */
  async getModelSelectionView(): Promise<ModelSelectionView | null> {
    try {
      return await this.accessor.modelSelectionService.getView({
        selection: this.store.getModelSelectionState().current,
      });
    } catch {
      return null;
    }
  }

  /**
   * 模型/档位切换（v4 switchModelConfig，spec §16 第 3 条）。CAS：baseRevision =
   * 此刻 store.getRevision()（读快照时点），stale ACK 用 revisionAtDecision 单次
   * 收敛重发（sendSwitchModelConfigCas）；跨模型切档丢弃源 thought 由调用方决定
   * 档位（缺省 = 目标模型默认档，命令层不补）。transport / ACK 拒绝一律收敛为
   * ok:false 不抛，调用方按失败呈现并可重试。
   */
  async switchModel(next: SwitchModelSelection): Promise<SwitchModelResult> {
    try {
      return await sendSwitchModelConfigCas({
        send: (envelope) =>
          this.accessor.droraAgentService.sendConversationCommandV4({
            ...this.workspaceRef(),
            envelope,
          }),
        sessionId: this.target.sessionId,
        clientId: `drora-mobile-${this.target.sessionId}`,
        baseRevision: this.store.getRevision(),
        command: next,
      });
    } catch {
      return { ok: false, staleRetried: false };
    }
  }

  /** 通知面订阅（快照/行列表/派生状态变化即触发）；返回解绑函数。 */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  async close(): Promise<void> {
    // 顺序：先停事件面（不再向 store 投帧）→ 退订（失败不阻塞关闭，桥释放后由连接级联收口）
    // → 反注册桥通道（RelayClient.releaseBridge 内部 dispose 并从注册表移除，未注册的桥帧
    // 在 acceptPayload 静默丢弃）；断线级联仍由 RelayClient.disconnect 收口。
    this.frameSubscription?.dispose();
    this.frameSubscription = null;
    const { subscriptionId } = this.store.getState();
    if (subscriptionId) {
      try {
        await this.accessor.droraAgentService.unsubscribeConversationV4({
          ...this.workspaceRef(),
          subscriptionId,
        });
      } catch {
        // 桥即将释放；退订失败不重试（连接关闭后 host 侧订阅随 attachment 级联清理）。
      }
    }
    this.client.releaseBridge(this.bridgeSessionId);
  }
}

// —— P3d 首页任务搜索（specs/mobile-relay-r3-frontend.md §18）——

/** 搜索作用域（AGENTS Workspace Identity：远程链路贯穿 workspaceIdentity，不得仅按路径匹配）。 */
export interface TaskSearchWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
}

/**
 * 搜索结果行。ui TaskSearchPanel 的 TaskSearchPanelTask 与本类型为结构同形面（ModelMenu
 * 同款约定：ui 不反向 import app，集成处由 TS 结构化赋值兜住漂移），字段漂移由单测锚定。
 */
export interface TaskSearchResult {
  taskId: string;
  title: string;
  /** host 侧命中片段（searchSnippet 优先，回落 searchSnippets[0]；无命中/空白为 null）。 */
  snippet: string | null;
  updatedAtMs: number | null;
  workspacePath: string;
  workspaceIdentity?: string;
}

/** listTaskList 单页上限（spec §18 第一档：host 侧 sortBy=updated 截断，面板不再追加翻页）。 */
export const TASK_SEARCH_LIST_LIMIT = 20;

/**
 * 首页任务搜索：windowControllerService.listTaskList 包装（spec §18：任务搜索 = host 侧）。
 * 查询契约 = {kind:"active", workspaceScopes, sortBy:"updated", search, limit:20}（与
 * desktop windowHostControllerService.listTaskList 同一入口：search 走
 * searchable_text/snippets 全文搜索，无 search 键时即普通 active 列表）。
 *
 * 形状取舍（相对指令基线 searchTasks(workspacePath, search) 的两处显式化）：
 * 1. accessor 显式注入 —— spec §18 验收「listTaskList 契约 node 单测（脚本化 accessor）」
 *    的测试缝；桥生命周期（openWorkspaceBridge → accessor）由调用方装配（App 装配归 P4），
 *    不在本函数内私开短命桥（每键一次开桥成本不可接受）；
 * 2. scopes 数组 —— 首页搜索面覆盖全部已打开工作区（一次查询合并多 scope，desktop 同构），
 *    单 workspacePath 参数无法贯穿 workspaceIdentity（AGENTS：不得仅按路径匹配）。
 *
 * 失败语义：桥断开/目标缺席/能力不支持一律返回 [] 不抛——只读搜索按「无结果显示」降级，
 * 调用方不得据此打断首页（与 fetchFileChanges 同口径）。
 */
export async function searchTasks(
  accessor: IServiceAccessor,
  workspaces: readonly TaskSearchWorkspaceScope[],
  search: string,
): Promise<TaskSearchResult[]> {
  const query = search.trim();
  // windowControllerService 在 IServiceAccessor 上可选（旧 server wire / 测试 double 可缺省）：
  // 能力缺席与查询失败同口径，收敛为空结果降级，不上抛。
  const controller = accessor.windowControllerService;
  if (!controller) {
    return [];
  }
  try {
    const result = await controller.listTaskList({
      kind: "active",
      workspaceScopes: workspaces.map((workspace) => ({
        workspacePath: workspace.workspacePath,
        ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}),
      })),
      sortBy: "updated",
      ...(query ? { search: query } : {}),
      limit: TASK_SEARCH_LIST_LIMIT,
    });
    return result.items.map((item) => {
      const rawSnippet = item.searchSnippet ?? item.searchSnippets?.[0];
      return {
        taskId: item.taskId,
        title: item.title || item.taskId,
        snippet: typeof rawSnippet === "string" && rawSnippet.trim().length > 0 ? rawSnippet : null,
        updatedAtMs:
          typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
            ? item.updatedAt
            : null,
        workspacePath: item.workspacePath,
        ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}),
      };
    });
  } catch {
    // 只读搜索降级：不区分失败原因（理由见方法注释），空态呈现即可重试。
    return [];
  }
}

// —— P5c 首页 sessions-index 实时桥（specs/mobile-relay-r3-frontend.md §19/P5c 第 1 条）——

/**
 * 首页 sessions-index 订阅的 subscriberScope。CLI 侧重订阅替换按 (connectionId, topic)
 * 判定（droraAgent.ts:514-533 取证）：桌面 renderer 侧栏 / task-index syncer 用各自
 * connectionId 常驻订阅同一 topic；手机桥的 scope 必须唯一（"mobile-home"），防止
 * 同 connection 上的订阅代际互替。
 */
export const HOME_SESSIONS_INDEX_SUBSCRIBER_SCOPE = "mobile-home";

/** workspace 级订阅/退订/帧面目标（TaskSession.workspaceRef 同形；AGENTS identity 规则）。 */
interface HomeWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

/**
 * 首页 sessions-index 专用桥句柄。与任务桥并存：openWorkspaceBridge 的 bridgeSessionId
 * 由客户端生成（relay-client `bridge-<uuid>`），天然隔离；单工作区部署下若与任务桥同
 * workspaceKey，调用方可传 existingAccessor 复用任务桥的 accessor 直接订阅 sessions-index
 * topic，不重复开桥（复用时 close 只退订、不反注册桥——桥归 TaskSession 所有）。
 */
export interface HomeSessionsIndexBridge {
  /** 工作区身份 key（workspaceIdentity?.trim() || workspacePath；store topic 后缀）。 */
  readonly workspaceKey: string;
  /** sessions-index store：帧/订阅水位/纪元的唯一所有者（UI 订阅它派生活性）。 */
  readonly store: SessionsIndexStore;
  /**
   * 发起订阅（visibility=foreground + existing-only + scope "mobile-home"）。
   * 返回 subscriptionId；existing-only 稳定拒绝（runtime 不存在等）返回 null——首页降级
   * 为投影数据，不重试（禁止为列表订阅拉起 runtime，droraAgent.ts:524-528 语义）。
   */
  start(): Promise<string | null>;
  /** 退订 + 解绑帧面 + 释放专用桥（复用 accessor 时只退订）。幂等。 */
  close(): Promise<void>;
}

/**
 * 为首页开一条 sessions-index 专用桥并挂好帧面（订阅由 start() 显式发起，桥生命周期
 * 与调用方面板挂载配对）。
 *
 * 事件顺序（专用桥路径）：workspace-bridge-open → hello/clientHello 握手（每条 attachment
 * 恰一次，TaskSession.open 同款 mobileRemote 语义）→ 挂 onDynamicSessionsIndexFrame 帧面 →
 * 返回句柄；start() → subscribeSessionsIndexV4 ACK → store.setSubscription。ACK 前到达的
 * initial wire 有界暂存，ACK 认领后回放；断档经 store 闩锁 →
 * resyncSessionsIndexV4(forceSnapshot) 兜底。
 *
 * 失败语义：开桥/握手失败上抛（结构性失败，半开桥已释放）；start 的订阅失败不上抛
 * （existing-only 的 unavailable 是稳定态而非故障，降级为无活性投影）。
 */
export async function openHomeSessionsIndexBridge(
  client: RelayClient,
  workspacePath: string,
  workspaceIdentity?: string,
  options: { existingAccessor?: IServiceAccessor } = {},
): Promise<HomeSessionsIndexBridge> {
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const target: HomeWorkspaceTarget = {
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
  };

  let accessor = options.existingAccessor ?? null;
  let bridgeSessionId: string | null = null;
  let frameSubscription: IDisposable | null = null;
  let subscriptionId: string | null = null;
  let closed = false;

  async function resync(): Promise<void> {
    // same-sub 恢复：base 一律从 store 水位取（不猜）；forceSnapshot 让服务端直接给全量。
    if (closed || !accessor || !subscriptionId) return;
    const state = store.getState();
    const result = await accessor.droraAgentService.resyncSessionsIndexV4({
      ...target,
      subscriptionId,
      base: state.logEpoch === null ? null : { logEpoch: state.logEpoch, seq: state.seq },
      forceSnapshot: true,
    });
    // resync ACK 与 subscribe ACK 同形：重置 store 纪元（clear assembler + resync 闩锁）。
    store.setSubscription(result.ack);
  }

  // store 先建：onResync 经闭包反查 resync（断档不猜，由 resyncSessionsIndexV4 裁决；
  // 失败静默：闩锁保持至下一纪元/快照帧，不做无退避重试——TaskSession.open 同口径）。
  const store = createSessionsIndexStore({
    workspaceKey,
    onResync: () => {
      resync().catch(() => {});
    },
  });
  const frameGate = createInitialFrameGate({
    topic: sessionsIndexTopic(workspaceKey),
    onOwnedFrame: (candidate) => store.acceptWireFrame(candidate),
  });

  if (!accessor) {
    const bridge = await client.openWorkspaceBridge({ workspaceKey });
    accessor = connectViaProtocol(createRelayMessageProtocol(bridge));
    bridgeSessionId = bridge.identity.bridgeSessionId;
    const agent = accessor.droraAgentService;
    try {
      // 可信 hello → clientHello（每条 attachment 恰一次；能力位缺省 = 旧客户端语义，
      // 不声明 strict 未知键，老 Host 可握手——TaskSession.open 同款）。
      await agent.helloConversationV4();
      const clientHello: ClientHello = {
        kind: "clientHello",
        protocolVersion: V4_WIRE_PROTOCOL_VERSION,
        clientId: `drora-mobile-home-${bridgeSessionId}`,
        clientKind: "mobileRemote",
        appVersion: __MOBILE_APP_VERSION__,
      };
      await agent.initializeConversationV4(clientHello);
    } catch (error) {
      // 握手失败：释放半开桥，避免 RelayClient 桥注册表泄漏（TaskSession 订阅失败
      // 先解绑句柄同因）。
      client.releaseBridge(bridgeSessionId);
      throw error;
    }
  }

  // 帧面先于订阅就位；首帧可能早于 ACK，归属未确定时交给有界 gate 暂存。
  frameSubscription = accessor.droraAgentService.onDynamicSessionsIndexFrame(target)(
    (candidate) => {
      frameGate.accept(candidate);
    },
  );

  async function unsubscribeQuiet(): Promise<void> {
    if (!accessor || !subscriptionId) return;
    try {
      await accessor.droraAgentService.unsubscribeSessionsIndexV4({
        ...target,
        subscriptionId,
        runtimePolicy: "existing-only",
      });
    } catch {
      // 桥即将释放；退订失败不重试（连接关闭后 host 侧订阅随 attachment 级联清理）。
    }
  }

  return {
    workspaceKey,
    store,
    async start(): Promise<string | null> {
      if (closed || !accessor) return null;
      if (subscriptionId) return subscriptionId;
      frameGate.clear();
      try {
        const result = await accessor.droraAgentService.subscribeSessionsIndexV4({
          ...target,
          visibility: "foreground",
          subscriberScope: HOME_SESSIONS_INDEX_SUBSCRIBER_SCOPE,
          // task-list 类被动观察者必须 existing-only：runtime 不存在时返回稳定
          // unavailable，禁止为了建立列表订阅而启动 Agent（droraAgent.ts:524-528）。
          runtimePolicy: "existing-only",
        });
        if (closed) {
          // start await 窗口内已 close：ACK 登记前先精确退订，不漏订阅代际。
          subscriptionId = result.ack.subscriptionId;
          await unsubscribeQuiet();
          subscriptionId = null;
          frameGate.clear();
          return null;
        }
        const initial = frameGate.claim(result.ack.subscriptionId);
        if (initial === null) {
          // 首帧暂存超界：整批作废并撤销订阅，避免半个 snapshot 变成权威状态。
          subscriptionId = result.ack.subscriptionId;
          await unsubscribeQuiet();
          subscriptionId = null;
          frameGate.clear();
          return null;
        }
        subscriptionId = result.ack.subscriptionId;
        store.setSubscription(result.ack);
        for (const candidate of initial) store.acceptWireFrame(candidate);
        return subscriptionId;
      } catch {
        // existing-only 稳定拒绝（runtime 不存在/目标缺席）：降级为投影数据，
        // 不重试、不拉起 runtime（理由见接口注释）。
        frameGate.clear();
        return null;
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // 顺序：先停事件面（不再向 store 投帧）→ 退订（失败不阻塞关闭）→ 反注册专用桥
      // （复用任务桥 accessor 时 bridgeSessionId 为 null，桥归 TaskSession 所有不动）。
      frameSubscription?.dispose();
      frameSubscription = null;
      frameGate.clear();
      await unsubscribeQuiet();
      subscriptionId = null;
      if (bridgeSessionId) client.releaseBridge(bridgeSessionId);
    },
  };
}

/** 桥关闭收口（退订 + 解绑帧面 + 反注册专用桥）；与 openHomeSessionsIndexBridge 配对。 */
export async function closeSessionsIndexBridge(bridge: HomeSessionsIndexBridge): Promise<void> {
  await bridge.close();
}
