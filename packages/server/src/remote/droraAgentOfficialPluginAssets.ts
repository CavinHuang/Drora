import { posix } from "node:path";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME = "packages";

/**
 * 远端 Agent 随 bundle 发布的官方插件包合同（对齐原版 13 包，Drora 命名差异仅
 * zcode-guide-plugin → drora-guide-plugin）。生产 remote 校验、开发态 SSH 复制与
 * release source 校验共用这份清单；缺任一 required path 即触发重部署。
 */
export const REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES = [
  "android-emulator-plugin",
  "browser-use-plugin",
  "zcode-cua-plugin",
  "documents-plugin",
  "pdf-plugin",
  "presentations-plugin",
  "spreadsheets-plugin",
  "image-search-plugin",
  "ios-simulator-plugin",
  "restore-legacy-sessions-plugin",
  "skill-creator-plugin",
  "plugin-creator-plugin",
  "drora-guide-plugin",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS = [
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  // 开发态远程插件复制使用独立白名单，遗漏 agents 会只在远端丢失子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  // Browser bootstrap 会从插件根目录动态导入 scripts/browser-client.mjs。
  // 开发态 SSH 部署若漏掉 scripts，会出现 MCP server 已启动但浏览器绑定无法初始化的半成品状态。
  "scripts",
  "skills",
  "templates",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS = [
  ...REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES.map(
    (packageName) => `${packageName}/.zcode-plugin/plugin.json`,
  ),
  // 只校验 manifest 会把“有插件壳”的残缺目录误判为可复用；正文资产缺失同样要重部署。
  //
  // 这里只能列各插件**自己产出**的资产。node_repl 宿主抽成 @drora/node-repl-host 后
  // browser-use 不再产出 dist/mcp/server.js；本清单里指向不存在的文件，会让远端资产
  // 校验对着幽灵路径报缺失。远程工作区要承载 node-repl 宿主时，应把 node-repl-host
  // 补进上面的 PACKAGE_NAMES 并在此声明它的 dist/mcp/server.js。
  "browser-use-plugin/docs/api.json",
  "browser-use-plugin/docs/documents.json",
  "browser-use-plugin/docs/overview.md",
  // 远端缓存若缺少 recording 正文，documents.json 仍会错误宣告该 lookup 可用。
  "browser-use-plugin/docs/recording.md",
  "browser-use-plugin/docs/workflow.md",
  "browser-use-plugin/scripts/browser-client.mjs",
  "browser-use-plugin/skills/control-browser/SKILL.md",
  "browser-use-plugin/skills/web-gui-tester/SKILL.md",
  // image-search 的 MCP server 声明在 .mcp.json，缺失则远端插件只有技能没有工具。
  "image-search-plugin/.mcp.json",
  // 文档插件缺技能正文或视觉评审 Agent 时同样残缺（原版合同含四件套）。
  "documents-plugin/agents/visual-judge.md",
  "documents-plugin/skills/docx/SKILL.md",
  "pdf-plugin/agents/visual-judge.md",
  "pdf-plugin/skills/pdf/SKILL.md",
  "presentations-plugin/agents/visual-judge.md",
  "presentations-plugin/skills/pptx/SKILL.md",
  "spreadsheets-plugin/agents/visual-judge.md",
  "spreadsheets-plugin/skills/xlsx/SKILL.md",
  // cua 0.6.3 起为 SDK+skill 包：client 供 kernel 引导挂 agent.computerUse，
  // docs 是 agent.documentation 的正文（与原版 13 包合同逐条一致）。
  "zcode-cua-plugin/docs/computer-use.md",
  "zcode-cua-plugin/scripts/computer-use-client.mjs",
  "zcode-cua-plugin/skills/computer-use/SKILL.md",
] as const;

export function buildRemoteAgentOfficialPluginDir(remoteProviderDir: string): string {
  return posix.join(remoteProviderDir, REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME);
}

export function buildRemoteAgentOfficialPluginSourceRelativePath(params: {
  runtimeResourceDir: string;
  platformArch: string;
}): string {
  return posix.join(
    params.runtimeResourceDir,
    params.platformArch,
    REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
  );
}

export function buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir: string): string[] {
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  return REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.map((relativePath) =>
    posix.join(remoteOfficialPluginDir, relativePath),
  );
}
