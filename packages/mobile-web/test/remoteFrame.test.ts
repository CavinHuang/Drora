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

    const { RemoteConversationTimeline } = await server.ssrLoadModule(
      "@drora/ui/remote-timeline",
    );
    const base = {
      rows: [],
      totalCount: 0,
      sessionKey: "task-1",
      workspacePath: "C:/repo",
      locale: "zh-CN",
      theme: "light",
    };
    const render = (statusSnapshot?: unknown) =>
      renderToStaticMarkup(
        React.createElement(RemoteConversationTimeline, { ...base, statusSnapshot }),
      );
    assert.doesNotMatch(render(), /data-testid="chat-summary-panel"/);
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
  } finally {
    await server.close();
  }
});
