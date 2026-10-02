import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteWorkspaceHeader } from "../src/ui/RemoteWorkspaceHeader.js";
import { IntlProvider } from "../src/ui/intl.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

function render(props: Partial<Parameters<typeof RemoteWorkspaceHeader>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(RemoteWorkspaceHeader, {
        title: "E2E 冒烟任务",
        workspacePath: "C:/g1/sub",
        ...props,
      }),
    ),
  );
}

test("官方双标题形态：workspace-title 可见 h1 + v4-session-title sr-only", () => {
  const html = render();
  assert.ok(html.includes('data-testid="workspace-title"'));
  assert.ok(/data-testid="v4-session-title"[^>]*class="[^"]*sr-only/.test(html), "sr-only 会话标题");
  assert.ok(html.includes("E2E 冒烟任务"));
});

test("workspace-path 官方 button 形态：onPathClick 传入才渲染 button，缺省 span", () => {
  const span = render();
  assert.ok(/data-testid="workspace-path"[\s\S]{0,80}<span|<span[^>]*data-testid="workspace-path"/.test(span) || !/<button[^>]*workspace-path/.test(span), "缺省非 button");
  const wired = render({ onPathClick: () => {} });
  assert.ok(/<button[^>]*data-testid="workspace-path"/.test(wired), "button 形态");
});

test("workspace-more-button 装配缝：缺省不渲染；传入渲染 ⋯ 图标按钮（aria=更多 §32.68 官方活体）", () => {
  const bare = render();
  assert.ok(!bare.includes("workspace-more-button"), "缺省不渲染（不臆造菜单项）");
  const wired = render({ onMoreMenu: () => {} });
  assert.ok(wired.includes('data-testid="workspace-more-button"'));
  // §32.68 官方活体（probe2 DOM）：⋯ 钮 aria=更多，不再携带任务标题。
  assert.ok(wired.includes('aria-label="更多"'));
});

test("side-pane-toggle 装配缝：缺省不渲染；传入渲染 PanelRight 按钮 + aria-expanded 投影", () => {
  const bare = render();
  assert.ok(!bare.includes("side-pane-toggle"), "缺省不渲染（侧板内容归 StatusPanel 装配）");
  const wired = render({ onToggleSidePane: () => {}, sidePaneOpen: true });
  assert.ok(wired.includes('data-testid="side-pane-toggle"'));
  assert.ok(wired.includes('aria-expanded="true"'));
  assert.ok(wired.includes('aria-label="展开侧边面板"'), "官方 mobileShell.task.sidePaneExpand 既有键");
});

test("§32.25 工作区 chip 名带分支：aria = 「工作区名 · 分支」（官方活体 demo · main）；分支缺省纯工作区名", () => {
  const withBranch = render({ branchName: "main" });
  assert.ok(
    withBranch.includes('aria-label="sub · main"'),
    "chip aria = 工作区名 · 分支",
  );
  const noBranch = render({ branchName: null });
  assert.ok(noBranch.includes('aria-label="sub"'), "无分支退化为纯工作区名");
});
