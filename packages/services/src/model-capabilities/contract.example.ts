/**
 * services-model-capabilities 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C11）：示例随 Jev/
 * embedding 节点拆除改为语音条目（asr/tts/image-generation 三条目为本域现存面）。
 */
import { createModelCapabilitiesService } from "./node.js";
import type { IModelCapabilitiesService } from "./contract.js";

/** Host 装配（desktop host 唯一构造点）：迁移在首次 get 时执行一次。 */
export function exampleConstruct(
  settingService: Parameters<typeof createModelCapabilitiesService>[0]["settingService"],
): IModelCapabilitiesService {
  return createModelCapabilitiesService({ settingService });
}

/** 读快照：语音适配器按 engine/providerRef 读路由（消费方照此读，不自建第二份状态）。 */
export async function exampleRead(service: IModelCapabilitiesService): Promise<boolean> {
  const snapshot = await service.get();
  return snapshot.capabilities.asr.engine === "remote";
}

/** 唯一写路径：条目浅合并，随后 onDidChange 广播（凭据面已随 §13/P7 收敛到供应商卡）。 */
export async function exampleUpdate(service: IModelCapabilitiesService): Promise<void> {
  await service.update({
    capabilities: {
      asr: {
        engine: "remote",
        providerRef: "my-provider",
        modelId: "paraformer-v2",
      },
    },
  });
}
