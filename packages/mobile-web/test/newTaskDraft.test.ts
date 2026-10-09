// §32.9 新建任务草稿页单测：时段问候边界（官方 MCt 逐值）+ 草稿面静态渲染。
// node:test + tsx + renderToStaticMarkup（与 composerDeep.test.ts 同法）。
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NewTaskDraft,
  resolveChatEmptyGreetingKey,
} from "../src/app/NewTaskDraft.js";
import { IntlProvider } from "../src/ui/intl.js";

Object.assign(globalThis, { React });

test("§32.9 时段问候边界：[5,9,12,14,18,23) 与官方 MCt 逐值一致", () => {
  // 早段新键；其余五段复用 P5b 既有键（值 = 官方逐字，spec §32.9）。
  assert.equal(resolveChatEmptyGreetingKey(5), "chat.empty.greeting.morningEarly");
  assert.equal(resolveChatEmptyGreetingKey(8), "chat.empty.greeting.morningEarly");
  assert.equal(resolveChatEmptyGreetingKey(9), "mobileShell.wide.greeting.morning");
  assert.equal(resolveChatEmptyGreetingKey(11), "mobileShell.wide.greeting.morning");
  assert.equal(resolveChatEmptyGreetingKey(12), "mobileShell.wide.greeting.noon");
  assert.equal(resolveChatEmptyGreetingKey(13), "mobileShell.wide.greeting.noon");
  assert.equal(
    resolveChatEmptyGreetingKey(14),
    "mobileShell.wide.greeting.afternoon",
  );
  assert.equal(
    resolveChatEmptyGreetingKey(17),
    "mobileShell.wide.greeting.afternoon",
  );
  assert.equal(resolveChatEmptyGreetingKey(18), "mobileShell.wide.greeting.evening");
  assert.equal(resolveChatEmptyGreetingKey(22), "mobileShell.wide.greeting.evening");
  assert.equal(resolveChatEmptyGreetingKey(23), "mobileShell.wide.greeting.lateNight");
  assert.equal(resolveChatEmptyGreetingKey(4), "mobileShell.wide.greeting.lateNight");
  assert.equal(resolveChatEmptyGreetingKey(0), "mobileShell.wide.greeting.lateNight");
});

function renderDraft(props: Record<string, unknown> = {}) {
  const base = {
    workspaceName: "demo",
    onBack: () => {},
    onSend: () => {},
    now: new Date(2026, 9, 1, 10, 0, 0),
  };
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(NewTaskDraft, { ...base, ...props }),
    ),
  );
}

test("§32.72 草稿面：问候 + 内嵌工作区行 + 全句占位 + 工具条四件 + chips suggestions 门控", () => {
  const html = renderDraft();
  // 上午 10 点 → morning 段（P5b 既有键，值 = 官方逐字）。
  assert.match(html, /上午好呀，有什么想让我帮忙的吗/);
  // §32.72 官方活体全句占位（chat.placeholder.newTask，非 newTaskMobile 短句）。
  assert.match(html, /向 Drora 提问，使用 @ 添加上下文，使用 \/ 选择命令或能力/);
  // composer 内嵌工作区行（工作区名）+ 分支占位图标。
  assert.match(html, /demo/);
  // 工具条四件：＋ 添加上下文 / 模式触发器（Hand+变更前确认+▾）/ 管理模型 / 发送。
  assert.match(html, /data-testid="new-task-draft-attach"/);
  assert.match(html, /aria-label="添加上下文"/);
  assert.match(html, /data-testid="new-task-draft-mode-trigger"/);
  assert.match(html, /变更前确认/, "草稿模式缺省 build（官方活体）");
  assert.match(html, /data-testid="new-task-draft-model-trigger"/);
  assert.match(html, /aria-label="管理模型"/);
  assert.match(html, /data-testid="new-task-draft-send"/);
  // 发送钮空草稿禁用。
  assert.match(html, /disabled/);
  // chips suggestions 门控：缺省不渲染（官方 suggestions 服务缺位活体一致）。
  assert.ok(!html.includes("检查近 7 天的 commit"), "chips 缺省隐藏");
  const withSuggestions = renderDraft({
    suggestions: [
      {
        labelId: "chat.draft.suggestedPrompt.recentCommits",
        promptId: "chat.draft.suggestedPrompt.recentCommits.prompt",
      },
    ],
  });
  assert.match(withSuggestions, /检查近 7 天的 commit/, "装配缝下发即渲染");
});

test("§32.9 草稿面：夜间问候段（lateNight）", () => {
  const html = renderDraft({ now: new Date(2026, 9, 1, 23, 30, 0) });
  assert.match(html, /夜深啦，别忘了照顾好自己哦/);
});
