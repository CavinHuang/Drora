// `plugins/listUiSurfaces`：工作区级只读投影，
// 返回已启用插件清单 `ui.surfaces[]` 的合法条目。与 plugin-reference-catalog.ts 同因分文件：plugins.ts 已近门禁。
import {
  droraPluginsListUiSurfacesParamsSchema,
  type DroraPluginUiSurface,
  type DroraPluginsListUiSurfacesResult,
} from "@drora/shared";
import { createConfig } from "@drora/adapters/config";
import type { PluginMetadata } from "@drora/contracts";
import { resolveDroraPlugins } from "../plugins.js";
import { parseParams, type DroraProtocolAgentServerContext } from "./server-types.js";

/**
 * 投影过滤语义（P7 本体清除后收窄，specs/obsidian-vault-phase2-true-extraction.md
 * §1-C4）：session 级沙箱面板维持 plugin.enabled 过滤（既有语义零变化：禁用插件
 * 没有运行时 MCP，入口不可用；解析仍保留在 metadata 里供管理页展示）。阶段一
 * `availability:"app"` 宿主面板项的三态合成过滤分支随宿主面板机制整体废除——解析侧
 * 已拒绝 app 形态，投影内不会再出现该类条目。
 */
export function listPluginUiSurfacesFromPlugins(
  plugins: readonly PluginMetadata[],
): DroraPluginUiSurface[] {
  const surfaces: DroraPluginUiSurface[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const surface of plugin.uiSurfaces ?? []) {
      surfaces.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        id: surface.id,
        title: surface.title,
        ...(surface.icon ? { icon: surface.icon } : {}),
        server: surface.server,
        resourceUri: surface.resourceUri,
        availability: "session",
      });
    }
  }
  return surfaces;
}

export async function listPluginUiSurfaces(
  context: DroraProtocolAgentServerContext,
  rawParams: unknown,
): Promise<DroraPluginsListUiSurfacesResult> {
  const params = parseParams(droraPluginsListUiSurfacesParamsSchema, rawParams);
  // 刻意不传 env——原实现经 resolveDroraPlugins 内部 createConfig 也不带 env，保持
  // 该投影入口的配置口径零变化。
  const configResult = createConfig({
    workingDirectory: params.workspace.workspacePath,
  });
  const outcome = resolveDroraPlugins({
    configResult,
    logger: context.logger,
    workingDirectory: params.workspace.workspacePath,
  });
  return {
    surfaces: listPluginUiSurfacesFromPlugins(outcome.plugins),
  };
}
