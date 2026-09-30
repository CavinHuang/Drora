import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SidePane, type SidePaneTab } from "../src/ui/SidePane.js";
import { IntlProvider } from "../src/ui/intl.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

const tab = (overrides: Partial<SidePaneTab> = {}): SidePaneTab => ({
  id: "tab-1",
  title: "src/a.ts",
  ...overrides,
});

function renderPane(props: Partial<Parameters<typeof SidePane>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(SidePane, {
        tabs: [],
        searchQuery: "",
        onSearchQueryChange: () => {},
        ...props,
      }),
    ),
  );
}

test("官方两分区：打开的标签页 / 最近关闭的标签页（closed 行走 onOpenTab）", () => {
  const html = renderPane({
    tabs: [tab()],
    recentlyClosed: [tab({ id: "tab-2", title: "README.md" })],
    onOpenTab: () => {},
  });
  assert.ok(html.includes("打开的标签页"));
  assert.ok(html.includes("最近关闭的标签页"));
  assert.ok(html.includes("src/a.ts"));
  assert.ok(html.includes("README.md"));
});

test("官方类型徽标：workflow 五细分键逐字（子代理/产物/目录/实例/脚本步骤）", () => {
  for (const [detail, label] of [
    ["actor", "工作流子代理"],
    ["artifact", "产物"],
    ["directory", "工作流目录"],
    ["run", "工作流实例"],
    ["script", "脚本步骤"],
  ] as const) {
    const html = renderPane({ tabs: [tab({ kind: "workflow", workflowDetail: detail })] });
    assert.ok(html.includes(label), `${detail} → ${label}`);
  }
});

test("官方其余徽标键：review/selectionChat/subagent/subagentDirectory 逐字", () => {
  assert.ok(renderPane({ tabs: [tab({ kind: "review" })] }).includes("审查"));
  assert.ok(renderPane({ tabs: [tab({ kind: "selectionChat" })] }).includes("辅助对话"));
  assert.ok(renderPane({ tabs: [tab({ kind: "subagent" })] }).includes("子智能体"));
  assert.ok(renderPane({ tabs: [tab({ kind: "subagentDirectory" })] }).includes("子智能体目录"));
});

test("搜索过滤 + 空态官方值：无命中→没有找到标签页。/空清单→打开描述", () => {
  const miss = renderPane({ tabs: [tab()], searchQuery: "zzz" });
  assert.ok(miss.includes("没有找到标签页。"));
  assert.ok(!miss.includes("src/a.ts"), "搜索过滤生效");
  const empty = renderPane();
  assert.ok(empty.includes("选择要在侧边面板中打开的标签。"));
});

test("关闭单页：aria-label 官方插值「关闭 {title}」逐字", () => {
  const html = renderPane({ tabs: [tab()], onCloseTab: () => {} });
  assert.ok(html.includes('aria-label="关闭 src/a.ts"'));
  assert.ok(html.includes("关闭标签"));
});

test("装配缝缺省：动作按回调存在性渲染（addTab/closeOther/closeAll/collapse/togglePanel）", () => {
  const bare = renderPane();
  assert.ok(!bare.includes("新增标签"));
  assert.ok(!bare.includes("关闭其他标签"));
  assert.ok(!bare.includes("关闭所有标签"));
  assert.ok(!bare.includes("收起侧边面板"));
  assert.ok(!bare.includes("切换面板"));
  const wired = renderPane({
    onAddTab: () => {},
    onCloseOtherTabs: () => {},
    onCloseAllTabs: () => {},
    onCollapse: () => {},
    onTogglePanel: () => {},
    tabs: [tab({ loading: true })],
  });
  assert.ok(wired.includes("新增标签"));
  assert.ok(wired.includes("关闭其他标签"));
  assert.ok(wired.includes("关闭所有标签"));
  assert.ok(wired.includes("收起侧边面板"));
  assert.ok(wired.includes("切换面板"));
  assert.ok(wired.includes("正在加载文件..."), "loading 态官方值");
  assert.ok(wired.includes("刚刚") === false, "time.justNow 由上层时间格式化注入，本组件不直渲");
});
