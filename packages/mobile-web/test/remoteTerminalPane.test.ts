// 32.14 终端侧板面板单测：静态渲染含输出区与输入行（renderToStaticMarkup 不跑 effect，
// fake 只需形状存在）。
import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteTerminalPane } from "../src/app/RemoteTerminalPane.js";

// Node 的 tsx loader 使用 classic JSX transform；与 composerDeep.test.ts 同法注入。
Object.assign(globalThis, { React });

const fakeTerminal = {
  create: () => Promise.resolve({ id: "t1", shell: "PowerShell", fontFamily: "monospace" }),
  write: () => Promise.resolve(),
  resize: () => Promise.resolve(),
  dispose: () => Promise.resolve(),
  onDynamicData: () => (listener) => {
    listener("");
    return { dispose: () => {} };
  },
  onDynamicExit: () => (listener) => {
    listener(0);
    return { dispose: () => {} };
  },
};

test("32.14 终端面板：静态渲染含输出区与输入行 testid", () => {
  const html = renderToStaticMarkup(
    React.createElement(RemoteTerminalPane, {
      terminal: fakeTerminal,
      workspacePath: "D:/ws/demo",
    }),
  );
  assert.match(html, /remote-terminal-output/);
  assert.match(html, /remote-terminal-input/);
});
