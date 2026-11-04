import { describe, expect, it, vi } from "vitest";
import {
  CoreErrorType,
  isCoreError,
  type ToolArtifactStorePort,
  type ToolArtifactWriteResult,
} from "@drora/contracts";
import { generateImageToolEntry } from "../src/tool/handlers/generate-image.js";
import type { ImageGenerationPort } from "@drora/contracts";
import type { ToolExecutionContext } from "../src/tool/types.js";
import { createToolResultDisplay } from "../src/tool/executor/result-display.js";

/** 200KiB 以下的小图（base64 后 ~8B）。 */
const TINY_PNG_BASE64 = Buffer.from("png-bytes").toString("base64");

function makeContext(overrides: {
  imageGenerationPort?: ImageGenerationPort;
  artifactStore?: ToolArtifactStorePort;
}): ToolExecutionContext {
  return {
    toolCallId: "tool_generate_image",
    traceId: "trace_test",
    spanId: "span_test",
    abortSignal: new AbortController().signal,
    workingDirectory: "/work",
    workspaceRoot: "/work",
    sessionId: "sess_test",
    turnId: "turn_test",
    ...(overrides.imageGenerationPort
      ? { imageGenerationPort: overrides.imageGenerationPort }
      : {}),
    ...(overrides.artifactStore ? { artifactStore: overrides.artifactStore } : {}),
  };
}

function makeArtifactStore(
  artifactPath = "/artifacts/saved.png",
): { store: ToolArtifactStorePort; writeSpy: ReturnType<typeof vi.fn> } {
  const writeSpy = vi.fn(async () =>
    Promise.resolve({
      id: "artifact-1",
      uri: `file://${artifactPath}`,
      path: artifactPath,
      bytes: 8,
      contentType: "image/png",
      createdAt: new Date(),
    } satisfies ToolArtifactWriteResult),
  );
  const store: ToolArtifactStorePort = {
    writeToolResultArtifact: vi.fn(async () => {
      throw new Error("unexpected text artifact write");
    }),
    writeToolResultBinaryArtifact: writeSpy,
    readToolResultArtifact: vi.fn(async () => {
      throw new Error("unexpected read");
    }),
  };
  return { store, writeSpy };
}

function makePort(
  result:
    | { ok: true; imageBase64: string; contentType: string; bytes: number }
    | { ok: false; errorKind: string; message: string },
): { port: ImageGenerationPort; generateSpy: ReturnType<typeof vi.fn> } {
  const generateSpy = vi.fn(async () => result);
  return {
    port: { generateImage: generateSpy },
    generateSpy,
  };
}

describe("generate_image handler（specs/model-capabilities.md §6.2；MC-6/MC-7/MC-8）", () => {
  it("端口缺席 → 结构化 ConfigurationError，文案含设置页指引（MC-7）", async () => {
    const { store } = makeArtifactStore();
    let caught: unknown;
    try {
      await generateImageToolEntry.handler(
        { prompt: "a cat" },
        makeContext({ artifactStore: store }),
      );
    } catch (error) {
      caught = error;
    }
    expect(isCoreError(caught)).toBe(true);
    expect((caught as { type: string }).type).toBe(CoreErrorType.ConfigurationError);
    expect((caught as Error).message).toContain("模型设置页 → 图像生成配置");
  });

  it("档案未启用（disabled）→ ConfigurationError，透传 host 指引文案（MC-7）", async () => {
    const { port } = makePort({
      ok: false,
      errorKind: "disabled",
      message: "图像生成未启用：请在模型设置页 → 图像生成配置中开启",
    });
    const { store } = makeArtifactStore();
    let caught: unknown;
    try {
      await generateImageToolEntry.handler(
        { prompt: "a cat" },
        makeContext({ imageGenerationPort: port, artifactStore: store }),
      );
    } catch (error) {
      caught = error;
    }
    expect(isCoreError(caught)).toBe(true);
    expect((caught as { type: string }).type).toBe(CoreErrorType.ConfigurationError);
    expect((caught as Error).message).toContain("图像生成未启用");
  });

  it("未配置（not_configured）同样走 ConfigurationError（MC-7）", async () => {
    const { port } = makePort({
      ok: false,
      errorKind: "not_configured",
      message: "图像生成配置不完整：请在模型设置页 → 图像生成配置中补全",
    });
    const { store } = makeArtifactStore();
    await expect(
      generateImageToolEntry.handler(
        { prompt: "a cat" },
        makeContext({ imageGenerationPort: port, artifactStore: store }),
      ),
    ).rejects.toMatchObject({ type: CoreErrorType.ConfigurationError });
  });

  it("正常链：b64 结果 → artifact 落盘（session retention）+ 路径 text + ≤200KiB display（MC-6）", async () => {
    const { port, generateSpy } = makePort({
      ok: true,
      imageBase64: TINY_PNG_BASE64,
      contentType: "image/png",
      bytes: 8,
    });
    const { store, writeSpy } = makeArtifactStore("/artifacts/generated.png");

    const context = makeContext({ imageGenerationPort: port, artifactStore: store });
    const output = (await generateImageToolEntry.handler(
      { prompt: "a cat", size: "1024x1024" },
      context,
    )) as Record<string, unknown>;

    // 端口收到归一化入参（prompt + size；n 不透出），且取消信号随出站透传
    // （specs/model-capabilities.md §12 取消贯通：context.abortSignal → port options.signal）。
    expect(generateSpy).toHaveBeenCalledWith(
      { prompt: "a cat", size: "1024x1024" },
      { signal: context.abortSignal },
    );
    expect(generateSpy.mock.calls[0][1]).toMatchObject({ signal: expect.any(AbortSignal) });
    // artifact 落盘：retention session、二进制内容、image/* 扩展名。
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const writeRequest = writeSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(writeRequest.retention).toBe("session");
    expect(writeRequest.toolName).toBe("generate_image");
    expect(writeRequest.contentType).toBe("image/png");
    expect((writeRequest.content as Buffer).toString("utf8")).toBe("png-bytes");
    // 输出：路径 + 摘要 + display 载荷。
    expect(output.status).toBe("ready");
    expect(output.artifactPath).toBe("/artifacts/generated.png");
    expect(output.message).toBe("Image saved to: /artifacts/generated.png");
    expect(output.bytes).toBe(8);
    expect(output.images).toEqual([
      { base64: TINY_PNG_BASE64, mimeType: "image/png" },
    ]);
    // executor display 投影（node_repl_images，复用 node_repl 展示面）。
    const display = createToolResultDisplay("generate_image", output);
    expect(display?.kind).toBe("node_repl_images");
    // 模型内容只有路径摘要，不回灌 base64。
    const modelContent = generateImageToolEntry.formatModelContent?.(output);
    expect(typeof modelContent).toBe("string");
    expect(modelContent).toContain("Image saved to: /artifacts/generated.png");
    expect(modelContent).not.toContain(TINY_PNG_BASE64);
  });

  it("大图（>200KiB base64）不带 images，展示走 artifactPath（MC-6）", async () => {
    // 200KiB = 204800 base64 字节；造 204801 字节的 base64 字符串。
    const largeBase64 = "a".repeat(200 * 1024 + 1);
    const { port } = makePort({
      ok: true,
      imageBase64: largeBase64,
      contentType: "image/png",
      bytes: 153600,
    });
    const { store } = makeArtifactStore("/artifacts/large.png");

    const output = (await generateImageToolEntry.handler(
      { prompt: "a cat" },
      makeContext({ imageGenerationPort: port, artifactStore: store }),
    )) as Record<string, unknown>;

    expect(output.status).toBe("ready");
    expect(output.artifactPath).toBe("/artifacts/large.png");
    expect(output.images).toBeUndefined();
    expect(createToolResultDisplay("generate_image", output)).toBeUndefined();
    expect((output.message as string)).toContain("Image saved to: /artifacts/large.png");
  });

  it("业务失败（限流/认证/超限）作为正常输出返回差异化 reason（MC-8）", async () => {
    const cases = [
      { errorKind: "rate_limited", message: "请求被限流（429），请稍后重试" },
      { errorKind: "auth_failed", message: "认证失败：API Key 无效或无权限" },
      { errorKind: "payload_too_large", message: "生成图片超过 8MiB 上限，请尝试更小的尺寸" },
    ] as const;
    for (const failure of cases) {
      const { port } = makePort({ ok: false, ...failure });
      const { store, writeSpy } = makeArtifactStore();
      const output = (await generateImageToolEntry.handler(
        { prompt: "a cat" },
        makeContext({ imageGenerationPort: port, artifactStore: store }),
      )) as Record<string, unknown>;
      expect(output.status).toBe("failed");
      expect(output.reason).toBe(failure.errorKind);
      expect(output.message).toBe(failure.message);
      expect(output.artifactPath).toBeNull();
      // 业务失败不出站落盘。
      expect(writeSpy).not.toHaveBeenCalled();
    }
  });

  it("artifact store 缺席 → ConfigurationError，不静默丢图", async () => {
    const { port } = makePort({
      ok: true,
      imageBase64: TINY_PNG_BASE64,
      contentType: "image/png",
      bytes: 8,
    });
    await expect(
      generateImageToolEntry.handler(
        { prompt: "a cat" },
        makeContext({ imageGenerationPort: port }),
      ),
    ).rejects.toMatchObject({ type: CoreErrorType.ConfigurationError });
  });

  it("工具契约：恒注册、shouldDefer、出站 permission 形态对齐 WebFetch（OQ-2）", () => {
    expect(generateImageToolEntry.metadata.name).toBe("generate_image");
    expect(generateImageToolEntry.metadata.shouldDefer).toBe(true);
    expect(generateImageToolEntry.metadata.sideEffectScope).toBe("network");
    expect(generateImageToolEntry.metadata.needsApproval).toBe(true);
    expect(generateImageToolEntry.permission).toMatchObject({
      permission: "image_generation",
      riskLevel: "medium",
      sideEffectScope: "network",
      needsApproval: true,
      patternSources: ["toolName"],
      alwaysAllowPatternSources: ["toolName"],
      denyPriority: "beforeAsk",
    });
    expect(generateImageToolEntry.timeout.defaultMs).toBeGreaterThanOrEqual(180_000);
  });
});
