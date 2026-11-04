import type { ModelCapabilitiesFile, ModelCapabilitiesUpdate } from "@drora/shared";
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";

/**
 * 模型能力档案服务契约（specs/model-capabilities.md §4；F-1）。
 *
 * `~/.drora/v2/model_capabilities.json` 的唯一所有者：读快照 + onDidChange 订阅；
 * 写路径只有 update（zod 校验 → 档案原子写盘 → 凭据变更写 credentialService → 广播）。
 * apiKey 一律不进档案文件，只在 ICredentialService（加密）。档案 schema、purpose 枚举
 * 与凭据键的单一出处是 shared/contracts/modelCapabilities.ts。
 */
export interface IModelCapabilitiesService {
  /**
   * 当前档案快照。首次访问触发一次性旧键迁移（spec §3.3：AppSettings 14 键 + 旧凭据
   * 5 键 → 档案 + 新凭据键；幂等标记 migratedFromLegacySettings，已迁移即跳过）。
   * 坏 JSON/坏 schema 降级为全默认并备份原文件（fail-closed，各能力默认关闭）。
   */
  get(): Promise<ModelCapabilitiesFile>;
  /**
   * 唯一写路径：capabilities 浅合并到对应 purpose 条目；credentials 按 purpose 写删
   * （value 为 null/空串 = 删除该键，沿用 ApiKeyRow「留空保存即删除」语义）。
   * 返回写入后的新快照，并 onDidChange 广播。
   */
  update(params: ModelCapabilitiesUpdate): Promise<ModelCapabilitiesFile>;
  /** 订阅档案变更（档案写盘与凭据写删都触发；凭据值不随事件出服务）。 */
  onDidChange(listener: (snapshot: ModelCapabilitiesFile) => void): { dispose(): void };
}

export const IModelCapabilitiesService = createServiceDescriptor<IModelCapabilitiesService>(
  ServiceChannels.ModelCapabilities,
);
