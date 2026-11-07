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
import {
  createMatePetTrayDom,
  matePetStatusLabel,
  matePetSuggestedTierLabel,
} from "../src/preload/desktopPetMateTrayDom.js";

const PROJECTION: MatePetProjection = {
  pendingDecisions: [
    {
      decisionId: 7,
      text: "手机点名：看下白屏",
      sourceKind: "phone",
      identity: "local@host",
      suggestedTier: "guarded",
    },
  ],
  activeTickets: [
    {
      ticketId: "T-1",
      status: "running",
      brief: "修复登录",
      targetWorkspaceIdentity: "ws-a",
      updatedAtMs: 1_000,
      mode: "B",
    },
  ],
  recentTickets: [
    {
      ticketId: "T-0",
      status: "done",
      brief: "修复登录",
      targetWorkspaceIdentity: "ws-a",
      updatedAtMs: 900,
      summary: "完成：构建已修复",
    },
    {
      ticketId: "T-9",
      status: "failed",
      brief: "跑一遍回归",
      targetWorkspaceIdentity: "ws-b",
      updatedAtMs: 800,
      summary: "assistant_row_failed",
    },
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
    // 未消费投影（无待决策集）→ decide 不带档（renderer 回落 build）。
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

  it("decide 放行档预填：Main 从已校验投影按 decisionId 查档（spec §11 tray 同参）", () => {
    const core = createMatePetBridgeCore();
    expect(core.consumeProjection(PROJECTION, true)).toBe(true);
    // 投影行带 suggestedTier → decide 事件透传（宠物窗命令 payload 不带档，不可信面
    // 不可自行指定权限档——档位只来自 Main 校验过的投影）。
    expect(core.routeCommand({ action: "decide", decisionId: 7, choice: "approve" }, true)).toEqual({
      kind: "decide",
      decisionId: 7,
      choice: "approve",
      suggestedTier: "guarded",
    });
    // decisionId 不在当前投影（已被消费/裁剪）→ 不带档，renderer 侧回落 build。
    expect(core.routeCommand({ action: "decide", decisionId: 99, choice: "approve" }, true)).toEqual({
      kind: "decide",
      decisionId: 99,
      choice: "approve",
    });
  });
});

function buildTrayDocument(): Document {
  // tray 真实入口按 documentElement.lang 判定文案语言（desktopPetTray.ts）；测试文档
  // 显式设 zh-CN，使断言与中文文档一致。
  document.documentElement.lang = "zh-CN";
  document.body.innerHTML = `
    <section id="tray"><section id="mate" hidden aria-label="mate">
      <div class="mate-head"><strong>大副</strong><span id="mate-count" class="mate-count"></span></div>
      <p class="mate-section-label" id="mate-decisions-label">待决策</p>
      <div id="mate-decisions"></div>
      <p class="mate-section-label" id="mate-tickets-label">进行中</p>
      <div id="mate-tickets"></div>
      <p class="mate-section-label" id="mate-recent-label" hidden>最近完成</p>
      <div id="mate-recent"></div>
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
    const openedMate: boolean[] = [];
    const dom = createMatePetTrayDom(
      doc,
      { approve: "放行", ignore: "忽略", openMate: "去面板" },
      {
        onOpenTicket: (ticketId, targetWorkspaceIdentity) => opened.push({ ticketId, targetWorkspaceIdentity }),
        onDecide: (decisionId, choice) => decided.push({ decisionId, choice }),
        onOpenMate: () => openedMate.push(true),
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
    // 进行中行 meta：状态 · 模式（仅 B/C）· 目标 · HH:mm（07 号详设 §1）。
    const activeMeta = doc.getElementById("mate-tickets")!.querySelector(".mate-meta")!;
    expect(activeMeta.textContent).toMatch(/进行中 · B · ws-a · \d{1,2}:\d{2}/);
    // 进行中点卡直达（回传投影内原始 identity，不重拼路径）。
    const openTicket = doc.getElementById("mate-tickets")!.querySelector<HTMLButtonElement>("button")!;
    openTicket.click();
    expect(opened).toEqual([{ ticketId: "T-1", targetWorkspaceIdentity: "ws-a" }]);
    // 最近完成区（07 号详设）：两行渲染（done+failed），failed meta 红；点行直达。
    const recentBox = doc.getElementById("mate-recent")!;
    expect(doc.getElementById("mate-recent-label")!.hidden).toBe(false);
    expect(recentBox.querySelectorAll("button")).toHaveLength(2);
    const failedMeta = recentBox.querySelectorAll(".mate-meta")[1]!;
    expect(failedMeta.textContent).toMatch(/已失败 · ws-b · \d{1,2}:\d{2} · assistant_row_failed/);
    expect(failedMeta.style.color).toBe("var(--color-destructive)");
    recentBox.querySelector<HTMLButtonElement>("button")!.click();
    expect(opened.at(-1)).toEqual({ ticketId: "T-0", targetWorkspaceIdentity: "ws-a" });
    // 最新汇报行：一次绑定，点击直达当前帧汇报。
    doc.getElementById("mate-report-open")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened.at(-1)).toEqual({ ticketId: "T-0", targetWorkspaceIdentity: "ws-a" });
    // 待决策计数徽标=待决策数。
    expect(doc.getElementById("mate-count")!.textContent).toBe("1");
    // 清空帧 → 分区隐藏、空态显现。
    dom.render({ pendingDecisions: [], activeTickets: [], latestReport: null, bubble: null });
    expect(root.hidden).toBe(true);
    expect(doc.getElementById("mate-empty")!.hidden).toBe(false);
    // recentTickets 可选缺席（旧发布方帧）=区隐藏，不炸渲染。
    expect(doc.getElementById("mate-recent-label")!.hidden).toBe(true);
  });

  it("P10 审查发现 8 修复：manage 建议卡渲染「去面板」（open-mate 直达唯一放行口），不出放行死按钮", () => {
    const doc = buildTrayDocument();
    const openedMate: boolean[] = [];
    const decided: Array<{ decisionId: number; choice: "approve" | "ignore" }> = [];
    const dom = createMatePetTrayDom(
      doc,
      { approve: "放行", ignore: "忽略", openMate: "去面板" },
      {
        onOpenTicket: () => undefined,
        onDecide: (decisionId, choice) => decided.push({ decisionId, choice }),
        onOpenMate: () => openedMate.push(true),
      },
    );
    dom.render({
      ...PROJECTION,
      pendingDecisions: [{ ...PROJECTION.pendingDecisions[0]!, manageSuggested: true }],
    });
    // manage 卡：无放行钮（旧放行口对 manage 建议拒绝——死按钮已除）；去面板+忽略在。
    expect(doc.querySelector('[data-mate-action="approve"]')).toBeNull();
    const openMate = doc.querySelector<HTMLButtonElement>('[data-mate-action="open-mate"]')!;
    expect(openMate.textContent).toBe("去面板");
    openMate.click();
    expect(openedMate).toEqual([true]);
    doc.querySelector<HTMLButtonElement>('[data-mate-action="ignore"]')!.click();
    expect(decided).toEqual([{ decisionId: 7, choice: "ignore" }]);
  });

  it("模板节点缺失（宠物窗文档）→ 渲染句柄安全 no-op", () => {
    document.body.innerHTML = "<div id='pet'></div>";
    const dom = createMatePetTrayDom(document, { approve: "放行", ignore: "忽略", openMate: "去面板" }, {
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

describe("matePetSuggestedTierLabel（速览放行档文案，spec §11 同参）", () => {
  it("guarded/build 双语；缺席回落 build（放行动作恒以某档执行，不明示=用户无从得知）", () => {
    expect(matePetSuggestedTierLabel("guarded", true)).toBe("guarded 档");
    expect(matePetSuggestedTierLabel("guarded", false)).toBe("guarded tier");
    expect(matePetSuggestedTierLabel("build", true)).toBe("build 档");
    expect(matePetSuggestedTierLabel(undefined, true)).toBe("build 档");
    expect(matePetSuggestedTierLabel(undefined, false)).toBe("build tier");
  });

  it("待决策行 meta 携带档位前缀（建议档/回落档）+identity", () => {
    const doc = buildTrayDocument();
    const dom = createMatePetTrayDom(
      doc,
      { approve: "放行", ignore: "忽略", openMate: "去面板" },
      { onOpenTicket: () => undefined, onDecide: () => undefined, onOpenMate: () => undefined },
    );
    dom.render(PROJECTION);
    const metas = [...doc.querySelectorAll("#mate-decisions .mate-meta")].map((n) => n.textContent);
    expect(metas).toEqual(["guarded 档 · ", "local@host"]);
    // 建议缺席（build 回落档）也明示——不发明档位，只展示放行实际生效值。
    dom.render({ ...PROJECTION, pendingDecisions: [{ ...PROJECTION.pendingDecisions[0]!, suggestedTier: undefined }] });
    const fallback = [...doc.querySelectorAll("#mate-decisions .mate-meta")].map((n) => n.textContent);
    expect(fallback).toEqual(["build 档 · ", "local@host"]);
  });
});
