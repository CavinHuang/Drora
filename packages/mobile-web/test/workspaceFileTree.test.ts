import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceFileTree, type WorkspaceFileTreeEntry } from "../src/ui/WorkspaceFileTree.js";
import { IntlProvider } from "../src/ui/intl.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

const entry = (overrides: Partial<WorkspaceFileTreeEntry>): WorkspaceFileTreeEntry => ({
  path: "src/a.ts",
  name: "a.ts",
  kind: "file",
  depth: 1,
  ...overrides,
});

function renderTree(props: Partial<Parameters<typeof WorkspaceFileTree>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(WorkspaceFileTree, {
        entries: [],
        searchQuery: "",
        onSearchQueryChange: () => {},
        ...props,
      }),
    ),
  );
}

test("文件树行渲染：名称 + gitIgnored 徽标（官方 zh 值「已忽略」）", () => {
  const html = renderTree({
    entries: [entry({}), entry({ path: "dist/", name: "dist", kind: "directory", depth: 0, gitIgnored: true })],
  });
  assert.ok(html.includes("a.ts"));
  assert.ok(html.includes("已忽略"), "gitIgnored 徽标应渲染官方 zh 值");
});

test("搜索框官方形态：placeholder/aria-label 为官方 zh 值", () => {
  const html = renderTree();
  assert.ok(html.includes('placeholder="搜索文件..."'));
  assert.ok(html.includes('aria-label="搜索文件"'));
});

test("有查询时渲染清空按钮（官方值「清空文件搜索」）", () => {
  const withQuery = renderTree({ searchQuery: "a" });
  assert.ok(withQuery.includes("清空文件搜索"));
  const noQuery = renderTree({ searchQuery: "" });
  assert.ok(!noQuery.includes("清空文件搜索"));
});

test("错误态：read 渲染「读取目录失败」；open 渲染「无法打开该条目」", () => {
  assert.ok(renderTree({ error: "read" }).includes("读取目录失败"));
  assert.ok(
    renderTree({ error: "open", entries: [entry({})] }).includes("无法打开该条目"),
    "open 错误随条目渲染",
  );
});

test("装配缝缺省（entries=[]）：空态不崩，头部动作按回调存在性渲染", () => {
  const bare = renderTree();
  assert.ok(!bare.includes("刷新文件树"), "无 onRefresh 不渲染刷新");
  const wired = renderTree({
    onRefresh: () => {},
    onBackToTasks: () => {},
    onAddToChat: () => {},
    onOpenWith: () => {},
    onOpenInBrowser: () => {},
    entries: [entry({})],
  });
  assert.ok(wired.includes("刷新文件树"));
  assert.ok(wired.includes("返回任务"));
  assert.ok(wired.includes("添加到聊天"));
  assert.ok(wired.includes("打开方式"));
  assert.ok(wired.includes("用内置浏览器打开"));
});
