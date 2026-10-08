export interface DefaultPluginMarketplace {
  id: string;
  source: string;
  name: string;
  description: string;
  pluginCount: number;
  lastUpdated?: string;
}

export const DRORA_OFFICIAL_PLUGIN_MARKETPLACE_ID = "drora-plugins-official";

/** Claude 生态内置市场（anthropics/claude-plugins-official），与官方原版内置清单同名同源补录。
 *  id 与 source 保持上游原名：claude 是第三方品牌，不属于 zcode→drora 改名范围；
 *  原版对该 id 同样按官方保留名保护（isOfficialMarketplaceId 覆盖）。 */
export const CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID = "claude-plugins-official";

/** 官方 CDN 插件资产基址（市场图标索引 icon-sources.json 与插件图标共用）。 */
export const OFFICIAL_PLUGIN_ASSETS_BASE_URL =
  "https://cdn-zcode.z.ai/zcode/official-plugin/assets";

/** Settings 三类资源发现共用；Bootstrap 单测与官方 definition 的 defaultEnabled 机械对照。 */
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@drora-plugins-official",
  "image-search@drora-plugins-official",
  "documents@drora-plugins-official",
  "pdf@drora-plugins-official",
  "presentations@drora-plugins-official",
  "spreadsheets@drora-plugins-official",
  // node_repl 宿主：不进市场、不对用户露出，也不贡献任何 skill/command/subagent，但必须
  // 始终可用 —— node_repl 的注册门禁是「Browser Use 或 Computer Use 任一启用」，宿主自己
  // 不参与那个判断。Browser Use 默认开着，宿主若默认关就等于它上来就没有宿主。
  "node-repl-host@drora-plugins-official",
  "skill-creator@drora-plugins-official",
  "plugin-creator@drora-plugins-official",
  "drora-guide@drora-plugins-official",
  // 电脑控制回退为默认关闭，故 computer-use 不在此名单内。
  // 该集合必须与 official-plugin-definitions.ts 里标了 defaultEnabled 的插件逐一对应，
  // bootstrap 的「Settings 默认启用集合与 CLI 的官方插件声明一致」单测机械对照两者。
]);

export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [
  {
    // Drora 官方市场：本地 seed 分片与 CDN 分片在 Agent storage 内合并。
    // CDN manifest 的 name 必须与该 canonical id 一致。
    id: DRORA_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    source: "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    name: DRORA_OFFICIAL_PLUGIN_MARKETPLACE_ID,
    description: "Official Drora plugins marketplace: built-in and community plugins for Drora.",
    pluginCount: 0,
  },
  {
    // 与官方原版内置清单（Bqt）对齐：Claude 生态市场源（GitHub anthropics/
    // claude-plugins-official）同样随首载自动补录，驱动发现页「Claude Code 插件」分段；
    // pluginCount 初始 0，首次浏览/安装时经懒刷新拉取真实清单。其插件图标由官方 CDN 的
    // icon-sources.json 索引补全（adapters 侧 syncClaudePluginsOfficialIcons）。
    id: CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID,
    source: "anthropics/claude-plugins-official",
    name: CLAUDE_PLUGINS_OFFICIAL_MARKETPLACE_ID,
    description:
      "Directory of popular Claude Code extensions including development tools, productivity plugins, and MCP integrations",
    pluginCount: 0,
  },
];

// 商店「公开」分段只有一个 Drora 官方市场 id（官方原版同款语义：claude 生态市场只补录为
// 已知源、落在个人分段，不并入公开商店身份），内置与 CDN 不再拆分身份。
export const PUBLIC_STORE_MARKETPLACE_IDS = [DRORA_OFFICIAL_PLUGIN_MARKETPLACE_ID] as const;

export function isPublicStoreMarketplaceId(id: string): boolean {
  return (PUBLIC_STORE_MARKETPLACE_IDS as readonly string[]).includes(id);
}
