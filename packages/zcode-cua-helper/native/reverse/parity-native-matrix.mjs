// 第三验收套件:49 个导出的输入×输出全矩阵对比(123 调用形态)。
// 对原版与重编译版跑同一矩阵,逐格比对行为(动态值函数做结构归一)。
// 用法:node parity-native-matrix.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = import.meta.dirname;
const orig = process.env.AX_NATIVE_ORIG ?? resolve(root, "../../build/Release/ax_native.node");

function runMatrix(addonPath, outPath) {
  const r = spawnSync(process.execPath, [resolve(root, "probe-matrix.mjs"), addonPath, outPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
  });
  if (r.status !== 0) throw new Error(`matrix probe failed for ${addonPath}: ${r.stderr?.slice(0, 300)}`);
}

const tmpA = resolve(root, ".matrix-a.json");
const tmpB = resolve(root, ".matrix-b.json");
runMatrix(orig, tmpA);
runMatrix(resolve(root, "./build/Release/ax_native_win.node"), tmpB);

const a = JSON.parse(readFileSync(tmpA, "utf8"));
const b = JSON.parse(readFileSync(tmpB, "utf8"));

// 动态值函数:成功执行即可,比较结构形态而非内容
const DYNAMIC = new Set([
  "cursorPoint", "listApplications", "listWindows", "screenCaptureProbeWindows",
  "readClipboardTextAsync", "elementAtPoint", "activateApplicationByAumid",
  "activateApplication", "applicationIconPngAsync", "captureApp", "isTargetElevated",
]);
const shape = (fn, beh) => {
  if (!DYNAMIC.has(fn) || typeof beh !== "object" || beh === null) return beh;
  const c = { ...beh };
  if ("value" in c) {
    const v = c.value;
    if (v === null || ["null", "undefined", "true", "false"].includes(v)) return c;
    if (v.startsWith("Buffer(")) c.value = "Buffer";
    else if (v.startsWith("[")) c.value = "array";
    else if (v.startsWith("{")) c.value = "object";
    else if (v.startsWith('"')) c.value = "string";
  }
  return c;
};

let cells = 0;
const diffs = [];
for (const fn of Object.keys(a)) {
  for (const [args, beh] of Object.entries(a[fn])) {
    cells++;
    const rb = b[fn]?.[args];
    if (JSON.stringify(shape(fn, beh)) !== JSON.stringify(shape(fn, rb))) {
      diffs.push({ fn, args, orig: beh, rest: rb });
    }
  }
}

for (const d of diffs) {
  console.log(`DIFF ${d.fn}${d.args}`);
  console.log(`   orig: ${JSON.stringify(d.orig)?.slice(0, 110)}`);
  console.log(`   rest: ${JSON.stringify(d.rest)?.slice(0, 110)}`);
}
console.log(
  diffs.length === 0
    ? `\n输入×输出矩阵对齐验收通过 ✓ (123 格,结构差异 0)`
    : `\n${diffs.length} 格不一致 ✗ (${cells - diffs.length}/${cells})`,
);
process.exit(diffs.length === 0 ? 0 : 1);
