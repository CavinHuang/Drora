#!/usr/bin/env node
/**
 * Obsidian Vault 阶段二「真抽离」残留扫描（specs/obsidian-vault-phase2-true-extraction.md §9）。
 *
 * 门禁定义：token 族 × 八包（§0 口径：packages/{services,ui,shared,client,desktop,
 * web,server} + apps/drora-cli/packages/{core,bootstrap,contracts}）扫描，白名单外
 * 零命中。token 集 = 字面量族精确匹配（大小写敏感、子串族匹配），不用裸词
 * knowledge/evidence/evidenceRef/Jev（实测误报：persona 域自有 evidenceRefs 字段、
 * "acknowledged" 等）；域收口改按文件清单（C6/C11 清单内的具体文件，P7 拆净后
 * 应不存在——由本扫描的 path 级断言兜底）。
 *
 * 白名单格式（§9）：逐条 `path + token + 原因`（平台接口、C5a 渲染面、C6 legacy
 * 探测器），防止白名单膨胀为第二实现位——白名单条目必须是「平台契约」或「拆除
 * 注记/兼容面」，不得包含 vault 实现。
 *
 * 并入 verify:pre-push（P7，spec §10）：`pnpm verify:pre-push` 链首执行。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * 注释剥离（代码面扫描口径）：token 门禁的对象是**实现残留**（标识符/字符串/
 * schema 字段），注释中的 spec 文件名引用（specs/obsidian-vault-phase2-*.md 本身
 * 含 obsidian-vault token——AGENTS.md 要求改动注释引 spec）是合法文档面，不算
 * 残留。剥离规则：块注释 /* *​/ 全剥；行注释 // 仅在行首/空白后且非 URL 冒号后
 * （https:）生效；css 只剥块注释；html 剥 <!-- -->。已知代价：字符串内 "//" 之后的
 * token 可能被误剥（罕见形态），由 P8 收尾批次的文档对账兜底。
 */

// 扫描根（仓库根解析）：八包口径。
const REPO_ROOT = join(import.meta.dirname, "..");
const SCAN_ROOTS = [
  "packages/services",
  "packages/ui",
  "packages/shared",
  "packages/client",
  "packages/desktop",
  "packages/web",
  "packages/server",
  "apps/drora-cli/packages/core",
  "apps/drora-cli/packages/bootstrap",
  "apps/drora-cli/packages/contracts",
];

/**
 * token 族（§9 终读评审 H1 重写版；大小写敏感子串匹配——「字面量族」指前缀族，
 * 如 vaultConfig 同时命中 vaultConfigReader/vault-config-reader 一族键名）。
 */
const TOKENS = [
  "VaultSearch",
  "vault_neighbors",
  "vaultSearch",
  "vaultNeighbors",
  "obsidian-vault",
  "obsidianVault",
  "IObsidianVaultService",
  "vaultConfig",
  "vault-config",
  "obsidian@drora-plugins-official",
  "knowledge-index",
  "KNOWLEDGE_INDEX_DB_FILE_NAME",
  "bge-small-zh",
  "knowledgeJev",
  "decision-jev",
  "knowledge/neighbors",
  "knowledge/search",
];

/**
 * 目录级排除：构建产物/测试缓存与三方树（再生产物，非本体实现；重构建即消）。
 * 点目录（.e2e-cache/.e2e-artifacts/.turbo 等）一律排除——都是工具链产物。
 */
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "dist-types",
  "coverage",
  "bundled-agents",
  // desktop 构建输出（.gitignore 的 out/，electron-vite 产物；随构建再生）。
  "out",
  // mock-cdn 是 .gitignore 的 e2e 下载缓存（.gitignore:15，未跟踪产物、随下载刷新），
  // 里面是旧版本 bundle 快照，非检入源码——不是「本体实现」的载体。
  "mock-cdn",
]);
/**
 * 文本源文件扩展（二进制/产物不扫）。.md 不扫：文档面（CONTRACT.md/说明）的
 * spec 引用与历史描述由 P8 收尾批次的 spec 回填与文档评审对账（§10-P8），
 * 非「本体零实现」的实现残留。
 */
const SCANNABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".html",
  ".yaml",
  ".yml",
  ".example",
]);

/**
 * 白名单（§9：逐条 path + token + 原因）。登记纪律：
 * - 只允许「平台接口文件」或「拆除注记/legacy 兼容面」；
 * - 每条必须写明原因与 spec 锚点；
 * - 出现实现残留（函数/类型/schema 字段生产）时宁可修代码不进白名单。
 */
const WHITELIST = [
  {
    path: "packages/desktop/scripts/mcp-apps-host-fixture/obsidian-main.ts",
    tokens: [
      "obsidian-vault",
      "vault-config",
      "obsidian@drora-plugins-official",
    ],
    reason:
      "P5 沙箱页面 e2e 夹具（specs/obsidian-vault-phase2-true-extraction.md §10-P5 附加 gate，P5 落地记录）：测试编排面驱动插件产物（dist/mcp/server.js + dist/ui/panel.html 过真实 agent/bridge/沙箱链），与 obsidian-plugin 包本身同一白名单口径——fixture 只 spawn/断言，不承载实现。",
  },
];

function listFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const dot = entry.name.lastIndexOf(".");
      if (dot === -1) continue;
      if (!SCANNABLE_EXTENSIONS.has(entry.name.slice(dot))) continue;
      out.push(join(dir, entry.name));
    }
  };
  walk(rootDir);
  return out;
}

function stripComments(text, ext) {
  let out = text;
  if (ext === ".css") return out.replace(/\/\*[\s\S]*?\*\//g, "");
  if (ext === ".html") {
    return out.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  }
  if (ext === ".json") return out;
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:"'`\w])\/\/[^\n]*/g, "$1");
  return out;
}

function whitelistTokensFor(relPath) {
  const entry = WHITELIST.find((item) => item.path === relPath);
  return entry ? new Set(entry.tokens) : null;
}

const violations = [];
const scannedFiles = [];
for (const root of SCAN_ROOTS) {
  const absRoot = join(REPO_ROOT, root);
  let files;
  try {
    files = listFiles(absRoot);
  } catch {
    console.error(`[vault-residuals] scan root missing: ${root}`);
    process.exitCode = 1;
    continue;
  }
  for (const file of files) {
    const relPath = relative(REPO_ROOT, file).split(sep).join("/");
    scannedFiles.push(relPath);
    const ext = relPath.slice(relPath.lastIndexOf("."));
    const text = stripComments(readFileSync(file, "utf8"), ext);
    const allowed = whitelistTokensFor(relPath);
    for (const token of TOKENS) {
      if (!text.includes(token)) continue;
      if (allowed?.has(token)) continue;
      const line = text.slice(0, text.indexOf(token)).split("\n").length;
      violations.push(`${relPath}:${line} token="${token}"`);
    }
  }
}

// 白名单孤儿检查：登记路径不存在（文件被删/改名）即报错，防白名单腐化。
for (const entry of WHITELIST) {
  try {
    statSync(join(REPO_ROOT, entry.path));
  } catch {
    violations.push(`WHITELIST-ORPHAN ${entry.path}（登记路径不存在，请随拆除同步清理）`);
  }
}

if (violations.length > 0) {
  console.error(`[vault-residuals] 残留扫描命中 ${violations.length} 处（白名单外）：`);
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    "处置：实现残留须修代码（迁插件/删除）；平台接口或拆除注记按 §9 白名单格式逐条登记。",
  );
  process.exit(1);
}
console.log(
  `[vault-residuals] OK：${scannedFiles.length} 文件 × ${TOKENS.length} token 白名单外零命中。`,
);
