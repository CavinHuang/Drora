/**
 * chat-completions 协议族具名提供商传输单测（spec §5d.10 提供商维度）。
 *
 * 断言各具名提供商的规范端点/协议头（OpenRouter X-Title、AI Gateway）、端点覆盖、
 * Bearer 鉴权、响应解析宽松度（干净 JSON / 代码围栏 / 裸数字）、非 2xx 与解析失败
 * → body=null（adapter 按 provider_error 单候选回退）。不发起真实网络请求。
 * 运行：node --import tsx --test packages/services/test/knowledgeChatCompletionsTransport.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ChatCompletionsProvider } from "../src/knowledge/decision/jevTransport.js";
import {
  createChatCompletionsScoringTransport,
  extractNoulScore,
} from "../src/knowledge/decision/jevTransport.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function transportWith(
  provider: ChatCompletionsProvider,
  fetchImpl: typeof fetch,
  overrides: { baseUrl?: string; model?: string } = {},
) {
  return createChatCompletionsScoringTransport({
    provider,
    apiKey: `sk-${provider}-test`,
    model: overrides.model ?? "openai/gpt-4o-mini",
    baseUrl: overrides.baseUrl,
    fetchImpl,
  });
}

function scoringRequest() {
  return {
    state: { query: "测试查询", note_excerpt: "片段内容", title: "标题" },
    model: "jev-latest",
    questions: {
      relevance: {
        type: "noul" as const,
        instructions: "判断片段是否支持查询",
        criteria: { true: "直接支持", false: "不支持" },
      },
    },
    signal: new AbortController().signal,
  };
}

test("OpenRouter：规范端点 + X-Title 署名头 + Bearer + model slug", async () => {
  let captured: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  const transport = transportWith("openrouter", async (url, init) => {
    captured = {
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    };
    return jsonResponse({
      model: "openai/gpt-4o-mini",
      choices: [{ message: { content: '{"type":"noul","noul":0.87}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    });
  });
  const response = await transport.post(scoringRequest());
  assert.ok(captured);
  assert.equal(captured.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(captured.headers.Authorization, "Bearer sk-openrouter-test");
  assert.equal(captured.headers["X-Title"], "Drora");
  assert.equal(captured.body.model, "openai/gpt-4o-mini");
  assert.equal(captured.body.temperature, 0);
  assert.ok(String(captured.body.messages?.[1]?.content).includes("测试查询"));

  assert.equal(response.status, 200);
  assert.equal(response.body?.answers.relevance?.noul, 0.87);
  assert.equal(response.body?.model, "openai/gpt-4o-mini");
  assert.equal(response.body?.usage?.input_tokens, 12);
});

test("AI Gateway：规范端点 ai-gateway.vercel.sh/v1，无 OpenRouter 署名头", async () => {
  let captured: { url: string; headers: Record<string, string> } | null = null;
  const transport = transportWith("ai-gateway", async (url, init) => {
    captured = { url: String(url), headers: (init?.headers ?? {}) as Record<string, string> };
    return jsonResponse({
      choices: [{ message: { content: '{"noul":0.4}' } }],
    });
  });
  const response = await transport.post(scoringRequest());
  assert.ok(captured);
  assert.equal(captured.url, "https://ai-gateway.vercel.sh/v1/chat/completions");
  assert.equal(captured.headers.Authorization, "Bearer sk-ai-gateway-test");
  assert.equal(captured.headers["X-Title"], undefined);
  assert.equal(response.body?.answers.relevance?.noul, 0.4);
});

test("端点覆盖：baseUrl 替换规范端点（网关/代理场景）", async () => {
  let capturedUrl = "";
  const transport = transportWith("openrouter", async (url) => {
    capturedUrl = String(url);
    return jsonResponse({ choices: [{ message: { content: '{"noul":0.5}' } }] });
  }, { baseUrl: "https://proxy.example.ai/openrouter/v1" });
  await transport.post(scoringRequest());
  assert.equal(capturedUrl, "https://proxy.example.ai/openrouter/v1/chat/completions");
});

test("解析宽松：围栏 JSON / 裸数字 / 失败为 null", () => {
  assert.equal(extractNoulScore('```json\n{"type":"noul","noul":0.5}\n```'), 0.5);
  assert.equal(extractNoulScore("相关性评分：0.33"), 0.33);
  assert.equal(extractNoulScore("无法判定"), null);
});

test("解析失败 → 2xx + body=null（adapter 按 provider_error 回退）；429 原样透传", async () => {
  const transport = transportWith("openrouter", async () =>
    jsonResponse({ choices: [{ message: { content: "我不会" } }] }),
  );
  const response = await transport.post(scoringRequest());
  assert.equal(response.status, 200);
  assert.equal(response.body, null);

  const rateLimited = transportWith("openrouter", async () => jsonResponse({ error: "rate" }, 429));
  const blocked = await rateLimited.post(scoringRequest());
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body, null);
});

test("构造校验：缺 apiKey/model 即抛错（绝不静默出站）", () => {
  for (const options of [
    { provider: "openrouter" as const, apiKey: " ", model: "m" },
    { provider: "ai-gateway" as const, apiKey: "k", model: " " },
  ]) {
    assert.throws(() => createChatCompletionsScoringTransport(options), /需要/, JSON.stringify(options));
  }
});
