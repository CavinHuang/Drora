/**
 * Router（大副会话）无状态壳的 host 侧簿记与候选卡组装（02 详设 §1.1/§1.3）。
 *
 * - 编排事实永不依赖会话记忆：轮转计数/当前 sessionId 全在台账 kv（ROUTER_KV_KEYS），
 *   Router 会话本体归 CLI runtime 所有（spec §4 状态所有者），可随时重建；
 * - 轮转规则：每 N=10 张工单归档旧会话、建新会话（同一 mate-session-<seq> 序列，
 *   台账浓缩上下文作新会话首条输入）。"会话上下文超阈值"分支 P2 不实现（host 无
 *   上下文规模信号，禁超时兜底；02 详设 §1.1 修订已登记，随 P4 watchdog 裁决）；
 * - 候选卡：brief verbatim 截断 1500 字（ASSISTANT_SNAPSHOT_LIMITS.candidateBriefMax）
 *   + Trigger 元数据 + 读指针说明；路由约言（只路由不执行的 system prompt 契约）以
 *   首条输入前缀承载——(a) 路线 CLI 零改动（02 详设 §1.1 修订）。
 *
 * 纯模块：kv 状态由调用方读写（服务闭包经 db），本文件只做纯计算。
 */
import { ASSISTANT_SNAPSHOT_LIMITS } from "@drora/shared";

/** 台账 kv 键（mate.sqlite kv 表；存储键单出处）。 */
export const ROUTER_KV_KEYS = {
  /** 已轮转序列号（从 1 起；mate-session-<seq>）。 */
  seq: "router_session_seq",
  /** 当前 Router 会话 id（null=尚未创建）。 */
  currentSessionId: "router_current_session_id",
  /** 当前会话已评估的工单计数（达阈值即轮转）。 */
  ticketsSinceRotation: "router_tickets_since_rotation",
} as const;

export interface RouterShellState {
  readonly seq: number;
  readonly currentSessionId: string | null;
  readonly ticketsSinceRotation: number;
}

/** 序列名（02 §1.1：同一 mate-session-<seq> 序列）。 */
export function routerSessionName(seq: number): string {
  return `mate-session-${seq}`;
}

/** 是否轮转：计数达到阈值即归档旧会话、建新会话。 */
export function shouldRotateRouterSession(state: RouterShellState): boolean {
  return (
    state.currentSessionId === null ||
    state.ticketsSinceRotation >= ASSISTANT_SNAPSHOT_LIMITS.routerRotateEveryTickets
  );
}

/**
 * 路由约言（02 §1.1 system prompt 契约的 (a) 路线载体）：只路由不执行；路由注 ≤30 词；
 * 输出必须命中决策 schema；不读代码/日志原文（评估只依赖候选卡与读指针）。
 * 输出 schema 与 routerDecision.ts 的 zod 定义一一对应——两处同改（本文件注释即对账点）。
 */
export function composeRoutingPreamble(): string {
  return [
    "你是「大副」（Drora Mate 路由器）。只路由，不执行：不写代码、不读文件、不跑命令；评估只依据候选卡原文与读指针。",
    "对每个候选卡输出恰好一个 JSON 对象（可带前后缀说明文字），四臂恰现其一：",
    '{"dispatch":{"targetWorkspaceIdentity":"…","permissionTier":"build|guarded","briefBase":"verbatim|verbatim+appendix","appendix":"≤2000字,可选","budgetMaxTokens":可选},"evidence":[{"quote":"原文片段≤80字"}]}',
    '{"attach":{"sessionId":"…","targetWorkspaceIdentity":"…"},"evidence":[{"quote":"…"}]}',
    '{"hold":{"reason":"≤500字"},"evidence":[…]}',
    '{"reject":{"reason":"≤500字"},"evidence":[…]}',
    "evidence 至多 3 条且必须逐字引用候选卡原文；路由注（附加说明）≤30 词；拿不准一律 hold，禁止编造。",
  ].join("\n");
}

export interface CandidateCardInput {
  readonly triggerId: string;
  /** 用户原文 verbatim（不改写；超长截断并如实标注）。 */
  readonly text: string;
  readonly strength: string;
  readonly identity: string;
  readonly atMs: number;
  readonly targetWorkspaceIdentity?: string | null;
  /** 换代/续办时的台账浓缩段（02 §3：新会话首条输入携带）。 */
  readonly digest?: string;
}

export interface CandidateCard {
  /** 发往 Router 会话的完整首条输入（约言 + 候选卡）。 */
  readonly input: string;
  /** 原文是否被截断（决策卡如实展示）。 */
  readonly truncated: boolean;
  /** 读指针：全文所在（triggerId；Router 无工具不可读，仅供人工下钻对账）。 */
  readonly readPointer: string;
}

/** 组装候选卡（02 §1.3 时序第一步）：verbatim 截断 1500 字 + 元数据 + 读指针。 */
export function composeCandidateCard(input: CandidateCardInput): CandidateCard {
  const max = ASSISTANT_SNAPSHOT_LIMITS.candidateBriefMax;
  const truncated = input.text.length > max;
  const body = truncated ? `${input.text.slice(0, max)}…` : input.text;
  const readPointer = `trigger:${input.triggerId} offset:${max}${truncated ? "+（截断）" : "（全文）"}`;
  const meta = [
    `- triggerId: ${input.triggerId}`,
    `- strength: ${input.strength}`,
    `- identity: ${input.identity}`,
    `- targetWorkspaceIdentity: ${input.targetWorkspaceIdentity ?? "（未指定，由你建议）"}`,
    `- atMs: ${input.atMs}`,
    `- readPointer: ${readPointer}`,
  ].join("\n");
  const digest = input.digest ? `\n\n[台账浓缩]\n${input.digest}` : "";
  const card = [
    "【候选卡】以下是用户请求原文（verbatim，未改写）：",
    "---",
    body,
    "---",
    meta,
    `${truncated ? `\n（原文超 ${max} 字已截断；全文见读指针，不得臆测截断内容。）` : ""}${digest}`,
    "\n请按约言输出 JSON 决策。",
  ].join("\n");
  return { input: `${composeRoutingPreamble()}\n\n${card}`, truncated, readPointer };
}

/** 换代新会话首条输入的浓缩前缀（02 §3：台账浓缩上下文作新会话首条输入）。 */
export function composeRouterHandoff(digest: string): string {
  return `${composeRoutingPreamble()}\n\n【会话轮转交接】${digest}\n上一会话已归档；编排事实以工单台账为准，本会话无历史记忆。`;
}

/**
 * Mode B lead 会话首条输入（02 §5：prompt 驱动建队——指示走既有 /team stage→人批流程，
 * TeamHub/审批门零改动；brief 原文 verbatim 在前，角色建议由 Router appendix 或人工补充携带）。
 */
export function composeTeamLeadBrief(brief: string): string {
  return [
    brief,
    "---",
    "大副指示：本工单需要多角色并行执行。请使用既有 /team 流程起草团队（角色/任务草案），",
    "提交人工审批（stage → 人批）后再 spawn 成员；不得跳过审批门，不得自行直接执行任务。",
  ].join("\n");
}
