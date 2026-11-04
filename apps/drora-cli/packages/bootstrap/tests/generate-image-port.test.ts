import { describe, expect, it, vi } from "vitest";
import { CoreErrorType, isCoreError } from "@drora/contracts";
import {
  droraModelCapabilityGenerateImageResultSchema,
  droraProtocolMethods,
} from "@drora/shared";
import { createProtocolImageGenerationPort } from "../src/drora-protocol/generate-image-port.js";
import {
  ProtocolRequestError,
  type DroraProtocolAgentServerContext,
} from "../src/drora-protocol/server-types.js";

function makeContext(
  requestClient: DroraProtocolAgentServerContext["requestClient"],
): DroraProtocolAgentServerContext {
  return { requestClient } as unknown as DroraProtocolAgentServerContext;
}

describe("createProtocolImageGenerationPort（specs/model-capabilities.md §6；MC-6/MC-7）", () => {
  it("正常链：requestClient 转发 modelCapability/generateImage 并严格校验结果（MC-6）", async () => {
    const requestClient = vi.fn(async () => ({
      ok: true,
      imageBase64: Buffer.from("png").toString("base64"),
      contentType: "image/png",
      bytes: 3,
    }));
    const port = createProtocolImageGenerationPort(makeContext(requestClient));

    const result = await port.generateImage({ prompt: "a cat", size: "1024x1024" });

    expect(result).toMatchObject({ ok: true, contentType: "image/png", bytes: 3 });
    expect(requestClient).toHaveBeenCalledTimes(1);
    const [method, params, schema] = requestClient.mock.calls[0] as unknown as [
      string,
      unknown,
      unknown,
    ];
    expect(method).toBe(droraProtocolMethods.modelCapabilityGenerateImage);
    expect(params).toEqual({ prompt: "a cat", size: "1024x1024" });
    // 结果 schema 用 shared 协议 schema（漂移在两侧严格 parse 暴露）。
    expect(schema).toBe(droraModelCapabilityGenerateImageResultSchema);
  });

  it("host 返回结构化 ok:false（档案未配置）原样透传给 handler 分层处理", async () => {
    const requestClient = vi.fn(async () => ({
      ok: false,
      errorKind: "not_configured",
      message: "图像生成配置不完整：请在模型设置页 → 图像生成配置中补全",
    }));
    const port = createProtocolImageGenerationPort(makeContext(requestClient));

    await expect(port.generateImage({ prompt: "a cat" })).resolves.toMatchObject({
      ok: false,
      errorKind: "not_configured",
    });
  });

  it("host 缺处理器（-32601，旧 host / 无档案服务）翻译为固定 ConfigurationError（MC-7）", async () => {
    const requestClient = vi.fn(async () => {
      throw new ProtocolRequestError(-32601, "Method not found");
    });
    const port = createProtocolImageGenerationPort(makeContext(requestClient));

    let caught: unknown;
    try {
      await port.generateImage({ prompt: "a cat" });
    } catch (error) {
      caught = error;
    }
    expect(isCoreError(caught)).toBe(true);
    expect((caught as { type: string }).type).toBe(CoreErrorType.ConfigurationError);
    expect((caught as Error).message).toContain("模型设置页 → 图像生成配置");
  });

  it("其余协议错误（-32603 等）原样上抛，不做本地兜底", async () => {
    const requestClient = vi.fn(async () => {
      throw new ProtocolRequestError(-32603, "host internal failure");
    });
    const port = createProtocolImageGenerationPort(makeContext(requestClient));

    await expect(port.generateImage({ prompt: "a cat" })).rejects.toThrow(
      "host internal failure",
    );
  });

  it("协议结果形状漂移（多余字段/坏形状）在严格 parse 处拒绝", async () => {
    const requestClient = vi.fn(async () => ({
      ok: true,
      // 缺 imageBase64/contentType/bytes。
    }));
    const port = createProtocolImageGenerationPort(makeContext(requestClient));

    await expect(port.generateImage({ prompt: "a cat" })).rejects.toThrow();
  });
});
