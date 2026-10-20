#!/usr/bin/env node
// v3.16.1 分段合并预演：对 aac4755..upstream/main 的全部变更路径做逐文件三方试合并。
// base = transform(aac4755)，theirs = transform(upstream/main)，ours = 当前分支（git 对象）。
// 产出：逐路径结局清单（new/take-theirs/clean-merge/conflict/delete*/decision）+ 按段统计。
//
// 用法：node scripts/upstream/merge-dryrun.mjs [--base-dir /tmp/golden/base-transformed] \
//        [--theirs-dir /tmp/dryrun/theirs] [--out /tmp/dryrun]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mapRelPath, zoneOf } from "./transform-upstream-tree.mjs";

const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE_REF = "aac4755666d09fdcd70272fcf063c077a639015f";
const THEIRS_REF = "upstream/main";
const baseDir = getArg("base-dir") ?? "/tmp/golden/base-transformed";
const theirsDir = getArg("theirs-dir") ?? "/tmp/dryrun/theirs";
const outDir = getArg("out") ?? "/tmp/dryrun";

const sh = (cmd) => execFileSync("sh", ["-c", cmd], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// 段划分（ specs/upstream-v3.16.1-migration.md 段表；drora 命名空间路径）
const SEGMENTS = [
  ["S2", ["apps/drora-cli/"]],
  ["S4", ["packages/desktop/"]],
  ["S3", ["packages/services/", "packages/server/", "packages/provider/", "packages/provider-node/", "packages/client/", "packages/drora-server-cli/", "packages/model-option-map/", "packages/android/", "packages/formal-proof/", "packages/share-ui/", "packages/web-share/", "packages/stream-animate/", "packages/e2e-report/", "harness/", "config/"]],
  ["S5", ["packages/ui/", "packages/web/", "packages/mobile-web/", "public/"]],
  ["S1", ["packages/shared/", "packages/rpc/"]],
  ["S6", ["packages/zcode-cua/", "packages/zcode-cua-helper/", "docs/", "scripts/", "patches/", "third-party/", ".agents/", ".github/", "apps/dev-docs/", "THIRD-PARTY-NOTICES.md", "AGENTS.md", "DESIGN.md", "CONTEXT.md", "README.md", "README.en.md", "UI_PLUGIN.md", "UI_PLUGIN.en.md", "NOTICE.md", ".gitattributes", ".gitignore", ".oxlintrc.json", ".oxfmtrc.json"]],
  ["S1", []], // 兜底：根级杂项归 S1
];
const segmentOf = (p) => {
  for (const [seg, prefixes] of SEGMENTS) {
    if (prefixes.some((x) => p === x || p.startsWith(x))) return seg;
  }
  return "S1";
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
  .split("\n").filter(Boolean)
  .map((l) => {
    const m = l.match(/^(\w+)\t(.+)$/);
    return { status: m[1], upstreamPath: m[2] };
  });

const readGit = (ref, p) => {
  try {
    return execFileSync("git", ["cat-file", "-p", `${ref}:${p}`], { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" });
  } catch {
    return null;
  }
};
const readFile = (dir, rel) => {
  try { return fs.readFileSync(path.join(dir, rel)); } catch { return null; }
};
const sameBuf = (a, b) => !Buffer.compare(a, b);

const results = [];
for (const { status, upstreamPath } of raw) {
  const zone = zoneOf(upstreamPath);
  const droraPath = zone === "cua-limited" ? upstreamPath : mapRelPath(upstreamPath);
  const seg = segmentOf(droraPath);
  const entry = { segment: seg, status, upstreamPath, droraPath, zone, outcome: "", detail: "" };

  // 上游侧内容（转换树；new/modify 均存在，delete 不存在）
  const theirs = readFile(theirsDir, droraPath);
  const base = readFile(baseDir, droraPath);
  const ours = readGit("HEAD", droraPath);

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
    if (!theirs) { entry.outcome = "missing-in-theirs"; }
    else if (!ours) entry.outcome = "theirs-modify-ours-deleted";
    else if (base && sameBuf(ours, base)) entry.outcome = "take-theirs";
    else if (base && sameBuf(theirs, base)) entry.outcome = "keep-ours";
    else {
      // 三方试合并
      const tmp = fs.mkdtempSync("/tmp/3way-");
      const fO = path.join(tmp, "ours"), fB = path.join(tmp, "base"), fT = path.join(tmp, "theirs");
      fs.writeFileSync(fO, ours); fs.writeFileSync(fB, base); fs.writeFileSync(fT, theirs);
      let mergeOut = "";
      try {
        execFileSync("git", ["merge-file", "-L", "ours", "-L", "base", "-L", "theirs", "-p", fO, fB, fT], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
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
  console.log(`${seg}: total=${total} ` + Object.entries(bySeg[seg]).map(([k, v]) => `${k}=${v}`).join(" "));
}
const conflicts = results.filter((r) => r.outcome === "conflict" || r.outcome === "new-collision" || r.outcome === "theirs-modify-ours-deleted" || r.outcome === "delete-decision");
fs.writeFileSync(path.join(outDir, "conflicts.json"), JSON.stringify(conflicts, null, 1));
console.log(`\n需人工/决策条目: ${conflicts.length}（详见 ${outDir}/conflicts.json）`);
