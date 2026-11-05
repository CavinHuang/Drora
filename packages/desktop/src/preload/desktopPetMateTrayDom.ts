import type { MatePetProjection } from "@drora/shared";

/**
 * Mate 托盘速览 DOM 构建器（spec §11 P3 落地注记；03 详设 §6「待决策卡精简（可 Y/N）
 * +进行中列表+最新汇报一行」）。纯 DOM：不 import electron——preload 桌面宠物壳
 * （desktopPetTray.ts）持 ipcRenderer 侧，本模块只做投影→节点的确定性渲染，jsdom 可测。
 *
 * 无框架约束的窗口（CSP default-src 'none'、静态文档）沿用既有 tray 的
 * createElement+textContent 手法：工单文本永不进 innerHTML（防注入），动作只回传
 * 投影里携带的 ticketId/decisionId（不转发调用方拼接的同 identity 伪造 payload——
 * 对齐 desktopPetSource.open 的防伪造注释）。分区标题/空态文案在 overlay 模板内联
 * 双语（与 tray 既有文案同机制），本模块只注入动作按钮文案。
 */

/** 投影内工单/汇报状态 → 速览文案（zh/en 双语内联，与 tray 文档语言一致）。 */
export function matePetStatusLabel(status: string, zh: boolean): string {
  switch (status) {
    case "queued":
      return zh ? "排队中" : "Queued";
    case "dispatched":
      return zh ? "已派发" : "Dispatched";
    case "running":
      return zh ? "进行中" : "Running";
    case "done":
      return zh ? "已完成" : "Completed";
    case "failed":
      return zh ? "已失败" : "Failed";
    default:
      return status;
  }
}

export interface MatePetTrayCallbacks {
  /** 点卡直达：回传投影里携带的原始目标（不重拼路径）。 */
  onOpenTicket(ticketId: string, targetWorkspaceIdentity?: string): void;
  /** 速览内放行/忽略（decide 事件经 Main 转发主窗口 renderer 执行）。 */
  onDecide(decisionId: number, choice: "approve" | "ignore"): void;
}

export interface MatePetTrayLabels {
  approve: string;
  ignore: string;
}

/** 组装速览区（挂 desktopPetOverlayContent tray 模板既有节点）；返回按帧渲染的句柄。 */
export function createMatePetTrayDom(
  document: Document,
  labels: MatePetTrayLabels,
  callbacks: MatePetTrayCallbacks,
): { render(projection: MatePetProjection): void } {
  const zh = document.documentElement.lang.startsWith("zh");
  const root = document.getElementById("mate");
  const count = document.getElementById("mate-count");
  const decisionsBox = document.getElementById("mate-decisions");
  const decisionsLabel = document.getElementById("mate-decisions-label");
  const ticketsBox = document.getElementById("mate-tickets");
  const ticketsLabel = document.getElementById("mate-tickets-label");
  const reportRow = document.getElementById("mate-report");
  const reportOpen = document.getElementById("mate-report-open");
  const reportTitle = document.getElementById("mate-report-title");
  const reportMeta = document.getElementById("mate-report-meta");
  const empty = document.getElementById("mate-empty");
  if (
    !(
      root &&
      count &&
      decisionsBox &&
      decisionsLabel &&
      ticketsBox &&
      ticketsLabel &&
      reportRow &&
      reportOpen &&
      reportTitle &&
      reportMeta &&
      empty
    )
  )
    return { render: () => undefined };

  // 最新汇报行是模板静态节点：监听器只绑一次，点击取当前帧的最新汇报（闭包读 latest）。
  let latest: MatePetProjection["latestReport"] = null;
  reportOpen.addEventListener("click", () => {
    if (latest) callbacks.onOpenTicket(latest.ticketId, latest.targetWorkspaceIdentity);
  });

  const metaSpan = (text: string, danger = false): HTMLElement => {
    const span = document.createElement("span");
    span.className = "mate-meta";
    span.textContent = text;
    if (danger) span.style.color = "var(--color-destructive)";
    return span;
  };

  return {
    render(projection) {
      latest = projection.latestReport;
      // 决策卡原文/工单 brief/汇报摘要已由发布方截断（schema 有界）；此处只读展示。
      // 决策卡行本体不可点（尚未成票，无直达目标；动作只有放行/忽略）。
      decisionsBox.replaceChildren();
      for (const decision of projection.pendingDecisions) {
        const row = document.createElement("div");
        row.className = "mate-row";
        const body = document.createElement("div");
        body.className = "mate-open";
        const title = document.createElement("span");
        title.className = "mate-title";
        title.textContent = decision.text;
        body.append(title, metaSpan(decision.identity, true));
        const actions = document.createElement("div");
        actions.className = "mate-actions";
        const approve = document.createElement("button");
        approve.type = "button";
        approve.textContent = labels.approve;
        approve.dataset.mateAction = "approve";
        approve.addEventListener("click", () => callbacks.onDecide(decision.decisionId, "approve"));
        const ignore = document.createElement("button");
        ignore.type = "button";
        ignore.textContent = labels.ignore;
        ignore.dataset.mateAction = "ignore";
        ignore.addEventListener("click", () => callbacks.onDecide(decision.decisionId, "ignore"));
        actions.append(approve, ignore);
        row.append(body, actions);
        decisionsBox.append(row);
      }
      // 进行中列表：整行为 button（与活动列表 open-task 同构），点卡直达工单详情。
      ticketsBox.replaceChildren();
      for (const ticket of projection.activeTickets) {
        const row = document.createElement("div");
        row.className = "mate-row";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mate-open";
        const title = document.createElement("span");
        title.className = "mate-title";
        title.textContent = ticket.brief;
        button.append(title, metaSpan(`${matePetStatusLabel(ticket.status, zh)} · ${ticket.targetWorkspaceIdentity}`));
        button.addEventListener("click", () =>
          callbacks.onOpenTicket(ticket.ticketId, ticket.targetWorkspaceIdentity),
        );
        row.append(button);
        ticketsBox.append(row);
      }
      if (latest) {
        reportTitle.textContent = latest.summary;
        reportMeta.textContent = `${matePetStatusLabel(latest.status, zh)} · ${latest.targetWorkspaceIdentity}`;
        reportRow.dataset.status = latest.status;
        reportRow.hidden = false;
      } else {
        reportRow.hidden = true;
      }
      const hasAny =
        projection.pendingDecisions.length > 0 ||
        projection.activeTickets.length > 0 ||
        latest !== null;
      root.hidden = !hasAny;
      count.textContent = hasAny ? String(projection.pendingDecisions.length) : "";
      empty.hidden = hasAny;
      decisionsLabel.hidden = projection.pendingDecisions.length === 0;
      ticketsLabel.hidden = projection.activeTickets.length === 0;
    },
  };
}
