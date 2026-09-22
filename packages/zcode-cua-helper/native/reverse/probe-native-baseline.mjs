// 原版 win32 ax_native.node 能力基线探测。
// 产出 JSON:导出面、参数校验行为、只读能力实测值。
// 用法:node probe-native-baseline.mjs <addon-path> <out.json>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import process from "node:process";

const [addonPath, outPath] = process.argv.slice(2);
const req = createRequire(import.meta.url);
const native = req(addonPath);

const report = { addonPath, exports: {}, probes: {}, errors: {} };

// —— 1. 导出面 ——
const names = Object.keys(native).sort();
report.exportNames = names;
report.exportCount = names.length;
for (const n of names) {
  const v = native[n];
  report.exports[n] = { type: typeof v, name: v?.name, length: typeof v === "function" ? v.length : null };
}

// —— 2. 参数校验行为(错误参数,不触发系统能力) ——
const badCalls = {
  applicationInfo: [() => native.applicationInfo("x")],
  applicationInfoByAumid: [() => native.applicationInfoByAumid(42)],
  captureApp: [() => native.captureApp("x")],
  readElement: [() => native.readElement(42)],
  elementAtPoint: [() => native.elementAtPoint("x", "y")],
  moveTo: [() => native.moveTo("x", 1)],
  scrollAt: [() => native.scrollAt(1, 2, "x")],
  mouseDown: [() => native.mouseDown(42)],
  mouseUp: [() => native.mouseUp(42)],
  drag: [() => native.drag(1, 2, 3)],
  clickAtPoint: [() => native.clickAtPoint(1, 2, 3)],
  typeTextGlobal: [() => native.typeTextGlobal(42)],
  pressKeyGlobal: [() => native.pressKeyGlobal(42)],
  keyDownGlobal: [() => native.keyDownGlobal(42)],
  keyUpGlobal: [() => native.keyUpGlobal(42)],
  holdKeyGlobal: [() => native.holdKeyGlobal(42)],
  holdKeyGlobalAsync: [() => native.holdKeyGlobalAsync(42)],
  writeClipboardTextAsync: [() => native.writeClipboardTextAsync(42)],
};
for (const [name, calls] of Object.entries(badCalls)) {
  if (typeof native[name] !== "function") continue;
  for (const call of calls) {
    try {
      const r = await call();
      report.errors[name] = { thrown: false, value: safeJson(r) };
    } catch (e) {
      report.errors[name] = {
        thrown: true,
        message: String(e?.message),
        code: e?.code ?? null,
        name: e?.name,
      };
    }
  }
}

// —— 3. 只读能力实测 ——
const probes = {
  isTrusted: () => native.isTrusted(),
  probeAccessibilityStatus: () => native.probeAccessibilityStatus(),
  probeAccessibility: () => native.probeAccessibility(),
  isInteractiveSession: () => native.isInteractiveSession(),
  isScreenCaptureSupported: () => native.isScreenCaptureSupported(),
  screenCaptureStatus: () => native.screenCaptureStatus(),
  dpiAwarenessInfo: () => native.dpiAwarenessInfo(),
  cursorPoint: () => native.cursorPoint(),
  displays: () => native.displays(),
  processExecutablePath: () => native.processExecutablePath(),
  startupError: () => native.startupError(),
  isTargetElevatedSelf: () => native.isTargetElevated(process.pid),
  screenCaptureProbeWindows: () => native.screenCaptureProbeWindows(),
  listApplications: () => native.listApplications(),
  listWindows: () => native.listWindows(),
  applicationInfoSelf: () => native.applicationInfo(process.pid),
};
for (const [name, fn] of Object.entries(probes)) {
  if (typeof native[name === "applicationInfoSelf" ? "applicationInfo" : name === "isTargetElevatedSelf" ? "isTargetElevated" : name] !== "function") continue;
  try {
    report.probes[name] = { ok: true, value: safeJson(await fn()) };
  } catch (e) {
    report.probes[name] = { ok: false, message: String(e?.message), code: e?.code ?? null };
  }
}

function safeJson(v) {
  try {
    return JSON.parse(JSON.stringify(v, (k, val) => (typeof val === "bigint" ? String(val) : val)));
  } catch {
    return String(v);
  }
}

writeFileSync(outPath, JSON.stringify(report, null, 1));
console.log(`exports: ${report.exportCount}; error probes: ${Object.keys(report.errors).length}; value probes: ${Object.keys(report.probes).length}`);
console.log("export names:", names.join(" "));
