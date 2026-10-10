/**
 * Jev HTTP transport 端口 + TypeSafe 默认实现（W05 / spec §5d.3）。
 *
 * 契约来源：2026-10-10 抓取的官方文档（docs.typesafe.ai/api.md、
 * docs.typesafe.ai/sdk/javascript.md）——POST {baseURL}/v1/systemone、
 * Authorization: Bearer、请求 {state, model, questions}、响应 {model, answers, usage}、
 * 错误 401/422/429/529。不从 Python 示例猜接口。
 *
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

export interface TypeSafeTransportOptions {
  /** Host 侧安全配置注入；缺失时构造即抛错（绝不静默出站）。 */
  apiKey: string;
  /** 默认官方端点（https://api.typesafe.ai）。 */
  baseUrl?: string;
  model?: string;
  /** 注入 fetch 便于测试与宿主网络策略（默认 globalThis.fetch）。 */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";

/** TypeSafe systemOne 的默认 HTTP transport（spec §5d.3 已验证契约）。 */
export function createTypeSafeHttpTransport(options: TypeSafeTransportOptions): JevTransport {
  if (!options.apiKey || !options.apiKey.trim()) {
    throw new Error("TypeSafe transport 需要 API Key（Host 侧安全配置）");
  }
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const model = options.model ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async post(request: JevTransportRequest): Promise<JevTransportResponse> {
      const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({ state: request.state, model: request.model || model, questions: request.questions }),
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
