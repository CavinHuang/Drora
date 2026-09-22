#!/usr/bin/env node
// ax_native.node 接口双向漂移校验：
//   1. 运行时导出面 ↔ ax-native-expected.txt（预期接口清单）
//   2. 源码 native.X 调用点 ↔ 导出面/已封装包装层
// 用途：更换或重建 ax_native.node 后，校验接口面无漂移。
// 用法：node tools/check-ax-native-interface.mjs [addon路径]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const pkgRoot = path.resolve(import.meta.dirname, "..");
const addonPath = process.argv[2] ?? path.resolve(pkgRoot, "native", "ax_native.node");

// 源码中经适配层间接调用的包装名（nativeAxSource / nodeAutomationAdapter 提供，
// 非 addon 直接导出）：调用点豁免清单。
// 平台条件导出（Windows addon 面 / macOS 可选能力，源码以 ?.() 或 wrapOptionalNativeMethod 守卫）
const OPTIONAL_GUARDED = new Set([
  // Windows addon 面（win.ts / windowsScreenCapture.ts / windowsDevHelperMain.ts）
  "applicationInfoByAumid",
  "isTargetElevated",
  "isScreenCaptureSupported",
  "dpiAwarenessInfo",
  "parentProcessPid",
  "activateApplicationByAumid",
  // macOS 可选能力（剪贴板 pasteboard 协议 / PiP 探针钩子）
  "pasteboardBeginProvidedPaste",
  "pasteboardAwaitProvidedRead",
  "pasteboardMarkProvidedPasteDispatched",
  "pasteboardFinishProvidedPaste",
  "readClipboardTextAsync",
  "writeClipboardTextAsync",
  "processExecutablePath",
  "pipStartInteractionTestPanel",
  "pipGetWindowBounds",
  "pipMoveInteractionTestPanelToPoint",
  "pipSampleInteractionOwnershipAtPoint",
  "pipVerifyInitialHitSurface",
]);
// 源码经适配层间接调用的包装名（nativeAxSource / nodeAutomationAdapter 提供）
const SESSION_WRAPPERS = new Set([
  "isInteractiveSession",
  "sessionType",
  "listInstalledApplicationsAsync",
  "launchApplicationAsync",
  "captureMonitorPngAsync",
  "captureWindowPngVerifiedAsync",
  "freezeGroup",
  "setActiveGroup",
  "beginTurn",
  "taskCompleted",
  "startComposite",
]);

let fail = 0;

// ---- 1) 导出面 vs 预期清单 ----
const expectedPath = path.resolve(pkgRoot, "tools", "ax-native-expected.txt");
const expected = fs
  .readFileSync(expectedPath, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const require2 = createRequire(import.meta.url);
const addon = require2(addonPath);
const actual = Object.keys(addon).sort();
const expSorted = [...expected].sort();

const missing = expSorted.filter((n) => !actual.includes(n));
const extra = actual.filter((n) => !expSorted.includes(n));
if (missing.length) {
  console.log("FAIL 缺失导出:", missing.join(", "));
  fail = 1;
}
if (extra.length) {
  console.log("FAIL 多余导出:", extra.join(", "));
  fail = 1;
}
console.log(
  `导出面: ${actual.length} 项（预期 ${expected.length}）${missing.length + extra.length === 0 ? " 一致" : " 漂移"}`,
);

// ---- 2) 源码调用点 ↔ 导出面/包装层 ----
const srcDir = path.resolve(pkgRoot, "src");
const used = new Set();
const scan = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scan(full);
    else if (e.name.endsWith(".ts")) {
      const text = fs.readFileSync(full, "utf8");
      for (const m of text.matchAll(/\bnative\.([a-zA-Z_]\w*)\b/g)) used.add(m[1]);
    }
  }
};
scan(srcDir);

const addonOrWrapper = new Set([...actual, ...SESSION_WRAPPERS, ...OPTIONAL_GUARDED]);
const unknownCalls = [...used].filter((n) => !addonOrWrapper.has(n));
if (unknownCalls.length) {
  console.log("FAIL 未知的 native 调用（既非导出面也非包装层）:", unknownCalls.join(", "));
  fail = 1;
} else {
  console.log(`源码 native.* 调用点: ${used.size} 个名字，全部可解析`);
}

process.exit(fail ? 1 : 0);
