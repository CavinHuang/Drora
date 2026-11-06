/**
 * Mate 桌宠接缝投影纯函数（specs/drora-personal-assistant.md §11 P3 落地注记；
 * docs/mate-implementation-plan-2026-11-04/03-p3-detailed-design.md §6）。
 *
 * 快照 → 有界 MatePetProjection（shared assistantPet.ts schema 的形状，供
 * platform.publishMatePet 发布、Main 转发宠物窗/tray 窗）。零副作用：只读过滤/截断/
 * 排序，不改写输入快照（view-model 同款纪律）；工单事实仍以 IAssistantTicketService
 * 快照为唯一事实源，本投影只服务桌宠呈现。
 *
 * 气泡判定（deriveMatePetBubble）：新汇报=latestReport 的 ticketId+updatedAtMs 组合键
 * 与已展示键不同；冷启动首帧只静默登记（历史汇报不弹泡，直达 tray 速览最新汇报行）。
 * 配额闸归 P4 配额中心（03 §6「P4 配额中心同一计数」——P3 不建第二计数器）。
 */

import {
  ASSISTANT_AUTONOMY_NOTICE_KINDS,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_SOURCE_KINDS,
  ASSISTANT_TICKET_STATUSES,
  MATE_PET_PROJECTION_LIMITS,
  type MatePetActiveTicket,
  type MatePetAutonomyBubble,
  type MatePetLatestReport,
  type MatePetPendingDecision,
  type MatePetProjection,
  type MatePetRecentTicket,
} from "@drora/shared";
import type { AssistantSnapshot } from "@drora/services";

import { isMateActiveTicket, isMatePendingDecision, isMateQueuedTicket } from "./view-model.js";

/** 首行截断（速览单行展示；与 MateTicketRow firstPreviewLine 同语义，本地实现避免循环依赖）。 */
function firstLine(text: string, max: number): string {
  const line = text.split("\n", 1)[0]?.trim() ?? "";
  return [...line].length > max ? `${[...line].slice(0, max).join("")}…` : line;
}

/** 汇报摘要首行：终态 output_summary 优先，failed 回落 fail_reason（诚实不伪造摘要）。 */
export function matePetReportSummary(ticket: AssistantSnapshot["tickets"][number]): string {
  const source = ticket.outputSummary ?? ticket.failReason ?? "";
  return firstLine(source, MATE_PET_PROJECTION_LIMITS.textMax);
}

/** 快照 → 桌宠投影（待决策 ≤5 按推送序；进行中 ≤5 按更新时间倒序；最新汇报一条）。 */
export function projectMatePet(snapshot: AssistantSnapshot): MatePetProjection {
  const pendingDecisions: MatePetPendingDecision[] = snapshot.decisions
    .filter(isMatePendingDecision)
    .slice(0, MATE_PET_PROJECTION_LIMITS.pendingMax)
    .map((decision) => {
      // 建议档透传（spec §11 tray 放行同参注记）：dispatch/attach 建议带 permissionTier
      // 时随投影行下发，decide 执行体据此预填（与面板 approveTier 同规则）；yolo 建议
      // 不透传（速览放行禁止 yolo，接口类型与服务侧人批门双兜底）、缺席=回落 build。
      const suggestedTier = decision.routerSuggestion?.permissionTier;
      return {
        decisionId: decision.id,
        text: firstLine(decision.triggerText, MATE_PET_PROJECTION_LIMITS.textMax),
        // 决策卡快照行 sourceKind 是可选追加字段；缺席（旧库行）按 local 诚实降级——
        // 本地双按钮是 P1 以来最常见触发面，不发明第四种来源。字面量单出处
        // （contracts ASSISTANT_SOURCE_KINDS；spec §5 P3 落地注记）。
        sourceKind:
          (decision.sourceKind as MatePetPendingDecision["sourceKind"]) ??
          ASSISTANT_SOURCE_KINDS.local,
        identity: findDecisionIdentity(snapshot, decision.triggerId),
        ...(suggestedTier && suggestedTier !== ASSISTANT_PERMISSION_TIERS.yolo
          ? { suggestedTier }
          : {}),
      };
    });
  const activeTickets: MatePetActiveTicket[] = snapshot.tickets
    .filter((ticket) => isMateActiveTicket(ticket.status) || isMateQueuedTicket(ticket.status))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, MATE_PET_PROJECTION_LIMITS.activeMax)
    .map((ticket) => ({
      ticketId: ticket.id,
      // P4 第二棒（04 详设 §3）：核验滞留 awaiting_output→"awaiting"（shared schema
      // 只加不破；旧宠物窗未知值走 matePetStatusLabel 兜底分支）。
      status:
        ticket.status === ASSISTANT_TICKET_STATUSES.queued
          ? "queued"
          : ticket.status === ASSISTANT_TICKET_STATUSES.running
            ? "running"
            : ticket.status === ASSISTANT_TICKET_STATUSES.awaitingOutput
              ? "awaiting"
              : "dispatched",
      brief: firstLine(ticket.brief, MATE_PET_PROJECTION_LIMITS.textMax),
      targetWorkspaceIdentity: ticket.targetWorkspaceIdentity ?? "",
      // 07 号详设 §1：活动行携带最近活动时刻（速览「状态 · 目标 · HH:mm」静态文本）
      // 与派发模式徽标（A 缺省不显，仅 B/C 标注）——只加不破（旧消费者可忽略）。
      updatedAtMs: ticket.updatedAtMs,
      ...(ticket.dispatchMode === "B" || ticket.dispatchMode === "C"
        ? { mode: ticket.dispatchMode }
        : {}),
    }));
  // 终态工单按更新时间倒序（07 号详设 §1）：首条=最新汇报（既有语义），前 recentMax
  // 条=「最近完成」工作历史（done/failed 都入列——失败也是工作内容，诚实呈现）。
  const terminalTickets = snapshot.tickets
    .filter(
      (ticket) =>
        ticket.status === ASSISTANT_TICKET_STATUSES.done ||
        ticket.status === ASSISTANT_TICKET_STATUSES.failed,
    )
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  const terminal = terminalTickets[0];
  const latestReport: MatePetLatestReport | null = terminal
    ? {
        ticketId: terminal.id,
        status: terminal.status === ASSISTANT_TICKET_STATUSES.done ? "done" : "failed",
        summary: matePetReportSummary(terminal),
        targetWorkspaceIdentity: terminal.targetWorkspaceIdentity ?? "",
        updatedAtMs: terminal.updatedAtMs,
      }
    : null;
  const recentTickets: MatePetRecentTicket[] = terminalTickets
    .slice(0, MATE_PET_PROJECTION_LIMITS.recentMax)
    .map((ticket) => {
      const summary = matePetReportSummary(ticket);
      return {
        ticketId: ticket.id,
        status: ticket.status === ASSISTANT_TICKET_STATUSES.done ? "done" : "failed",
        brief: firstLine(ticket.brief, MATE_PET_PROJECTION_LIMITS.textMax),
        targetWorkspaceIdentity: ticket.targetWorkspaceIdentity ?? "",
        updatedAtMs: ticket.updatedAtMs,
        // done 无 output_summary 且非 failed（无 fail_reason）时省略——诚实不伪造。
        ...(summary ? { summary } : {}),
      };
    });
  // bubble 由发布方以 deriveMatePetBubble 差分后并集（本函数保持纯投影，不持时序状态）。
  // P9：autonomyReport=通知区最新一条自主 report（差分源扩 report 帧的原材料；kind
  // 字面量单出处 shared contracts ASSISTANT_AUTONOMY_NOTICE_KINDS——2026-11-06 复审
  // 上收，删除消费方副本）。
  const autonomyNotice = [...(snapshot.watchdogNotices ?? [])]
    .filter((notice) => notice.kind === ASSISTANT_AUTONOMY_NOTICE_KINDS.report)
    .sort((a, b) => b.atMs - a.atMs)[0];
  const autonomyBubble: MatePetAutonomyBubble | null = autonomyNotice
    ? {
        summary: autonomyNotice.summary.slice(0, MATE_PET_PROJECTION_LIMITS.textMax),
        atMs: autonomyNotice.atMs,
      }
    : null;
  return {
    pendingDecisions,
    activeTickets,
    recentTickets,
    latestReport,
    bubble: null,
    autonomyBubble,
  };
}

/** 决策卡触发起始身份（速览元数据展示用；trigger 被快照容量裁剪时回空串）。 */
function findDecisionIdentity(snapshot: AssistantSnapshot, triggerId: string): string {
  return snapshot.triggers.find((trigger) => trigger.id === triggerId)?.identity ?? "";
}

/** 气泡展示键（ticketId+updatedAtMs；同工单后续快照刷新不重弹）。 */
export function matePetBubbleKey(report: MatePetLatestReport): string {
  return `${report.ticketId}:${report.updatedAtMs}`;
}

/**
 * 气泡状态机（纯函数）：给上一帧的汇报登记态与本帧汇报，返回是否弹泡与下一登记态。
 * - previous=null（发布方挂载后首帧，含冷启动已存在的旧汇报）：只登记不弹——历史汇报
 *   直达 tray 速览最新汇报行。
 * - 上一帧无汇报（key=null）本帧出现汇报、或汇报键变化（同工单换代后再次终态）：
 *   弹泡——会话期间新到达的汇报必须提示。
 * - 同键重复帧：不弹；汇报被快照容量裁剪（本帧 report=null）不弹且保留登记键——
 *   同一汇报键在发布方生命周期内至多弹一次。
 */
export function deriveMatePetBubble(
  previous: { readonly key: string | null } | null,
  report: MatePetLatestReport | null,
): { show: boolean; next: { readonly key: string | null } } {
  if (previous === null) {
    return { show: false, next: { key: report ? matePetBubbleKey(report) : null } };
  }
  if (!report) return { show: false, next: { key: previous.key } };
  const key = matePetBubbleKey(report);
  return { show: key !== previous.key, next: { key } };
}

/** 自主 report 气泡展示键（atMs；同帧重复推送不重弹）。 */
export function matePetAutonomyBubbleKey(report: MatePetAutonomyBubble): string {
  return `autonomy:${report.atMs}`;
}

/**
 * P9 自主气泡状态机（deriveMatePetBubble 同构纯函数，差分源扩 report 帧）：给上一帧
 * 的自主汇报登记态与本帧自主汇报，返回是否弹泡与下一登记态。语义与工单汇报差分
 * 一致——挂载首帧只登记不弹；键变化（新 report 时刻）弹泡；同键重复帧不弹；本帧无
 * 自主汇报（通知区被裁剪）不弹且保留登记键。
 * 配额闸说明：report 文本在服务侧已经 admitDisturbance(kind=report) 过闸（超额聚合
 * 次日摘要、通知区不落账）——发布方不二次计数（一次 report 一次闸）。
 */
export function deriveMateAutonomyBubble(
  previous: { readonly key: string | null } | null,
  report: MatePetAutonomyBubble | null,
): { show: boolean; next: { readonly key: string | null } } {
  if (previous === null) {
    return { show: false, next: { key: report ? matePetAutonomyBubbleKey(report) : null } };
  }
  if (!report) return { show: false, next: { key: previous.key } };
  const key = matePetAutonomyBubbleKey(report);
  return { show: key !== previous.key, next: { key } };
}
