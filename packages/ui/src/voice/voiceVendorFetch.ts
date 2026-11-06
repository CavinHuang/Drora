/**
 * 语音厂商出站 fetch 工厂（specs/model-capabilities.md §15.8 CORS 根治批）。
 *
 * 路由规则：url host ∈ VOICE_VENDOR_PROXY_ALLOWED_HOSTS 且平台提供 voiceVendorProxyFetch
 * （仅桌面）→ 经 desktop main net.fetch 代理（厂商 CORS 预检白名单堵死浏览器直连，
 * 火山单 Key X-Api-Key 是实证案例）；其余一切 → 直连 fetch（OpenAI 兼容族 CORS 友好、
 * Web/手机平台方法缺席，行为与现状零差异）。
 *
 * 语义对齐直连：AbortSignal 竞速（signal 不跨 IPC——renderer race 提前结算，main 侧
 * 另有 60s 硬超时兜底）；响应按 base64 还原 ResponseLike（text=utf8 解码供火山 NDJSON
 * 流、blob=字节+contentType 供 OpenAI 兼容音频），cloudTtsAdapter 零改动消费。
 * 隐私边界不变：零日志，载荷只经 IPC 到本机 main。
 */

import { isVoiceVendorProxyAllowedUrl, type IPlatformService } from "@drora/shared";
import type { CloudTtsFetch, ResponseLike } from "./cloudTtsAdapter.js";

/** 平台依赖（useOptionalPlatform 结果直传；null/undefined = Web/非桌面 = 恒直连）。 */
export interface VoiceVendorFetchDeps {
  platform?: Pick<IPlatformService, "voiceVendorProxyFetch"> | null;
}

/** signal 提前中止竞速：AbortSignal 结构不可克隆不能过 IPC，用 race 模拟直连中止语义。 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("The operation was aborted.", "AbortError"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function base64ToBytes(bodyBase64: string): Uint8Array {
  const binary = atob(bodyBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 代理响应 → 适配器 ResponseLike（blob/text 双供给，按分支各取所需）。 */
function wrapProxyResponse(response: {
  ok: boolean;
  status: number;
  contentType: string | null;
  bodyBase64: string;
}): ResponseLike {
  const bytes = base64ToBytes(response.bodyBase64);
  return {
    ok: response.ok,
    status: response.status,
    blob: async () =>
      new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: response.contentType ?? "application/octet-stream",
      }),
    text: async () => new TextDecoder().decode(bytes),
  };
}

/**
 * IPC 错误剥壳：Electron ipcRenderer.invoke 把 main 侧 throw 包装成
 * `Error invoking remote method '<channel>': Error: <原始消息>`——剥出真实消息，
 * 避免内部通道名经 toast/warn 呈现给用户（AGENTS：内部服务地址不入用户面）。
 * 非 IPC 包装形态的错误原样返回。
 */
function unwrapIpcError(error: unknown): unknown {
  if (error instanceof Error) {
    const marker = "Error invoking remote method";
    if (error.message.startsWith(marker)) {
      const idx = error.message.lastIndexOf("Error: ");
      if (idx >= 0) {
        return new Error(error.message.slice(idx + "Error: ".length));
      }
    }
  }
  return error;
}

/**
 * 代理载荷形状守卫（§15.8 审查修复）：代理通道只接受纯字符串记录 headers +
 * string body（schema strict 侧再校验）。形状不符（Headers 实例/FormData 等）
 * 保守回退直连——直连 fetch 对这些形状语义正确，代理路径反而会发畸形载荷。
 */
function isProxyShaped(init: RequestInit): init is RequestInit & {
  headers: Record<string, string>;
  body: string;
} {
  const headers = init.headers;
  // Headers 实例 typeof 也是 "object"，但其键值在原型方法里（Object.values 为空），
  // 必须显式排除，否则会被误判为纯记录发进代理。
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return false;
  }
  if (headers !== undefined && headers !== null) {
    if (typeof headers !== "object" || Array.isArray(headers)) {
      return false;
    }
    for (const value of Object.values(headers as Record<string, unknown>)) {
      if (typeof value !== "string") {
        return false;
      }
    }
  }
  return init.body === undefined || typeof init.body === "string";
}

/**
 * 构造语音厂商 fetch（播报腿 createCloudTtsAdapter.deps.fetch 与试听腿
 * synthesizeOnce opts.fetch 共用；无状态可 memo 复用）。
 */
export function createVoiceVendorFetch(deps: VoiceVendorFetchDeps): CloudTtsFetch {
  const proxyFetch = deps.platform?.voiceVendorProxyFetch?.bind(deps.platform);
  return async (input, init) => {
    // 对齐直连 fetch 语义：调用前已中止 → 不发起任何出站（IPC 不虚发）。
    if (init.signal?.aborted) {
      throw init.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    }
    if (!proxyFetch || !isVoiceVendorProxyAllowedUrl(input) || !isProxyShaped(init)) {
      // 非白名单厂商 / 非桌面平台 / 载荷形状不符：直连（现状路径零变化）。
      return fetch(input, init);
    }
    try {
      const response = await raceAbort(
        proxyFetch({
          url: input,
          headers: init.headers ?? {},
          body: init.body ?? "",
        }),
        init.signal,
      );
      return wrapProxyResponse(response);
    } catch (error) {
      throw unwrapIpcError(error);
    }
  };
}
