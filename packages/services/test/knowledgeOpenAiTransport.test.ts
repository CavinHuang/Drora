/**
 * OpenAI 兼容 Jev 传输单测（spec §5d.10 提供商维度）。
 *
 * 断言线格式（POST {baseUrl}/chat/completions、Bearer、model/temperature/messages）、
 * 响应解析宽松度（干净 JSON / 代码围栏 / 裸数字）、非 2xx 与解析失败 → body=null
 * （adapter 按 provider_error 单候选回退）。不发起真实网络请求。
 * 运行：node --import tsx --test packages/services/test/knowledgeOpenAiTransport.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenAICompatibleTransport,
  extractNoulScore,
} from "../src/knowledge/decision/jevTransport.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function transportWith(fetchImpl: typeof fetch) {
  return createOpenAICompatibleTransport({
    baseUrl: "https://api.example.ai/v4",
    apiKey: "sk-openai-test",
    model: "glm-4.7",
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

test("线格式：POST {baseUrl}/chat/completions + Bearer + model/temperature/messages", async () => {
  let captured: { url: string; init: RequestInit } | null = null;
  const transport = transportWith(async (url, init) => {
    captured = { url: String(url), init: init ?? {} };
    return jsonResponse({
      model: "glm-4.7",
      choices: [{ message: { content: '{"type":"noul","noul":0.87}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    });
  });
  const response = await transport.post(scoringRequest());
  assert.ok(captured);
  assert.equal(captured.url, "https://api.example.ai/v4/chat/completions");
  assert.equal(captured.init.method, "POST");
  assert.equal((captured.init.headers as Record<string, string>).Authorization, "Bearer sk-openai-test");
  const body = JSON.parse(String(captured.init.body));
  assert.equal(body.model, "glm-4.7");
  assert.equal(body.temperature, 0);
  assert.equal(body.messages[0].role, "system");
  assert.ok(body.messages[1].content.includes("测试查询"));
  assert.ok(body.messages[1].content.includes("片段内容"));
  assert.ok(body.messages[1].content.includes("判断片段是否支持查询"));

  assert.equal(response.status, 200);
  assert.equal(response.body?.answers.relevance?.noul, 0.87);
  assert.equal(response.body?.model, "glm-4.7");
  assert.equal(response.body?.usage?.input_tokens, 12);
  assert.equal(response.body?.usage?.output_tokens, 5);
});

test("解析宽松：代码围栏 JSON 与裸数字都能提取", async () => {
  assert.equal(extractNoulScore('```json\n{"type":"noul","noul":0.5}\n```'), 0.5);
  assert.equal(extractNoulScore("相关性评分：0.33"), 0.33);
  assert.equal(extractNoulScore("无法判定"), null);
});

test("解析失败 → 2xx + body=null（adapter 按 provider_error 回退）", async () => {
  const transport = transportWith(async () => jsonResponse({ choices: [{ message: { content: "我不会" } }] }));
  const response = await transport.post(scoringRequest());
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
});

test("429/5xx 原样透传（重试与 5xx 分类由 adapter 承担）", async () => {
  const transport = transportWith(async () => jsonResponse({ error: "rate" }, 429));
  const response = await transport.post(scoringRequest());
  assert.equal(response.status, 429);
  assert.equal(response.body, null);
});

test("构造校验：缺 baseUrl/model/apiKey 即抛错（绝不静默出站）", () => {
  for (const options of [
    { baseUrl: "  ", apiKey: "k", model: "m" },
    { baseUrl: "https://x", apiKey: " ", model: "m" },
    { baseUrl: "https://x", apiKey: "k", model: "" },
  ]) {
    assert.throws(
      () => createOpenAICompatibleTransport(options as never),
      /需要/,
      JSON.stringify(options),
    );
  }
});
