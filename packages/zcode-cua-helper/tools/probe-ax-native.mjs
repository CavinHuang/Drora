#!/usr/bin/env node
// ax_native.node 接口验收探针：加载原生插件，对照接口清单逐项校验。
// 用法：node tools/probe-ax-native.mjs [addon路径]
//       （缺省加载 native/ax_native.node；仅枚举与签名校验，不调用任何函数）
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const addonPath = process.argv[2]
  ? // require 把不以 ./ 或 / 开头的参数当包名解析（CI 从仓库根传相对路径即
    // MODULE_NOT_FOUND），这里统一先按 cwd 解析成绝对路径。
    path.resolve(process.argv[2])
  : path.resolve(import.meta.dirname, "..", "native", "ax_native.node");
if (!fs.existsSync(addonPath)) {
  console.error(`addon not found: ${addonPath}`);
  process.exit(1);
}
const addon = createRequire(import.meta.url)(addonPath);
const keys = Object.keys(addon).sort();

const EXPECTED = fs
  .readFileSync(path.resolve(import.meta.dirname, "ax-native-expected.txt"), "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const missing = EXPECTED.filter((n) => !keys.includes(n));
const extra = keys.filter((k) => !EXPECTED.includes(k));

console.log(`addon: ${addonPath}`);
console.log(`exports: ${keys.length} (expected ${EXPECTED.length})`);
if (missing.length) console.log("MISSING:", missing.join(", "));
if (extra.length) console.log("EXTRA:", extra.join(", "));
for (const k of keys) {
  if (typeof addon[k] !== "function")
    console.log(`WARN: ${k} is ${typeof addon[k]}, expected function`);
}
const ok = missing.length === 0 && extra.length === 0;
console.log(ok ? "PROBE OK" : "PROBE FAILED");
process.exit(ok ? 0 : 1);
