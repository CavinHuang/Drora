/**
 * Jev systemOne HTTP transport（W05 端口 / spec §5d.3、§5d.10 提供商维度）。
 *
 * systemOne 是 Jev 全生态唯一的线协议：官方托管端点契约来自 2026-10-10 抓取的
 * 官方文档（docs.typesafe.ai/api.md、sdk/javascript.md）——POST {baseURL}/v1/systemone、
 * Authorization: Bearer、请求 {state, model, questions}、响应 {model, answers, usage}、
 * 错误 401/422/429/529。第三方 AI Gateway（TrueFoundry / Kong / Vercel AI Gateway /
 * LiteLLM / Pydantic AI 等）与 OpenRouter 的 Jev 决策端点都按原样代理同一协议形状
 * （Kong 文档：请求路由至 {网关route}/v1/systemone），不存在 chat/completions 翻译层
 * ——Jev 没有 OpenAI 兼容端点。提供商之间只有 baseURL 部署、凭据与模型别名的差异
 * （2026-10-11 用户裁定：不硬编码无法证实公开规范 URL 的提供商端点——openrouter /
 * ai-gateway 的 baseURL 必填、由发行方文档/部署方提供，缺失即该提供商禁用）。
 *
 * adapter（授权/超时/重试/校验）只面向本端口，与提供商无关。
 * API Key 只在 Host 侧构造 transport 时注入；不进 RPC 面、日志与诊断。
 */

/** 与官方响应 answers.<name> 同形的判别（只取决策层用到的字段）。 */
export interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

export interface JevSystemOneResponse {
  model: string;
  answers: Record<string, { type: string; noul?: number; choice?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevTransportRequest {
  /** 官方字段：state（本次为「查询 + 单候选片段」的最小状态对象）。 */
  state: Record<string, string>;
  model: string;
  questions: Record<
    string,
    { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  >;
  signal: AbortSignal;
}

/** 单次 HTTP 出站结果；status 原样保留（429/5xx 分类由 adapter 承担）。 */
export interface JevTransportResponse {
  status: number;
  body: JevSystemOneResponse | null;
}

export interface JevTransport {
  post(request: JevTransportRequest): Promise<JevTransportResponse>;
}

/** TypeSafe 官方托管端点（docs.typesafe.ai，2026-10-10）；typesafe 提供商的缺省 baseURL。 */
export const TYPESAFE_OFFICIAL_BASE_URL = "https://api.typesafe.ai";

const DEFAULT_MODEL = "jev-latest";

export interface SystemOneTransportOptions {
  /** Host 侧安全配置注入；缺失时构造即抛错（绝不静默出站）。 */
  apiKey: string;
  /** 提供商/网关部署的 Jev 端点 baseURL，必填（不做任何隐藏默认）；末尾斜杠剥除。 */
  baseUrl: string;
  /** 提供商侧模型别名覆盖（如命名空间 slug）；缺省用请求携带的官方别名（jev-latest）。 */
  model?: string;
  /** 注入 fetch 便于测试与宿主网络策略（默认 globalThis.fetch）。 */
  fetchImpl?: typeof fetch;
}

/** systemOne 线协议的默认 HTTP transport；所有具名提供商（typesafe/openrouter/ai-gateway）共用。 */
export function createSystemOneHttpTransport(options: SystemOneTransportOptions): JevTransport {
  if (!options.apiKey || !options.apiKey.trim()) {
    throw new Error("systemOne transport 需要 API Key（Host 侧安全配置）");
  }
  if (!options.baseUrl || !options.baseUrl.trim()) {
    throw new Error("systemOne transport 需要端点 baseURL（提供商/网关部署方提供）");
  }
  const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
  const modelOverride = options.model?.trim() || undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async post(request: JevTransportRequest): Promise<JevTransportResponse> {
      const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          state: request.state,
          model: modelOverride || request.model || DEFAULT_MODEL,
          questions: request.questions,
        }),
        signal: request.signal,
      });
      let body: JevSystemOneResponse | null = null;
      if (response.status >= 200 && response.status < 300) {
        try {
          body = (await response.json()) as JevSystemOneResponse;
        } catch {
          body = null;
        }
      }
      return { status: response.status, body };
    },
  };
}
