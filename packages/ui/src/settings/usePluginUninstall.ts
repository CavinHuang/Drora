import { useCallback, useMemo, useState } from "react";
import type { DroraInstalledPluginSummary, DroraPluginInfo } from "@drora/shared";
import type { IPluginManagementService } from "@drora/services";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";

interface UsePluginUninstallInput {
  store?: typeof usePluginManagementStore;
  pluginService: IPluginManagementService;
  installedPlugins: DroraInstalledPluginSummary[];
  plugins: DroraPluginInfo[];
  activeOperations: ReadonlyArray<{ id: string }>;
  // 卸载会让插件提供的技能/命令失效，调用方传入统一的「能力变更后刷新」收尾逻辑。
  onAfterUninstall: () => Promise<void>;
}

export interface PluginUninstallController {
  pendingPlugin: DroraPluginInfo | DroraInstalledPluginSummary | null;
  uninstalling: boolean;
  /**
   * 待卸载插件是否强制保留数据目录（§11-D6）：obsidian 插件数据目录含知识库+模型，
   * 卸载确认弹窗据此明示「数据将保留」，与卸载链路的强制 keepData 行为对齐。
   */
  pendingKeepsData: boolean;
  requestUninstall: (pluginId: string) => void;
  cancelUninstall: () => void;
  confirmUninstall: () => Promise<void>;
}

/**
 * 集中管理插件卸载的确认流程：UI 各入口（已安装详情、市场面板）都通过它发起卸载，
 * 共用同一份 pending 状态、确认弹窗目标解析与卸载收尾逻辑。
 */
export function usePluginUninstall({
  store = usePluginManagementStore,
  pluginService,
  installedPlugins,
  plugins,
  activeOperations,
  onAfterUninstall,
}: UsePluginUninstallInput): PluginUninstallController {
  const uninstallPlugin = store((state) => state.uninstallPlugin);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const pendingPlugin = useMemo(() => {
    if (!pendingId) return null;
    return (
      installedPlugins.find((item) => item.id === pendingId) ??
      plugins.find((item) => item.id === pendingId) ??
      null
    );
  }, [installedPlugins, pendingId, plugins]);

  const uninstalling =
    pendingId !== null &&
    activeOperations.some((operation) => operation.id === `plugin:uninstall:${pendingId}`);

  // §11-D6：已装摘要投影的 uninstallKeepData（显式 keepData:false 在 CLI 侧也不生效）。
  const pendingKeepsData =
    pendingPlugin !== null && "uninstallKeepData" in pendingPlugin
      ? pendingPlugin.uninstallKeepData === true
      : false;

  const requestUninstall = useCallback((pluginId: string) => {
    setPendingId(pluginId);
  }, []);

  const cancelUninstall = useCallback(() => {
    setPendingId(null);
  }, []);

  const confirmUninstall = useCallback(async () => {
    if (!pendingId) return;
    await uninstallPlugin(pendingId, pluginService);
    if (store.getState().error) return;
    await onAfterUninstall();
    setPendingId(null);
  }, [pluginService, onAfterUninstall, pendingId, store, uninstallPlugin]);

  return { pendingPlugin, uninstalling, pendingKeepsData, requestUninstall, cancelUninstall, confirmUninstall };
}
