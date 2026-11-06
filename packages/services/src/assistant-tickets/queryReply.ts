/**
 * P7 查询确定性应答器（08 号详设 §3.2；spec §14 P7）。
 *
 * Router query_status 臂 → host 按账本模板生成答复（**零 LLM 加工**——答案由本模块
 * 从快照投影切片，与面板事实结构性恒一致；不存在 Router 幻觉账本）。五 scope：
 *   status（workspace/全局）、ticket、usage、digest、work（P8b，09 详设 §1.6——
 *   全域工作台账视角：每项目一行 kind 计数/最近活动/停滞点；快照 inventory 缺席回落
 *   工单账并注明「仅工单视角」，不拼半张账）。
 * 空态诚实文案（查无此票/无工单不猜测）；全文界 ASSISTANT_REPLY_LIMITS.replyTextMax。
 *
 * 数据面复用快照投影（buildAssistantSnapshot 同一 SQL 口径——不建第二读路径）。
 * inventory 由调用方（routerEvaluation）读装配层 provider 传入——本模块保持纯函数
 * （无 IO、不读模块级端口；测试直接注入视图）。
 */
import {
  ASSISTANT_REPLY_LIMITS,
  ASSISTANT_SNAPSHOT_LIMITS,
  ASSISTANT_TICKET_STATUSES,
  ASSISTANT_TRUST_GATE_DEFAULTS,
  MATE_WORK_INVENTORY_ROW_KINDS,
  type MateWorkInventoryView,
} from "@drora/shared";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";
import type { AssistantSnapshot } from "./assistantTickets.js";
import { buildAssistantSnapshot } from "./assistantSnapshot.js";

export type QueryReplyLocale = "zh" | "en";

export interface ComposeQueryReplyInput {
  readonly scope: {
    readonly kind: "status" | "ticket" | "usage" | "digest" | "work";
    readonly workspaceIdentity?: string;
    readonly ticketId?: string;
  };
  readonly raw: AssistantDatabaseRaw;
  readonly localIdentity: string;
  /**
   * P8b（09 详设 §1.6）：全域工作台账视图（调用方读 provider 传入；与快照同一新鲜度
   * 口径）。null/缺席=台账投影不可用——work scope 回落工单账并注明「仅工单视角」。
   */
  readonly inventory?: MateWorkInventoryView | null;
  /** TODO(P7 批 2)：Source 事件原语言接线——当前答复恒中文（面板缺省），参数占位。 */
  readonly locale?: QueryReplyLocale;
  readonly nowMs?: () => number;
}

export interface ComposeQueryReplyResult {
  /** 答复文本（界 replyTextMax；含数据时刻尾注）。 */
  readonly text: string;
  /** 命中的工单数（status/digest/work 汇总域；ticket/usage=0/1）。 */
  readonly matchedTickets: number;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function firstLine(text: string, max = 60): string {
  const line = text.split("\n", 1)[0]?.trim() ?? "";
  return [...line].length > max ? `${[...line].slice(0, max).join("")}…` : line;
}

function ticketStatusLabel(status: string): string {
  switch (status) {
    case ASSISTANT_TICKET_STATUSES.queued:
      return "排队中";
    case ASSISTANT_TICKET_STATUSES.dispatched:
      return "已派发";
    case ASSISTANT_TICKET_STATUSES.running:
      return "进行中";
    case ASSISTANT_TICKET_STATUSES.awaitingOutput:
      return "待核验";
    case ASSISTANT_TICKET_STATUSES.done:
      return "已完成";
    case ASSISTANT_TICKET_STATUSES.failed:
      return "已失败";
    default:
      return status;
  }
}

/**
 * status scope 的答案体（无 cap/footer——由调用方统一施加；work scope 缺席回落复用
 * 同一工单账口径，保证「仅工单视角」的回落与 status scope 结构性同文）。
 */
function composeStatusAnswer(
  domain: string | undefined,
  snapshot: AssistantSnapshot,
): { text: string; matchedTickets: number } {
  const inDomain = domain
    ? snapshot.tickets.filter((t) => t.targetWorkspaceIdentity === domain)
    : snapshot.tickets;
  const activeStatuses: readonly string[] = [
    ASSISTANT_TICKET_STATUSES.queued,
    ASSISTANT_TICKET_STATUSES.dispatched,
    ASSISTANT_TICKET_STATUSES.running,
    ASSISTANT_TICKET_STATUSES.awaitingOutput,
  ];
  const active = inDomain.filter((t) => activeStatuses.includes(t.status));
  const pending = snapshot.decisions.filter(
    (d) =>
      d.outcome === "decision_card" &&
      d.decidedBy === "gate" &&
      (!domain || snapshot.triggers.find((tr) => tr.id === d.triggerId)?.targetWorkspaceIdentity === domain),
  );
  const recent = inDomain
    .filter(
      (t) => t.status === ASSISTANT_TICKET_STATUSES.done || t.status === ASSISTANT_TICKET_STATUSES.failed,
    )
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, 3);
  if (active.length === 0 && recent.length === 0 && pending.length === 0) {
    return {
      text: domain
        ? `${domain} 当前没有大副工单。`
        : "大副当前没有任何工单——可在面板底部点名派活。",
      matchedTickets: 0,
    };
  }
  const lines = [domain ? `${domain}：` : "大副当前："];
  if (active.length > 0) {
    lines.push(
      ...active
        .slice(0, 5)
        .map(
          (t) =>
            `- ${firstLine(t.brief, 40)}：${ticketStatusLabel(t.status)}${t.dispatchMode && t.dispatchMode !== "A" ? `(${t.dispatchMode})` : ""} · ${clock(t.updatedAtMs)}`,
        ),
    );
  } else {
    lines.push("进行中 0");
  }
  if (pending.length > 0) lines.push(`待决策 ${pending.length}（面板可放行）`);
  if (recent.length > 0) {
    lines.push(
      ...recent.map(
        (t) =>
          `- 最近${t.status === ASSISTANT_TICKET_STATUSES.done ? "完成" : "失败"}：${firstLine(t.outputSummary ?? t.brief, 50)}（${clock(t.updatedAtMs)}）`,
      ),
    );
  }
  return { text: lines.join("\n"), matchedTickets: inDomain.length };
}

/**
 * P8b work scope 的全域答案体（09 详设 §1.4 示意：每项目一行——活动行数按 kind/
 * 最近活动时刻/停滞点；teams 计数随会话 kind 注记）。inventory 视图有界
 * （≤6 workspace），scoped 查询未命中时如实注记视图有界，不臆测「无工作」。
 */
function composeWorkAnswer(
  inventory: MateWorkInventoryView,
  domain: string | undefined,
): { text: string; matchedTickets: number } {
  const groups = domain
    ? inventory.workspaces.filter((workspace) => workspace.key === domain)
    : inventory.workspaces;
  if (groups.length === 0) {
    return {
      text: domain
        ? `全域台账中没有 ${domain} 的条目（台账视图有界，未必穷尽所有项目）。`
        : "全域台账当前没有活动条目。",
      matchedTickets: 0,
    };
  }
  const lines = [
    domain ? `${domain}（全域台账）：` : `全域台账 ${inventory.workspaces.length} 个项目：`,
  ];
  let matchedTickets = 0;
  for (const group of groups) {
    let tickets = 0;
    let sessions = 0;
    let teams = 0;
    let offpeak = 0;
    let stale = 0;
    let latest = 0;
    for (const row of group.rows) {
      if (row.updatedAtMs > latest) latest = row.updatedAtMs;
      if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.ticket) {
        tickets += 1;
        if (row.staleSinceMs != null) stale += 1;
      } else if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.session) {
        sessions += 1;
        if (row.teamStatus) teams += 1;
      } else {
        offpeak += 1;
      }
    }
    matchedTickets += tickets;
    const parts: string[] = [];
    if (tickets > 0) parts.push(`工单 ${tickets}`);
    if (sessions > 0) parts.push(teams > 0 ? `会话 ${sessions}（teams ${teams}）` : `会话 ${sessions}`);
    if (offpeak > 0) parts.push(`闲时任务 ${offpeak}`);
    let line = `- ${group.key}：${parts.join(" · ") || "无活动行"}｜最近活动 ${latest > 0 ? clock(latest) : "—"}`;
    if (stale > 0) line += `；停滞 ${stale}`;
    lines.push(line);
  }
  return { text: lines.join("\n"), matchedTickets };
}

/** 组装查询答复（host 确定性生成；写侧唯一入口=评估循环 query 臂落点）。 */
export function composeQueryReply(input: ComposeQueryReplyInput): ComposeQueryReplyResult {
  const nowMs = input.nowMs ?? (() => Date.now());
  // 最小配置读取（应答器不消费 config 语义字段——快照构建要求形；读侧坏值回落语义
  // 不受影响，快照只取工单/决策/触发事实）。
  const snapshot = buildAssistantSnapshot(input.raw, {
    mode: "observe",
    allowlist: [input.localIdentity],
    budgetMaxActivePerWorkspace: 3,
    worktreeDisabled: false,
    trustGateThresholds: {
      minRate: ASSISTANT_TRUST_GATE_DEFAULTS.minReleaseRate,
      minSamples: ASSISTANT_TRUST_GATE_DEFAULTS.minSamples,
    },
    watchdogIntervalMinutes: 15,
    modelPreference: null,
    sourcesConfig: {},
    identityMap: {},
  }, { dailyQuota: undefined });

  // 全文界（修复：footer 纳入 cap——旧实现先截 body 再拼 footer，全文超界）。
  const footer = `\n（数据时刻 ${clock(nowMs())}；详情见大副面板）`;
  const cap = (text: string): string => {
    const full = `${text}${footer}`;
    const chars = [...full];
    return chars.length > ASSISTANT_REPLY_LIMITS.replyTextMax
      ? `${chars.slice(0, ASSISTANT_REPLY_LIMITS.replyTextMax).join("")}…`
      : full;
  };

  if (input.scope.kind === "ticket" || input.scope.kind === "usage") {
    const ticketId = input.scope.ticketId?.trim() ?? "";
    const ticket = snapshot.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      return {
        text: cap(`没有找到工单 ${ticketId || "（未指定）"}——可在面板工单列表确认工单号。`),
        matchedTickets: 0,
      };
    }
    if (input.scope.kind === "usage") {
      const lines = [
        `工单 ${ticket.id} 累计：输入 ${ticket.usage.inputTokens} / 输出 ${ticket.usage.outputTokens} tokens`,
      ];
      for (const gen of ticket.usageByGeneration ?? []) {
        lines.push(`第 ${gen.generation} 代：输入 ${gen.inputTokens} / 输出 ${gen.outputTokens}`);
      }
      return { text: cap(lines.join("\n")), matchedTickets: 1 };
    }
    const lines = [
      `工单 ${ticket.id}（${ticket.brief}）：${ticketStatusLabel(ticket.status)}`,
      `第 ${ticket.generationCount ?? 1} 代 · 目标 ${ticket.targetWorkspaceIdentity}`,
    ];
    if (ticket.outputSummary) lines.push(`最新汇报：${firstLine(ticket.outputSummary, 120)}`);
    if (ticket.failReason) lines.push(`失败原因：${firstLine(ticket.failReason, 120)}`);
    if (ticket.status === ASSISTANT_TICKET_STATUSES.awaitingOutput)
      lines.push("工件核验滞留——可在面板「人工确认交付」或查看证据页签");
    return { text: cap(lines.join("\n")), matchedTickets: 1 };
  }

  if (input.scope.kind === "digest") {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const terminal = snapshot.tickets.filter(
      (t) =>
        (t.status === ASSISTANT_TICKET_STATUSES.done ||
          t.status === ASSISTANT_TICKET_STATUSES.failed) &&
        nowMs() - t.updatedAtMs <= weekMs,
    );
    if (terminal.length === 0) {
      return { text: cap("近 7 日没有已完成/失败的大副工单。"), matchedTickets: 0 };
    }
    const done = terminal.filter((t) => t.status === ASSISTANT_TICKET_STATUSES.done).length;
    const usage = terminal.reduce(
      (acc, t) => ({
        input: acc.input + t.usage.inputTokens,
        output: acc.output + t.usage.outputTokens,
      }),
      { input: 0, output: 0 },
    );
    const lines = [
      `近 7 日：完成 ${done} / 失败 ${terminal.length - done}；花费输入 ${usage.input} / 输出 ${usage.output} tokens`,
      ...terminal
        .slice(0, 6)
        .map((t) => `- ${firstLine(t.brief, 40)}：${ticketStatusLabel(t.status)}（${clock(t.updatedAtMs)}）`),
    ];
    return { text: cap(lines.join("\n")), matchedTickets: terminal.length };
  }

  const domain = input.scope.workspaceIdentity?.trim() || undefined;

  // P8b（09 详设 §1.6）：work scope——全域台账视角。inventory 缺席回落工单账并注明
  // 「仅工单视角」（诚实语义：不把工单账冒充全域账）。
  if (input.scope.kind === "work") {
    if (input.inventory) {
      const answer = composeWorkAnswer(input.inventory, domain);
      return { text: cap(answer.text), matchedTickets: answer.matchedTickets };
    }
    const answer = composeStatusAnswer(domain, snapshot);
    return {
      text: cap(`（全域台账暂不可用——以下仅工单视角）\n${answer.text}`),
      matchedTickets: answer.matchedTickets,
    };
  }

  // scope.kind === "status"（workspace 域或全局）
  const answer = composeStatusAnswer(domain, snapshot);
  return { text: cap(answer.text), matchedTickets: answer.matchedTickets };
}


/** 台账速览界——工单速览（v1 写死 400；速览消费 inventory 全域事实时改用
 *  contracts ledgerDigestInventoryMax=600，两界并存——09 详设 §1.6）。 */
const LEDGER_DIGEST_MAX = 400;

/**
 * 账本速览（08 号详设 §4 方案乙）：候选卡附带的有界台账事实——Router 无工具即可
 * 感知账本（查询意图判定/attach 目标佐证），零新进程。空台账返回 undefined
 * （候选卡不出现速览段，与 attachCandidates 缺席同语义）。
 *
 * P8b（09 详设 §1.6）：inventory 视图传入时追加速览段的全域会话/teams/闲时任务事实
 * （工单事实已在行内，全域段只补会话/闲时两类），attach 佐证从「仅工单」扩为全域；
 * 全文界升为 ledgerDigestInventoryMax=600（contracts 单出处）。工单账与全域事实皆空
 * 仍返回 undefined（缺席不拼半张账）。
 */
export function composeLedgerDigest(
  raw: AssistantDatabaseRaw,
  localIdentity: string,
  nowMs: () => number = () => Date.now(),
  /** 评估中的决策 id（排除自身——正在评估的这张卡不该计入「待决策」速览）。 */
  excludeDecisionId?: number,
  /** P8b：全域工作台账视图（调用方读 provider 传入；null/缺席=纯工单速览，界 400）。 */
  inventory?: MateWorkInventoryView | null,
): string | undefined {
  const snapshot = buildAssistantSnapshot(raw, {
    mode: "observe",
    allowlist: [localIdentity],
    budgetMaxActivePerWorkspace: 3,
    worktreeDisabled: false,
    trustGateThresholds: {
      minRate: ASSISTANT_TRUST_GATE_DEFAULTS.minReleaseRate,
      minSamples: ASSISTANT_TRUST_GATE_DEFAULTS.minSamples,
    },
    watchdogIntervalMinutes: 15,
    modelPreference: null,
    sourcesConfig: {},
    identityMap: {},
  }, { dailyQuota: undefined });
  const activeStatuses: readonly string[] = [
    ASSISTANT_TICKET_STATUSES.queued,
    ASSISTANT_TICKET_STATUSES.dispatched,
    ASSISTANT_TICKET_STATUSES.running,
    ASSISTANT_TICKET_STATUSES.awaitingOutput,
  ];
  const active = snapshot.tickets.filter((t) => activeStatuses.includes(t.status));
  const pending = snapshot.decisions.filter(
    (d) =>
      d.outcome === "decision_card" &&
      d.decidedBy === "gate" &&
      d.id !== excludeDecisionId,
  );
  const latest = snapshot.tickets
    .filter(
      (t) => t.status === ASSISTANT_TICKET_STATUSES.done || t.status === ASSISTANT_TICKET_STATUSES.failed,
    )
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0];
  // 全域段素材：会话/闲时行非零的组（工单事实已在上面行内，不重复计数）。
  const globalGroups = (inventory?.workspaces ?? []).filter((workspace) =>
    workspace.rows.some(
      (row) => row.kind !== MATE_WORK_INVENTORY_ROW_KINDS.ticket,
    ),
  );
  if (active.length === 0 && pending.length === 0 && !latest && globalGroups.length === 0) {
    return undefined;
  }
  const lines: string[] = [`活动 ${active.length} / 待决策 ${pending.length}`];
  for (const ticket of active.slice(0, 3)) {
    lines.push(
      `- ${ticket.targetWorkspaceIdentity}：${firstLine(ticket.brief, 30)}（${ticketStatusLabel(ticket.status)}）`,
    );
  }
  if (latest) {
    lines.push(
      `- 最近${latest.status === ASSISTANT_TICKET_STATUSES.done ? "完成" : "失败"}：${firstLine(latest.targetWorkspaceIdentity ?? "", 20)}（${firstLine(latest.outputSummary ?? latest.brief, 40)}）`,
    );
  }
  for (const workspace of globalGroups.slice(0, 3)) {
    let sessions = 0;
    let teams = 0;
    let offpeak = 0;
    for (const row of workspace.rows) {
      if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.session) {
        sessions += 1;
        if (row.teamStatus) teams += 1;
      } else if (row.kind === MATE_WORK_INVENTORY_ROW_KINDS.offpeak) {
        offpeak += 1;
      }
    }
    const parts: string[] = [];
    if (sessions > 0) parts.push(teams > 0 ? `会话 ${sessions}（teams ${teams}）` : `会话 ${sessions}`);
    if (offpeak > 0) parts.push(`闲时 ${offpeak}`);
    if (parts.length > 0) lines.push(`- 全域 ${workspace.key}：${parts.join(" · ")}`);
  }
  const text = lines.join("\n");
  const max = globalGroups.length > 0
    ? ASSISTANT_SNAPSHOT_LIMITS.ledgerDigestInventoryMax
    : LEDGER_DIGEST_MAX;
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}
