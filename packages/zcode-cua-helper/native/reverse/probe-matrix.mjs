// 49 个导出的输入×输出全矩阵探测:每个接口多种调用形态,记录原版完整行为。
// 用法:node probe-matrix.mjs <addon-path> [out.json]
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import process from "node:process";

const [addonPath, outPath] = process.argv.slice(2);
const base = pathToFileURL(import.meta.dirname + "/").href;
const req = createRequire(base);
const native = req(addonPath);

// 每个接口的调用形态矩阵(null = 不存在的形态)
const matrix = {
  activateApplication: [["x"], [], [0], [-1], [999999999]],
  activateApplicationByAumid: [[42], [], [""], ["no.such!app"]],
  applicationIconPngAsync: [["x"], [], [0], [999999999]],
  applicationInfo: [["x"], [], [0]],
  applicationInfoByAumid: [[42], [], [""]],
  cancelInputHoldsForSession: [[], ["x"]],
  cancelPendingInputHolds: [[], ["x"]],
  captureApp: [["x"], [], [0], [-5]],
  captureMonitorPngAsync: [["x"], [], [0], [999999]],
  captureWindowImage: [["x"], [], [0], [999999999]],
  captureWindowPngVerifiedAsync: [["x"], [], [0]],
  clickAtPoint: [[], [1], [1, 2], [1, 2, 3], [1, 2, "left", 0], [1, 2, "left", 1, 42]],
  cursorPoint: [["x"]],
  displays: [["x"]],
  dpiAwarenessInfo: [["x"]],
  drag: [[], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 42]],
  elementAtPoint: [[], [1], ["x", "y"], [1, 2]],
  holdKeyGlobal: [[], ["a"], ["a", "x"], ["a", -1]],
  holdKeyGlobalAsync: [[], ["a"], ["a", "x"]],
  isFocusStealPrevented: [["x"]],
  isInteractiveSession: [["x"]],
  isScreenCaptureSupported: [["x"]],
  isTargetElevated: [["x"], [], [0], [-1], [999999999]],
  isTrusted: [["x"]],
  keyDownGlobal: [[], [42]],
  keyUpGlobal: [[], [42]],
  listApplications: [["x"]],
  listWindows: [["x"]],
  mouseDown: [[], [42]],
  mouseUp: [[], [42]],
  moveTo: [[], [1], ["x", 1], [1, "y"]],
  performAction: [[], ["x"], ["x", 42], ["x", "press"]],
  pressKeyGlobal: [[], [42], [""]],
  preventActivation: [["x"]],
  probeAccessibility: [["x"]],
  probeAccessibilityStatus: [["x"]],
  processExecutablePath: [["x"], [42]],
  readClipboardTextAsync: [["x"]],
  readElement: [[], [42]],
  reenableActivation: [["x"]],
  screenCaptureProbeWindows: [["x"]],
  screenCaptureStatus: [["x"]],
  scrollAt: [[], [1, 2], [1, 2, 3], [1, 2, 3, 42]],
  selectText: [[], [42], ["x"], ["x", 0], ["x", "a", "b"]],
  setFocused: [[], [42]],
  setValue: [[], ["x"], ["x", 42]],
  startupError: [["x"]],
  typeTextGlobal: [[], [42], [""]],
  writeClipboardTextAsync: [[], [42]],
};

const norm = (v) => {
  if (Buffer.isBuffer(v)) return `Buffer(${v.length})`;
  if (v === undefined) return "undefined";
  return JSON.stringify(v) ?? String(v);
};

const report = {};
for (const [name, forms] of Object.entries(matrix)) {
  if (typeof native[name] !== "function") {
    report[name] = { missing: true };
    continue;
  }
  report[name] = {};
  for (const args of forms) {
    const key = JSON.stringify(args);
    if (process.env.MATRIX_TRACE) console.error(`[trace] ${name}${key}`);
    try {
      const r = await native[name](...args);
      report[name][key] = { thrown: false, value: norm(await r) };
    } catch (e) {
      report[name][key] = {
        thrown: true,
        name: e?.name ?? "Error",
        message: String(e?.message),
      };
    }
  }
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify(report, null, 1));
  console.log("written:", outPath);
} else {
  console.log(JSON.stringify(report, null, 1));
}
