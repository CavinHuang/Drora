// @vitest-environment jsdom
/**
 * Drora Mate 桌宠接缝测试（specs/drora-personal-assistant.md §11 P3 落地注记；
 * docs/mate-implementation-plan-2026-11-04/03-p3-detailed-design.md §6/§7 场景 5）：
 * - Main 桥路由纯核（matePetBridge.createMatePetBridgeCore）：来源窗口校验、zod 校验、
 *   命令路由（open-ticket/decide）、发布方登记/分离；
 * - tray 速览 DOM（desktopPetMateTrayDom）：分区渲染、Y/N 动作回传投影 id、点卡直达、
 *   空态收敛；文本只经 textContent（防注入）。
 * Electron ipcMain 接线（bridge 包装层/desktopPetWindow 守卫）不在 jsdom 可测范围，
 * 由 tsconfig.pet/main 类型检查与真机链路覆盖。
 */
import { describe, expect, it } from "vitest";
import { EMPTY_MATE_PET_PROJECTION } from "@drora/shared";
import type { MatePetProjection } from "@drora/shared";

import { createMatePetBridgeCore } from "../src/main/matePetBridge.js";
import { createMatePetTrayDom, matePetStatusLabel } from "../src/preload/desktopPetMateTrayDom.js";

const PROJECTION: MatePetProjection = {
  pendingDecisions: [
    { decisionId: 7, text: "手机点名：看下白屏", sourceKind: "phone", identity: "local@host" },
  ],
  activeTickets: [
    { ticketId: "T-1", status: "running", brief: "修复登录", targetWorkspaceIdentity: "ws-a" },
  ],
  latestReport: {
    ticketId: "T-0",
    status: "done",
    summary: "完成：构建已修复",
    targetWorkspaceIdentity: "ws-a",
    updatedAtMs: 1_000,
  },
  bubble: null,
};

describe("matePetBridgeCore（Main 桥路由纯核）", () => {
  it("非主窗口来源/非法 payload 拒绝；合法帧接受并成为当前投影", () => {
    const core = createMatePetBridgeCore();
    expect(core.consumeProjection(PROJECTION, false)).toBe(false);
    expect(core.current).toEqual(EMPTY_MATE_PET_PROJECTION);
    expect(core.consumeProjection({ garbage: true }, true)).toBe(false);
    // 超界的待决策条数（schema pendingMax=5）拒绝。
    const bloated = {
      ...PROJECTION,
      pendingDecisions: Array.from({ length: 6 }, (_, i) => ({
        decisionId: i + 1,
        text: "x",
        sourceKind: "local",
        identity: "u",
      })),
    };
    expect(core.consumeProjection(bloated, true)).toBe(false);
    expect(core.consumeProjection(PROJECTION, true)).toBe(true);
    expect(core.current.pendingDecisions).toHaveLength(1);
    expect(core.hasSource).toBe(false);
    core.attachSource(42);
    expect(core.targetWindowId).toBe(42);
    core.detachSource(42);
    expect(core.targetWindowId).toBeNull();
  });

  it("命令路由：非宠物来源/非法 payload → null；open-ticket/decide 映射 rendererEvent", () => {
    const core = createMatePetBridgeCore();
    expect(core.routeCommand(PROJECTION, false)).toBeNull();
    expect(core.routeCommand({ action: "decide" }, true)).toBeNull();
    expect(
      core.routeCommand({ action: "open-ticket", ticketId: "T-9", targetWorkspaceIdentity: "ws-b" }, true),
    ).toEqual({ kind: "open-ticket", ticketId: "T-9", targetWorkspaceIdentity: "ws-b" });
    expect(
      core.routeCommand({ action: "open-ticket", ticketId: "T-9" }, true),
    ).toEqual({ kind: "open-ticket", ticketId: "T-9" });
    expect(core.routeCommand({ action: "decide", decisionId: 7, choice: "approve" }, true)).toEqual({
      kind: "decide",
      decisionId: 7,
      choice: "approve",
    });
    expect(core.routeCommand({ action: "decide", decisionId: 7, choice: "ignore" }, true)).toEqual({
      kind: "decide",
      decisionId: 7,
      choice: "ignore",
    });
  });
});

function buildTrayDocument(): Document {
  document.body.innerHTML = `
    <section id="tray"><section id="mate" hidden aria-label="mate">
      <div class="mate-head"><strong>大副</strong><span id="mate-count" class="mate-count"></span></div>
      <p class="mate-section-label" id="mate-decisions-label">待决策</p>
      <div id="mate-decisions"></div>
      <p class="mate-section-label" id="mate-tickets-label">进行中</p>
      <div id="mate-tickets"></div>
      <div class="mate-row" id="mate-report" hidden><button type="button" class="mate-open" id="mate-report-open"><span class="mate-title" id="mate-report-title"></span><span class="mate-meta" id="mate-report-meta"></span></button></div>
      <p id="mate-empty" class="mate-section-label" hidden>没有待处置条目</p>
    </section></section>`;
  return document;
}

describe("createMatePetTrayDom（托盘速览 DOM）", () => {
  it("渲染待决策（Y/N 回传 decisionId）/进行中（点卡直达）/最新汇报；空态收敛", () => {
    const doc = buildTrayDocument();
    const opened: Array<{ ticketId: string; targetWorkspaceIdentity?: string }> = [];
    const decided: Array<{ decisionId: number; choice: "approve" | "ignore" }> = [];
    const dom = createMatePetTrayDom(
      doc,
      { approve: "放行", ignore: "忽略" },
      {
        onOpenTicket: (ticketId, targetWorkspaceIdentity) => opened.push({ ticketId, targetWorkspaceIdentity }),
        onDecide: (decisionId, choice) => decided.push({ decisionId, choice }),
      },
    );
    const root = doc.getElementById("mate")!;
    expect(root.hidden).toBe(true);
    dom.render(PROJECTION);
    expect(root.hidden).toBe(false);
    // 待决策区：原文经 textContent（不进 innerHTML），Y/N 按钮回传投影 decisionId。
    const approve = doc.querySelector<HTMLButtonElement>('[data-mate-action="approve"]')!;
    const ignore = doc.querySelector<HTMLButtonElement>('[data-mate-action="ignore"]')!;
    expect(approve.textContent).toBe("放行");
    expect(doc.querySelector(".mate-title")?.textContent).toBe("手机点名：看下白屏");
    approve.click();
    ignore.click();
    expect(decided).toEqual([
      { decisionId: 7, choice: "approve" },
      { decisionId: 7, choice: "ignore" },
    ]);
    // 进行中点卡直达（回传投影内原始 identity，不重拼路径）。
    const openTicket = doc.getElementById("mate-tickets")!.querySelector<HTMLButtonElement>("button")!;
    openTicket.click();
    expect(opened).toEqual([{ ticketId: "T-1", targetWorkspaceIdentity: "ws-a" }]);
    // 最新汇报行：一次绑定，点击直达当前帧汇报。
    doc.getElementById("mate-report-open")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened.at(-1)).toEqual({ ticketId: "T-0", targetWorkspaceIdentity: "ws-a" });
    // 待决策计数徽标=待决策数。
    expect(doc.getElementById("mate-count")!.textContent).toBe("1");
    // 清空帧 → 分区隐藏、空态显现。
    dom.render({ pendingDecisions: [], activeTickets: [], latestReport: null, bubble: null });
    expect(root.hidden).toBe(true);
    expect(doc.getElementById("mate-empty")!.hidden).toBe(false);
  });

  it("模板节点缺失（宠物窗文档）→ 渲染句柄安全 no-op", () => {
    document.body.innerHTML = "<div id='pet'></div>";
    const dom = createMatePetTrayDom(document, { approve: "放行", ignore: "忽略" }, {
      onOpenTicket: () => undefined,
      onDecide: () => undefined,
    });
    expect(() => dom.render(PROJECTION)).not.toThrow();
  });
});

describe("matePetStatusLabel（速览状态文案）", () => {
  it("五态 zh/en 双语映射；未知值原样透传", () => {
    expect(matePetStatusLabel("queued", true)).toBe("排队中");
    expect(matePetStatusLabel("running", true)).toBe("进行中");
    expect(matePetStatusLabel("done", true)).toBe("已完成");
    expect(matePetStatusLabel("failed", true)).toBe("已失败");
    expect(matePetStatusLabel("dispatched", false)).toBe("Dispatched");
    expect(matePetStatusLabel("mystery", false)).toBe("mystery");
  });
});
