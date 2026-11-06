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
    // P4 第二棒（04 详设 §3）：工件核验滞留档（shared schema 只加不破，旧窗未知值
    // 走 default 兜底展示原值）。
    case "awaiting":
      return zh ? "待核验" : "Unverified";
    case "done":
      return zh ? "已完成" : "Completed";
    case "failed":
      return zh ? "已失败" : "Failed";
    default:
      return status;
  }
}

/**
 * 放行档 → 速览文案（spec §11 tray 放行同参注记：速览行明示实际生效档位）。
 * 文案口径与主面板 mate.card.tier.* 一致（build 档/tier…）；投影行建议缺席时展示
 * 回落档 build——放行动作恒以某档执行，不明示会让用户无从得知生效档。
 */
export function matePetSuggestedTierLabel(tier: string | undefined, zh: boolean): string {
  switch (tier) {
    case "guarded":
      return zh ? "guarded 档" : "guarded tier";
    case "build":
      return zh ? "build 档" : "build tier";
    default:
      return zh ? "build 档" : "build tier";
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
  // 07 号详设 §1：「最近完成」工作历史区（done/failed；TRAE宝 式工作面板第三区）。
  const recentBox = document.getElementById("mate-recent");
  const recentLabel = document.getElementById("mate-recent-label");
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
      recentBox &&
      recentLabel &&
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

  /** 最近活动/终态时刻（HH:mm 静态文本——纯 DOM 无 tick，不做相对时长）。 */
  const clock = (ms: number): string =>
    new Date(ms).toLocaleTimeString(zh ? "zh-CN" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
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
        // 档位前置（放行按钮的实际生效档），identity 仍为 danger 末位——与工单行
        // 「状态 · 目标」meta 同构，速览单行不增高。
        body.append(
          title,
          metaSpan(`${matePetSuggestedTierLabel(decision.suggestedTier, zh)} · `, false),
          metaSpan(decision.identity, true),
        );
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
        // 07 号详设 §1：meta=状态 · [模式（仅 B/C）] · 目标 · HH:mm（updatedAtMs 可选
        // ——旧发布方帧缺席只少时刻段，不缺行）。
        const modePrefix =
          ticket.mode === "B" || ticket.mode === "C" ? `${ticket.mode} · ` : "";
        button.append(
          title,
          metaSpan(
            `${matePetStatusLabel(ticket.status, zh)} · ${modePrefix}${ticket.targetWorkspaceIdentity}${ticket.updatedAtMs !== undefined ? ` · ${clock(ticket.updatedAtMs)}` : ""}`,
          ),
        );
        button.addEventListener("click", () =>
          callbacks.onOpenTicket(ticket.ticketId, ticket.targetWorkspaceIdentity),
        );
        row.append(button);
        ticketsBox.append(row);
      }
      // 最近完成/失败的工作历史（07 号详设 §1）：整行可点直达详情；failed 行 meta 红。
      const recent = projection.recentTickets ?? [];
      recentBox.replaceChildren();
      for (const ticket of recent) {
        const row = document.createElement("div");
        row.className = "mate-row";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mate-open";
        const title = document.createElement("span");
        title.className = "mate-title";
        title.textContent = ticket.brief;
        const metaText = `${matePetStatusLabel(ticket.status, zh)} · ${ticket.targetWorkspaceIdentity} · ${clock(ticket.updatedAtMs)}${ticket.summary ? ` · ${ticket.summary}` : ""}`;
        button.append(title, metaSpan(metaText, ticket.status === "failed"));
        button.addEventListener("click", () =>
          callbacks.onOpenTicket(ticket.ticketId, ticket.targetWorkspaceIdentity),
        );
        row.append(button);
        recentBox.append(row);
      }
      recentLabel.hidden = recent.length === 0;
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
        recent.length > 0 ||
        latest !== null;
      root.hidden = !hasAny;
      count.textContent = hasAny ? String(projection.pendingDecisions.length) : "";
      empty.hidden = hasAny;
      decisionsLabel.hidden = projection.pendingDecisions.length === 0;
      ticketsLabel.hidden = projection.activeTickets.length === 0;
    },
  };
}
