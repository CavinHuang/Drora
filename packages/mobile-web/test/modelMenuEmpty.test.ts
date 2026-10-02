// §32.70 模型菜单空态守卫：provider-settings 缺位（空清单）→ 官方活体单条
// 「管理模型」菜单项面（mm-click 取证），非占位文案；首读中仍 remoteWaiting 占位。
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelMenu } from "../src/ui/ModelMenu.js";
import { IntlProvider } from "../src/ui/intl.js";
import { EMPTY_MODEL_SELECTION_STATE } from "../src/app/conversationStore.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

function renderMenu(props: Partial<Parameters<typeof ModelMenu>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(ModelMenu, {
        view: null,
        state: EMPTY_MODEL_SELECTION_STATE,
        onSelect: () => {},
        onClose: () => {},
        ...props,
      }),
    ),
  );
}

test("§32.70 空清单 → 单条「管理模型」菜单项（官方 mm-click 活体）+ 首读中 remoteWaiting 占位", () => {
  const empty = renderMenu();
  assert.match(empty, /data-testid="mobile-model-menu-manage"/);
  assert.ok(empty.includes("管理模型"), "chat.toolbar.model.manageModels 官方逐字");
  assert.ok(!empty.includes("暂无模型目标"), "空清单不再渲染 targetMissing 占位文案");
  const loading = renderMenu({ loading: true });
  assert.ok(loading.includes("等待远程模型"), "首读中保留 remoteWaiting 占位");
});
