/**
 * systemOne HTTP transport 单测（spec §5d.10）。
 *
 * 三类提供商（typesafe/openrouter/ai-gateway）共用同一 systemOne 线协议实现；
 * 本文件断言协议无关行为：必填守卫（Key/baseURL 缺一即抛）、baseURL 规范化
 * （末尾斜杠剥除、路径拼接 {baseURL}/v1/systemone）、提供商模型别名覆盖优先于
 * 请求携带的官方别名、状态码原样透传（429/5xx 分类由 adapter 承担）、2xx 坏
 * JSON 容错为 body=null。
 * 运行：node --import tsx --test packages/services/test/knowledgeSystemOneTransport.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TYPESAFE_OFFICIAL_BASE_URL,
  createSystemOneHttpTransport,
} from "../src/knowledge/decision/jevTransport.js";
import type { JevTransport } from "../src/knowledge/decision/jevTransport.js";

function fakeFetch(payload: { status: number; json?: unknown }) {
  const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
    calls.push({
      url: String(url),
      auth: init?.headers?.Authorization ?? "",
      body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    });
    return new Response(payload.json === undefined ? "not-json" : JSON.stringify(payload.json), {
      status: payload.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function makeRequest(model: string) {
  return {
    state: { query: "查询", note_excerpt: "片段", title: "标题" },
    model,
    questions: { relevance: { type: "noul" as const, instructions: "判定" } },
    signal: new AbortController().signal,
  };
}

test("TYPESAFE_OFFICIAL_BASE_URL 是官方托管端点（装配层缺省回落的单一出处）", () => {
  assert.equal(TYPESAFE_OFFICIAL_BASE_URL, "https://api.typesafe.ai");
});

test("缺 API Key / 缺 baseURL 构造即抛错（不做隐藏默认，绝不静默出站）", () => {
  assert.throws(
    () => createSystemOneHttpTransport({ apiKey: "", baseUrl: TYPESAFE_OFFICIAL_BASE_URL }),
    /API Key/u,
  );
  assert.throws(
    () => createSystemOneHttpTransport({ apiKey: "sk-test", baseUrl: "   " }),
    /baseURL/u,
  );
});

test("线格式：POST {baseURL}/v1/systemone + Bearer；末尾斜杠剥除；官方别名透传", async () => {
  const { calls, fetchImpl } = fakeFetch({
    status: 200,
    json: { model: "jev-latest", answers: { relevance: { type: "noul", noul: 0.5 } } },
  });
  const transport: JevTransport = createSystemOneHttpTransport({
    apiKey: "sk-test",
    baseUrl: "https://gateway.example.ai///",
    fetchImpl,
  });
  const response = await transport.post(makeRequest("jev-latest"));
  assert.equal(response.status, 200);
  assert.equal(response.body?.answers.relevance?.noul, 0.5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://gateway.example.ai/v1/systemone");
  assert.equal(calls[0]?.auth, "Bearer sk-test");
  assert.deepEqual(Object.keys(calls[0]?.body ?? {}), ["state", "model", "questions"]);
  assert.equal(calls[0]?.body.model, "jev-latest");
});

test("提供商模型别名覆盖优先于请求携带的官方别名", async () => {
  const { calls, fetchImpl } = fakeFetch({
    status: 200,
    json: { model: "tenant/jev-1.13.0", answers: { relevance: { type: "noul", noul: 0.5 } } },
  });
  const transport = createSystemOneHttpTransport({
    apiKey: "sk-test",
    baseUrl: "https://gateway.example.ai",
    model: " tenant/jev-1.13.0 ",
    fetchImpl,
  });
  await transport.post(makeRequest("jev-latest"));
  assert.equal(calls[0]?.body.model, "tenant/jev-1.13.0");
});

test("状态码原样透传；2xx 坏 JSON 容错为 body=null（adapter 按 provider_error 回退）", async () => {
  const rateLimited = fakeFetch({ status: 429, json: { error: "rate limited" } });
  const transport429 = createSystemOneHttpTransport({
    apiKey: "sk-test",
    baseUrl: TYPESAFE_OFFICIAL_BASE_URL,
    fetchImpl: rateLimited.fetchImpl,
  });
  const rateLimitResponse = await transport429.post(makeRequest("jev-latest"));
  assert.equal(rateLimitResponse.status, 429);
  assert.equal(rateLimitResponse.body, null);

  const malformed = fakeFetch({ status: 200 });
  const transportMalformed = createSystemOneHttpTransport({
    apiKey: "sk-test",
    baseUrl: TYPESAFE_OFFICIAL_BASE_URL,
    fetchImpl: malformed.fetchImpl,
  });
  const malformedResponse = await transportMalformed.post(makeRequest("jev-latest"));
  assert.equal(malformedResponse.status, 200);
  assert.equal(malformedResponse.body, null);
});
