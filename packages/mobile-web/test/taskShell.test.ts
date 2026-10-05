import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileTaskShell } from "../src/ui/TaskShell.js";
import { IntlProvider } from "../src/ui/intl.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

test("任务面两层顶栏在时间线前，输入区由时间线 dock 承载", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      null,
      React.createElement(MobileTaskShell, {
        title: "会话标题",
        workspaceHeader: React.createElement(
          "div",
          { "data-testid": "workspace-header" },
          "工作区",
        ),
        timeline: React.createElement("div", { "data-v4-composer-dock": "true" }, "输入区"),
        timelineOwnsScroll: true,
      }),
    ),
  );
  assert.ok(html.indexOf("会话标题") < html.indexOf("workspace-header"));
  assert.ok(html.indexOf("workspace-header") < html.indexOf("data-v4-composer-dock"));
  assert.equal((html.match(/data-v4-composer-dock/g) ?? []).length, 1);
  assert.equal(html.includes("border-t border-border bg-background"), false);
});

test("官方骨架：v4-session-pane-workspace-main 包 时间线+dock，dock 双层 grid 逐字", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      null,
      React.createElement(MobileTaskShell, {
        title: "会话标题",
        workspaceHeader: React.createElement("div", { "data-testid": "workspace-header" }, "工作区"),
        timeline: React.createElement("div", { "data-testid": "v4-timeline-stub" }),
        composer: React.createElement("div", { "data-testid": "v4-composer" }),
        timelineOwnsScroll: true,
      }),
    ),
  );
  assert.ok(html.indexOf("workspace-header") < html.indexOf("v4-session-pane-workspace-main"));
  assert.ok(html.indexOf("v4-session-pane-workspace-main") < html.indexOf("v4-timeline-stub"));
  assert.ok(html.includes('data-testid="conversation-bottom-dock-transition"'));
  assert.ok(html.includes('data-testid="conversation-bottom-dock-transition-layer"'));
  assert.ok(
    html.indexOf("conversation-bottom-dock-transition") <
      html.indexOf("conversation-bottom-dock-transition-layer"),
  );
  assert.ok(html.includes("col-start-1 row-start-1 w-full min-w-0"), "官方同格叠放 class 逐字");
});
