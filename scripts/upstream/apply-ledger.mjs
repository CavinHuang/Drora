#!/usr/bin/env node
// v3.17.1 ledger 驱动分段应用器（specs/upstream-v3.17.1-migration.md P1-07 交付）。
//
// 输入：规划轮 upstream-ledger.tsv（逐路径 blob 锚定）+ 可选 decisions JSON。
// 与旧 apply-segment.mjs 的区别：不再依赖 /tmp/dryrun/inventory.json 与硬编码
// base/theirs 目录；直接以 ledger 的 blob OID 为唯一事实源，应用前做 fail-closed
// 输入校验（工作区内容与 ledger 记录的 ours blob 不一致即拒绝该路径），规避
// 双会话/基线漂移把错误内容当 ours 合并。
//
// 内容转换复用 transform-upstream-tree.mjs 的导出（规则唯一来源
// specs/drora-rename.md）：normal 全量转换、cua-limited 仅 @zcode/ scope、
// verbatim 逐字节。路径层 normal 用 mapRelPath，cua-limited 保持原路径；
// 与 ledger 记录的 drora_path 不一致即 fail-closed（改名规则漂移须先改 spec）。
//
// 文本比较采用 CRLF 宽容归一（仅去 \r）：本仓 Windows 检出存在已知 CRLF 幻影
// （docs/upstream-sync/2026-10-31-v3.17.1 前身经验），内容判定不能被行尾破坏；
// 二进制仍按字节精确比较。
//
// 用法：
//   node scripts/upstream/apply-ledger.mjs --ledger <tsv> --segment S1 [--decisions <json>]
//        [--dry] [--report <out.json>]
// decisions JSON：{ "<drora_path>": "take-theirs" | "keep-ours" | "delete" | "skip" }

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { transformContent, mapRelPath, zoneOf } from "./transform-upstream-tree.mjs";

const execFileAsync = promisify(execFile);
const p = (n) => process.argv.indexOf(`--${n}`);

function getArg(n) {
  const i = p(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const LEDGER = getArg("ledger");
const SEGMENT = getArg("segment");
const DECISIONS_PATH = getArg("decisions");
const DRY = process.argv.includes("--dry");
const REPORT = getArg("report");

if (!LEDGER || !SEGMENT) {
  console.error("用法: apply-ledger.mjs --ledger <tsv> --segment S1 [--decisions <json>] [--dry] [--report <out>]");
  process.exit(1);
}

const OUTCOME_ORDER = [
  "add",
  "take-upstream",
  "text-clean-needs-semantic-review",
  "text-conflict",
  "delete-review",
  "delete-local-change-review",
  "zone-decision",
  "already-present",
  "lockfile-regenerate",
  "already-deleted",
];
const DECISION_ACTIONS = new Set(["take-theirs", "keep-ours", "delete", "skip"]);

const gitCat = async (oid) => {
  try {
    const { stdout } = await execFileAsync("git", ["cat-file", "blob", oid], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: "buffer",
    });
    return stdout;
  } catch {
    return null;
  }
};

// 与 transform-upstream-tree.mjs 的 isTransformableText 同语义：二进制内容
// （NUL/严格 UTF-8 解码失败）即使落在 normal zone 也逐字保留，不得走文本替换。
const isTransformableText = (buf) => {
  if (buf.subarray(0, 4096).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return false;
  }
  return true;
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// CRLF 宽容文本归一：仅去 \r，不做其他改写。
const normalizeText = (buf) => Buffer.from(buf.toString("utf8").replaceAll("\r", ""), "utf8");

const isTextLike = (buf) => !buf.subarray(0, 4096).includes(0);

const contentMatches = (workBuf, expectBuf) => {
  if (workBuf === null) return expectBuf === null;
  if (expectBuf === null) return false;
  if (workBuf.equals(expectBuf)) return true;
  if (isTextLike(workBuf) && isTextLike(expectBuf)) {
    return normalizeText(workBuf).equals(normalizeText(expectBuf));
  }
  return false;
};

// 按规划转换规则得到该路径的 base/theirs 内容（zcode→drora 命名空间）。
async function transformedBlob(oid, zone) {
  const raw = await gitCat(oid);
  if (raw === null) return null;
  if (!isTransformableText(raw)) return raw; // 二进制/非 UTF-8：逐字保留
  if (zone === "normal") return Buffer.from(transformContent(raw.toString("utf8")), "utf8");
  if (zone === "cua-limited") return Buffer.from(raw.toString("utf8").replaceAll("@zcode/", "@drora/"), "utf8");
  return raw; // verbatim：官方字节资产逐字保留
}

async function mergeFile(base, ours, theirs) {
  const dir = await fs.mkdtemp(path.join(process.env.TEMP ?? "/tmp", "usync-merge-"));
  const b = path.join(dir, "base");
  const o = path.join(dir, "ours");
  const t = path.join(dir, "theirs");
  await fs.writeFile(b, base);
  await fs.writeFile(o, ours);
  await fs.writeFile(t, theirs);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["merge-file", "-p", "--diff3", "-L", "ours", "-L", "base(v3.16.1→drora)", "-L", "theirs(v3.17.1→drora)", o, b, t],
      { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
    );
    return { content: stdout, conflicts: 0 };
  } catch (error) {
    if (error.stdout && typeof error.code === "number" && error.code > 0) {
      return { content: error.stdout, conflicts: error.code };
    }
    throw error;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const parseLedger = (text) => {
  const [headerLine, ...lines] = text.split("\n");
  const header = headerLine.split("\t");
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return lines.filter((l) => l.trim()).map((l) => {
    const cols = l.split("\t");
    const row = {};
    for (const [k, i] of Object.entries(idx)) row[k] = cols[i] ?? "";
    return row;
  });
};

const main = async () => {
  const ledgerText = await fs.readFile(LEDGER, "utf8");
  const decisions = DECISIONS_PATH ? JSON.parse(await fs.readFile(DECISIONS_PATH, "utf8")) : {};
  for (const [k, v] of Object.entries(decisions)) {
    if (!DECISION_ACTIONS.has(v)) throw new Error(`非法决策值 ${v}（${k}）`);
  }
  const rows = parseLedger(ledgerText).filter((r) => r.segment === SEGMENT);
  if (!rows.length) throw new Error(`段 ${SEGMENT} 无清单行`);

  const report = {
    segment: SEGMENT,
    ledger: { path: LEDGER, sha256: sha256(Buffer.from(ledgerText)) },
    dry: DRY,
    counts: Object.fromEntries(OUTCOME_ORDER.map((o) => [o, 0])),
    applied: [],
    skipped: [],
    conflicts: [],
    semanticReview: [],
    driftBlocked: [],
    decisionRequired: [],
    errors: [],
  };

  for (const row of rows) {
    const droraPath = row.drora_path;
    const outcome = row.current_main_dryrun;
    report.counts[outcome] = (report.counts[outcome] ?? 0) + 1;
    const dec = decisions[droraPath];
    // 非法路径守卫：拒绝越出仓库根的相对路径（../ 前缀注入）。
    if (path.isAbsolute(droraPath) || droraPath.split("/").includes("..")) {
      report.errors.push({ path: droraPath, reason: "非法路径" });
      continue;
    }
    const abs = path.resolve(droraPath);
    let workBuf = null;
    try {
      workBuf = await fs.readFile(abs);
    } catch {
      workBuf = null;
    }

    // —— fail-closed 输入校验：工作区内容必须等于 ledger 记录的 ours blob ——
    const expectOurs = row.current_main_blob && row.current_main_blob !== "-" ? await gitCat(row.current_main_blob) : null;
    if (!contentMatches(workBuf, expectOurs)) {
      if (dec !== "skip") {
        report.driftBlocked.push({ path: droraPath, outcome });
        continue;
      }
    }

    // —— 路径映射与 zone 一致性：改名规则漂移即停 ——
    const zone = row.zone;
    if (zone !== zoneOf(row.upstream_path)) {
      report.errors.push({ path: droraPath, reason: `zone 漂移：ledger=${zone} 计算=${zoneOf(row.upstream_path)}` });
      continue;
    }
    const expectPath = zone === "cua-limited" ? row.upstream_path : mapRelPath(row.upstream_path);
    if (expectPath !== droraPath) {
      report.errors.push({ path: droraPath, reason: `路径映射漂移：期望 ${expectPath}` });
      continue;
    }

    const action = dec ?? outcome;
    try {
      if (action === "skip") {
        report.skipped.push(droraPath);
      } else if (action === "keep-ours") {
        report.applied.push({ path: droraPath, action: "keep-ours" });
      } else if (action === "delete") {
        if (!DRY) await fs.rm(abs, { force: true });
        report.applied.push({ path: droraPath, action: "delete" });
      } else if (action === "take-theirs" || outcome === "add" || outcome === "take-upstream") {
        const theirs = await transformedBlob(row.target_blob, zone);
        if (theirs === null) throw new Error("target blob 不可读");
        if (!DRY) {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, theirs);
        }
        report.applied.push({ path: droraPath, action: outcome === "add" ? "add" : "take-theirs" });
      } else if (outcome === "text-clean-needs-semantic-review" || outcome === "text-conflict") {
        const base = await transformedBlob(row.base_blob, zone);
        const theirs = await transformedBlob(row.target_blob, zone);
        if (base === null || theirs === null || expectOurs === null) throw new Error("三方内容缺失");
        if (!isTransformableText(base) || !isTransformableText(theirs) || !isTransformableText(expectOurs)) {
          // 二进制不可文本合并：升决策，禁止产出带标记的损坏二进制。
          report.decisionRequired.push({ path: droraPath, outcome, note: "二进制三方合并需人工裁决" });
          continue;
        }
        // ours 侧用 git blob 内容而非磁盘内容：Windows CRLF 检出会让 merge-file
        // 把整文件判为行尾差异（P1-11 重放实证 text-clean 全量误判为冲突）。
        const merged = await mergeFile(base, expectOurs, theirs);
        if (!DRY) {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, merged.content);
        }
        if (merged.conflicts > 0) report.conflicts.push({ path: droraPath, hunks: merged.conflicts });
        else report.semanticReview.push(droraPath);
        report.applied.push({ path: droraPath, action: outcome, conflicts: merged.conflicts });
      } else if (outcome === "delete-review") {
        const base = await transformedBlob(row.base_blob, zone, droraPath);
        if (workBuf === null) {
          report.applied.push({ path: droraPath, action: "already-absent" });
        } else if (contentMatches(workBuf, base)) {
          if (!DRY) await fs.rm(abs, { force: true });
          report.applied.push({ path: droraPath, action: "delete" });
        } else {
          report.decisionRequired.push({ path: droraPath, outcome, note: "上游删除但本地有独有改动" });
        }
      } else if (outcome === "delete-local-change-review" || outcome === "zone-decision" || outcome === "already-present") {
        if (dec) {
          report.applied.push({ path: droraPath, action: `decision:${dec}` });
        } else {
          report.decisionRequired.push({ path: droraPath, outcome });
        }
      } else if (outcome === "lockfile-regenerate" || outcome === "already-deleted") {
        report.skipped.push(droraPath);
      } else {
        report.errors.push({ path: droraPath, reason: `未知结局 ${outcome}` });
      }
    } catch (error) {
      report.errors.push({ path: droraPath, reason: error.message });
    }
  }

  const outPath = REPORT ?? path.join("docs/upstream-sync/2026-10-31-v3.17.1/apply", `${SEGMENT}-report.json`);
  if (!DRY || REPORT) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(report, null, 1));
  }
  const sum = {
    segment: SEGMENT,
    rows: rows.length,
    applied: report.applied.length,
    conflicts: report.conflicts.length,
    semanticReview: report.semanticReview.length,
    decisionRequired: report.decisionRequired.length,
    driftBlocked: report.driftBlocked.length,
    skipped: report.skipped.length,
    errors: report.errors.length,
    dry: DRY,
    report: outPath,
  };
  console.log(JSON.stringify(sum, null, 1));
  if (report.errors.length || report.driftBlocked.length) process.exitCode = 2;
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
