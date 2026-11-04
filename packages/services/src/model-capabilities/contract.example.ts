/**
 * services-model-capabilities 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import { modelCapabilityCredentialKey } from "@drora/shared";
import { IModelCapabilitiesService, createModelCapabilitiesService } from "./index.js";

/** Host 装配（desktop host 唯一构造点）：迁移在首次 get 时执行一次。 */
export function exampleConstruct(
  settingService: Parameters<typeof createModelCapabilitiesService>[0]["settingService"],
): IModelCapabilitiesService {
  return createModelCapabilitiesService({ settingService });
}

/** 读快照：Jev 装配按 providerKind 取端点/模型（消费方照此读，不自建第二份状态）。 */
export async function exampleRead(service: IModelCapabilitiesService): Promise<boolean> {
  const snapshot = await service.get();
  return snapshot.capabilities["decision-jev"].enabled;
}

/** 唯一写路径：条目浅合并 + 凭据写删（null/空串 = 删除），随后 onDidChange 广播。 */
export async function exampleUpdate(service: IModelCapabilitiesService): Promise<void> {
  await service.update({
    capabilities: {
      "decision-jev": {
        enabled: true,
        providerKind: "openrouter",
        modelId: "typesafe/jev-latest",
      },
    },
    credentials: {
      decisionJev: { providerKind: "openrouter", value: "sk-openrouter" },
    },
  });
  // 凭据键由 shared 契约单一出处推导，禁止手写字面量：
  // modelCapabilityCredentialKey.decisionJev("openrouter") === "model-capabilities:decision-jev:openrouter:api-key"
  void modelCapabilityCredentialKey;
}
