/**
 * Jev HTTP transport 端口 + 提供商实现（W05 / spec §5d.3、§5d.10）。
 *
 * 端口是「提供商中立评分契约」：post() 收 systemOne 形状的评分请求
 * （state={query,note_excerpt,title} + questions.relevance 判定标准），返回
 * {model, answers.relevance.noul, usage} 形状的评分结果；每个提供商实现负责把
 * 该契约翻译成自家线格式（TypeSafe 原生；OpenAI 兼容走 chat/completions + JSON 裁决）。
 * adapter（授权/超时/重试/校验）只面向本端口，与提供商无关。
 *
 * TypeSafe 契约来源：2026-10-10 抓取的官方文档（docs.typesafe.ai/api.md、
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

export interface OpenAICompatibleTransportOptions {
  /** OpenAI 兼容端点根（如 https://open.bigmodel.cn/api/paas/v4），必填；缺失构造即抛错。 */
  baseUrl: string;
  apiKey: string;
  /** 评分用模型名（如 glm-4.7），必填；缺失构造即抛错。 */
  model: string;
  /** 注入 fetch 便于测试与宿主网络策略（默认 globalThis.fetch）。 */
  fetchImpl?: typeof fetch;
}

const SCORING_SYSTEM_PROMPT =
  "你是笔记检索的相关性裁判。对给定的「查询 + 笔记片段」做命题级匹配判定，只输出一个 JSON 对象，不要输出任何其它文字。";

/**
 * OpenAI 兼容提供商传输（spec §5d.10）：把提供商中立评分契约翻译成
 * POST {baseUrl}/chat/completions（Authorization: Bearer，temperature=0），
 * 要求模型只输出 {"type":"noul","noul":<0-1>}；解析宽松（容忍代码围栏/前后缀文字/
 * 裸数字）。解析失败返回 2xx + body=null——adapter 按 provider_error 单候选回退，
 * 429/5xx 语义与 TypeSafe 路径一致。
 */
export function createOpenAICompatibleTransport(
  options: OpenAICompatibleTransportOptions,
): JevTransport {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
  if (!baseUrl) throw new Error("OpenAI 兼容 transport 需要 baseUrl（Host 侧安全配置）");
  if (!options.apiKey?.trim()) throw new Error("OpenAI 兼容 transport 需要 API Key（Host 侧安全配置）");
  if (!options.model?.trim()) throw new Error("OpenAI 兼容 transport 需要模型名（Host 侧安全配置）");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async post(request: JevTransportRequest): Promise<JevTransportResponse> {
      const criterion = request.questions.relevance;
      const userPrompt = [
        `查询：${request.state.query ?? ""}`,
        `笔记标题：${request.state.title ?? ""}`,
        `笔记片段：${request.state.note_excerpt ?? ""}`,
        "",
        `判定指令：${criterion?.instructions ?? ""}`,
        `满足 → noul 接近 1：${criterion?.criteria?.true ?? ""}`,
        `不满足 → noul 接近 0：${criterion?.criteria?.false ?? ""}`,
        '',
        '只输出 JSON：{"type":"noul","noul":<0 到 1 之间的小数>}',
      ].join("\n");
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          messages: [
            { role: "system", content: SCORING_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: request.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        return { status: response.status, body: null };
      }
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        return { status: response.status, body: null };
      }
      const parsed = parseOpenAiScoringResponse(payload, options.model);
      return parsed ? { status: response.status, body: parsed } : { status: response.status, body: null };
    },
  };
}

/** 从 chat/completions 响应提取评分；任何不合法形态都返回 null（由 adapter 统一回退）。 */
function parseOpenAiScoringResponse(
  payload: unknown,
  fallbackModel: string,
): JevSystemOneResponse | null {
  const record = payload as Record<string, unknown> | null;
  const choice = (record?.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string") return null;
  const noul = extractNoulScore(content);
  if (noul === null) return null;
  const model = typeof record?.model === "string" ? record.model : fallbackModel;
  const usage = (record?.usage ?? {}) as Record<string, unknown>;
  return {
    model,
    answers: { relevance: { type: "noul", noul } },
    usage: {
      input_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      output_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
    },
  };
}

/** 宽松提取 [0,1] 分数：JSON 对象 → 围栏 JSON → 裸数字；范围校验交给 adapter（invalid_score）。 */
export function extractNoulScore(content: string): number | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/u);
  const candidates = [trimmed, fenced?.[1]?.trim() ?? ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const noul = (parsed as { noul?: unknown })?.noul;
      if (typeof noul === "number") return noul;
    } catch {
      // 继续尝试其它候选形态
    }
  }
  const bare = trimmed.match(/-?\d+(?:\.\d+)?/u);
  if (bare) {
    const value = Number.parseFloat(bare[0]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}
