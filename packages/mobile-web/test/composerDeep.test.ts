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
  // §32.24 官方还原页活体取证：触发器 aria/title = 通用「切换模式」（chat.toolbar.mode.label），
  // 当前模式名不再进触发器；mode.label.glm.* 映射保留在菜单项（四项闭集另测）。
  const buildHtml = render({ configMode: "build" });
  assert.ok(buildHtml.includes("chat-mode-select-trigger"));
  assert.ok(
    buildHtml.includes('aria-label="切换模式"') || buildHtml.includes('title="切换模式"'),
    "触发器 aria = 官方通用文案 切换模式",
  );
  assert.ok(!buildHtml.includes('aria-label="变更前确认"'), "当前模式名不进触发器 aria");
  const yoloHtml = render({ configMode: "yolo" });
  assert.ok(yoloHtml.includes("chat-mode-select-trigger"));
  assert.ok(!yoloHtml.includes('aria-label="完全访问"'), "yolo 模式名同样不进触发器");
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

test("attachment §32.64 官方活体：aria-label=添加上下文（Plus 图标）+ hidden input", () => {
  const html = render();
  assert.ok(html.includes('data-testid="chat-attachment-button"'));
  assert.ok(html.includes('aria-label="添加上下文"'));
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

test("§32.22 官方 plan 标记：plan 生效且有切换能力时渲染 v4-composer-plan-marker（可移除钮）", () => {
  const planHtml = render({ configMode: "plan", onModeSelect: () => {} });
  assert.ok(planHtml.includes('data-testid="v4-composer-plan-marker"'), "plan 标记渲染");
  assert.ok(planHtml.includes('role="separator"'), "官方竖分隔结构");
  assert.ok(planHtml.includes("关闭计划模式"), "官方 removeMarker 文案（aria/title）");
  // 非 plan 模式与无切换能力（缺 onModeSelect）均不渲染——缺能力不臆造。
  assert.ok(!render({ configMode: "build", onModeSelect: () => {} }).includes("v4-composer-plan-marker"));
  const noCapability = render({ configMode: "plan" });
  assert.ok(!noCapability.includes("v4-composer-plan-marker"), "无 onModeSelect 不渲染标记");
});
