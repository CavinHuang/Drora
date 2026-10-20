#!/usr/bin/env node
// 上游树正向改名转换：zcode 命名空间 → drora 命名空间。
// 规则唯一权威：specs/drora-rename.md（有序替换表 + 豁免区 + 占位保护）；
// 占位保护清单还固化了 v3.15.1 集成产品树（780721e7）逐案核对的 wire 契约
// （docs/upstream/zcode-v3.16.1-golden.md 记录依据）。
// 供 v3.16.1 分段合并（specs/upstream-v3.16.1-migration.md）做逐文件三方合并的 base/theirs 预处理。
//
// 用法：node scripts/upstream/transform-upstream-tree.mjs --ref <git-ref> --out <dir> [--quiet]
// 也被 merge-dryrun.mjs import（mapRelPath / zones）。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// —— 规则 0 占位保护：外部 z.ai 基础设施 / wire 契约 / 官方锚点，改名即失效或篡改语义。
export const PLACEHOLDERS = [
  "cdn-zcode.z.ai",
  "zcode.z.ai",
  "zcode\\.z\\.ai", // 正则转义形态（config/provider 模板）
  "zcode/electron/releases", // 官方桶对象目录（HEAD 11d92f9be 专门保留 zcode/ 形态）
  "/zcode/official-plugin/",
  "zcode://",
  "zcode:/",
  "x-scheme-handler/zcode",
  "x-zcode-trace-id",
  "X-Zcode-Trace-Id",
  "X-Zcode-Trace-ID",
  "x-zcode-session-type",
  "X-Zcode-Session-Type",
  "x-zcode-bot-secret",
  "X-ZCode-Mobile-Connection-Id",
  "x-zcode-mobile-connection-id",
  "X-Zcode-App-Version",
  "x-zcode-app-version",
  "x-zcode-rpc-host-capability",
  "x-zcode-rpc-client-mode",
  "x-zcode-query-source",
  "X-Zcode-Query-Source",
  "x-zcode-channel",
  "x-zcode-agent",
  "X-Zcode-Agent",
  "x-zcode-intranet-token",
  "application/x-zcode-workspace-file",
  "application/x-zcode-session",
  // z.ai 后端 API 路径保留官方形态（服务端路由）；品牌叙述/本地路径随规则改名。
  "/api/v1/zcode-plan",
  "zcode-plan/anthropic",
  "zcode_type",
  "zcode/csp",
  // 官方通道别名前缀（托管手机页按官方通道名调用）。
  '"zcode-"',
  // 双 scheme 注册字面量与还原区导出的标识符（packages/zcode-cua 区仅换 scope，符号原名跨区引用）。
  '"zcode", "drora"',
  '"drora", "zcode"',
  "zcode|drora",
  "isPotentialZCodeCuaAgentMcpServer",
  "isAuthorizedOfficialZCodeCuaPluginServer",
  "omitUnbrokeredZCodeCuaAgentMcpServers",
  // 官方仓库/发行物锚点。
  "dev.zcode.app",
  "zai-org/ZCode",
  "zai-org/zcode",
  // 规则 3 的 lookahead 只保护「.zcode→.drora」这一步；兜底规则 8 仍会吃掉
  // .zcode-plugin 内的 zcode（specs/drora-rename.md 记录过的教训），显式占位。
  ".zcode-plugin",
  ".zcode-plugin-seed.json",
  // zcode-cua 双上下文：身份上下文改名（@drora/drora-cua、drora-cua@marketplace、
  // mcp__plugin_drora-cua_*）→ 规则 8b；路径/仓库/协议上下文保留 → 此处占位。
  "packages/zcode-cua",
  "zcode-cua-plugin",
  "zcode-cua-helper",
  "zcode-cua.git",
  "aminer.cn/codegeex/zcode-cua",
  "assets/zcode-cua/", // 官方 CDN 资产子路径（official-plugin/assets/zcode-cua/…）；
  // 注意不能写成 /zcode-cua/——会拦截 import specifier（@zcode/zcode-cua/xxx）里的 8b 规则，
  // 产出 @drora/zcode-cua 半形态（核查一发现的缺陷）
  "bump-zcode-cua-producer",
  "sync-skill-from-zcode-cua",
  "zcode-cua-windows-dev",
];
const APPID_RE = /appId:\s*(["'])zcode\1/g;

// —— 豁免区（内容逐字不动；upstream 命名空间下的路径前缀）。
export const VERBATIM_PREFIXES = [
  "apps/zcode-cli/packages/zcode-cua-plugin/", // 0.5.13 逐字 seed（producer 脚本一并豁免）
  "third-party/", // provenance
  "pnpm-lock.yaml",
  "package-lock.json",
  "apps/zcode-cli/pnpm-lock.yaml",
  "THIRD-PARTY-NOTICES.md",
];
// —— CUA 还原权威区：仅 @zcode/ scope 替换，其余逐字（含 broker/身份串/官方锚点）。
export const CUA_LIMITED_PREFIXES = ["packages/zcode-cua/", "packages/zcode-cua-helper/"];
// —— 路径段豁免：zcode-cua* 目录/文件名保留原名（与其豁免身份一致）。
const SEGMENT_PREFIX_KEEP = ["zcode-cua"];

const SENTINEL = "\x00ZP";
// 哨兵以 "!" 结界（不在 base64url 字母表内），防止还原时的贪婪匹配吞掉哨兵后的原文。
const protect = (s) => {
  let out = s;
  // appId: "zcode" 整体保护（服务端注册值）
  out = out.replace(APPID_RE, (m) => `${SENTINEL}${Buffer.from(m).toString("base64url")}!`);
  for (const p of PLACEHOLDERS) {
    out = out.split(p).join(`${SENTINEL}${Buffer.from(p).toString("base64url")}!`);
  }
  return out;
};
const unprotect = (s) =>
  s.replace(new RegExp(`${SENTINEL}([A-Za-z0-9_-]+)!`, "g"), (_, b64) =>
    Buffer.from(b64, "base64url").toString("utf8"),
  );

// 有序替换表（specs/drora-rename.md 规则 1–8 + 8b CUA 身份上下文）。
const applyRules = (s) =>
  s
    .replaceAll("@zcode/", "@drora/") // 1 包 scope
    .replaceAll("ZCODE_", "DRORA_") // 2 环境变量（ZCODE_HOME 等兼容键已占位）
    .replace(/\.zcode(?!-plugin)/g, ".drora") // 3 数据目录（.zcode-plugin* 保留）
    .replaceAll("ZCode", "Drora") // 4 品牌显示词
    .replaceAll("ZCODE", "DRORA") // 5 剩余全大写
    .replaceAll("Zcode", "Drora") // 6 标题式变体
    .replaceAll("z-code", "drora") // 7 连字变体
    .replaceAll("zcode-cua", "drora-cua") // 8b CUA 身份上下文（路径/仓库上下文已占位保护）
    .replaceAll("zcode", "drora"); // 8 兜底小写

export const transformContent = (s) => unprotect(applyRules(protect(s)));
export const mapRelPath = (rel) =>
  rel
    .split("/")
    .map((seg) =>
      SEGMENT_PREFIX_KEEP.some((p) => seg.startsWith(p)) ? seg : transformContent(seg),
    )
    .join("/");

export const zoneOf = (rel) =>
  VERBATIM_PREFIXES.some((p) => rel === p || rel.startsWith(p))
    ? "verbatim"
    : CUA_LIMITED_PREFIXES.some((p) => rel === p || rel.startsWith(p))
      ? "cua-limited"
      : "normal";

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

const isTransformableText = (buf, filename) => {
  if (BINARY_EXT.has(path.extname(filename).toLowerCase())) return false;
  // NUL 字节 → 二进制
  for (const b of buf.subarray(0, 4096)) if (b === 0) return false;
  // 严格 UTF-8 解码失败（如 GB2312 夹具）→ 按二进制逐字保留，防止重编码损坏
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return false;
  }
  return true;
};

export function transformTree(ref, outDir) {
  const tmpExtract = fs.mkdtempSync("/tmp/upstream-extract-");
  const tarPath = path.join(tmpExtract, "tree.tar");
  execFileSync("sh", ["-c", `git archive '${ref}' > '${tarPath}'`], {
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-f", tarPath, "-C", tmpExtract]);
  fs.rmSync(tarPath);

  const stats = { total: 0, content: 0, verbatim: 0, cuaLimited: 0, binary: 0, pathRenamed: 0 };
  const walk = (dir, relPrefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      stats.total++;
      const zone = zoneOf(rel);
      const buf = fs.readFileSync(abs);
      let outContent = buf;
      if (isTransformableText(buf, entry.name)) {
        if (zone === "normal") {
          outContent = Buffer.from(transformContent(buf.toString("utf8")), "utf8");
          stats.content++;
        } else if (zone === "cua-limited") {
          // 仅规则 1：@zcode/ scope（specs/drora-rename.md 豁免区 2）
          outContent = Buffer.from(buf.toString("utf8").replaceAll("@zcode/", "@drora/"), "utf8");
          stats.cuaLimited++;
        } else {
          stats.verbatim++;
        }
      } else {
        stats.binary++;
      }
      const outRel = zone === "cua-limited" ? rel : mapRelPath(rel);
      if (outRel !== rel) stats.pathRenamed++;
      const outAbs = path.join(outDir, outRel);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, outContent);
    }
  };
  walk(tmpExtract, "");
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  return stats;
}

// —— CLI 入口（被 import 时不执行）——
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const ref = getArg("ref") ?? "upstream/main";
  const outDir = getArg("out");
  const quiet = args.includes("--quiet");
  if (!outDir) {
    console.error("用法: transform-upstream-tree.mjs --ref <git-ref> --out <dir>");
    process.exit(1);
  }
  const stats = transformTree(ref, outDir);
  if (!quiet) {
    console.error(
      `[transform] ref=${ref} -> ${outDir}: total=${stats.total} content=${stats.content} ` +
        `cuaLimited=${stats.cuaLimited} verbatim=${stats.verbatim} binary=${stats.binary} pathRenamed=${stats.pathRenamed}`,
    );
  }
}
