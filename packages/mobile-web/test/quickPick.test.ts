import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickPickDialog, type QuickPickItem } from "../src/ui/QuickPickDialog.js";
import { IntlProvider } from "../src/ui/intl.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

const items: QuickPickItem[] = [
  { id: "cmd-1", label: "刷新文件树", detail: "重新读取当前工作区目录" },
  { id: "cmd-2", label: "停止生成" },
];

function renderDialog(props: Partial<Parameters<typeof QuickPickDialog>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(QuickPickDialog, {
        open: true,
        onOpenChange: () => {},
        mode: "command",
        query: "",
        onQueryChange: () => {},
        items: [],
        ...props,
      }),
    ),
  );
}

test("open=false 受控关闭渲染 null（官方 Dialog open 语义）", () => {
  assert.equal(renderDialog({ open: false }), "");
});

test("command 模式：官方逐字 title「命令面板」+ description", () => {
  const html = renderDialog();
  assert.ok(html.includes("命令面板"));
  assert.ok(html.includes("搜索并执行当前工作区可用的命令。"));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('aria-modal="true"'));
});

test("find 模式：官方逐字 title「在任务中查找」+ find.description", () => {
  const html = renderDialog({ mode: "find" });
  assert.ok(html.includes("在任务中查找"));
  assert.ok(html.includes("搜索当前任务中的消息和文件变更。"));
});

test("command 导航按钮按回调存在性渲染（官方逐字 返回/前进）", () => {
  const bare = renderDialog();
  assert.ok(!bare.includes("返回"), "无 onGoBack 不渲染");
  const wired = renderDialog({ onGoBack: () => {}, onGoForward: () => {} });
  assert.ok(wired.includes(">返回<"));
  assert.ok(wired.includes(">前进<"));
});

test("find 模式导航：官方逐字 上一个结果/下一个结果 + scope aria-label", () => {
  const html = renderDialog({
    mode: "find",
    onFindPrevious: () => {},
    onFindNext: () => {},
    onFindScopeChange: () => {},
  });
  assert.ok(html.includes("上一个结果"));
  assert.ok(html.includes("下一个结果"));
  assert.ok(html.includes('aria-label="切换搜索范围消息/文件"'));
});

test("错误行：官方 {error} 插值逐字（命令执行失败：{error}）", () => {
  const html = renderDialog({ error: "timeout" });
  assert.ok(html.includes("命令执行失败：timeout"));
});

test("items 渲染 label/detail 并可执行（onExecute 装配缝）", () => {
  const html = renderDialog({ items, onExecute: () => {} });
  assert.ok(html.includes("刷新文件树"));
  assert.ok(html.includes("重新读取当前工作区目录"));
  assert.ok(html.includes("停止生成"));
});
