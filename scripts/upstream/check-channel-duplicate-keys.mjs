#!/usr/bin/env node
// channels.ts 重复键检查（v3.18.0 S1 段门；v3.17.2 前科=同一对象内键重复声明）。
//
// 背景：spec §4 S1 原文给出的朴素 grep（`grep -oE '^\s+\w+: "[^"]+"' | sort | uniq -d` 为空）
// 会被跨 const 块的合法同名键误报（Broadcast/CaptchaSolveResult/TaskNotificationSound/
// TaskOwnerCommandResult 四组在 HEAD 基线与上游 theirs 均存在，见 spec §10 S1 条目）；
// 且该检查经 node -e 内联执行时会被 shell 吞掉 `>`（箭头函数被截断，2026-11-13 段门
// 第 2/3 轮实证），故落成本脚本供段门直接调用。
//
// 语义：与 TypeScript ts(1117) 一致——重复＝同一对象字面量内同名键。跨块同名合法。
// 用法：node scripts/upstream/check-channel-duplicate-keys.mjs [file=packages/shared/src/channels.ts]
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2] ?? "packages/shared/src/channels.ts";
const src = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
const lines = src.split("\n");

let blockStart = -1;
let blockName = "";
let depth = 0;
const blocks = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^export const (\w+) = \{$/);
  if (m && depth === 0) {
    blockStart = i;
    blockName = m[1];
    depth = 1;
    continue;
  }
  if (blockStart >= 0) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth === 0) {
      blocks.push({ name: blockName, from: blockStart + 1, to: i + 1 });
      blockStart = -1;
    }
  }
}

let dupTotal = 0;
for (const b of blocks) {
  const seg = lines.slice(b.from, b.to);
  const seen = new Set();
  for (const line of seg) {
    const km = line.match(/^\s+(\w+): "/);
    if (!km) continue;
    const key = km[1];
    if (seen.has(key)) {
      console.error(`DUP in ${b.name}: ${key} (line ~${b.from + seg.indexOf(line)})`);
      dupTotal++;
    }
    seen.add(key);
  }
}
if (dupTotal > 0) {
  console.error(`${file}: ${dupTotal} same-object duplicate key(s)`);
  process.exit(1);
}
console.log(`${file}: no same-object duplicate keys (${blocks.length} blocks scanned)`);
