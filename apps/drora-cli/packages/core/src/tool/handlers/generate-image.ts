// ============================================================
// GenerateImage Tool Handler
// ============================================================
// agent 内置文生图（specs/model-capabilities.md §6）：经 context.imageGenerationPort
// 反向 RPC 到 host 画图服务（出站与凭据解密留在 host，凭据零出 host）。
// 工具恒注册（不做 include 布尔门）：可用性由端口错误语义统一表达——端口缺席、
// host -32601 翻译、档案未启用/未配置都是结构化 ConfigurationError（含设置页指引），
// 其余失败是工具正常输出（差异化文案供模型转述，照 testJevConnection 分类）。
// 产物落 writeToolResultBinaryArtifact（retention "session"），≤200KiB 追加
// node_repl_images display 投影载荷；模型内容只有路径摘要，不回灌图片字节。

import {
  CoreErrorType,
  createCoreError,
  GENERATE_IMAGE_TOOL_NAME,
  GenerateImageInputJsonSchema,
  GenerateImageInputSchema,
  GenerateImageOutputJsonSchema,
  GenerateImageOutputSchema,
  GenerateImagePortResultSchema,
  type GenerateImageInput,
  type GenerateImageOutput,
} from "@drora/contracts";
import { isAbsolute, resolve } from "node:path";
import type { TraceContext } from "@drora/contracts";
import type { ToolEntry, ToolExecutionContext, ToolHandler } from "../types.js";
import { MCP_IMAGE_INLINE_BASE64_BYTES } from "../../mcp/image-normalization.js";

/** Host 侧出站 180s（spec §6.3）+ 取消/序列化余量。 */
const GENERATE_IMAGE_TOOL_TIMEOUT_MS = 185_000;
/** 模型可见内容预算：产物只回路径与摘要（图片字节不回灌模型上下文）。 */
const GENERATE_IMAGE_MODEL_BYTES = 24_000;
/** 持久化 output 内联预算：容纳 ≤200KiB 的 display 投影载荷（node_repl 先例）。 */
const GENERATE_IMAGE_INLINE_BYTES = 1_000_000;

const IMAGE_GENERATION_SETTINGS_GUIDE = "在模型设置页 → 图像生成配置";

function assertImageGenerationPort(
  context: ToolExecutionContext,
): asserts context is ToolExecutionContext & {
  imageGenerationPort: NonNullable<ToolExecutionContext["imageGenerationPort"]>;
} {
  if (context.imageGenerationPort) return;
  throw createCoreError(
    CoreErrorType.ConfigurationError,
    `Image generation is not configured for ${GENERATE_IMAGE_TOOL_NAME}（${IMAGE_GENERATION_SETTINGS_GUIDE}）`,
    {
      context: {
        toolCallId: context.toolCallId,
        toolName: GENERATE_IMAGE_TOOL_NAME,
      },
      recoverable: false,
    },
  );
}

function traceFromToolContext(context: ToolExecutionContext): TraceContext {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
    sessionId: context.sessionId,
    turnId: context.turnId,
  } as TraceContext;
}

function extensionForMimeType(mimeType: string): string {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    default:
      return ".bin";
  }
}

const generateImageHandler: ToolHandler = async (input, context) => {
  const parsed = GenerateImageInputSchema.parse(input) as GenerateImageInput;
  assertImageGenerationPort(context);

  const result = GenerateImagePortResultSchema.parse(
    // 取消贯通（specs/model-capabilities.md §12）：把执行取消信号随出站透传，
    // 用户打断回合时 pending 反向 RPC 即刻终止，不再留孤儿请求等 Host 180s 超时。
    await context.imageGenerationPort.generateImage(
      {
        prompt: parsed.prompt,
        ...(parsed.size === undefined ? {} : { size: parsed.size }),
      },
      context.abortSignal ? { signal: context.abortSignal } : undefined,
    ),
  );

  if (!result.ok) {
    // 配置类失败（档案未启用/未配置）是环境错误而非业务结果：结构化
    // ConfigurationError 让 executor 走失败链路（MC-7）；host 文案已含设置页指引。
    if (result.errorKind === "disabled" || result.errorKind === "not_configured") {
      throw createCoreError(CoreErrorType.ConfigurationError, result.message, {
        context: {
          toolCallId: context.toolCallId,
          toolName: GENERATE_IMAGE_TOOL_NAME,
        },
        recoverable: false,
      });
    }
    // 其余失败（401/429/5xx/坏载荷/超限/网络）是可转述的业务结果（MC-8）。
    const failedOutput: GenerateImageOutput = {
      status: "failed",
      artifactPath: null,
      artifactUri: null,
      contentType: null,
      bytes: 0,
      message: result.message,
      reason: result.errorKind,
    };
    return GenerateImageOutputSchema.parse(failedOutput) as GenerateImageOutput;
  }

  // 产物必须落 artifact（工具的意义就是产出本地文件）：store 缺席或无二进制写
  // 方法按配置错误处理，不静默丢弃图片。
  const artifactStore = context.artifactStore;
  const writeBinary = artifactStore?.writeToolResultBinaryArtifact;
  if (!artifactStore || !writeBinary) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      `Artifact store is not configured for ${GENERATE_IMAGE_TOOL_NAME}`,
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: GENERATE_IMAGE_TOOL_NAME,
        },
        recoverable: false,
      },
    );
  }

  const content = Buffer.from(result.imageBase64, "base64");
  const artifact = await writeBinary.call(
    artifactStore,
    {
      sessionId: context.sessionId,
      turnId: context.turnId,
      toolCallId: context.toolCallId,
      toolName: GENERATE_IMAGE_TOOL_NAME,
      content,
      contentType: result.contentType,
      extension: extensionForMimeType(result.contentType),
      retention: "session",
      trace: traceFromToolContext(context),
    },
    { signal: context.abortSignal },
  );
  const artifactPath = artifact.path
    ? isAbsolute(artifact.path)
      ? artifact.path
      : resolve(artifact.path)
    : null;

  // ≤200KiB：追加 display 投影载荷（executor createNodeReplDisplay 从 output.images
  // 投影 node_repl_images display，照 node_repl 先例）；大图展示走 artifactPath。
  const base64Bytes = Buffer.byteLength(result.imageBase64, "utf8");
  const inlineForDisplay = base64Bytes <= MCP_IMAGE_INLINE_BASE64_BYTES;

  const output: GenerateImageOutput = GenerateImageOutputSchema.parse({
    status: "ready",
    artifactPath,
    artifactUri: artifact.uri,
    contentType: result.contentType,
    bytes: result.bytes,
    message: artifactPath ? `Image saved to: ${artifactPath}` : "Image generated",
    reason: null,
    ...(inlineForDisplay
      ? { images: [{ base64: result.imageBase64, mimeType: result.contentType }] }
      : {}),
  }) as GenerateImageOutput;
  return output;
};

function formatGenerateImageModelContent(output: unknown): string {
  if (typeof output === "object" && output !== null && "message" in output) {
    const message = (output as { message?: unknown }).message;
    const bytes = (output as { bytes?: unknown }).bytes;
    const contentType = (output as { contentType?: unknown }).contentType;
    if (typeof message === "string") {
      const meta =
        typeof bytes === "number" && bytes > 0 && typeof contentType === "string"
          ? ` (${contentType}, ${bytes} bytes)`
          : "";
      return `${message}${meta}`;
    }
  }
  return typeof output === "string" ? output : (JSON.stringify(output) ?? "");
}

export const generateImageToolEntry: ToolEntry = {
  capability: "Generate an image from a text prompt via the user's configured image-generation endpoint",
  metadata: {
    name: GENERATE_IMAGE_TOOL_NAME,
    description: [
      "Generate an image from a text prompt using the image-generation endpoint configured in the user's model capabilities profile (e.g. OpenAI images-compatible APIs such as zhipu CogView or dall-e).",
      "Returns the absolute path of the saved image file; the file is already on disk — reference it directly instead of re-generating.",
      "If the tool reports a configuration error, tell the user to enable and fill in the image-generation entry in Settings → Model capabilities (image generation).",
      "size is a free-form hint (e.g. \"1024x1024\"); when the generated image exceeds the payload limit, retry with a smaller size.",
    ].join("\n"),
    modelInstructions: [
      "Use this instead of external image tools when the user asks to draw/generate/create an image; it uses their own configured endpoint.",
      "Always report the saved absolute path back to the user.",
      "Failures carry a reason: auth_failed means the API key is invalid; rate_limited asks to retry later; payload_too_large suggests a smaller size — follow the message instead of retrying blindly.",
    ],
    // 上游 v3.16.1 tool-search 机制要求非驻留内建工具声明 shouldDefer=true 才能进入
    // 「先公告、按需加载 schema」集合（照 vault-search.ts 同款理由）。
    shouldDefer: true,
    readOnly: false,
    destructive: false,
    concurrentSafe: true,
    timeoutMs: GENERATE_IMAGE_TOOL_TIMEOUT_MS,
    maxOutputBytes: GENERATE_IMAGE_MODEL_BYTES,
    sideEffectScope: "network",
    riskLevel: "medium",
    needsApproval: true,
  },
  handler: generateImageHandler,
  formatModelContent: formatGenerateImageModelContent,
  isModelContentBounded: () => true,
  inputSchema: GenerateImageInputJsonSchema,
  outputSchema: GenerateImageOutputJsonSchema,
  runtimeInputSchema: GenerateImageInputSchema,
  runtimeOutputSchema: GenerateImageOutputSchema,
  permission: {
    // 出站 + 潜在计费，对齐仓库现有出站工具（WebFetch）的 permission 形态
    // （spec §6.2/OQ-2）。patternSources 取 toolName 而非 network：出站 baseUrl 是
    // 用户档案配置的固定端点，模型可控面只有 prompt 文本，按工具名记忆「总是允许
    // 生成图像」语义正确（WebFetch 的 network pattern 针对模型提供的 URL，不适用）。
    permission: "image_generation",
    reason:
      "GenerateImage sends the prompt to the user's configured image-generation endpoint and may incur billing",
    riskLevel: "medium",
    sideEffectScope: "network",
    needsApproval: true,
    patternSources: ["toolName"],
    alwaysAllowPatternSources: ["toolName"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: GENERATE_IMAGE_INLINE_BYTES,
    maxModelBytes: GENERATE_IMAGE_MODEL_BYTES,
    strategy: "truncate",
    preview: {
      maxBytes: GENERATE_IMAGE_MODEL_BYTES,
      direction: "head",
    },
  },
  timeout: {
    defaultMs: GENERATE_IMAGE_TOOL_TIMEOUT_MS,
    maxMs: GENERATE_IMAGE_TOOL_TIMEOUT_MS,
    allowCallOverride: false,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "Image generation was cancelled before the image was returned",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};
