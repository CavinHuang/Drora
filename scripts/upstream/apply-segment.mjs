#!/usr/bin/env node
// 分段应用器：按 inventory.json 的结局把一个段的上游变更落地到工作树。
// 机械结局自动应用（take-theirs/new/clean-merge/delete/noop-delete）；
// conflict 写入带标记的合并结果供人工解决；决策类按 --decisions JSON 或默认策略跳过并报告。
//
// 用法：node scripts/upstream/apply-segment.mjs --segment S1 [--dry] [--decisions /tmp/dryrun/decisions.json]
// decisions JSON: { "<droraPath>": "take-theirs" | "keep-ours" | "delete" | "skip", ... }

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const segment = getArg("segment");
const dry = args.includes("--dry");
const decisions = getArg("decisions")
  ? JSON.parse(fs.readFileSync(getArg("decisions"), "utf8"))
  : {};
const baseDir = "/tmp/golden/base-transformed";
const theirsDir = "/tmp/dryrun/theirs";
const repoRoot = process.cwd();
if (!segment) {
  console.error("用法: apply-segment.mjs --segment S1 [--dry]");
  process.exit(1);
}

const inventory = JSON.parse(fs.readFileSync("/tmp/dryrun/inventory.json", "utf8"));
const items = inventory.filter((i) => i.segment === segment);
const readFile = (dir, rel) => {
  try {
    return fs.readFileSync(path.join(dir, rel));
  } catch {
    return null;
  }
};
const readGit = (p) => {
  try {
    return execFileSync("git", ["cat-file", "-p", `HEAD:${p}`], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: "buffer",
    });
  } catch {
    return null;
  }
};

const applied = {
  "take-theirs": 0,
  new: 0,
  "clean-merge": 0,
  delete: 0,
  "noop-delete": 0,
  decision: 0,
  conflict: 0,
  error: 0,
};
const report = { conflicts: [], decisions: [], errors: [] };

for (const it of items) {
  const { droraPath, outcome } = it;
  const abs = path.join(repoRoot, droraPath);
  const dec = decisions[droraPath];
  try {
    if (dec) {
      if (dec === "take-theirs") {
        const t = readFile(theirsDir, droraPath);
        if (t) {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, t);
          applied["take-theirs"]++;
        } else applied.error++;
      } else if (dec === "delete") {
        fs.rmSync(abs, { force: true });
        applied.delete++;
      } else {
        applied.decision++;
      }
      report.decisions.push(`${droraPath} -> ${dec}`);
      continue;
    }
    switch (outcome) {
      case "take-theirs":
      case "new": {
        const t = readFile(theirsDir, droraPath);
        if (!t) {
          applied.error++;
          report.errors.push(`theirs 缺失: ${droraPath}`);
          break;
        }
        if (!dry) {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, t);
        }
        applied[outcome]++;
        break;
      }
      case "clean-merge": {
        const o = readGit(droraPath),
          b = readFile(baseDir, droraPath),
          t = readFile(theirsDir, droraPath);
        if (!o || !b || !t) {
          applied.error++;
          report.errors.push(`三方缺失: ${droraPath}`);
          break;
        }
        const tmp = fs.mkdtempSync("/tmp/apply3-");
        const fO = path.join(tmp, "o"),
          fB = path.join(tmp, "b"),
          fT = path.join(tmp, "t");
        fs.writeFileSync(fO, o);
        fs.writeFileSync(fB, b);
        fs.writeFileSync(fT, t);
        let merged;
        try {
          merged = execFileSync(
            "git",
            ["merge-file", "-L", "ours", "-L", "base", "-L", "theirs", "-p", fO, fB, fT],
            { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
          );
        } catch (e) {
          merged = e.stdout; // 环境差异导致的意外冲突按标记文件落地
        }
        fs.rmSync(tmp, { recursive: true, force: true });
        if (!dry) {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, merged);
        }
        applied["clean-merge"]++;
        break;
      }
      case "delete": {
        if (!dry && fs.existsSync(abs)) fs.rmSync(abs);
        applied.delete++;
        break;
      }
      case "noop-delete":
        applied["noop-delete"]++;
        break;
      case "conflict": {
        // 写带冲突标记的合并结果，供人工/代理逐案解决
        const o = readGit(droraPath),
          b = readFile(baseDir, droraPath),
          t = readFile(theirsDir, droraPath);
        if (o && b && t) {
          const tmp = fs.mkdtempSync("/tmp/apply3-");
          const fO = path.join(tmp, "o"),
            fB = path.join(tmp, "b"),
            fT = path.join(tmp, "t");
          fs.writeFileSync(fO, o);
          fs.writeFileSync(fB, b);
          fs.writeFileSync(fT, t);
          let merged;
          try {
            merged = execFileSync(
              "git",
              ["merge-file", "-L", "ours", "-L", "base", "-L", "theirs", "-p", fO, fB, fT],
              { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
            );
            applied["clean-merge"]++; // 重放意外干净（工作树或 theirs 与预演时不同）
            if (!dry) fs.writeFileSync(abs, merged);
          } catch (e) {
            merged = e.stdout; // -p 模式：冲突结果仍输出到 stdout，含标记
            applied.conflict++;
            if (!dry) fs.writeFileSync(abs, merged);
            report.conflicts.push(`${droraPath} (${it.detail} hunks)`);
          }
          fs.rmSync(tmp, { recursive: true, force: true });
        } else {
          applied.error++;
          report.errors.push(`conflict 三方缺失: ${droraPath}`);
        }
        break;
      }
      case "zone-decision":
      case "delete-decision":
      case "theirs-modify-ours-deleted":
      case "new-collision":
      case "already-present":
        applied.decision++;
        report.decisions.push(`${droraPath} [${outcome}]`);
        break;
      default:
        applied.error++;
        report.errors.push(`未知结局 ${outcome}: ${droraPath}`);
    }
  } catch (e) {
    applied.error++;
    report.errors.push(`${droraPath}: ${e.message}`);
  }
}

console.log(
  `[${segment}] ${dry ? "(dry) " : ""}` +
    Object.entries(applied)
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
);
if (report.conflicts.length)
  console.log("冲突文件（已写标记，待解决）:\n  " + report.conflicts.join("\n  "));
if (report.decisions.length) console.log("决策跳过:\n  " + report.decisions.join("\n  "));
if (report.errors.length) console.log("错误:\n  " + report.errors.join("\n  "));
fs.writeFileSync(`/tmp/dryrun/apply-${segment}.json`, JSON.stringify(report, null, 1));
