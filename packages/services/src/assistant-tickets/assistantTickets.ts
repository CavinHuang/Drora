/**
 * Drora Mate 工单服务接口（specs/drora-personal-assistant.md §5；
 * docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md §1.3）。
 *
 * 本文件 browser-safe：只放接口 + descriptor（工厂在 assistantTicketsService.ts，
 * 经 services/node.ts 装配——index.ts:187-190 红线：根 barrel 只导出 descriptor 与类型）。
 */

import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";
import {
  ASSISTANT_MODES,
  ASSISTANT_PERMISSION_TIERS,
  type AssistantErrorCode,
  type AssistantMode,
  type AssistantPermissionTier,
  type AssistantStrength,
} from "@drora/shared";

// ---------------------------------------------------------------------------
// 快照形状（onDidChange 推送；01 §1.2——zod schema 在 service 侧 parse，UI type-only）
// ---------------------------------------------------------------------------

export interface AssistantTriggerView {
  readonly id: string;
  readonly sourceKind: string;
  readonly strength: AssistantStrength;
  readonly identity: string;
  readonly text: string;
  readonly atMs: number;
  /** P2：触发目标 workspace（mateActivity 聚合与决策卡预填的归属键；缺席=未指定）。 */
  readonly targetWorkspaceIdentity?: string | null;
  /**
   * P3：Source 通道绑定（03 详设 §5；串接格式 sources/channelRef.ts 单出处）。
   * local 触发恒 null；放行建票时回填 ticket.channel_ref。
   */
  readonly channelRef?: string | null;
  /** P3：手机远控会话贯穿（AGENTS.md 远程链路贯穿；仅追溯/推送路由用）。 */
  readonly remoteSessionId?: string | null;
}

/**
 * Router 建议预填（02 详设 §1.3：决策卡预填 Router 建议与证据，人终审 Y/N/E）。
 * kind 与 services routerDecision.ts 的 RouterDecision 四臂对齐（UI type-only）。
 */
export interface AssistantRouterSuggestionView {
  readonly kind: "dispatch" | "attach" | "hold" | "reject";
  readonly targetWorkspaceIdentity?: string;
  readonly sessionId?: string;
  readonly permissionTier?: AssistantPermissionTier;
  readonly briefBase?: "verbatim" | "verbatim+appendix";
  readonly appendix?: string;
  readonly reason?: string;
  readonly evidence: readonly string[];
}

export interface AssistantDecisionView {
  readonly id: number;
  readonly triggerId: string;
  readonly strength: AssistantStrength;
  readonly mode: AssistantMode;
  readonly outcome: string;
  readonly decidedBy: "gate" | "user";
  readonly decidedMs: number;
  /** 决策卡可用：对应的 trigger 正文预览（verbatim 首行截断）。 */
  readonly triggerText: string;
  /**
   * P3（Source 注册表，03 详设 §1；可选追加不破 v2 兼容）：触发来源封闭枚举
   * （ASSISTANT_SOURCE_KINDS——local/feishu/phone/github）。UI 决策卡/观察行据此渲染
   * 来源徽标；旧快照行缺席合法。
   */
  readonly sourceKind?: string;
  /** P2：Router 评估状态（pending=评估中；suggested=有建议；failed=降级 Tier3 问人）。 */
  readonly routerState?: "pending" | "suggested" | "failed";
  /** P2：Router 建议预填（schema 校验通过才有；failed 时缺省）。 */
  readonly routerSuggestion?: AssistantRouterSuggestionView;
  /** P2：Router 评估失败原因（诚实展示，不重试模型）。 */
  readonly routerError?: string;
}

/** 写域视图（02 详设 §4；UI 据此明示隔离形态——worktree=目录级，paths=声明域，workspace=未隔离）。 */
export type AssistantWriteDomainView =
  | { readonly kind: "workspace" }
  | { readonly kind: "worktree"; readonly path: string; readonly branch: string }
  | { readonly kind: "paths"; readonly paths: readonly string[] };

export interface AssistantTicketView {
  readonly id: string;
  readonly brief: string;
  readonly status: string;
  readonly permissionTier: AssistantPermissionTier;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly outputSummary: string | null;
  readonly failReason: string | null;
  readonly targetWorkspaceIdentity: string | null;
  readonly sessionId: string | null;
  readonly updatedAtMs: number;
  /** P2：派发模式（A=独立；B=建队；C=附着；未派发=undefined）。 */
  readonly dispatchMode?: "A" | "B" | "C";
  /** P2：写域（spec §9；queued/approved 即有值）。 */
  readonly writeDomain?: AssistantWriteDomainView;
  /** P2：已归档代际数（+1=当前代序号）。 */
  readonly generationCount?: number;
  /** P2：当代锚（最后成功投递的 commandId；null=尚未投递）。 */
  readonly anchorCommandId?: string | null;
  /** P2：queued 原因（软预算告知卡文案）。 */
  readonly queuedReason?: string | null;
  /**
   * P2 Surface 批次补投影（可选追加，不破 v2 兼容）：建票决策卡 id（ticket.decision_id
   * 列既有）。Surface C 证据页签据此关联决策卡取 triggerText verbatim 与 Router 证据；
   * 手动建票（无 decision_id，NULL）时缺席。类型与 assistantSnapshot.ts 投影同步。
   */
  readonly decisionId?: number | null;
  /**
   * P3（Source 注册表，03 详设 §5）：工单的通道绑定（feishu thread / GitHub issue /
   * 手机会话；串接格式 sources/channelRef.ts 单出处）。同绑定 SourceEvent 命中活动工单
   * 即直通 Tier1（不过 gate/Router）。本地双按钮建票无绑定（NULL）。
   */
  readonly channelRef?: string | null;
}

export interface AssistantConfigView {
  readonly mode: AssistantMode;
  readonly allowlist: readonly string[];
  readonly budgetMaxActivePerWorkspace: number;
  /** P2：W1 worktree 用户开关（spec §9：关闭 → W2 声明域；kv worktree_disabled，缺省 false）。 */
  readonly worktreeDisabled: boolean;
}

export interface AssistantTrustView {
  readonly wouldAcceptCount: number;
  readonly releaseCount: number;
}

export interface AssistantSnapshot {
  /** v2（2026-11-05，P2）：决策卡 Router 建议预填 + 工单写域/代际/锚/模式字段。
   * P2 审查修复追加 worktreeDisabled（W1 用户开关投影，仍属 v2 有界投影的增量字段）。 */
  readonly version: 2;
  readonly mode: AssistantMode;
  readonly allowlist: readonly string[];
  readonly budget: { readonly maxActivePerWorkspace: number };
  /** P2 审查修复：W1 worktree 用户开关（spec §9 W2 兜底；setWorktreeDisabled 唯一写路径）。 */
  readonly worktreeDisabled: boolean;
  readonly trust: AssistantTrustView;
  readonly triggers: readonly AssistantTriggerView[];
  readonly decisions: readonly AssistantDecisionView[];
  readonly tickets: readonly AssistantTicketView[];
  readonly updatedAtMs: number;
}

// ---------------------------------------------------------------------------
// 服务失败臂（封闭错误码；正文入 fail_reason 不进错误码——照 PersonaManagementResult）
// ---------------------------------------------------------------------------

export type AssistantServiceError = { readonly code: AssistantErrorCode; readonly reason?: string };

export type AssistantResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AssistantServiceError };

// ---------------------------------------------------------------------------
// 接口
// ---------------------------------------------------------------------------

export interface IAssistantTicketService {
  /**
   * 记录一次本地触发并跑准入门（纯函数判定；单一写者事务内同写 trigger+decision）。
   * P1 仅 local Source：strength 由 UI 双按钮模拟（explicit=点名 / inferred=未指名），
   * P3 起由真实 Source 判定（mention && allowlist）。
   * off 模式：只记 trigger+decision（outcome=ignored），零执行。
   */
  recordTrigger(input: {
    text: string;
    simulated: AssistantStrength;
    targetWorkspaceIdentity?: string;
  }): Promise<AssistantResult<{ triggerId: string; outcome: string }>>;

  /**
   * 决策卡人工放行（explicit×observe 路径；P1 Mode A 直派）。
   * briefAppendix 追加段拼在 verbatim 原文之后（原文永不改写）；
   * permissionTier 缺省取 build；同 decision 重复放行幂等返回首次 ticketId。
   * P2 扩展：dispatchMode='B' → 建队（prompt 驱动 /team，spec §7）；
   * attachToSessionId 非空 → Mode C 附着该既有会话（派发桥校验存在/归属后投递，
   * 决策卡从 Router attach 建议预填，"开新会话"恒为人工选项）；
   * 软预算满/写域冲突 → 工单 queued + 返回 queued:true（告知卡文案在 ticket.queuedReason）。
   */
  approveDecision(input: {
    decisionId: number;
    briefAppendix?: string;
    permissionTier?: Exclude<AssistantPermissionTier, typeof ASSISTANT_PERMISSION_TIERS.yolo>;
    targetWorkspaceIdentity?: string;
    dispatchMode?: "A" | "B";
    attachToSessionId?: string;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string; queued?: boolean }>>;

  /** 忽略决策卡（N）：decision 记 rejected，trigger 保留。 */
  ignoreDecision(input: { decisionId: number }): Promise<AssistantResult<{ ok: true }>>;

  /**
   * P3 Source 注册表的 channel 可见入口（03 详设 §3 手机 Source 事件面定型；renderer/
   * 手机 replayable attachment 可达的唯一 Source 入口）。仅开放 sourceKind="phone"：
   * identity 由 host 侧取本机用户（renderer 不可自报 feishu/github 外部身份——防身份
   * 伪造，飞书/GitHub identity 只能来自 host 侧映射，走 host 内部 ingestSourceEvent）。
   * channelRef 命中活动工单 → 直通 Tier1（不过 gate）；否则按真实强度规则进 gate
   * （mention && allowlist → explicit）。remoteSessionId 贯穿落 trigger.remote_session_id。
   */
  submitSourceEntry(input: {
    text: string;
    mention: boolean;
    remoteSessionId?: string;
    /** 已串接的通道绑定（sources/channelRef.ts 格式；非法格式拒绝）。 */
    channelRef?: string;
    targetWorkspaceIdentity?: string;
    atMs?: number;
  }): Promise<
    AssistantResult<{
      triggerId: string | null;
      outcome: string | null;
      directThrough: boolean;
      ticketId?: string;
      sessionId?: string;
    }>
  >;

  /** Mandate 变更途径之二：用户 stop（工单未终态时终止；spec §5 三途径）。 */
  stopMandate(input: { ticketId: string }): Promise<AssistantResult<{ ok: true }>>;

  /** 忽略观察记录（would-accept 行 N）：decision 补 ignored。 */
  dismissObservation(input: { triggerId: string }): Promise<AssistantResult<{ ok: true }>>;

  /** Mandate 变更途径之三：校验失败撤销（仅服务内部/测试路径调用）。 */
  revokeMandate(input: {
    ticketId: string;
    reason: string;
  }): Promise<AssistantResult<{ ok: true }>>;

  setMode(mode: AssistantMode): Promise<AssistantResult<{ ok: true }>>;
  setAllowlist(identities: readonly string[]): Promise<AssistantResult<{ ok: true }>>;
  /**
   * W1 worktree 用户开关（spec §9 W2 兜底；P2 审查修复补交互入口——此前 kv
   * worktree_disabled 只有读取，"用户关闭 W1"分支仅测试直驱可达）。开启=派发前规划
   * worktree；关闭=声明域（W2，空集=待声明整域）。只影响之后的派发规划，不改动
   * 已建工单的写域。
   */
  setWorktreeDisabled(disabled: boolean): Promise<AssistantResult<{ ok: true }>>;
  getConfig(): Promise<AssistantResult<AssistantConfigView>>;

  /** 全量快照（拉取一次；后续经 onDidChange 推送）。 */
  getSnapshot(): Promise<AssistantSnapshot>;

  /**
   * 快照推送订阅。返回 disposable 对象（非裸函数）——ProxyChannel.toService 对 on*
   * 属性返回 channel.listen 订阅语义（proxy-channel.ts:126-133，照 IModelCapabilitiesService
   * 先例）；UI 端 unsubscribe=subscription.dispose()。
   */
  onDidChange(listener: (snapshot: AssistantSnapshot) => void): { dispose(): void };
}

export const IAssistantTicketService = createServiceDescriptor<IAssistantTicketService>(
  ServiceChannels.AssistantTickets,
);

/** 供 accessor/client 类型引用的 re-export（防 import 面散落）。 */
export { ASSISTANT_MODES, ASSISTANT_PERMISSION_TIERS };
