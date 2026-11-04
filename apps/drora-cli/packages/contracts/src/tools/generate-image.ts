// ============================================================
// GenerateImage Tool - agent 内置文生图（specs/model-capabilities.md §6）
// ============================================================
// 模型能力档案的图像生成条目（F-5）出站面在 Host：CLI 工具壳经 imageGenerationPort
// 反向 RPC 取图片字节（凭据零出 Host），本地落 artifact 后只回路径与摘要。
// n 固定 1（F-8 不做清单）；size 为自由字符串——各家取值集不同，不做枚举强校验。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

// -----------------------------------------------
// Input Schema
// -----------------------------------------------

export const GENERATE_IMAGE_TOOL_NAME = "generate_image";

export const GenerateImageInputSchema = z
  .object({
    /** 图像描述（1-4000 字符；各家端点上限不同，统一在 4000 内收紧）。 */
    prompt: z.string().min(1).max(4000).describe("Text description of the image to generate"),
    /**
     * 尺寸自由字符串（不做枚举强校验——各家取值集不同）：OpenAI 如 "1024x1024"、
     * 智谱 CogView 如 "1024x1024" / "768x1344"；缺省由端点默认值决定。
     */
    size: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('Image size hint passed to the endpoint (e.g. "1024x1024"); defaults to the endpoint default'),
  })
  .strict();

export type GenerateImageInput = z.infer<typeof GenerateImageInputSchema>;

export const GenerateImageInputJsonSchema = toToolJsonSchema(GenerateImageInputSchema);

// -----------------------------------------------
// Port Result（Host 画图服务的结构化返回；失败不抛业务错，照 testJevConnection 风格）
// -----------------------------------------------

/**
 * 失败分类（specs/model-capabilities.md §6.3）。disabled/not_configured 是配置类
 * （CLI handler 翻译为 ConfigurationError 含设置页指引）；其余为业务失败，按
 * 差异化文案作为工具正常输出返回给模型转述。
 */
export const GENERATE_IMAGE_ERROR_KINDS = [
  "disabled",
  "not_configured",
  "auth_failed",
  "rate_limited",
  "endpoint_error",
  "bad_response",
  "payload_too_large",
  "network",
] as const;

export const GenerateImageSuccessSchema = z
  .object({
    ok: z.literal(true),
    /** base64 图片载荷（字节上限由 Host 保证 ≤8MiB，防 stdio 大帧风险）。 */
    imageBase64: z.string().min(1),
    /** image/* MIME；仅 url 响应时由 Host 下载并按 content-type 判定。 */
    contentType: z.string().regex(/^image\/[a-z0-9.+-]+$/iu),
    /** 原始图片字节数（解码后）。 */
    bytes: z.number().int().positive(),
  })
  .strict();

export const GenerateImageFailureSchema = z
  .object({
    ok: z.literal(false),
    errorKind: z.enum(GENERATE_IMAGE_ERROR_KINDS),
    /** 可直接转述的失败文案；配置类失败含「模型设置页 → 图像生成配置」指引。 */
    message: z.string().min(1),
  })
  .strict();

export const GenerateImagePortResultSchema = z.discriminatedUnion("ok", [
  GenerateImageSuccessSchema,
  GenerateImageFailureSchema,
]);

export type GenerateImagePortResult = z.infer<typeof GenerateImagePortResultSchema>;

// -----------------------------------------------
// Output Schema（工具面：产物已落 artifact，模型只见路径与摘要）
// -----------------------------------------------

export const GenerateImageOutputSchema = z
  .object({
    /** ready = 出图成功并落盘；failed = 出站完成但生成失败（业务失败不抛错）。 */
    status: z.enum(["ready", "failed"]),
    /** ready: 产物绝对路径；failed: null。 */
    artifactPath: z.string().nullable(),
    /** ready: artifact URI；failed: null。 */
    artifactUri: z.string().nullable(),
    /** ready: 产物 MIME（image/*）；failed: null。 */
    contentType: z.string().nullable(),
    /** ready: 原始字节；failed: 0。 */
    bytes: z.number().int().nonnegative(),
    /** ready: "Image saved to: <path>"；failed: 差异化错误文案。 */
    message: z.string(),
    /** failed 的机器可读原因（端口 errorKind）；ready: null。 */
    reason: z.string().nullable(),
    /**
     * ≤200KiB 时的 UI display 投影载荷（node_repl images 先例，executor 的
     * createNodeReplDisplay 从本字段投影 node_repl_images display）；大图缺省，
     * 展示走 artifactPath。
     */
    images: z
      .array(z.object({ base64: z.string().min(1), mimeType: z.string() }).strict())
      .max(1)
      .optional(),
  })
  .strict();

export type GenerateImageOutput = z.infer<typeof GenerateImageOutputSchema>;

export const GenerateImageOutputJsonSchema = toToolJsonSchema(GenerateImageOutputSchema);
