#!/usr/bin/env node
// 切段覆盖完整性检查：验证 01-merge-inventory.tsv 的每一行都被切段规则唯一分配。
// 用法: node check-segment-coverage.mjs [--inventory <tsv>] [--rules <json>]
// 退出码: 0=全覆盖; 1=存在未分配行或规则文件错误。
import fs from "node:fs";

const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const invPath = opt("inventory") ?? "docs/upstream-v3.18.0-diff-2026-11-11/01-merge-inventory.tsv";
const rulesPath = opt("rules") ?? "docs/upstream-v3.18.0-diff-2026-11-11/03-segment-rules.json";

let rules;
try {
  rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
} catch (e) {
  console.error(`规则文件无法解析 (${rulesPath}): ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(rules.segments) || rules.segments.length === 0) {
  console.error("规则文件缺少非空 segments 数组");
  process.exit(1);
}
const segIds = new Set(rules.segments.map((s) => s.id));
const exceptions = Array.isArray(rules.exceptions) ? rules.exceptions : [];
for (const ex of exceptions) {
  if (!segIds.has(ex.segment)) {
    console.error(`例外指向未知段: ${ex.prefix} -> ${ex.segment}`);
    process.exit(1);
  }
}

let lines;
try {
  lines = fs.readFileSync(invPath, "utf8").split("\n").filter(Boolean);
} catch (e) {
  console.error(`清单无法读取 (${invPath}): ${e.message}`);
  process.exit(1);
}
if (lines[0]?.startsWith("bucket\t")) lines = lines.slice(1);

// 最长前缀优先：例外先于段规则。
const longest = (prefixes) =>
  prefixes.reduce((a, b) => (b.length > (a?.length ?? -1) ? b : a), undefined);
const assign = (path) => {
  const exHit = longest(exceptions.filter((e) => path.startsWith(e.prefix)).map((e) => e.prefix));
  if (exHit !== undefined) return exceptions.find((e) => e.prefix === exHit).segment;
  let bestSeg;
  let bestPrefix = "";
  for (const seg of rules.segments) {
    const p = longest((seg.prefixes ?? []).filter((x) => path.startsWith(x)));
    if (p !== undefined && p.length > bestPrefix.length) {
      bestPrefix = p;
      bestSeg = seg.id;
    }
  }
  return bestSeg;
};

const counts = {};
const unassigned = [];
for (const line of lines) {
  const t = line.split("\t");
  // 列: bucket status upstreamPath droraPath droraDivergeLines upstreamChangeLines
  const path = t[3] || t[2];
  if (!path) continue;
  const seg = assign(path);
  if (seg === undefined) unassigned.push(`${t[0]}\t${path}`);
  else counts[seg] = (counts[seg] ?? 0) + 1;
}

const total = lines.length;
const assigned = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`清单 ${invPath}: ${total} 行; 已分配 ${assigned}; 未分配 ${unassigned.length}`);
for (const s of rules.segments) console.log(`  ${s.id}: ${counts[s.id] ?? 0}`);
if (unassigned.length > 0) {
  console.log(`未分配样例 (前 40):`);
  for (const u of unassigned.slice(0, 40)) console.log(`  ${u}`);
  process.exit(1);
}
console.log("COVERAGE OK: 全部变更行均有切段归属");
