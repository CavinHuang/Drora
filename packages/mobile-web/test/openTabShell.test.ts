import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteOpenTabShell } from "../src/ui/RemoteOpenTabShell.js";
import { IntlProvider } from "../src/ui/intl.js";

Object.assign(globalThis, { React });

test("侧板开关先显示官方标签启动壳，未接命令不展示假动作", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(RemoteOpenTabShell, { onClose: () => {} }),
    ),
  );
  assert.match(html, /side-pane-open-tab-shell/);
  assert.match(html, /side-pane-open-tab-content/);
  assert.match(html, /打开标签页/);
  assert.match(html, /选择要在侧边面板中打开的标签。/);
  assert.doesNotMatch(html, /data-side-pane-open-tab-item/);
  assert.doesNotMatch(html, /git-pane/);
});

test("已有 Git 审查能力时显示官方 review 启动项", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(RemoteOpenTabShell, {
        onClose: () => {},
        onOpenReview: () => {},
      }),
    ),
  );
  assert.match(html, /data-side-pane-open-tab-item="review"/);
  assert.match(html, /审查/);
  assert.doesNotMatch(html, /data-side-pane-open-tab-item="terminal"/);
});
