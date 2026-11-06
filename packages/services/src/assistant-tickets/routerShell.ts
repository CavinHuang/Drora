/**
 * Router（大副会话）无状态壳的 host 侧簿记与候选卡组装（02 详设 §1.1/§1.3）。
 *
 * - 编排事实永不依赖会话记忆：轮转计数/当前 sessionId 全在台账 kv（ROUTER_KV_KEYS），
 *   Router 会话本体归 CLI runtime 所有（spec §4 状态所有者），可随时重建；
 * - 轮转规则：每 N=10 张工单建新会话（同一 mate-session-<seq> 序列）。**无浓缩交接、
 *   无旧会话归档动作**（P2 裁剪，CONTRACT.md 已登记）：每张候选卡自带完整约言，
 *   编排事实在台账——新会话首条输入即下一张候选卡，零交接依赖；02 §1.1 原案的
 *   "归档旧会话/浓缩交接"待 CLI 会话生命周期处置动作可用时再对账。"会话上下文超
 *   阈值"分支 P2 不实现（host 无上下文规模信号，禁超时兜底；随 P4 watchdog 裁决）；
 * - 候选卡：brief verbatim 截断 1500 字（ASSISTANT_SNAPSHOT_LIMITS.candidateBriefMax）
 *   + Trigger 元数据 + 读指针说明 + Tier2 附着候选集（02 §2，filterAttachCandidates
 *   硬过滤产出）；路由约言（只路由不执行的 system prompt 契约）以首条输入前缀承载
 *   ——(a) 路线 CLI 零改动（02 详设 §1.1 修订）。
 *
 * 纯模块：kv 状态由调用方读写（服务闭包经 db），本文件只做纯计算。
 */
import { ASSISTANT_MANAGE_LIMITS, ASSISTANT_SNAPSHOT_LIMITS } from "@drora/shared";
import type { MateWorkInventoryView } from "@drora/shared";
import type { AssistantSessionSummaryLite } from "./assistantPorts.js";

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
 * Tier2 反编造纪律（02 §2）：attach 臂 sessionId 只能取自候选卡【附着候选】清单；
 * 清单缺席/为空/均不合适 → hold，禁止编造 sessionId（派发桥随后 fail-closed 兜底）。
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
    "attach 臂的 sessionId 只能取自候选卡【附着候选】清单；清单缺席、为空或均不合适 → hold，禁止编造 sessionId。",
    "候选卡【台账速览】段（若有）是大副账本的当前事实（活动/待决策/最近完成计数；P8 起含「全域 …」行=跨项目会话/teams/闲时任务概览）——查询意图的 scope 判定与 dispatch/attach 的目标佐证以它为准（attach 目标佐证不限于大副工单，但 sessionId 仍只能取自【附着候选】清单）；缺席时按原文判断，禁止臆测账本内容。",
    "P7 查询直答（08 号详设；P8 扩 work；P10a 扩 chat）：进度/状态/成本/摘要类**查询意图**（不要求执行）→ {\"query_status\":{\"scope\":{\"kind\":\"status|ticket|usage|digest|work\",\"workspaceIdentity\":可选,\"ticketId\":可选},\"reason\":\"≤500字\"},\"evidence\":[…]}——系统会按你的 scope 直查账本作答，无需 worker。问「最近都在忙什么/各项目什么情况」等跨项目问题用 work（全域工作台账视角）。非四 scope 的读意图（闲聊/咨询/泛问题）→ {\"query_status\":{\"scope\":{\"kind\":\"chat\"},\"reason\":\"≤500字\"},\"evidence\":[…]}——系统会以你身份追加一轮自由作答。含「去做/去修/去查一下」等执行动词 → dispatch/attach。",
    "P10b 管理动作：管理写意图（停掉会话/取消闲时任务）→ {\"manage\":{\"targetKind\":\"session|offpeak_task\",\"targetRef\":\"…\",\"action\":\"stop_turn|cancel\",\"reason\":\"≤200字\"},\"evidence\":[…]}——仅 session+stop_turn / offpeak_task+cancel 两配对；targetRef 只能取自候选卡【可管理对象】清单（缺席/为空/不合适 → hold 引导面板，禁止编造）；管理必须决策卡人工 Y。停大副自己的工单/切模式/换代 → reject 引导面板。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// P10a（10 号详设 §2.2）：Router 聊天轮输入组装——query_status scope kind="chat" 时
// 评估循环改经 router port 聊天轮入口向**同一 Router 会话**追加自由作答轮。约言与候选
// 卡轮/自主轮互扰防护：显式标记「本输入为聊天轮」（composeAutonomyPreamble 自主轮
// 同款先例——同一会话内多类输入靠标记区分，不靠模型猜）。
// ---------------------------------------------------------------------------

/**
 * 聊天轮约言（双脑禁令落点）：自由作答、无工具、不承诺执行、涉及工单操作只引导走
 * 任务/面板；输出=自然语言 ≤800 字（host 只截断不解析——非 zod 五臂，无失败解析态）。
 */
export function composeChatTurnPreamble(): string {
  return [
    "你是「大副」（Drora Mate）。【本输入为聊天轮】——这不是候选卡，无需输出 JSON 决策；也不是自主评估。",
    "你没有工具：不读写文件、不跑命令、不查账本系统；凭本会话已有上下文以自然语言自由作答。",
    "回答 ≤800 字；不承诺执行任何操作——需要执行的事请引导用户走任务派发或大副面板。",
    "涉及工单/会话操作（停止、换代、切换模式等）时，只说明可在面板完成，不要声称已做或将做。",
  ].join("\n");
}

/** 聊天轮完整输入（约言 + 用户问题 verbatim；超 candidateBriefMax 截断并如实标注）。 */
export function composeChatTurnInput(question: string): string {
  const max = ASSISTANT_SNAPSHOT_LIMITS.candidateBriefMax;
  const truncated = question.length > max;
  const body = truncated ? `${question.slice(0, max)}…` : question;
  return [
    composeChatTurnPreamble(),
    "【用户问题】（verbatim，未改写）：",
    "---",
    body,
    "---",
    `${truncated ? `（原文超 ${max} 字已截断；不得臆测截断内容。）\n` : ""}请按约言以自然语言回答（本输入为聊天轮）。`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tier2 附着候选集（02 §2）：harness 生成有界候选——目标 workspace 的 sessions-index
// 快照经硬过滤（已结束/busy/无转录 draft/过期>7d），喂给 Router 带证据选择。
// 纯函数：跨 identity 由端口按 (workspaceIdentity, hostPath) 作用域保证（快照只含
// 本 workspace 会话）；本函数只做会话级硬过滤与有界截断。
// ---------------------------------------------------------------------------

/** 候选卡携带的附着候选（AssistantSessionSummaryLite 的有界投影）。 */
export interface RouterAttachCandidate {
  readonly sessionId: string;
  readonly title: string;
  readonly phase: string;
  readonly updatedAtMs: number;
}

/** busy 判定（02 §2 硬过滤）：有进行中工作（running/prewarming）的会话不入选——
 * busy 投递本身合法（heldQueueDisposition 保序），但 Tier2 候选要求目标可立即承接，
 * 时序不可预期的会话留给 Tier1 直投与人工路径。draft=无转录空会话，无续办语义。 */
function isBusyPhase(phase: string): boolean {
  return phase === "running" || phase === "prewarming" || phase === "draft";
}

/**
 * Tier2 硬过滤纯函数：已结束（sessionEnded）、busy/draft、updatedAt 距今超过
 * attachCandidateFreshMaxMs（7d）的会话剔除；按原序保留至多 attachCandidatesMax 条。
 * 空 sessionId 的坏行防御性剔除（诚实不猜）。
 */
export function filterAttachCandidates(input: {
  sessions: readonly AssistantSessionSummaryLite[];
  /** 当前时刻（ms）；7d 过期判定基准（注入便于测试）。 */
  nowMs: number;
}): RouterAttachCandidate[] {
  const freshWindow = ASSISTANT_SNAPSHOT_LIMITS.attachCandidateFreshMaxMs;
  const result: RouterAttachCandidate[] = [];
  for (const session of input.sessions) {
    if (!session.sessionId) continue;
    if (session.sessionEnded) continue;
    if (isBusyPhase(session.phase)) continue;
    if (
      typeof session.updatedAtMs !== "number" ||
      !Number.isFinite(session.updatedAtMs) ||
      input.nowMs - session.updatedAtMs > freshWindow
    ) {
      continue;
    }
    result.push({
      sessionId: session.sessionId,
      title: session.title,
      phase: session.phase,
      updatedAtMs: session.updatedAtMs,
    });
    if (result.length >= ASSISTANT_SNAPSHOT_LIMITS.attachCandidatesMax) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// P10b（10 号详设 §3.1）：manage 臂台账可见集——评估输入携带的可管理对象清单
// （attach【附着候选】同款结构化反编造载体；约言约束 Router 只能从中取 targetRef，
// 放行预检 manageActions 按**实时**可见集 fail-closed 兜底——两道防线同 attach）。
// ---------------------------------------------------------------------------

/** 候选卡携带的可管理对象（台账行投影；workspaceKey 供放行预检解析执行目标域）。 */
export interface RouterManageTarget {
  readonly targetKind: "session" | "offpeak_task";
  readonly targetRef: string;
  readonly title: string;
  /** 台账分组键（AGENTS 身份键；执行端口据此定位会话/任务所在 workspace 域）。 */
  readonly workspaceKey: string;
}

/**
 * 台账可见集推导（纯函数）：inventory 会话行/闲时行 → 有界可管理对象清单。
 * 每类各取最近活动在前 targetsMaxPerKind 条（视图本身已按最近活动排序）；已结束
 * 会话不可停（无当前回合）不入清单。工单行不入（停大副自有工单走 stopMandate
 * 既有面，非 manage 臂）。inventory 缺席（provider 未注入/冷启动）→ 空集（候选卡
 * 不出段，约言禁止 Router 输出 manage 臂——诚实降级 Tier3）。
 */
export function deriveManageTargets(
  inventory: MateWorkInventoryView | null,
): RouterManageTarget[] {
  if (!inventory) return [];
  const targets: RouterManageTarget[] = [];
  const perKindBudget = ASSISTANT_MANAGE_LIMITS.targetsMaxPerKind;
  let sessions = 0;
  let offpeak = 0;
  for (const workspace of inventory.workspaces) {
    for (const row of workspace.rows) {
      if (row.kind === "session") {
        if (row.sessionEnded) continue;
        if (sessions >= perKindBudget) continue;
        sessions += 1;
        targets.push({
          targetKind: "session",
          targetRef: row.sessionId,
          title: row.title,
          workspaceKey: workspace.key,
        });
      } else if (row.kind === "offpeak") {
        if (offpeak >= perKindBudget) continue;
        offpeak += 1;
        targets.push({
          targetKind: "offpeak_task",
          targetRef: row.taskId,
          title: row.title,
          workspaceKey: workspace.key,
        });
      }
    }
  }
  return targets;
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
  /**
   * Tier2 附着候选集（02 §2：listSessions 硬过滤产出；P2 审查修复接线——此前候选卡
   * 无候选清单，Router 的 attach 臂 sessionId 无真实来源）。缺席/空集=无候选，
   * Router 按约言不得输出 attach 臂。
   */
  readonly attachCandidates?: readonly RouterAttachCandidate[];
  /**
   * P10b manage 台账可见集（deriveManageTargets 产出；10 号详设 §3.1）。缺席/空集=
   * 无可管理对象，Router 按约言不得输出 manage 臂（hold 引导面板）。
   */
  readonly manageTargets?: readonly RouterManageTarget[];
}

export interface CandidateCard {
  /** 发往 Router 会话的完整首条输入（约言 + 候选卡）。 */
  readonly input: string;
  /** 原文是否被截断（决策卡如实展示）。 */
  readonly truncated: boolean;
  /** 读指针：全文所在（triggerId；Router 无工具不可读，仅供人工下钻对账）。 */
  readonly readPointer: string;
}

/** 组装候选卡（02 §1.3 时序第一步）：verbatim 截断 1500 字 + 元数据 + 读指针 + Tier2 候选。 */
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
  const candidates = input.attachCandidates?.length
    ? `\n\n【附着候选】目标 workspace 的可附着会话（已硬过滤 busy/已结束/无转录/过期>7d；sessionId 必须从这里选）：\n${input.attachCandidates
        .map(
          (candidate) =>
            `- ${candidate.sessionId} 「${candidate.title}」 phase=${candidate.phase} updatedAt=${candidate.updatedAtMs}`,
        )
        .join("\n")}`
    : "";
  // P10b：可见集段（manage 臂 targetRef 的唯一合法来源；缺席不出段——约言禁止 manage）。
  const manageList = input.manageTargets?.length
    ? `\n\n【可管理对象】台账当前可见的会话/闲时任务（manage 臂 targetRef 必须从这里选）：\n${input.manageTargets
        .map(
          (target) =>
            `- ${target.targetKind} ${target.targetRef} 「${target.title}」`,
        )
        .join("\n")}`
    : "";
  const card = [
    "【候选卡】以下是用户请求原文（verbatim，未改写）：",
    "---",
    body,
    "---",
    meta,
    `${truncated ? `\n（原文超 ${max} 字已截断；全文见读指针，不得臆测截断内容。）` : ""}${digest}${candidates}${manageList}`,
    "\n请按约言输出 JSON 决策。",
  ].join("\n");
  return { input: `${composeRoutingPreamble()}\n\n${card}`, truncated, readPointer };
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
