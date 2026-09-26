// 原版/本仓 bundle 行为契约字面量族集合差分。
// 用途：上游对齐审查的第一步——系统性发现"原版有而本仓缺"（疑似契约/功能缺口）
// 与"本仓有而原版无"（残留漂移或有意改名，需逐一归类）。
// 用法：node scripts/check-bundle-key-parity.mjs <原版bundle> <本仓bundle>
// 示例：node scripts/check-bundle-key-parity.mjs "D:\software\ZCode\resources\glm\zcode.cjs" packages/desktop/bundled-agents/win32-x64/glm/drora.cjs
// 方法论出处：specs/plugin-marketplaces.md 与 48-52 轮还原对齐审查（键名角色混淆、
// env 键撕裂、帧分隔符等错误都会体现为字面量族的缺失或错拼）。
import fs from "node:fs";

const [, , originalPath, oursPath] = process.argv;
if (!originalPath || !oursPath) {
  console.error("usage: node scripts/check-bundle-key-parity.mjs <original-bundle> <ours-bundle>");
  process.exit(2);
}

const orig = fs.readFileSync(originalPath, "utf8");
const ours = fs.readFileSync(oursPath, "utf8");

function census(text) {
  const families = {
    // 跨进程 _meta / wire 契约键（zcode.cua/* 族；drora 改名归一化后对照）
    metaKeys: [...text.matchAll(/"(?:zcode|drora|codex)\.cua\/[a-z0-9./-]+"/g)].map((m) => m[0]),
    // env 契约键
    envKeys: [...text.matchAll(/"(?:ZCODE|DRORA)_[A-Z0-9_]+"/g)].map((m) => m[0]),
    // 权限 capability 持久化键
    permissionKeys: [...text.matchAll(/"(?:zcode|drora):permission[a-z-]*:[a-z_]+"/g)].map((m) => m[0]),
    // 帧完整性/栅格相关诊断码
    diagCodes: [...text.matchAll(/"[a-z]+_[a-z_]*frame[a-z_]*"/g)].map((m) => m[0]),
  };
  const out = {};
  for (const [fam, arr] of Object.entries(families)) {
    out[fam] = new Map();
    for (const k of arr) out[fam].set(k, (out[fam].get(k) ?? 0) + 1);
  }
  return out;
}

// 品牌归一化：对照前把本仓侧的 drora/codex 前缀折算回原版命名（codex 是原版
// 浏览器 responseMeta 的前缀词，与 zcode 并存）。数值与结构不受影响。
function normalize(map) {
  const out = new Map();
  for (const [k, v] of map) {
    out.set(
      k
        .replace(/"(?:drora|codex)\.cua\//g, '"zcode.cua/')
        .replace(/"DRORA_/g, '"ZCODE_')
        .replace(/"drora:permission/g, '"zcode:permission'),
      v,
    );
  }
  return out;
}

const o = census(orig);
const m = { ...census(ours) };
for (const fam of Object.keys(m)) m[fam] = normalize(m[fam]);

let missing = 0;
for (const fam of Object.keys(o)) {
  const onlyOrig = [...o[fam].keys()].filter((k) => !m[fam].has(k));
  const onlyOurs = [...m[fam].keys()].filter((k) => !o[fam].has(k));
  console.log(`\n### ${fam}`);
  if (onlyOrig.length) {
    missing += onlyOrig.length;
    console.log(`only in ORIGINAL (${onlyOrig.length}):`);
    for (const k of onlyOrig) console.log(`  ${k}  x${o[fam].get(k)}`);
  }
  if (onlyOurs.length) {
    console.log(`only in OURS (${onlyOurs.length}) —— 逐一归类：品牌改名（归一化未覆盖）/ 残留漂移 / 自研新增：`);
    for (const k of onlyOurs) console.log(`  ${k}  x${m[fam].get(k)}`);
  }
  if (!onlyOrig.length && !onlyOurs.length) console.log("sets identical");
}
console.log(`\nsummary: ${missing} original-only literal(s) need triage`);
process.exit(missing > 0 ? 1 : 0);
