#!/usr/bin/env node

// 桌面打包态的 agent 运行时资产：把 agent 的 JS bundle（drora.cjs）放进 bundled-agents/<platform>/glm，
// 由 app 内置的 Electron Node runtime（ELECTRON_RUN_AS_NODE）执行，替代以前随包内置的独立 Node 二进制。
//
// 为什么这么做：
// - agent 没有任何原生 NAPI 插件（ripgrep 是 WASM，其余纯 JS），可直接跑在 Electron 的 Node 上；
// - Electron 41 内置 Node 24.x，与 drora-cli 的目标运行时一致；
// - 单平台体积从 ~180MB 降到 ~16MB，且同一份 JS 跨平台通用；
// - app-server 命令路径不会加载 @drora/tui，所以这里天然不打包 TUI。
//
// 远端（SSH/WSL/Docker）没有 Electron，仍走 prepare:remote-assets 的原生二进制，互不影响。

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { access, cp, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCommand } from "../../../scripts/spawn-command.mjs";
import { stageAgentBundle } from "./stage-agent-bundle.mjs";
import { stageSharpIntoBundledAgents } from "./sharp-package-assets.mjs";
import { stageKoffiIntoBundledAgents } from "./koffi-package-assets.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const cliBundlePath = resolve(repoRoot, "apps/drora-cli/packages/cli/dist/drora.cjs");
const adaptersRoot = resolve(repoRoot, "apps/drora-cli/packages/adapters");
const pnpmRunEnv = {
  ...process.env,
  // pnpm 11 会在 apps/drora-cli 子 workspace 执行 run 前触发 install；
  // 子 workspace 不能解析根 workspace 的 @drora/shared，Docker/web app 打包会因此卡在插件 runtime 构建。
  PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
};
const BROWSER_USE_PLUGIN_PACKAGE_NAME = "@drora/browser-use-plugin";

// 平台目录命名：darwin/win32/linux + x64/arm64，
// 支持 DRORA_TARGET_OS / DRORA_TARGET_ARCH 覆盖（交叉打包时由 CI 注入）。
function normalizePlatform(raw) {
  switch (raw) {
    case "mac":
    case "macos":
    case "darwin":
    case "osx":
      return "darwin";
    case "win":
    case "windows":
    case "win32":
      return "win32";
    case "linux":
      return "linux";
    default:
      return raw;
  }
}

function normalizeArch(raw) {
  switch (raw) {
    case "x86_64":
    case "x64":
    case "amd64":
      return "x64";
    case "aarch64":
    case "arm64":
      return "arm64";
    default:
      return raw;
  }
}

const platform = normalizePlatform(process.env.DRORA_TARGET_OS || "") || process.platform;
const arch = normalizeArch(process.env.DRORA_TARGET_ARCH || "") || process.arch;
const platformKey = `${platform}-${arch}`;

const glmDir = resolve(desktopRoot, "bundled-agents", platformKey, "glm");
// drora.cjs / .node-bundle-meta.json 的落点由 stage-agent-bundle.mjs 自己解析（同源）。
// node_repl 宿主抽成独立包
// @drora/node-repl-host 之后，browser-use 不再产出 dist/mcp/server.js，CUA 资产
// （docs/computer-use.md、scripts/computer-use-client.mjs）也已归 @drora/drora-cua-plugin。
// 这份清单当时漏改，打包准备阶段照旧去 browser-use 要那三个文件，直接 missing runtime 挂掉。
// dev 链路走的是 scripts/build-desktop-agent-cli.mjs 的 requiredDevPluginRuntimeBuilds（那份改对了），
// 两份平行清单各自维护，所以 dev 测不出来 —— 权威归属见 bootstrap/official-plugin-definitions.ts。
const browserUseRequiredRuntimePaths = [
  "scripts/browser-client.mjs",
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  // documents.json 已暴露 recording lookup，桌面安装包不能复用缺少正文的 runtime。
  "docs/recording.md",
  "docs/workflow.md",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
];
const officialPluginPackages = [
  {
    // browser-use 只携带自己的 client script 与 skill/docs；node_repl MCP runtime 归
    // @drora/node-repl-host（见上方常量注释）。
    packageName: "@drora/browser-use-plugin",
    relativePath: "apps/drora-cli/packages/browser-use-plugin",
    requiresRuntime: true,
    requiredRuntimePaths: browserUseRequiredRuntimePaths,
    runtimeBuildScript: "scripts/build.mjs",
    // 官方 0.5.1 发行物随包携带 node_modules sharp 运行时（截图/缩放链）。
    // 打包期 node_modules 不从源目录复制（源 node_modules 混 pnpm 开发依赖，且入库基线为
    // win32 平台集），改由 stager 按目标平台重产（见 stageOfficialPlugins），与官方发行物同形态。
    // bootstrap 注册表侧的 runtimeTopLevelPaths 子树仅服务 dev filesystem seed。
    stagedNativeRuntimes: ["sharp"],
    stagedPath: "packages/browser-use-plugin",
  },

  {
    // node_repl 宿主：Browser Use 与 Computer Use 共用的 MCP runtime，本轮抽成独立包。
    // 它没有 listing（不进插件市场展示面），但生产包首启 seed 必须拿到它的 dist runtime，
    // 否则 bua/cua 任一开启时都会连不上 node_repl。
    packageName: "@drora/node-repl-host",
    relativePath: "apps/drora-cli/packages/node-repl-host",
    requiresRuntime: true,
    requiredRuntimePaths: ["dist/mcp/server.js"],
    runtimeBuildScript: "scripts/build.mjs",
    // 宿主 bundle externalize sharp，随包 node_modules 由打包期按目标平台 staging；
    // dev 态解析走仓库根 hoisted sharp（desktop devDep）。
    stagedNativeRuntimes: ["sharp"],
    stagedPath: "packages/node-repl-host",
  },

  // 以下内容型 / 预编译插件不带可构建 runtime（dist 即分发产物），只需原样 stage，
  // requiredSeedPaths 与 bootstrap/official-plugin-definitions.ts 的声明保持一致，
  // 缺文件时在打包阶段就报错，而不是装出一个残缺插件。
  {
    packageName: "@drora/documents-plugin",
    relativePath: "apps/drora-cli/packages/documents-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/docx/SKILL.md"],
    stagedPath: "packages/documents-plugin",
  },
  {
    packageName: "@drora/pdf-plugin",
    relativePath: "apps/drora-cli/packages/pdf-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/pdf/SKILL.md"],
    stagedPath: "packages/pdf-plugin",
  },
  {
    packageName: "@drora/presentations-plugin",
    relativePath: "apps/drora-cli/packages/presentations-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/pptx/SKILL.md"],
    stagedPath: "packages/presentations-plugin",
  },
  {
    packageName: "@drora/spreadsheets-plugin",
    relativePath: "apps/drora-cli/packages/spreadsheets-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["agents/visual-judge.md", "skills/xlsx/SKILL.md"],
    stagedPath: "packages/spreadsheets-plugin",
  },
  {
    packageName: "@drora/image-search-plugin",
    relativePath: "apps/drora-cli/packages/image-search-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [".mcp.json"],
    stagedPath: "packages/image-search-plugin",
  },
  {
    packageName: "@drora/android-emulator-plugin",
    relativePath: "apps/drora-cli/packages/android-emulator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["dist/mcp/server.js"],
    stagedPath: "packages/android-emulator-plugin",
  },
  {
    packageName: "@drora/ios-simulator-plugin",
    relativePath: "apps/drora-cli/packages/ios-simulator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["dist/mcp/server.js"],
    stagedPath: "packages/ios-simulator-plugin",
  },
  {
    packageName: "@drora/obsidian-plugin",
    relativePath: "apps/drora-cli/packages/obsidian-plugin",
    requiresRuntime: false,
    // dist runtime 与 skill 正文是同一发布单元，缺任一项打包期即报错。
    requiredSeedPaths: ["dist/mcp/server.js", "skills/obsidian/SKILL.md"],
    stagedPath: "packages/obsidian-plugin",
  },
  {
    packageName: "@drora/restore-legacy-sessions-plugin",
    relativePath: "apps/drora-cli/packages/restore-legacy-sessions-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/restore-legacy-sessions/SKILL.md"],
    stagedPath: "packages/restore-legacy-sessions-plugin",
  },
  {
    packageName: "@drora/plugin-creator-plugin",
    relativePath: "apps/drora-cli/packages/plugin-creator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [
      "skills/plugin-creator/SKILL.md",
      "skills/plugin-creator/scripts/create-basic-plugin.mjs",
      "skills/plugin-creator/scripts/marketplace-files.mjs",
      "skills/plugin-creator/scripts/upsert-dev-marketplace.mjs",
      "skills/plugin-creator/scripts/scaffold-files.mjs",
      "skills/plugin-creator/scripts/validate-plugin.mjs",
      "skills/plugin-creator/references/plugin-json-spec.md",
      "skills/plugin-creator/references/installing-and-updating.md",
    ],
    stagedPath: "packages/plugin-creator-plugin",
  },
  {
    packageName: "@drora/skill-creator-plugin",
    relativePath: "apps/drora-cli/packages/skill-creator-plugin",
    requiresRuntime: false,
    requiredSeedPaths: ["skills/skill-creator/SKILL.md"],
    stagedPath: "packages/skill-creator-plugin",
  },
  {
    packageName: "@drora/drora-guide-plugin",
    relativePath: "apps/drora-cli/packages/drora-guide-plugin",
    requiresRuntime: false,
    requiredSeedPaths: [
      "commands/workflow.md",
      "skills/dynamic-workflows/SKILL.md",
      "skills/dynamic-workflows/examples.md",
      "skills/dynamic-workflows/patterns.md",
    ],
    stagedPath: "packages/drora-guide-plugin",
  },
  {
    packageName: "@drora/drora-cua-plugin",
    relativePath: "apps/drora-cli/packages/zcode-cua-plugin",
    requiresRuntime: false,
    // 与原版 0.6.3 发行物对齐（bootstrap/official-plugin-definitions.ts 同步声明）：
    // 插件载荷为 node_repl SDK client + skill + 按需文档；seed 级 native 依赖缺失会让
    // SDK 首次调用即 MODULE_NOT_FOUND，必须在 staging 阶段就报错。
    requiredSeedPaths: [
      "skills/computer-use/SKILL.md",
      "docs/computer-use.md",
      "scripts/computer-use-client.mjs",
      "package.json",
      "node_modules/sharp/package.json",
    ],
    // 打包期 node_modules 由 stager 按目标平台重产（sharp + koffi，与官方 0.6.3 发行物
    // 同形态）；入库 win32 基线只服务 dev filesystem seed，不直接进安装包。
    stagedNativeRuntimes: ["sharp", "koffi"],
    stagedPath: "packages/zcode-cua-plugin",
  },
];
// 随 CLI 内置的技能包（不是插件）：bootstrap 的 resolveBundledSkillRoots 沿官方插件同款候选目录
// 在 drora.cjs 旁找 packages/bundled-skills 并原地读取。漏 stage 它，桌面包的 /workflow 会展开成
// 「先加载 dynamic-workflows 技能」而技能文件不存在，因此必须随 Agent 一起打包。
const bundledSkillPack = {
  relativePath: "apps/drora-cli/packages/bundled-skills",
  requiredPaths: [
    "skills/dynamic-workflows/SKILL.md",
    "skills/dynamic-workflows/patterns.md",
    "skills/dynamic-workflows/examples.md",
  ],
  stagedPath: "packages/bundled-skills",
  // 官方 3.14.3 发行物在 bundled-skills 根带 README（分发链三形态说明）；
  // skills 之外的这份文档也随包 staging，保持文件集对齐。
  topLevelPaths: ["skills", "README.md"],
};
const includedOfficialPluginTopLevelPaths = new Set([
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  // Electron 生产资源复制有独立白名单，遗漏 agents 会让首启 filesystem seed 永久缺少子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
]);
const excludedOfficialPluginAssetNames = new Set([
  ".DS_Store",
  ".venv",
  "__pycache__",
  "node_modules",
]);

function shouldCopyOfficialPluginAsset(sourcePath, allowSeedNodeModules = false) {
  const name = basename(sourcePath);
  if (name === "node_modules" && allowSeedNodeModules) return true;
  return !excludedOfficialPluginAssetNames.has(name) && !name.endsWith(".pyc");
}
const isBootstrapWithRemote = process.env.DRORA_BOOTSTRAP_WITH_REMOTE === "1";

function buildCliBundle() {
  console.log("[prepare:agent-bundle] building drora-cli app-server bundle ...");
  // 复用仓库根脚本（turbo build:desktop-agent --filter=@drora/cli），命中缓存时几乎瞬时。
  runCommand(process.execPath, [resolve(repoRoot, "scripts/build-desktop-agent-cli.mjs")], {
    cwd: repoRoot,
    env: pnpmRunEnv,
  });
  if (!existsSync(cliBundlePath)) {
    throw new Error(
      `[prepare:agent-bundle] expected cli bundle missing after build: ${cliBundlePath}`,
    );
  }
}

function buildOfficialPluginRuntimes() {
  for (const plugin of officialPluginPackages) {
    if (!plugin.requiresRuntime) continue;
    console.log(`[prepare:agent-bundle] building ${plugin.packageName} runtime ...`);
    if (isBootstrapWithRemote) {
      buildOfficialPluginRuntimeForBootstrap(plugin);
      assertOfficialPluginRuntime(plugin);
      continue;
    }

    runCommand(
      "pnpm",
      ["--dir", resolve(repoRoot, "apps/drora-cli"), "--filter", plugin.packageName, "build"],
      {
        cwd: repoRoot,
        env: pnpmRunEnv,
      },
    );
    assertOfficialPluginRuntime(plugin);
  }
}

function buildOfficialPluginRuntimeForBootstrap(plugin) {
  const pluginRoot = resolve(repoRoot, plugin.relativePath);
  const hasCompleteRuntime = plugin.requiredRuntimePaths.every((relativePath) =>
    existsSync(resolve(pluginRoot, ...relativePath.split("/"))),
  );
  if (plugin.packageName !== BROWSER_USE_PLUGIN_PACKAGE_NAME && hasCompleteRuntime) {
    console.log(
      `[prepare:agent-bundle] reuse existing official plugin runtime: ${plugin.packageName}`,
    );
    return;
  }

  // bootstrap:with-remote 会连续构建 remote assets 和桌面 agent bundle。
  // 通过 pnpm/filter 进入插件 build 时，tsc shim 在本地低内存环境中容易被 SIGKILL；
  // 这里仅在 bootstrap 开关下用当前 Node 直接执行等价 tsc + build-mcp，不改变插件自身 build 脚本。
  // browser-use 的 server 与 browser-client 是同一发布对；即使旧 server.js 存在也必须重建，
  // 否则会把旧 server 与当前 client（或缺失 client）一起 stage 到桌面安装包。
  runCommand(process.execPath, ["../../node_modules/typescript/bin/tsc"], {
    cwd: pluginRoot,
    env: process.env,
  });
  runCommand(process.execPath, [plugin.runtimeBuildScript], {
    cwd: pluginRoot,
    env: process.env,
  });
}

function assertOfficialPluginRuntime(plugin) {
  const pluginRoot = resolve(repoRoot, plugin.relativePath);
  for (const relativePath of plugin.requiredRuntimePaths) {
    const runtimePath = resolve(pluginRoot, ...relativePath.split("/"));
    if (!existsSync(runtimePath)) {
      throw new Error(`[prepare:agent-bundle] missing official plugin runtime: ${runtimePath}`);
    }
  }
}

function stageBundle() {
  // 实现已抽到 stage-agent-bundle.mjs：dev 链（scripts/build-desktop-agent-cli.mjs）
  // 必须用同一份，否则 dev 会继续跑上一次打包留下的陈旧 agent。
  stageAgentBundle({ repoRoot, platformKey });
}

function stageOfficialPlugins() {
  for (const plugin of officialPluginPackages) {
    const sourceRoot = resolve(repoRoot, plugin.relativePath);
    const manifestPath = resolve(sourceRoot, ".zcode-plugin", "plugin.json");
    if (!existsSync(manifestPath)) {
      throw new Error(`[prepare:agent-bundle] missing official plugin manifest: ${manifestPath}`);
    }

    const targetRoot = resolve(glmDir, plugin.stagedPath);
    mkdirSync(targetRoot, { recursive: true });
    // runtimeTopLevelPaths 条目可以是整目录（node_modules，如 zcode-cua-plugin 入库基线）
    // 或确定性子树（node_modules/sharp，browser-use 按 seed 级运行时子树随包），
    // 与 bootstrap/official-plugin-definitions.ts 同步声明。
    const allowSeedNodeModules = (plugin.runtimeTopLevelPaths ?? []).includes("node_modules");
    const stagedTopLevelPaths = [
      ...includedOfficialPluginTopLevelPaths,
      ...(plugin.runtimeTopLevelPaths ?? []),
    ];
    for (const entryName of stagedTopLevelPaths) {
      const sourcePath = resolve(sourceRoot, entryName);
      if (!existsSync(sourcePath)) continue;
      cpSync(sourcePath, resolve(targetRoot, entryName), {
        recursive: true,
        filter: (path) => shouldCopyOfficialPluginAsset(path, allowSeedNodeModules),
      });
    }
    // 带 stagedNativeRuntimes 的插件（node_repl 宿主 / browser-use / zcode-cua）：
    // 官方发行物的 node_modules 是按目标平台 staging 的运行时闭包（sharp JS + 平台
    // @img natives + koffi），不是源目录复制。此前整目录复制会把入库 win32 基线带进
    // darwin/linux 安装包（bundled-agents 缓存实测 sharp-win32-x64 出现在 darwin-arm64），
    // 原生模块在目标平台直接 MODULE_NOT_FOUND。这里先清空再按目标平台重产，与官方
    // sync-cache 共用同一组 staging 函数。
    if ((plugin.stagedNativeRuntimes ?? []).length > 0) {
      rmSync(resolve(targetRoot, "node_modules"), { recursive: true, force: true });
      const targetPlatform = { os: platform, arch };
      if (plugin.stagedNativeRuntimes.includes("sharp")) {
        stageSharpIntoBundledAgents({ desktopPackageRoot: desktopRoot, glmDir: targetRoot, targetPlatform });
      }
      if (plugin.stagedNativeRuntimes.includes("koffi")) {
        stageKoffiIntoBundledAgents({
          koffiPackageRoot: resolve(repoRoot, "apps/drora-cli/packages/adapters"),
          glmDir: targetRoot,
          targetPlatform,
        });
      }
    }
    for (const relativePath of plugin.requiredSeedPaths ?? []) {
      const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
      if (!existsSync(stagedAssetPath)) {
        throw new Error(
          `[prepare:agent-bundle] missing staged official plugin seed asset: ${stagedAssetPath}`,
        );
      }
    }
    console.log(`[prepare:agent-bundle] staged official plugin ${plugin.stagedPath}`);
  }
}

// Electron 生产包只带 resources/glm/drora.cjs 时，app-server 进程的
// __dirname 附近没有官方插件目录，启动时 seed 找不到 source，用户侧不会自动得到内置插件。
// 这里把官方插件按 bootstrap 的 rootCandidates 期望放到 glm/packages/*-plugin，
// 让 Electron Node 运行 drora.cjs 时复用同一套 filesystem seed 逻辑。
// browser-use runtime 的声明生成依赖 @drora/core/dist。CI 干净检出没有该产物，
// 必须先构建 CLI 依赖，再构建官方插件；开发机残留的 dist 曾掩盖这个顺序问题。
buildCliBundle();
buildOfficialPluginRuntimes();
stageBundle();
stageOfficialPlugins();
await stageBundledSkillPack();
await stageCuaHelperRuntime();

async function stageBundledSkillPack() {
  const sourceRoot = resolve(repoRoot, bundledSkillPack.relativePath);
  const targetRoot = resolve(glmDir, bundledSkillPack.stagedPath);
  await mkdir(targetRoot, { recursive: true });
  for (const entryName of bundledSkillPack.topLevelPaths) {
    const sourcePath = resolve(sourceRoot, entryName);
    await cp(sourcePath, resolve(targetRoot, entryName), {
      recursive: true,
      filter: shouldCopyOfficialPluginAsset,
    });
  }
  for (const relativePath of bundledSkillPack.requiredPaths) {
    const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
    await access(stagedAssetPath);
  }
  console.log(`[prepare:agent-bundle] staged bundled skill pack ${bundledSkillPack.stagedPath}`);
}

async function stageCuaHelperRuntime() {
  // CUA helper 运行时(0.6.3):windows-helper.js + ax_native.node + node_modules。
  // resolveWindowsCuaRuntime 产品模式只读 resources/tools/cua-helper,缺文件即 fail-closed,
  // 因此这里整树暴装(含运行依赖),与原版 resources/tools/cua-helper 布局一致。
  const sourceRoot = resolve(repoRoot, "packages/zcode-cua-helper/runtime/cua-helper");
  const targetRoot = resolve(glmDir, "tools", "cua-helper");
  await mkdir(targetRoot, { recursive: true });
  await cp(sourceRoot, targetRoot, { recursive: true });
  for (const relativePath of ["dist/windows-helper.js", "build/Release/ax_native.node", "runtime-manifest.json"]) {
    const stagedAssetPath = resolve(targetRoot, ...relativePath.split("/"));
    await access(stagedAssetPath);
  }
  console.log(`[prepare:agent-bundle] staged cua helper runtime tools/cua-helper`);
}

