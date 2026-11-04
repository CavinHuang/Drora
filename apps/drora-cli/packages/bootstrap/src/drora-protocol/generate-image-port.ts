// ============================================================
// GenerateImage Protocol Port
// ============================================================
// generate_image 工具的 CLI 侧端口实现（specs/model-capabilities.md §6）：经
// drora-protocol 反向请求把生成请求转发到 host 进程内的模型能力档案画图服务
// （出站、凭据解密全部留在 host，凭据零出 host）。host 无画图服务（旧 host /
// 远程降级）返回 -32601，这里翻译为稳定的 ConfigurationError（MC-7：结构化
// 不可用 + 设置页指引）；业务失败是 host 返回的结构化 ok:false 结果，不是这里的
// 错误。本端口不做任何本地兜底。

import {
  CoreErrorType,
  createCoreError,
  GENERATE_IMAGE_TOOL_NAME,
  GenerateImagePortResultSchema,
  type GenerateImagePortResult,
} from "@drora/contracts";
import {
  droraModelCapabilityGenerateImageParamsSchema,
  droraModelCapabilityGenerateImageResultSchema,
  droraProtocolMethods,
} from "@drora/shared";
import { ProtocolRequestError, type DroraProtocolAgentServerContext } from "./server-types.js";

const IMAGE_GENERATION_UNAVAILABLE_MESSAGE =
  "图像生成在当前 Host 不可用（无模型能力服务）；如需启用请在模型设置页 → 图像生成配置中配置";

export function createProtocolImageGenerationPort(
  context: DroraProtocolAgentServerContext,
): {
  generateImage(
    input: { prompt: string; size?: string },
    options?: { signal?: AbortSignal },
  ): Promise<GenerateImagePortResult>;
} {
  return {
    async generateImage(
      input: {
        prompt: string;
        size?: string;
      },
      options?: { signal?: AbortSignal },
    ): Promise<GenerateImagePortResult> {
      try {
        const result = (await context.requestClient(
          droraProtocolMethods.modelCapabilityGenerateImage,
          droraModelCapabilityGenerateImageParamsSchema.parse(input),
          droraModelCapabilityGenerateImageResultSchema,
          // 取消贯通（specs/model-capabilities.md §12）：signal 随工具执行取消/
          // 超时传入，requestClient 在 abort 时终止 pending 反向请求；不传
          // timeoutMs——出站超时由 host 侧 180s AbortSignal.timeout 兜底。
          options?.signal ? { signal: options.signal } : undefined,
        )) as GenerateImagePortResult;
        // 协议 result 与 contracts GenerateImagePortResult 结构同形（字段白名单一致）；
        // 漂移会在 host/CLI 任一侧的严格 parse 处暴露，这里二次校验锁住两侧契约。
        return GenerateImagePortResultSchema.parse(result);
      } catch (error) {
        // 旧 host 不认识 modelCapability/generateImage（-32601）= 能力差异：翻译为
        // 固定 ConfigurationError（MC-7），含设置页指引；-32603 等其余错误携带 host
        // 原始消息（含显式不可用与真实内部错误），原样上抛。
        if (error instanceof ProtocolRequestError && error.code === -32601) {
          throw createCoreError(
            CoreErrorType.ConfigurationError,
            IMAGE_GENERATION_UNAVAILABLE_MESSAGE,
            {
              context: { toolName: GENERATE_IMAGE_TOOL_NAME },
              recoverable: false,
            },
          );
        }
        throw error;
      }
    },
  };
}
