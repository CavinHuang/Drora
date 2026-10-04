// §33.18.17 置顶区行契约守卫（specs/mobile-relay-r3-frontend.md §33.18.17）：
// 任务行统一 data-testid=task-item-{sessionId}（§33.18.1 官方行契约）。置顶区行
// 此前漏接——stub 场景唯一 running 任务恰为置顶，harness 按
// [data-testid^=task-item-] 计行恒得 0（§33.18.6-11 rows:0 挂账根因，帧级取证见
// 同节：ws/relay/store 全链健康、行由 bootstrap 投影正常渲染）。
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "../src/ui/intl.js";
import { PinnedTaskSection } from "../src/ui/PinnedTaskSection.js";

Object.assign(globalThis, { React });

function renderSection(tasks: Array<Record<string, unknown>>) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(PinnedTaskSection, {
        tasks: tasks.map((task) => ({
          sessionId: "t1",
          title: "任务",
          createdAtMs: null,
          updatedAtMs: null,
          status: "idle" as const,
          workspace: { workspaceKey: "w", name: "demo" },
          ...task,
        })),
      }),
    ),
  );
}

test("置顶区行带 task-item-{sessionId} testid（§33.18.1 行契约，harness 计行依据）", () => {
  const html = renderSection([{ sessionId: "stub-task-1" }]);
  assert.ok(html.includes('data-testid="task-item-stub-task-1"'), "testid 契约");
  assert.ok(html.includes("打开任务"), "aria 契约（既有）");
});

test("多行逐行带各自 sessionId testid；空列表不渲染 section", () => {
  const html = renderSection([{ sessionId: "a" }, { sessionId: "b" }]);
  assert.ok(html.includes('data-testid="task-item-a"'), "行 a testid");
  assert.ok(html.includes('data-testid="task-item-b"'), "行 b testid");
  assert.equal(renderSection([]), "", "空置顶区返回 null");
});
