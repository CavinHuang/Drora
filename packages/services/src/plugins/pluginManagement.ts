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
}

export const IPluginManagementService = createServiceDescriptor<IPluginManagementService>(
  ServiceChannels.PluginManagement,
);
