import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

test("远控页复用窗口外壳与会话状态面板", async () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const server = await createServer({
    configFile: false,
    root: packageRoot,
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "@": resolve(packageRoot, "../ui/src") } },
    plugins: [react()],
  });
  try {
    const { DesktopWindowFrame } = await server.ssrLoadModule("@drora/ui/remote-frame");
    const html = renderToStaticMarkup(
      React.createElement(
        DesktopWindowFrame,
        { title: "Drora Remote", isDesktop: false },
        React.createElement("main", null, "task surface"),
      ),
    );
    assert.match(html, /data-desktop-window-frame="true"/);
    assert.match(html, /class="[^"]*h-dvh[^"]*"/);
    assert.match(html, /<main>task surface<\/main>/);

    const { RemoteConversationTimeline } = await server.ssrLoadModule("@drora/ui/remote-timeline");
    const base = {
      rows: [],
      totalCount: 0,
      sessionKey: "task-1",
      workspacePath: "C:/repo",
      locale: "zh-CN",
      theme: "light",
    };
    const render = (statusSnapshot?: unknown, actions: Record<string, unknown> = {}) =>
      renderToStaticMarkup(
        React.createElement(RemoteConversationTimeline, { ...base, statusSnapshot, ...actions }),
      );
    assert.doesNotMatch(render(), /data-testid="chat-summary-panel"/);
    assert.doesNotMatch(render(), /data-testid="team-conversation-summary"/);
    const teamHtml = render({
      goal: null,
      plan: null,
      backgroundWorks: [],
      subagents: { revision: 0, childSessionIds: [], running: [], endedTotal: 0 },
      team: {
        teamId: "team-mobile",
        name: "Mobile team",
        status: "idle",
        members: [],
        board: { limit: 100, tasks: [] },
        mailboxTail: [],
      },
    });
    // §21 A4（2026-10-24，packages/ui/src/v4/RemoteConversationTimeline.tsx「手机远控状态面
    // 此前漏传 team prop」注释）：手机远端 timeline 无 shell 导航端口，team 呈现为状态面板
    // 的「不可点退化事实行」；且空 rows 时 ConversationTimeline 走 emptyState 分支
    // （ConversationTimeline.tsx renderUnitCount===0 分支），footerSlot 的
    // TeamConversationSummary 不渲染。旧断言（team-conversation-summary + 查看协作详情）
    // 是桌面 SessionPane 表面的锚点，由 ui/test/teamSessionPaneCardRouting.test.ts 锁定，
    // 本文件改为断言手机远控的现行契约锚点。
    assert.match(teamHtml, /data-status-section="team"/);
    assert.match(teamHtml, /data-testid="status-panel-team-row"/);
    assert.match(teamHtml, /Mobile team/);
    assert.match(teamHtml, /成员 0\/0 · 任务 0\/0/);
    const taskHtml = render({
      goal: null,
      plan: {
        items: [{ id: "step-1", content: "检查项目", status: "inProgress" }],
        updatedAt: Date.now(),
      },
      backgroundWorks: [],
      subagents: { revision: 0, childSessionIds: [], running: [], endedTotal: 0 },
    });
    assert.match(taskHtml, /data-testid="chat-summary-panel"/);
    assert.match(taskHtml, /data-v4-timeline-scroll="true"/);
    assert.match(taskHtml, /@container\/conversation/);

    const activeGoal = {
      goal: {
        targetId: "g1",
        objective: "完成任务",
        summaryTitle: null,
        timeUsedSeconds: 0,
        activeRunStartedAtMs: null,
        status: "active",
        iteration: 1,
        verifications: [],
        iterations: [],
      },
      plan: null,
      backgroundWorks: [],
      availability: { pauseGoal: { allowed: true }, resumeGoal: { allowed: false } },
    };
    assert.match(render(activeGoal), /data-goal-action="pause"[^>]*disabled/);
    const enabled = render(activeGoal, { onPauseGoal: () => {} });
    assert.match(enabled, /data-goal-action="pause"/);
    assert.doesNotMatch(enabled, /data-goal-action="pause"[^>]*disabled/);
  } finally {
    await server.close();
  }
});
