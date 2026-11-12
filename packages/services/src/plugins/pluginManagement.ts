// 平台能力面收敛：设置页「插件管理」的薄服务接口。
//
// 背景：pluginManagementStore / usePluginUninstall 过去直接注入 IDroraAgentService，
// UI 层因此散布 13 个 plugins/* 旧协议词的消费点。收敛为独立薄 service 后，UI 只依赖
// 本接口；plugins/* 词表的 host 侧消费点收拢到 pluginManagementService 一处（插件的
// 事实源在 drora-cli 进程，服务实现仍经 agent 协议往返——plugins 词表的收口归属
// 插件能力面自身的协议演进，不在会话 v4 词表范围内）。
// 注意与既有 IPluginsService（已 retired 的 marketplace pluginStore 通道）区分：
// 那套接口按 pluginName+marketplace 寻址且方法语义过时，不复用避免签名冲突。
import type { Event } from "@drora/rpc";
import type {
  DroraPluginOperationProgressNotification,
  DroraPluginsConfigureResult,
  DroraPluginsCancelOperationResult,
  DroraPluginsDescribeResult,
  DroraPluginsInstallResult,
  DroraPluginsListResult,
  DroraPluginsMarketplaceMutationResult,
  DroraPluginsOverviewResult,
  DroraPluginsReferenceCatalogResult,
  DroraPluginsRestoreBuiltinResult,
  DroraPluginsSetEnabledResult,
  DroraPluginsSetHostComponentsEnabledResult,
  DroraPluginsUninstallResult,
  DroraPluginsValidateResult,
} from "@drora/shared";
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  DroraAgentAddPluginMarketplaceParams,
  DroraAgentConfigurePluginParams,
  DroraAgentCancelPluginOperationParams,
  DroraAgentDescribePluginParams,
  DroraAgentInstallPluginParams,
  DroraAgentPluginReferenceCatalogParams,
  DroraAgentResolveSuggestedPluginReferenceParams,
  DroraAgentResetPluginConfigParams,
  DroraAgentPluginViewParams,
  DroraAgentRemovePluginMarketplaceParams,
  DroraAgentRestoreBuiltinPluginParams,
  DroraAgentSetHostComponentsEnabledParams,
  DroraAgentSetPluginEnabledParams,
  DroraAgentUninstallPluginParams,
  DroraAgentUpdatePluginMarketplaceParams,
  DroraAgentUpdatePluginParams,
  DroraAgentValidatePluginParams,
} from "../drora-agent/droraAgentPluginParams.js";

export interface IPluginManagementService {
  listPlugins(params: DroraAgentPluginViewParams): Promise<DroraPluginsListResult>;
  /**
   * Plugin 对话引用 catalog：
   * 带 sessionId → session-owned 冻结 catalog；不带 → workspace 当前 catalog。
   * 实现路由到 workspace 级 agent client，不走插件管理独立进程。
   */
  getPluginReferenceCatalog(
    params: DroraAgentPluginReferenceCatalogParams,
  ): Promise<DroraPluginsReferenceCatalogResult>;
  resolveSuggestedPluginReference(
    params: DroraAgentResolveSuggestedPluginReferenceParams,
  ): Promise<import("@drora/shared").DroraPluginsResolveSuggestedReferenceResult>;
  onDynamicPluginOperationProgress(
    operationId: string,
  ): Event<DroraPluginOperationProgressNotification>;
  getPluginsOverview(params: DroraAgentPluginViewParams): Promise<DroraPluginsOverviewResult>;
  addPluginMarketplace(
    params: DroraAgentAddPluginMarketplaceParams,
  ): Promise<DroraPluginsMarketplaceMutationResult>;
  removePluginMarketplace(
    params: DroraAgentRemovePluginMarketplaceParams,
  ): Promise<DroraPluginsMarketplaceMutationResult>;
  updatePluginMarketplace(
    params: DroraAgentUpdatePluginMarketplaceParams,
  ): Promise<DroraPluginsMarketplaceMutationResult>;
  installPlugin(params: DroraAgentInstallPluginParams): Promise<DroraPluginsInstallResult>;
  cancelPluginOperation(
    params: DroraAgentCancelPluginOperationParams,
  ): Promise<DroraPluginsCancelOperationResult>;
  uninstallPlugin(params: DroraAgentUninstallPluginParams): Promise<DroraPluginsUninstallResult>;
  updatePlugin(params: DroraAgentUpdatePluginParams): Promise<DroraPluginsInstallResult>;
  restoreBuiltinPlugin(
    params: DroraAgentRestoreBuiltinPluginParams,
  ): Promise<DroraPluginsRestoreBuiltinResult>;
  configurePlugin(params: DroraAgentConfigurePluginParams): Promise<DroraPluginsConfigureResult>;
  resetPluginConfig(
    params: DroraAgentResetPluginConfigParams,
  ): Promise<DroraPluginsConfigureResult>;
  validatePlugin(params: DroraAgentValidatePluginParams): Promise<DroraPluginsValidateResult>;
  describePlugin(params: DroraAgentDescribePluginParams): Promise<DroraPluginsDescribeResult>;
  setPluginEnabled(params: DroraAgentSetPluginEnabledParams): Promise<DroraPluginsSetEnabledResult>;
  /**
   * 宿主能力独立开关（specs/obsidian-vault-plugin-extraction.md §3 D1a，B1）：
   * `plugins.hostComponents` 的唯一写方（renderer 插件设置页专用），与 setPluginEnabled
   * 同链路（RPC plugins/setHostComponentsEnabled → CLI file-config 原子写 user 级配置）。
   * 修订注记（2026-11-11 施工 B1 核实）：spec §3/§10-B1 原文写 IPluginsService，经核实
   * IPluginsService 是 retired 桩通道（pluginsService.ts throwRetiredPluginManagement），
   * 唯一写方不可落在必然抛错的死通道，按「与 setPluginEnabled 同链路」实质落本接口。
   * 重启生效（§4.2 事件顺序），无热切换。
   */
  setHostComponentsEnabled(
    params: DroraAgentSetHostComponentsEnabledParams,
  ): Promise<DroraPluginsSetHostComponentsEnabledResult>;
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);

/** 入口只附加观测上下文；RPC 方法由 Proxy 动态提供，不能通过对象展开复制。 */
export function withPluginTelemetry(
  service: IPluginManagementService,
  telemetry: NonNullable<DroraAgentInstallPluginParams["telemetry"]>,
): IPluginManagementService {
  const mutations = new Set<PropertyKey>([
    "addPluginMarketplace",
    "removePluginMarketplace",
    "updatePluginMarketplace",
    "installPlugin",
    "uninstallPlugin",
    "updatePlugin",
    "restoreBuiltinPlugin",
    "configurePlugin",
    "resetPluginConfig",
    "setPluginEnabled",
    "setHostComponentsEnabled",
  ]);
  return new Proxy(service, {
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (typeof method !== "function") return method;
      if (!mutations.has(property)) return method.bind(target);
      return (params: DroraAgentInstallPluginParams) =>
        method.call(target, { ...params, telemetry });
    },
  });
}
