/**
 * 插件启用状态存储契约（specs/obsidian-vault-plugin-extraction.md §3，B1 收口单一出处）。
 *
 * 契约键单一出处（AGENTS.md）：`~/.drora/cli/config.json` 的 `plugins.*` 启用状态键、
 * 存储路径基、canonical id 归一与「两层启用位三态合成」读取器只在此定义一次，
 * 生产方与消费方引用同一常量/同一函数；改名任何一侧前先全链 grep 生产与消费。
 *
 * 消费方全集（spec §3）：CLI contracts/adapters（现持有方，B1 起改为此处 re-export）、
 * host 只读读取器（B3 装配条件化）、CLI 注册门（B4）、renderer 插件设置页（B2 开关编辑面）。
 * 结构照 contracts/voice.ts 先例（对象常量 + 纯函数，无 IO——shared 不落盘，文件读写由
 * 各消费方执行，合成语义在此钉死，禁止消费方各自手写三态判定）。
 */

import { DRORA_CUA_OFFICIAL_PLUGIN_ID } from "../mcp.js";

// ---------------------------------------------------------------------------
// 存储文件路径基（迁移自 adapters/src/config/file-config.adapter.ts:62-63；
// 迁移定义不是建第二份，CLI 侧自此 re-export）
// ---------------------------------------------------------------------------

/** 插件启用状态所在配置文件的基目录（`~` 按 home 展开，CLI file-config adapter 执行）。 */
export const DRORA_PLUGIN_CONFIG_BASE_DIR = "~/.drora/cli";
/** 插件启用状态所在配置文件名（与基目录拼接成 `~/.drora/cli/config.json`）。 */
export const DRORA_PLUGIN_CONFIG_FILE_NAME = "config.json";

// ---------------------------------------------------------------------------
// config.json `plugins` 节 schema 键（hostComponents 为本 spec 新增键，D1a 独立开关）
// ---------------------------------------------------------------------------

export const DRORA_PLUGINS_CONFIG_KEYS = {
  /** hooks 启用覆盖：`enabledPlugins[id] ?? defaultEnabled`（现状语义，D1b 维持 false）。 */
  enabledPlugins: "enabledPlugins",
  /** 卸载抑制标记：内置插件卸载即写入，两个启用位同时失效（spec §3 三态合成）。 */
  suppressedBuiltins: "suppressedBuiltins",
  /**
   * 宿主能力独立开关（D1a）：控制面板/宿主服务/VaultSearch 等宿主能力的在场性，
   * 缺省 true（存量体验零回退），不读 enabledPlugins/defaultEnabled——两类能力现状相反，
   * 单一启用位会让「hooks 关闭」误伤宿主能力在场。
   */
  hostComponents: "hostComponents",
} as const;

/** 宿主能力开关缺省（D1a=true：不写键即在场）。 */
export const DRORA_PLUGIN_HOST_COMPONENTS_DEFAULT = true;

// ---------------------------------------------------------------------------
// canonical id 归一（迁移自 adapters/src/config/schema.ts:177-188；CUA 改名历史别名）
// ---------------------------------------------------------------------------

export const LEGACY_CUA_PLUGIN_ID = "drora-cua@drora-plugins-official";
export const CANONICAL_CUA_PLUGIN_ID = DRORA_CUA_OFFICIAL_PLUGIN_ID;

export function canonicalizePluginId(pluginId: string): string {
  return pluginId === LEGACY_CUA_PLUGIN_ID ? CANONICAL_CUA_PLUGIN_ID : pluginId;
}

export function pluginIdAliases(pluginId: string): readonly string[] {
  return canonicalizePluginId(pluginId) === CANONICAL_CUA_PLUGIN_ID
    ? [CANONICAL_CUA_PLUGIN_ID, LEGACY_CUA_PLUGIN_ID]
    : [pluginId];
}

// ---------------------------------------------------------------------------
// 两层启用位三态合成读取器（spec §3；读取器必须实现三态合成，
// 禁止只按 enabledPlugins??defaultEnabled 合成——卸载态会被误判为启用）
// ---------------------------------------------------------------------------

/**
 * 启用状态三键快照：config.json `plugins` 节的启用相关子集。
 * 字段可缺省（未配置即按各读取器的缺省语义合成）；host 侧只读读取器直接传
 * 解析后的 `plugins` 节对象即可（多余字段不影响合成）。
 */
export interface PluginEnablementState {
  enabledPlugins?: Readonly<Record<string, boolean>>;
  suppressedBuiltins?: readonly string[];
  hostComponents?: boolean;
}

function readEnabledPlugins(state: PluginEnablementState): Readonly<Record<string, boolean>> {
  const value = state.enabledPlugins;
  return value && typeof value === "object" ? value : {};
}

function readSuppressedBuiltins(state: PluginEnablementState): readonly string[] {
  const value = state.suppressedBuiltins;
  return Array.isArray(value) ? value : [];
}

/** 卸载抑制判定（输入 id 先做 canonical 归一，与 config 装载侧归一一致）。 */
export function isPluginSuppressed(state: PluginEnablementState, pluginId: string): boolean {
  const canonicalId = canonicalizePluginId(pluginId);
  return readSuppressedBuiltins(state).some((id) => canonicalizePluginId(id) === canonicalId);
}

/**
 * hooks 在场合成（现状语义不变，spec §3）：
 * `!suppressedBuiltins 含 id && (enabledPlugins[id] ?? defaultEnabled)`。
 * `defaultEnabled` 由官方定义传入（「仅限内容型插件」约定维持，obsidian 为 false——D1b）。
 */
export function resolvePluginHooksPresence(
  state: PluginEnablementState,
  pluginId: string,
  defaultEnabled = false,
): boolean {
  if (isPluginSuppressed(state, pluginId)) return false;
  const canonicalId = canonicalizePluginId(pluginId);
  return readEnabledPlugins(state)[canonicalId] ?? defaultEnabled;
}

/**
 * 宿主能力在场合成（新开关，缺省 true，spec §3）：
 * `!suppressedBuiltins 含 id && hostComponents`（不读 enabledPlugins/defaultEnabled）。
 * 卸载（写 suppression）使 hooks 与宿主能力两个位同时失效；「恢复」清抑制后各自回落。
 */
export function resolvePluginHostComponentsPresence(
  state: PluginEnablementState,
  pluginId: string,
): boolean {
  if (isPluginSuppressed(state, pluginId)) return false;
  return state.hostComponents ?? DRORA_PLUGIN_HOST_COMPONENTS_DEFAULT;
}

// ---------------------------------------------------------------------------
// renderer 宿主面板白名单（spec §4.1 阶段一形态）——已随 P7 本体清除废除
//（specs/obsidian-vault-phase2-true-extraction.md §1-C4）：hostPanelId/app 形态、
// DRORA_PLUGIN_HOST_PANEL_IDS 白名单与 renderer 注册表整体拆除；本文件只保留两层
// 启用位三态合成（hooks/hostComponents），供 CLI 配置装载与插件管理页继续引用。
// ---------------------------------------------------------------------------
