// 手机页自检：内联 JS 语法可解析、加载占位与状态函数齐备（spec §7 R2）。
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { PHONE_PAGE_HTML, PHONE_PAGE_CRYPTO_JS } from "../src/phonePage.js";

test("页面 JS 语法可解析（全部 script 块）", () => {
  const blocks = PHONE_PAGE_HTML.match(/<script>[\s\S]*?<\/script>/g) ?? [];
  assert.ok(blocks.length >= 2, "至少两个 script 块（加密 + UI）");
  for (const block of blocks) {
    const js = block.replace(/<\/?script>/g, "");
    assert.doesNotThrow(() => new Function(js), "内联 JS 必须可解析");
  }
});

test("加载占位与四步进度齐备", () => {
  for (const probe of [
    'id="loading"',
    'id="loadTitle"',
    'id="st1"',
    'id="st4"',
    "function showLoading",
    "已配对，正在加载工作区",
    "连接中转服务",
    "设备鉴权",
    "等待桌面端配对",
    "同步工作区",
  ]) {
    assert.ok(PHONE_PAGE_HTML.includes(probe), `缺少: ${probe}`);
  }
});

test("状态视图切换完整（loading/tasks/chat/unpaired + 数据到达切换）", () => {
  for (const probe of [
    'show("loading")',
    'show("unpaired")',
    'show("tasks")',
    'show("chat")',
    "function renderTasks",
    "function renderTimeline",
  ]) {
    assert.ok(PHONE_PAGE_HTML.includes(probe), `缺少: ${probe}`);
  }
});

test("时间线渲染面对齐 Drora 声明契约形状（info.role + text/reasoning/tool parts）", () => {
  // 2026-09-29 schema 漂移修复配套：timeline 帧承载 DroraMessageWithParts（legacy
  // 形状），role 在 info 内，parts 词表为 text/reasoning/tool；渲染面不得回流
  // 已随配对栈删除的 v1 页旧词（message.role/tool_call/thinking）。
  for (const probe of [
    "info.role",
    'p.type === "text"',
    'p.type === "reasoning"',
    'p.type === "tool"',
  ]) {
    assert.ok(PHONE_PAGE_HTML.includes(probe), `缺少: ${probe}`);
  }
  for (const banned of ['"tool_call"', '"thinking"']) {
    assert.ok(!PHONE_PAGE_HTML.includes(banned), `不得残留: ${banned}`);
  }
});

test("CRYPTO_JS 与页面 UI 均引用同一 computeProof", () => {
  assert.ok(PHONE_PAGE_CRYPTO_JS.includes("function computeProof"));
  assert.ok(PHONE_PAGE_HTML.includes("computeProof(passHash"));
});
