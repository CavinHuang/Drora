#!/usr/bin/env node
// 分段应用器：按 inventory.json 的结局把一个段的上游变更落地到工作树。
// 机械结局自动应用（take-theirs/new/clean-merge/delete/noop-delete）；
// conflict 写入带标记的合并结果供人工解决；决策类按 --decisions JSON 或默认策略跳过并报告。
//
// 用法：node scripts/upstream/apply-segment.mjs --segment S1 [--dry] [--decisions /tmp/dryrun/decisions.json]
// decisions JSON: { "<droraPath>": "take-theirs" | "keep-ours" | "delete" | "skip", ... }

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
// Windows 兼容修复：Node 下 "/tmp" 解析为当前盘根的 \tmp\，与 MSYS sh 实际写入的
// C:\Users\...\Temp（MSYS /tmp 真实位置）不一致——统一为 Windows 形态默认值（与 merge-dryrun.mjs 对齐）。
const TMP = "C:/Users/A/AppData/Local/Temp";
const baseDir = getArg("base-dir") ?? `${TMP}/dryrun/theirs`; // v3.18.2 战役：base=v3.18.0 变换树（dryrun/theirs），v3.17.2 旧树（golden/）退役
const theirsDir = getArg("theirs-dir") ?? `${TMP}/dryrun/theirs`;
const inventoryPath = getArg("inventory") ?? `${TMP}/dryrun/inventory.json`;
const repoRoot = process.cwd();
if (!segment) {
  console.error("用法: apply-segment.mjs --segment S1 [--dry]");
  process.exit(1);
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const items = inventory.filter((i) => i.segment === segment);
const readFile = (dir, rel) => {
  try {
    return fs.readFileSync(path.join(dir, rel));
  } catch {
    return null;
  }
};
// v3.18.2 增量战役修复：ours 优先读工作树（v3.18.0 战役成果未提交，HEAD 读会误判
// 为不存在/未改）。读文件失败（未跟踪新文件被删等）回退 HEAD blob。
const worktreeOurs = (p) => {
  try {
    return fs.readFileSync(path.join(repoRoot, p));
  } catch {
    return readGit(p);
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
// EOL 归一化（台账 18，与 merge-dryrun 同口径）：BOM 剥离 + CRLF→LF。
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
const normIfText = (buf) => (buf && isTextBuf(buf) ? normText(buf) : buf);

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
      case "keep-ours": {
        // v3.18.0 战役新增结局（merge-dryrun 归一化后出现：ours 与 theirs 内容等价）——保 ours 零动作。
        applied["keep-ours"] ??= 0;
        applied["keep-ours"]++;
        break;
      }
      case "clean-merge": {
        const o = worktreeOurs(droraPath),
          b = readFile(baseDir, droraPath),
          t = readFile(theirsDir, droraPath);
        if (!o || !b || !t) {
          applied.error++;
          report.errors.push(`三方缺失: ${droraPath}`);
          break;
        }
        // Windows 兼容：mkdtemp 走 os.tmpdir（"/tmp" 会落到当前盘根）。
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apply3-"));
        const fO = path.join(tmp, "o"),
          fB = path.join(tmp, "b"),
          fT = path.join(tmp, "t");
        // EOL 归一化修复（台账 18）：git blob（LF）与变换树（部分 CRLF）直接喂 merge-file 会整文件假冲突
        // 并落标记内容——S1 段曾 38 件全中；与 merge-dryrun 同口径先归一化再三方合并。
        fs.writeFileSync(fO, normIfText(o));
        fs.writeFileSync(fB, normIfText(b));
        fs.writeFileSync(fT, normIfText(t));
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
        const o = worktreeOurs(droraPath),
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
fs.writeFileSync(`${TMP}/dryrun/apply-${segment}.json`, JSON.stringify(report, null, 1));
