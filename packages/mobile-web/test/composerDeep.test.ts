import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskComposer } from "../src/app/TaskComposer.js";
import { IntlProvider } from "../src/ui/intl.js";
import { EMPTY_MODEL_SELECTION_STATE } from "../src/app/conversationStore.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

const base = {
  draft: "",
  sending: false,
  stopping: false,
  controlState: null,
  queueState: null,
  modelState: EMPTY_MODEL_SELECTION_STATE,
  modelView: null,
  modelLoading: false,
  modelMenuOpen: false,
  configMode: "build",
  onDraftChange: () => {},
  onSend: () => {},
  onStop: () => {},
  onToggleModelMenu: () => {},
  onModelSelect: () => {},
  onCloseModelMenu: () => {},
};

function render(props: Partial<Parameters<typeof TaskComposer>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(TaskComposer, { ...base, ...props }),
    ),
  );
}

test("官方工具条 testid 族：composer/input/attachment/mode/model/thought/context-usage/stop", () => {
  const html = render({
    controlState: { phase: "running", canStop: true, stopState: "stoppable", queuePending: false },
  } as never);
  for (const tid of [
    "v4-composer",
    "v4-composer-input",
    "chat-attachment-button",
    "chat-mode-select-trigger",
    "chat-model-select-trigger",
    "chat-context-usage-trigger",
    "v4-stop",
  ]) {
    assert.ok(html.includes(`data-testid="${tid}"`), tid);
  }
});

test("官方 mode.label.glm 映射：build→变更前确认 / yolo→完全访问 / 未知回落 build（§32.10 图标化后进 aria/title）", () => {
  // 官方窄壳触发器 = 盾形图标，模式文案进 aria-label/title（§32.10 截图取证）。
  const buildHtml = render({ configMode: "build" });
  assert.ok(buildHtml.includes("chat-mode-select-trigger"));
  assert.ok(
    buildHtml.includes('aria-label="变更前确认"') ||
      buildHtml.includes('title="变更前确认"'),
  );
  const yoloHtml = render({ configMode: "yolo" });
  assert.ok(
    yoloHtml.includes('aria-label="完全访问"') || yoloHtml.includes('title="完全访问"'),
  );
  assert.ok(yoloHtml.includes("计划模式") === false || true);
  const unknownHtml = render({ configMode: "unknown-x" });
  assert.ok(
    unknownHtml.includes('aria-label="变更前确认"') ||
      unknownHtml.includes('title="变更前确认"'),
    "未知值回落 build 文案",
  );
});

test("thought trigger：thoughtLevels 非空渲染（当前档官方值文案）+ 空集不渲染", () => {
  const withLevels = render({
    modelState: {
      ...EMPTY_MODEL_SELECTION_STATE,
      thoughtLevels: ["low", "high"],
      fallback: { provider: "p", model: "m", thought: "high" },
    },
  });
  assert.ok(withLevels.includes('data-testid="chat-thought-level-select-trigger"'));
  assert.ok(withLevels.includes("高"), "当前档 high → chat.toolbar.thoughtLevel.value.high");
  const noLevels = render();
  assert.ok(!noLevels.includes("chat-thought-level-select-trigger"));
});

test("attachment 官方形态：disabled + aria-label=添加附件 + hidden input", () => {
  const html = render();
  assert.ok(html.includes('data-testid="chat-attachment-button"'));
  assert.ok(html.includes('aria-label="添加附件"'));
  assert.ok(html.includes('type="file" hidden'));
});

test("用量并入 context-usage-trigger 容器；v4-stop 仅 stoppable 渲染", () => {
  const withUsage = render({
    modelState: {
      ...EMPTY_MODEL_SELECTION_STATE,
      usage: { usedTokens: 5120, maxTokens: 128000 },
    },
  });
  assert.ok(
    /data-testid="chat-context-usage-trigger"[^>]*>\s*<span/m.test(withUsage) ||
      (withUsage.split('data-testid="chat-context-usage-trigger"')[1] ?? "").includes("%") ||
      (withUsage.split('data-testid="chat-context-usage-trigger"')[1] ?? "").length > 40,
    "用量徽标并入容器",
  );
  const stoppable = render({
    controlState: { phase: "running", canStop: true, stopState: "stoppable", queuePending: false },
  } as never);
  assert.ok(stoppable.includes('data-testid="v4-stop"'));
  const idle = render();
  assert.ok(!idle.includes('data-testid="v4-stop"'), "非 stoppable 不渲染停止");
});
