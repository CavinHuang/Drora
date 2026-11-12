import { join } from "node:path";
import type { AgentRuntimeConfig } from "@drora/core";
import type { PluginLoadOutcome } from "@drora/contracts";
import {
  OFFICIAL_BROWSER_USE_PLUGIN_ID,
  OFFICIAL_CUA_PLUGIN_ID,
} from "./official-plugin-definitions.js";

export type RuntimeFeaturesConfig = NonNullable<AgentRuntimeConfig["runtimeFeatures"]>;

/**
 * P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C8 双轨下线）：
 * B4 的 obsidianHostComponents 宿主能力合成随 VaultSearch 注册门拆除——CLI 内建
 * vault 工具面已下线（检索走插件 knowledge MCP server），本函数只剩 browser-use /
 * CUA 两个官方插件 runtime feature。
 */
export function resolvePluginRuntimeFeatures(
  pluginOutcome: Pick<PluginLoadOutcome, "plugins">,
): RuntimeFeaturesConfig {
  const browserUsePlugin = pluginOutcome.plugins.find(
    (plugin) => plugin.id === OFFICIAL_BROWSER_USE_PLUGIN_ID && plugin.enabled,
  );
  const cuaPlugin = pluginOutcome.plugins.find(
    (plugin) => plugin.id === OFFICIAL_CUA_PLUGIN_ID && plugin.enabled,
  );
  if (!browserUsePlugin && !cuaPlugin) {
    return {};
  }
  return {
    // Node REPL 已迁到真实 MCP server；这里仅启用 BrowserControlPort 注入，不再注册 core 裸 js*。
    ...(browserUsePlugin ? { browserUse: true } : {}),
    ...(browserUsePlugin
      ? {
          // 修复：该路径进入 node_repl 文档注入与提示词（模型面），Windows 的 join 产反斜杠
          // 会令形态随平台漂移；node fs 接受正斜杠，统一归一。
          browserDocumentationRoot: join(browserUsePlugin.rootPath, "docs").replaceAll("\\", "/"),
        }
      : {}),
    // CUA 与 Browser Use 共用同一个无状态 node_repl MCP server；这里只记录 CUA
    // SDK 是否需要由 bootstrap 注入 broker。不要设置 nodeRepl：那个字段会重新注册
    // 已迁移前的 core 裸 js 工具，导致 MCP 与 core 重复投影。
    ...(cuaPlugin ? { computerUse: true } : {}),
  };
}
