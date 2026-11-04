/**
 * Host 图像生成服务（specs/model-capabilities.md §6.1/§6.3；F-5/F-6）。
 *
 * generate_image 工具的出站执行者，全部留在 Host 进程内：
 * - 每次请求读档案快照（enabled/baseUrl/modelId fail-closed 校验，未启用/未配置
 *   → 结构化失败含「模型设置页 → 图像生成配置」指引，零出站）；
 * - 读凭据（credentialService 解密；凭据不落日志、不进 RPC 面、不进 CLI）；
 * - 出站 POST {baseUrl}/images/generations（OpenAI images 兼容，n 固定 1，180s 超时）：
 *   b64_json 优先；仅 url 时 Host 下载（≤20MiB，content-type 须 image/*）；最终
 *   base64 载荷 ≤8MiB（防 stdio 大帧风险，OQ-5 实测后可调）；
 * - 失败以结构化 ok:false 返回（不抛业务错，照 testJevConnection 风格）：401/403
 *   认证失败、429 限流、其余 4xx/5xx 透传状态码、坏 JSON/坏载荷结构化报错。
 */
import { modelCapabilityCredentialKey } from "@drora/shared";
import type { ICredentialService } from "../credential/credential.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IModelCapabilitiesService } from "./contract.js";

const logger = createServiceLogger("modelCapabilities");

/** OpenAI images 兼容生成路径（F-6：baseUrl 含版本段，拼在去尾斜杠后的 baseUrl 后）。 */
const IMAGES_GENERATIONS_PATH = "/images/generations";
/** 生成类接口慢于聊天（spec §6.3）：Host 侧出站超时。 */
const IMAGE_GENERATION_TIMEOUT_MS = 180_000;
/** base64 载荷上限（spec §6.3/OQ-5）：超出报错并提示换小尺寸，防 stdio 大帧风险。 */
const IMAGE_GENERATION_MAX_BASE64_BYTES = 8 * 1024 * 1024;
/** 仅 url 响应时 Host 下载的原始字节上限。 */
const IMAGE_GENERATION_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** 失败分类（与 shared drora-protocol / contracts 的 errorKind 枚举一一对应）。 */
export type ImageGenerationErrorKind =
  | "disabled"
  | "not_configured"
  | "auth_failed"
  | "rate_limited"
  | "endpoint_error"
  | "bad_response"
  | "payload_too_large"
  | "network";

export type ImageGenerationResult =
  | { ok: true; imageBase64: string; contentType: string; bytes: number }
  | { ok: false; errorKind: ImageGenerationErrorKind; message: string };

export interface ImageGenerationServiceDependencies {
  /** 档案唯一所有者（每次请求读快照，天然最新，spec §4 生效语义）。 */
  modelCapabilities: Pick<IModelCapabilitiesService, "get">;
  /** 凭据解密读取；生产注入 Host 共享实例，测试注入假实现。 */
  credentialService: Pick<ICredentialService, "load">;
  /** 注入 fetch 便于测试（默认 globalThis.fetch，照 jevTransport 先例）。 */
  fetchImpl?: typeof fetch;
}

/** https 强制；localhost/127.0.0.1/[::1]/*.localhost 明文例外（照 voiceVendorBaseUrl 规则）。 */
function isUsableBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    return (
      host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function configurationFailure(
  errorKind: "disabled" | "not_configured",
  message: string,
): ImageGenerationResult {
  return { ok: false, errorKind, message };
}

/** 从 OpenAI images 兼容响应体提取第一张图（b64_json 优先，仅 url 由调用方下载）。 */
function readImageDataEntry(payload: unknown): { b64Json?: string; url?: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (typeof first !== "object" || first === null) return null;
  const record = first as { b64_json?: unknown; url?: unknown };
  if (typeof record.b64_json === "string" && record.b64_json.length > 0) {
    return { b64Json: record.b64_json };
  }
  if (typeof record.url === "string" && record.url.length > 0) {
    return { url: record.url };
  }
  return null;
}

/** 仅 url 响应时 Host 下载：≤20MiB、content-type 须 image/*（spec §6.1）。 */
async function downloadImageFromUrl(
  url: string,
  fetchImpl: typeof fetch,
): Promise<
  | { ok: true; imageBase64: string; contentType: string; bytes: number }
  | { ok: false; errorKind: ImageGenerationErrorKind; message: string }
> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS) });
  } catch (error) {
    return {
      ok: false,
      errorKind: "network",
      message: `图像下载失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      errorKind: "endpoint_error",
      message: `图像下载失败：端点返回 ${response.status}`,
    };
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!/^image\/[a-z0-9.+-]+$/iu.test(contentType)) {
    return {
      ok: false,
      errorKind: "bad_response",
      message: `图像下载失败：响应 content-type 不是 image/*（${contentType || "未知"}）`,
    };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  try {
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > IMAGE_GENERATION_MAX_DOWNLOAD_BYTES) {
          await reader.cancel().catch(() => undefined);
          return {
            ok: false,
            errorKind: "payload_too_large",
            message: "图像下载超过 20MiB 上限，请尝试更小的尺寸",
          };
        }
        chunks.push(value);
      }
    } else {
      const buffer = new Uint8Array(await response.arrayBuffer());
      total = buffer.byteLength;
      if (total > IMAGE_GENERATION_MAX_DOWNLOAD_BYTES) {
        return {
          ok: false,
          errorKind: "payload_too_large",
          message: "图像下载超过 20MiB 上限，请尝试更小的尺寸",
        };
      }
      chunks.push(buffer);
    }
  } catch (error) {
    return {
      ok: false,
      errorKind: "network",
      message: `图像下载失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (total === 0) {
    return { ok: false, errorKind: "bad_response", message: "图像下载失败：响应体为空" };
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    ok: true,
    imageBase64: Buffer.from(merged).toString("base64"),
    contentType,
    bytes: total,
  };
}

export function createImageGenerationService(dependencies: ImageGenerationServiceDependencies): {
  generate(request: { prompt: string; size?: string }): Promise<ImageGenerationResult>;
} {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return {
    async generate(request: { prompt: string; size?: string }): Promise<ImageGenerationResult> {
      // fail-closed：档案快照逐项校验，未启用/未配置零出站（MC-4/MC-7）。
      const snapshot = await dependencies.modelCapabilities.get();
      const capability = snapshot.capabilities["image-generation"];
      if (!capability.enabled) {
        return configurationFailure(
          "disabled",
          "图像生成未启用：请在模型设置页 → 图像生成配置中开启",
        );
      }
      const baseUrl = capability.baseUrl.trim();
      const modelId = capability.modelId.trim();
      if (baseUrl.length === 0 || modelId.length === 0 || !isUsableBaseUrl(baseUrl)) {
        return configurationFailure(
          "not_configured",
          "图像生成配置不完整（需 https Base URL、模型 ID 与 API Key）：请在模型设置页 → 图像生成配置中补全",
        );
      }
      const apiKey = (
        await dependencies.credentialService.load(modelCapabilityCredentialKey.imageGeneration)
      )?.trim();
      if (!apiKey) {
        return configurationFailure(
          "not_configured",
          "图像生成缺少 API Key：请在模型设置页 → 图像生成配置中填写",
        );
      }

      const url = `${baseUrl.replace(/\/+$/u, "")}${IMAGES_GENERATIONS_PATH}`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            prompt: request.prompt,
            ...(request.size === undefined ? {} : { size: request.size }),
            n: 1,
          }),
          signal: AbortSignal.timeout(IMAGE_GENERATION_TIMEOUT_MS),
        });
      } catch (error) {
        // 网络层失败（含超时）：不出站结果，结构化 network；日志不携带凭据与完整 prompt。
        logger.warn(undefined, "image generation request failed", {
          urlOrigin: new URL(url).origin,
          error: error instanceof Error ? error.name : typeof error,
        });
        return {
          ok: false,
          errorKind: "network",
          message: `图像生成请求失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // 错误分类照 testJevConnection 风格（spec §6.3）：401/403 认证、429 限流、
      // 其余非 2xx 透传状态码（响应体摘要只取前 200 字符，不携带凭据）。
      if (response.status === 401 || response.status === 403) {
        return { ok: false, errorKind: "auth_failed", message: "认证失败：API Key 无效或无权限" };
      }
      if (response.status === 429) {
        return { ok: false, errorKind: "rate_limited", message: "请求被限流（429），请稍后重试" };
      }
      if (response.status < 200 || response.status >= 300) {
        const bodySummary = (await response.text().catch(() => "")).slice(0, 200).trim();
        return {
          ok: false,
          errorKind: "endpoint_error",
          message: `端点返回 ${response.status}${bodySummary ? `：${bodySummary}` : ""}`,
        };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { ok: false, errorKind: "bad_response", message: "端点响应不是合法 JSON" };
      }
      const entry = readImageDataEntry(payload);
      if (entry === null) {
        return {
          ok: false,
          errorKind: "bad_response",
          message: "端点响应缺少图像数据（data[0].b64_json / data[0].url 均缺失）",
        };
      }

      if (entry.b64Json !== undefined) {
        const base64Bytes = Buffer.byteLength(entry.b64Json, "utf8");
        if (base64Bytes > IMAGE_GENERATION_MAX_BASE64_BYTES) {
          return {
            ok: false,
            errorKind: "payload_too_large",
            message: "生成图片超过 8MiB 上限，请尝试更小的尺寸",
          };
        }
        const content = Buffer.from(entry.b64Json, "base64");
        if (content.byteLength === 0) {
          return { ok: false, errorKind: "bad_response", message: "端点响应的图像数据为空" };
        }
        // OpenAI images 兼容协议未随 b64_json 携带 MIME；PNG 是该族的通用缺省产物。
        return {
          ok: true,
          imageBase64: entry.b64Json,
          contentType: "image/png",
          bytes: content.byteLength,
        };
      }

      // 到这里只剩 url 分支；显式判空防 readImageDataEntry 返回形状之外的空值。
      if (entry.url === undefined) {
        return {
          ok: false,
          errorKind: "bad_response",
          message: "端点响应缺少图像数据（data[0].b64_json / data[0].url 均缺失）",
        };
      }
      const downloaded = await downloadImageFromUrl(entry.url, fetchImpl);
      if (!downloaded.ok) return downloaded;
      const base64Bytes = Buffer.byteLength(downloaded.imageBase64, "utf8");
      if (base64Bytes > IMAGE_GENERATION_MAX_BASE64_BYTES) {
        return {
          ok: false,
          errorKind: "payload_too_large",
          message: "生成图片超过 8MiB 上限，请尝试更小的尺寸",
        };
      }
      return downloaded;
    },
  };
}
