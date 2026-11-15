#!/usr/bin/env node
// v3.16.1 分段合并预演：对 aac4755..upstream/main 的全部变更路径做逐文件三方试合并。
// base = transform(aac4755)，theirs = transform(upstream/main)，ours = 当前分支（git 对象）。
// 产出：逐路径结局清单（new/take-theirs/clean-merge/conflict/delete*/decision）+ 按段统计。
//
// 用法：node scripts/upstream/merge-dryrun.mjs [--base-dir /tmp/golden/base-transformed] \
//        [--theirs-dir /tmp/dryrun/theirs] [--out /tmp/dryrun]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapRelPath, zoneOf } from "./transform-upstream-tree.mjs";

const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
// v3.18.0 战役重定标（specs/upstream-v3.18.0-migration.md §4 S0）：
// base=v3.17.2（上一轮合并完成点），theirs=本仓 git 对象库固定树（gh api tarball 导入）。
// v3.18.2 增量战役重定标（05-remaining-gaps.md §1 吸收路径）：base=已对齐的 v3.18.0，theirs=v3.18.2。
const BASE_REF = "refs/upstream-trees/v3.18.0";
const THEIRS_REF = "refs/upstream-trees/v3.18.2";
const baseDir = getArg("base-dir") ?? "C:/Users/A/AppData/Local/Temp/dryrun/theirs"; // v3.18.2 战役：base=v3.18.0 变换树（曾误指 v3.17.2 树致三方全失真）
const theirsDir = getArg("theirs-dir") ?? "C:/Users/A/AppData/Local/Temp/dryrun/theirs-v3182";
const outDir = getArg("out") ?? "C:/Users/A/AppData/Local/Temp/dryrun-v3182";

const sh = (cmd) =>
  execFileSync("sh", ["-c", cmd], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// 段划分：v3.18.0 起改由 03-segment-rules.json 单一出处加载（含 exceptions 最长前缀优先），
// 与 check-segment-coverage.mjs 同源，避免段表硬编码与本轮 spec 漂移。
const RULES_PATH = getArg("rules") ?? "docs/upstream-v3.18.0-diff-2026-11-11/03-segment-rules.json";
const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
const SEGMENTS = rules.segments.map((s) => [s.id, s.prefixes ?? []]);
const RULE_EXCEPTIONS = rules.exceptions ?? [];
const segmentOf = (p) => {
  // 例外最长前缀优先，其次段前缀最长匹配；均未命中归 S8 之外的兜底报错（分配表应全覆盖）。
  let exHit = "";
  let exSeg = "";
  for (const ex of RULE_EXCEPTIONS) {
    if (p.startsWith(ex.prefix) && ex.prefix.length > exHit.length) {
      exHit = ex.prefix;
      exSeg = ex.segment;
    }
  }
  if (exHit) return exSeg;
  let bestPrefix = "";
  let bestSeg = "UNASSIGNED";
  for (const [seg, prefixes] of SEGMENTS) {
    for (const x of prefixes) {
      if ((p === x || p.startsWith(x)) && x.length > bestPrefix.length) {
        bestPrefix = x;
        bestSeg = seg;
      }
    }
  }
  return bestSeg;
};

// theirs 转换树（缓存：若目录已存在则跳过）
if (!fs.existsSync(path.join(theirsDir, "package.json"))) {
  const { transformTree } = await import("./transform-upstream-tree.mjs");
  fs.rmSync(theirsDir, { recursive: true, force: true });
  fs.mkdirSync(theirsDir, { recursive: true });
  transformTree(THEIRS_REF, theirsDir);
}

// 上游变更清单（zcode 命名空间）
const raw = sh(`git diff --name-status --no-renames ${BASE_REF} ${THEIRS_REF}`)
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const m = l.match(/^(\w+)\t(.+)$/);
    return { status: m[1], upstreamPath: m[2] };
  });

// v3.18.2 增量战役修复：v3.18.0 战役成果未提交（工作树态），ours 若读 HEAD 会把
// 工作树已就位文件误判为不存在（假 theirs-modify-ours-deleted）。ours 改为优先读工作树文件。
const worktreeOurs = (p) => {
  try {
    return fs.readFileSync(path.join(repoRootForRead(), p));
  } catch {
    return readGit("HEAD", p);
  }
};
const repoRootForRead = () => process.cwd();
const readGit = (ref, p) => {
  try {
    return execFileSync("git", ["cat-file", "-p", `${ref}:${p}`], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: "buffer",
    });
  } catch {
    return null;
  }
};
const readFile = (dir, rel) => {
  try {
    return fs.readFileSync(path.join(dir, rel));
  } catch {
    return null;
  }
};
// 与 01-merge-inventory 分类器同口径：比较前做 BOM 剥离 + CRLF→LF 归一化，
// 否则本仓 CRLF blob 与变换树的 LF 内容会全部判成幻影 conflict（v3.17.2 后仓内 CRLF blob 增多）。
const normText = (buf) => {
  let s = buf.toString("utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return Buffer.from(s.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8");
};
const isTextBuf = (buf) => {
  for (const b of buf.subarray(0, 4096)) if (b === 0) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
};
const sameBuf = (a, b) => {
  if (!Buffer.compare(a, b)) return true;
  if (isTextBuf(a) && isTextBuf(b) && !Buffer.compare(normText(a), normText(b))) return true;
  return false;
};
const normIfText = (buf) => (buf && isTextBuf(buf) ? normText(buf) : buf);

const results = [];
for (const { status, upstreamPath } of raw) {
  const zone = zoneOf(upstreamPath);
  const droraPath = zone === "cua-limited" ? upstreamPath : mapRelPath(upstreamPath);
  const seg = segmentOf(droraPath);
  const entry = { segment: seg, status, upstreamPath, droraPath, zone, outcome: "", detail: "" };

  // 上游侧内容（转换树；new/modify 均存在，delete 不存在）
  const theirs = readFile(theirsDir, droraPath);
  const base = readFile(baseDir, droraPath);
  const ours = worktreeOurs(droraPath);

  if (zone === "verbatim" || zone === "cua-limited") {
    // 豁免区/还原区：Drora 拥有，上游变化一律走决策表（R3/还原资产）
    entry.outcome = "zone-decision";
    entry.detail = zone;
    results.push(entry);
    continue;
  }

  if (status === "A") {
    if (ours) {
      // 上游新增路径与 Drora 自研同路径冲突（理论少见）
      entry.outcome = ours && theirs && sameBuf(ours, theirs) ? "already-present" : "new-collision";
    } else {
      entry.outcome = "new";
    }
  } else if (status === "D") {
    if (!ours) entry.outcome = "noop-delete";
    else if (base && sameBuf(ours, base)) entry.outcome = "delete";
    else entry.outcome = "delete-decision";
  } else {
    if (!theirs) {
      entry.outcome = "missing-in-theirs";
    } else if (!ours) entry.outcome = "theirs-modify-ours-deleted";
    else if (base && sameBuf(ours, base)) entry.outcome = "take-theirs";
    else if (base && sameBuf(theirs, base)) entry.outcome = "keep-ours";
    else if (!base) {
      // 防御（v3.18.2 预演实测触发）：M 状态但 base 树缺此文件——按 new/冲突记录，避免 writeFileSync(null) 崩溃。
      console.error(`[dryrun] base 缺失的 M 文件: ${upstreamPath} -> ${droraPath}`);
      entry.outcome = "new";
    } else {
      // 三方试合并（临时目录走 os.tmpdir：Node 下 "/tmp" 会落到当前盘根，D 盘满时必炸）
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "3way-"));
      const fO = path.join(tmp, "ours"),
        fB = path.join(tmp, "base"),
        fT = path.join(tmp, "theirs");
      fs.writeFileSync(fO, normIfText(ours));
      fs.writeFileSync(fB, normIfText(base));
      fs.writeFileSync(fT, normIfText(theirs));
      let mergeOut = "";
      try {
        execFileSync(
          "git",
          ["merge-file", "-L", "ours", "-L", "base", "-L", "theirs", "-p", fO, fB, fT],
          { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
        );
        entry.outcome = "clean-merge";
      } catch (e) {
        mergeOut = e.stdout ?? "";
        const hunks = (mergeOut.match(/^<{7}/gm) || []).length;
        entry.outcome = hunks > 0 ? "conflict" : "clean-merge";
        entry.detail = String(hunks);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  results.push(entry);
}

// 汇总
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "inventory.json"), JSON.stringify(results, null, 1));
const bySeg = {};
for (const r of results) {
  bySeg[r.segment] ??= {};
  bySeg[r.segment][r.outcome] = (bySeg[r.segment][r.outcome] ?? 0) + 1;
}
console.log("=== 预演汇总（按段×结局）===");
for (const seg of Object.keys(bySeg).sort()) {
  const total = Object.values(bySeg[seg]).reduce((a, b) => a + b, 0);
  console.log(
    `${seg}: total=${total} ` +
      Object.entries(bySeg[seg])
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );
}
const conflicts = results.filter(
  (r) =>
    r.outcome === "conflict" ||
    r.outcome === "new-collision" ||
    r.outcome === "theirs-modify-ours-deleted" ||
    r.outcome === "delete-decision",
);
fs.writeFileSync(path.join(outDir, "conflicts.json"), JSON.stringify(conflicts, null, 1));
console.log(`\n需人工/决策条目: ${conflicts.length}（详见 ${outDir}/conflicts.json）`);
