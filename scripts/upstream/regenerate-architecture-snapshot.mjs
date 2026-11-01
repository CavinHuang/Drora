#!/usr/bin/env node
// 按 U2 转换树重生成 scripts/architecture/upstream-snapshot.json（specs/upstream-v3.17.1-migration.md D07；
// 机制沿用 v3.16.1 S6 的 R5 白名单，见 specs/upstream-v3.16.1-migration.md「段执行补记」）。
//
// 已核实的既有语义（对 69daa438c 现行快照逐条验证：18221/18223 blob 与该提交树一致）：
//   files = 转换树路径集 ∩ 本仓 index，值取本仓 index 的 `mode blob`（冻结集成态，含冲突裁决
//   与 fmt 后内容，不是上游原始字节）；上一代快照中仍在 index 且未改动的非上游路径原样结转。
//   introduced = files ∩ 首次新增晚于 architecture-policy.yaml newFilesEnforcedSince 的路径。
// 之后对这些路径的任何编辑都会使 blob 失配、退出准入并回到 unmanaged-new-file 约束。
//
// 用法: node scripts/upstream/regenerate-architecture-snapshot.mjs [--upstream <sha>] [--tree <commit>] [--write]
//   --upstream 默认 a60ba6a7（U2，specs/upstream-v3.17.1-migration.md §2 固定）。
//   --tree 用指定提交树代替当前 index（用于复现旧快照做机制验证）。
//   不加 --write 只打印差异摘要（D07：官方文件快照与本仓 introduced 差异分别审计）。

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { transformContent, mapRelPath, zoneOf } from "./transform-upstream-tree.mjs";

const execFileAsync = promisify(execFile);
const cwd = process.cwd();

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const UPSTREAM = arg("upstream") ?? "a60ba6a7e5a06742270ca605f5d2cc2766afa7e1";
const TREE = arg("tree");
const WRITE = process.argv.includes("--write");
const SNAPSHOT_PATH = "scripts/architecture/upstream-snapshot.json";

// —— 与 transform-upstream-tree.mjs transformTree 的分类逻辑逐字对齐（未导出，原地复制；
// 源文件为唯一权威，改动须先改 specs/drora-rename.md 再同步两处）——
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".icns",
  ".webp",
  ".avif",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".node",
  ".dll",
  ".dylib",
  ".so",
  ".exe",
  ".bin",
  ".wasm",
  ".zip",
  ".gz",
  ".tgz",
  ".7z",
  ".tar",
  ".br",
  ".xz",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".aac",
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".jar",
  ".class",
  ".pkl",
  ".onnx",
]);
function isTransformableText(buf, filename) {
  if (BINARY_EXT.has(path.extname(filename).toLowerCase())) return false;
  for (const b of buf.subarray(0, 4096)) if (b === 0) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return false;
  }
  return true;
}

const gitBlobSha = (buf) =>
  createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

// 1) 上游树清单 → 转换树路径集 + 转换后内容的 git blob SHA（内容比对仅用于审计报告）
const lsTree = await execFileAsync("git", ["ls-tree", "-r", "-z", UPSTREAM], {
  cwd,
  maxBuffer: 256 * 1024 * 1024,
});
const upstreamEntries = [];
for (const record of lsTree.stdout.split("\0")) {
  if (!record) continue;
  const info = record.slice(0, record.indexOf("\t"));
  const rel = record.slice(record.indexOf("\t") + 1);
  const [mode, type, oid] = info.split(" ");
  // transformTree 只走 readdirSync 的 isFile；symlink/gitlink 不进转换树，保持一致跳过。
  if (type !== "blob") continue;
  upstreamEntries.push({ mode, oid, rel });
}

const converted = new Map(); // mappedPath -> { contentSha }
const needsRead = [];
for (const entry of upstreamEntries) {
  const zone = zoneOf(entry.rel);
  const binaryExt = BINARY_EXT.has(path.extname(entry.rel).toLowerCase());
  const mapped = zone === "cua-limited" ? entry.rel : mapRelPath(entry.rel);
  if (converted.has(mapped)) throw new Error(`转换路径冲突: ${mapped}`);
  if (zone === "verbatim" || binaryExt) converted.set(mapped, { contentSha: entry.oid });
  else {
    converted.set(mapped, {});
    needsRead.push({ ...entry, zone, mapped });
  }
}

const child = spawn("git", ["cat-file", "--batch"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
const stdoutChunks = [];
let stdoutLen = 0;
let stderrText = "";
child.stdout.on("data", (c) => {
  stdoutChunks.push(c);
  stdoutLen += c.length;
});
child.stderr.on("data", (c) => {
  stderrText += c.toString("utf8");
});
const feed = `${needsRead.map((e) => e.oid).join("\n")}\n`;
child.stdin.write(feed);
child.stdin.end();
await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code, signal) =>
    code === 0
      ? resolve()
      : reject(new Error(`git cat-file --batch failed (${signal ?? code}): ${stderrText}`)),
  );
});
const stdoutBuf = Buffer.concat(stdoutChunks, stdoutLen);
let cursor = 0;
const oidToContent = new Map();
let parsedRecords = 0;
while (cursor < stdoutBuf.length) {
  const headerEnd = stdoutBuf.indexOf(0x0a, cursor);
  if (headerEnd < 0) break;
  const header = stdoutBuf.subarray(cursor, headerEnd).toString("utf8");
  cursor = headerEnd + 1;
  const [oid, type, sizeText] = header.split(" ");
  if (!oid || !type || type === "missing") throw new Error(`cat-file 缺对象: ${header}`);
  const size = Number(sizeText);
  const content = stdoutBuf.subarray(cursor, cursor + size);
  cursor += size + 1;
  oidToContent.set(oid, content);
  parsedRecords += 1;
}
// 请求行数=输出记录数；Map 以 oid 去重（空文件/相同内容多路径共享 blob）。
if (parsedRecords !== needsRead.length) {
  throw new Error(`blob 读取不完整: ${parsedRecords}/${needsRead.length}`);
}
for (const { oid, zone, mapped } of needsRead) {
  const buf = oidToContent.get(oid);
  let out;
  if (isTransformableText(buf, mapped)) {
    if (zone === "normal") out = Buffer.from(transformContent(buf.toString("utf8")), "utf8");
    else out = Buffer.from(buf.toString("utf8").replaceAll("@zcode/", "@drora/"), "utf8");
  } else {
    out = buf; // NUL/非 UTF-8 文本 → 逐字保留（与 transformTree 的 binary 分支一致）
  }
  converted.get(mapped).contentSha = gitBlobSha(out);
}

// 2) 本仓文件清单（index stage-0，或 --tree 指定提交树）
const indexEntries = new Map(); // path -> `mode blob`
if (TREE) {
  const { stdout } = await execFileAsync("git", ["ls-tree", "-r", "-z", TREE], {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
  });
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const info = record.slice(0, record.indexOf("\t"));
    const file = record.slice(record.indexOf("\t") + 1);
    const [mode, , oid] = info.split(" ");
    indexEntries.set(file, `${mode} ${oid}`);
  }
} else {
  const { stdout } = await execFileAsync("git", ["ls-files", "--stage", "-z"], {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
  });
  for (const record of stdout.split("\0")) {
    if (!record) continue;
    const separator = record.indexOf("\t");
    const file = record.slice(separator + 1);
    const [mode, blob, stage] = record.slice(0, separator).split(" ");
    if (stage !== "0") continue;
    indexEntries.set(file, `${mode} ${blob}`);
  }
}

// 3) files = 转换树路径 ∩ 本仓清单（本仓 blob）+ 上一代快照未改动条目结转
const previous = JSON.parse(await readFile(path.join(cwd, SNAPSHOT_PATH), "utf8"));
const prevFiles = new Map(Object.entries(previous.files));
const files = {};
const carryOver = [];
for (const [file, entry] of indexEntries) {
  if (converted.has(file)) files[file] = entry;
  else if (prevFiles.get(file) === entry) {
    files[file] = entry;
    carryOver.push(file);
  }
}

// 4) introduced = 上一代 introduced 的保留面 ∪ 本轮段提交新增面（对 69daa438c 现行快照反推核实：
//    旧 introduced 1655/1700 的首增提交全部是 v3.16.1 段提交 S1–S6，不是「近期新增的全集」；
//    段外自研提交新增的路径不得经本白名单洗白——D07）。S6/S7 提交尚未产生且经核实工作区无
//    packages/apps 新增源文件，不影响 unmanaged-new-file 候选集。
const SEGMENT_COMMITS = [
  "2b7cbad62", // S1 根配置与共享协议
  "bff94f4bd", // S2 CLI 与运行时
  "821b68f5b", // S3 服务、存储与远端
  "1376aa9a2", // S4 桌面
  "40f36cc09", // S5 UI、Web 与手机
];
const segAdded = new Set();
for (const commit of SEGMENT_COMMITS) {
  const { stdout } = await execFileAsync(
    "git",
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "--diff-filter=A", commit],
    { cwd, maxBuffer: 256 * 1024 * 1024 },
  );
  for (const file of stdout.split("\0")) if (file) segAdded.add(file);
}
const prevIntroduced = new Set(previous.introduced);
const introduced = Object.keys(files)
  .filter((file) => prevIntroduced.has(file) || segAdded.has(file))
  .sort();

// 5) D07 差异审计摘要：官方快照路径增删、introduced 增删、内容与转换树分叉的路径（仅报告）
const upstreamPathsAdded = [...converted.keys()].filter((f) => files[f] && !prevFiles.has(f));
const upstreamPathsDropped = [...prevFiles.keys()].filter(
  (f) => !converted.has(f) && !carryOver.includes(f),
);
const introducedAdded = introduced.filter((f) => !prevIntroduced.has(f));
const introducedDropped = [...prevIntroduced].filter((f) => !introduced.includes(f));
const divergent = Object.keys(files).filter(
  (f) => converted.has(f) && converted.get(f).contentSha !== files[f].split(" ")[1],
);

const summary = {
  upstream: UPSTREAM,
  index: TREE ?? "index",
  upstreamFiles: upstreamEntries.length,
  convertedPaths: converted.size,
  indexFiles: indexEntries.size,
  filesEntries: Object.keys(files).length,
  introducedEntries: introduced.length,
  previous: { files: prevFiles.size, introduced: previous.introduced.length },
  diff: {
    upstreamPathsAdded: upstreamPathsAdded.length,
    upstreamPathsDropped: upstreamPathsDropped.length,
    carryOverFromPrevious: carryOver.length,
    introducedAdded: introducedAdded.length,
    introducedDropped: introducedDropped.length,
    contentDivergentFromConvertedUpstream: divergent.length,
  },
  carryOverFromPrevious: carryOver,
  upstreamPathsDroppedSample: upstreamPathsDropped.slice(0, 20),
  introducedDropped: introducedDropped,
  introducedAdded,
  // 段提交新增但未进白名单的路径（Drora 自研挂载点或上游已删路径）——这些是
  // unmanaged-new-file 可能继续命中的残留，需 architecture-policy 例外或模块登记承接。
  segAddedNotAdmitted: [...segAdded].filter((f) => !files[f]).sort(),
};
console.log(JSON.stringify(summary, null, 2));

if (WRITE) {
  // 显式排序键：JS 对象会把纯数字键前置，git 路径序不能直接当 JSON 键序。
  const sortedFiles = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((k) => [k, files[k]]),
  );
  const payload = { version: 1, files: sortedFiles, historicalFiles: {}, introduced };
  await writeFile(path.join(cwd, SNAPSHOT_PATH), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`written: ${SNAPSHOT_PATH}`);
}
