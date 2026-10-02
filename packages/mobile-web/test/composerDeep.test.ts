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
    // §32.68 context-usage 数据源 = snapshot.usage（官方同源）；无数据不渲染（官方 null 门）。
    modelState: {
      ...EMPTY_MODEL_SELECTION_STATE,
      usage: { usedTokens: 123456, maxTokens: 1000000 },
    },
  });
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
  // 无 usage 数据 → 官方同款 null 门（活体：Oxt 校验 used/size 非法即不渲染触发器）。
  const noUsage = render();
  assert.ok(!noUsage.includes('data-testid="chat-context-usage-trigger"'), "无数据不渲染用量表");
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

test("thought trigger：档位只认 modelView optionSpecs（§32.68 官方活体）+ 快照档位/空集不渲染", () => {
  // §32.68 官方活体取证（CDP）：snapshot.config.thoughtLevels=["low","high"] 已下发而
  // 官方页不渲染 chat-thought-level-select-trigger——档位事实归 provider-settings 模型
  // 配置（view optionSpecs），不归快照；快照档位不再触发渲染。
  const withLevels = render({
    modelView: {
      revision: 1,
      providers: [
        {
          providerId: "p",
          providerName: "p",
          templateId: null,
          models: [
            {
              modelId: "m",
              displayName: "m",
              config: { optionSpecs: { reasoningLevel: { values: ["low", "high"] } } },
            },
          ],
        },
      ],
    } as never,
    modelState: {
      ...EMPTY_MODEL_SELECTION_STATE,
      fallback: { provider: "p", model: "m", thought: "high" },
    },
  });
  assert.ok(withLevels.includes('data-testid="chat-thought-level-select-trigger"'));
  assert.ok(withLevels.includes("高"), "当前档 high → chat.toolbar.thoughtLevel.value.high");
  // 仅快照档位（无 modelView）→ 不渲染（官方同证）。
  const snapshotOnly = render({
    modelState: {
      ...EMPTY_MODEL_SELECTION_STATE,
      thoughtLevels: ["low", "high"],
      fallback: { provider: "p", model: "m", thought: "high" },
    },
  });
  assert.ok(
    !snapshotOnly.includes("chat-thought-level-select-trigger"),
    "快照 thoughtLevels 不再触发渲染（官方语义）",
  );
  const noLevels = render();
  assert.ok(!noLevels.includes("chat-thought-level-select-trigger"));
});

test("attachment §32.64 官方活体：aria-label=添加上下文（Plus 图标）+ hidden input", () => {
  const html = render();
  assert.ok(html.includes('data-testid="chat-attachment-button"'));
  assert.ok(html.includes('aria-label="添加上下文"'));
  assert.ok(html.includes('type="file" hidden'));
});

test("§32.68 官方用量表：chat-context-usage-trigger 环形 aria=Intl 千分位 + null 门", () => {
  const withUsage = render({
    modelState: {
      ...EMPTY_MODEL_SELECTION_STATE,
      usage: { usedTokens: 123456, maxTokens: 1000000 },
    },
  });
  assert.ok(withUsage.includes('data-testid="chat-context-usage-trigger"'));
  assert.ok(
    withUsage.includes("上下文已用 123,456 / 总量 1,000,000"),
    "aria = chat.contextUsage Intl 千分位（官方活体同值）",
  );
  assert.ok(withUsage.includes("62.83185307179586"), "环形几何 2πr 与官方 dasharray 同值");
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
