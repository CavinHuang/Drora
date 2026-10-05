import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationsPanel, type AutomationTaskItem } from "../src/ui/AutomationsPanel.js";
import { IntlProvider } from "../src/ui/intl.js";
import { defaultSchedule, parseCron, type AutomationSchedule } from "../src/app/automationsSchedule.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

const NOW = new Date(2026, 8, 30);

// weekdays 形态须经 parseCron 解析（defaultSchedule 原样是 custom/daily，不产生"每工作日"）。
const schedule: AutomationSchedule = parseCron("30 9 * * 1-5", NOW);

const task: AutomationTaskItem = {
  automationId: "auto-1",
  title: "每日汇总",
  schedule,
  nextRunWhen: "明天 09:30",
  runCount: 3,
  activeRouteSuffix: "automations:auto-1",
};

function renderPanel(props: Partial<Parameters<typeof AutomationsPanel>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(AutomationsPanel, {
        tab: "automation",
        onTabChange: () => {},
        tasks: [],
        ...props,
      }),
    ),
  );
}

test("官方 tablist 形态：role=tablist + aria-label=自动化页面 + roving tabindex", () => {
  const html = renderPanel();
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('aria-label="自动化页面"'));
  assert.ok(html.includes('role="tab"'));
  assert.ok(html.includes('aria-selected="true"'), "当前页签 aria-selected");
  assert.ok(html.includes('tabindex="0"'));
  assert.ok(html.includes('tabindex="-1"'), "非当前页签 -1（焦点漫游）");
  assert.ok(html.includes('data-testid="automations-tab-automation"'));
  assert.ok(html.includes('data-testid="automations-tab-workflow"'), "官方 E1 双页签");
});

test("官方页签双键：automation=定时任务 / workflow=定时任务模板（装配缝缺省空态）", () => {
  const automationHtml = renderPanel({ tab: "automation" });
  assert.ok(automationHtml.includes("定时任务"));
  const workflowHtml = renderPanel({ tab: "workflow" });
  assert.ok(workflowHtml.includes("定时任务模板"), "workflow 页签标题");
  assert.ok(workflowHtml.includes("没有符合条件的任务"), "装配缝缺省空态");
});

test("官方行形态：`title · nextRun{when}` 连接 + runCount {count} + describeSchedule", () => {
  const html = renderPanel({ tasks: [task] });
  assert.ok(html.includes("每日汇总 · 下次运行 明天 09:30"), "官方 ' · ' 连接形态");
  assert.ok(html.includes("已运行 3 次"));
  assert.ok(html.includes("每工作日 09:30"), "describeSchedule 官方构造器接入");
});

test("官方活跃判定：route.endsWith(':automationId') → 行高亮", () => {
  const activeHtml = renderPanel({ tasks: [task] });
  assert.ok(activeHtml.includes("bg-muted"), "活跃行高亮");
  const inactiveHtml = renderPanel({ tasks: [{ ...task, activeRouteSuffix: "automations:auto-9" }] });
  assert.ok(!inactiveHtml.includes("bg-muted/60"), "非活跃不高亮");
});

test("空态：empty.title + createManually + createViaChat.prompt 官方逐字", () => {
  const html = renderPanel({ onCreate: () => {} });
  assert.ok(html.includes("还没有定时任务"));
  assert.ok(html.includes("创建定时任务"));
  assert.ok(html.includes("每个工作日 9 点，汇总当前项目的代码变更和待跟进事项。"));
});

test("装配缝缺省：无 onCreate/onRefresh 不渲染对应按钮；错误行走官方键", () => {
  const bare = renderPanel();
  assert.ok(!bare.includes("立即运行"), "空态无 onRunNow 不渲染");
  assert.ok(!bare.includes(">新建<"), "无 onCreate 不渲染新建");
  const errorHtml = renderPanel({ error: "timeout" });
  assert.ok(errorHtml.includes("未找到该定时任务，可能已被删除"));
});
