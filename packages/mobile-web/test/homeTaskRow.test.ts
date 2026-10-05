// §32.37 官方行槽位三态还原守卫（specs/mobile-relay-r3-frontend.md §32.37）：
// 官方还原页活体取证——未读=天蓝点（h-1.5 w-1.5 bg-sky-500 dark:bg-sky-400）；
// 置顶=lucide Pin size-4；并存=Pin+右上叠加徽标（absolute -top-0.5 -right-0.5）。
// 另守卫投影链：projectTask 仅并入 number 型 unreadAt；活性合并保留三态。
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeTaskRow } from "../src/ui/OrganizeMenu.js";
import { IntlProvider } from "../src/ui/intl.js";
import { projectHomeData } from "../src/app/entry.js";
import { mergeHomeWorkspaceLiveness } from "../src/app/sessionsIndexStore.js";

Object.assign(globalThis, { React });

function renderRow(task: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(HomeTaskRow, {
        task: { sessionId: "t1", title: "任务", createdAtMs: null, updatedAtMs: null, status: "idle", ...task },
        workspace: { workspaceKey: "w" },
        selected: false,
      }),
    ),
  );
}

test("未读：size-4 槽位渲染天蓝点（官方 class 逐字）", () => {
  const html = renderRow({ unreadAtMs: Date.now() });
  assert.ok(html.includes("h-1.5 w-1.5 rounded-full bg-sky-500 dark:bg-sky-400"), "天蓝点 class");
  assert.ok(!html.includes("lucide-pin"), "无置顶时不渲染 Pin");
});

test("置顶：lucide Pin size-4（官方图标，非 emoji）", () => {
  const html = renderRow({ pinned: true });
  assert.ok(html.includes("lucide-pin"), "Pin 图标");
  assert.ok(!html.includes("bg-sky-500"), "无未读不渲染点");
});

test("未读+置顶并存：Pin + 右上叠加徽标（absolute -top-0.5 -right-0.5）", () => {
  const html = renderRow({ pinned: true, unreadAtMs: Date.now() });
  assert.ok(html.includes("lucide-pin"), "Pin 图标");
  assert.ok(html.includes("absolute -top-0.5 -right-0.5 h-1.5 w-1.5"), "叠加徽标");
});

test("投影链：projectTask 仅并入 number 型 unreadAt（null/缺省=已读）", () => {
  const result = projectHomeData({
    workspaces: [{ workspacePath: "D:\\ws\\demo", label: "demo", kind: "local" }],
    tasks: [
      { taskId: "a", title: "A", status: "running", createdAt: 1, updatedAt: 2, workspacePath: "D:\\ws\\demo", unreadAt: 12345 },
      { taskId: "b", title: "B", status: "", createdAt: 1, updatedAt: 2, workspacePath: "D:\\ws\\demo" },
      { taskId: "c", title: "C", status: "", createdAt: 1, updatedAt: 2, workspacePath: "D:\\ws\\demo", unreadAt: null },
    ],
  });
  const tasks = result.workspaces[0]!.tasks;
  assert.equal(tasks[0]!.unreadAtMs, 12345);
  assert.equal(tasks[1]!.unreadAtMs, null);
  assert.equal(tasks[2]!.unreadAtMs, null);
});

test("活性合并保留 membership/未读态（左表字段不丢）", () => {
  const merged = mergeHomeWorkspaceLiveness(
    {
      workspaceKey: "k",
      name: "demo",
      kind: "local",
      path: "D:\\ws\\demo",
      updatedAtMs: null,
      tasks: [
        {
          sessionId: "a",
          title: "A",
          createdAtMs: 1,
          updatedAtMs: 2,
          status: "idle",
          pinned: true,
          unreadAtMs: 99,
        },
      ] as never,
    },
    [],
  );
  assert.equal(merged.tasks[0]!.pinned, true);
  assert.equal(merged.tasks[0]!.unreadAtMs, 99);
});
