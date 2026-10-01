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

test("§32.9 草稿面：时段问候 + 项目标识 + 占位符 + 静态建议词 chips", () => {
  const html = renderDraft();
  // 上午 10 点 → morning 段（P5b 既有键，值 = 官方逐字）。
  assert.match(html, /上午好呀，有什么想让我帮忙的吗/);
  // 官方移动端占位（chat.placeholder.newTaskMobile）。
  assert.match(html, /向 ZCode 提问…/);
  // 项目标识行（工作区名）。
  assert.match(html, /demo/);
  // 静态建议词 chips（chat.draft.suggestedPrompt.*，官方 locale 既有）。
  assert.match(html, /检查近 7 天的 commit/);
  assert.match(html, /制作一份 PDF/);
  // 发送钮空草稿禁用。
  assert.match(html, /disabled/);
});

test("§32.9 草稿面：夜间问候段（lateNight）", () => {
  const html = renderDraft({ now: new Date(2026, 9, 1, 23, 30, 0) });
  assert.match(html, /夜深啦，别忘了照顾好自己哦/);
});
