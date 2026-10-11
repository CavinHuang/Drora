/**
 * W05 JevAdapter 单测（spec §5d.3–§5d.7）。
 *
 * 打桩 transport 断言 2026-10-10 已验证的 TypeSafe systemOne 请求形状
 * （{state, model, questions}，answers.<name>.noul/usage；Bearer 头由默认 HTTP
 * transport 添加，不进请求对象）；错误路径：429/529 短退避、5xx、超时、取消、
 * 非法评分；授权逐调用重查。不发起真实网络请求。
 * 运行：node --import tsx --test packages/services/test/knowledgeJevAdapter.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJevAdapter, mergedNoulQuestion, JEV_PROVIDER_ID } from "../src/knowledge/decision/jevAdapter.js";
import { DecisionConsentRegistry } from "../src/knowledge/decision/decisionConsent.js";
import { DEFAULT_DECISION_POLICY } from "../src/knowledge/decision/decisionPolicy.js";
import type { JevTransport, JevTransportRequest, JevTransportResponse } from "../src/knowledge/decision/jevTransport.js";
import type {
  KnowledgeDecisionCandidate,
  KnowledgeDecisionRequest,
} from "../src/knowledge/decision/decisionTypes.js";

const QUERY_HASH = "a".repeat(64);

function candidatesOf(ids: string[]): KnowledgeDecisionCandidate[] {
  return ids.map((id, index) => ({
    candidateId: id,
    chunkSha256: `sha-${id}`,
    title: `标题${id}`,
    headingPath: null,
    excerpt: `片段内容${id}`,
    localRank: index + 1,
    localScore: 0,
  }));
}

function requestOf(
  candidates: KnowledgeDecisionCandidate[],
  overrides: Partial<KnowledgeDecisionRequest> = {},
): KnowledgeDecisionRequest {
  return {
    queryId: "run-1",
    vaultId: "vault-1",
    sourceEpoch: 3,
    query: "大上下文窗口",
    queryHash: QUERY_HASH,
    candidates,
    maxCandidates: DEFAULT_DECISION_POLICY.maxCandidates,
    consent: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function okBody(noul: number, model = "jev-1.13.0", inputTokens = 296, outputTokens = 20): JevTransportResponse {
  return {
    status: 200,
    body: {
      model,
      answers: { relevance: { type: "noul", noul } },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  };
}

const adapterOptions = (transport: JevTransport, registry: DecisionConsentRegistry) => ({
  transport,
  consentRegistry: registry,
  perCallTimeoutMs: 200,
  stageBudgetMs: 5000,
  concurrency: 2,
  rateLimitRetries: 1,
  rateLimitBackoffMs: 10,
});

function grantFor(registry: DecisionConsentRegistry, ids: string[], epoch = 3): string {
  return registry.grant({
    providerId: JEV_PROVIDER_ID,
    vaultId: "vault-1",
    sourceEpoch: epoch,
    queryHash: QUERY_HASH,
    candidateHashes: new Set(ids.map((id) => `sha-${id}`)),
    grantedAtMs: 0,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
  }).consentId;
}

test("P0 合并问题：单条 Noul 问题同时承载相关性 + 直接证据判定", () => {
  const question = mergedNoulQuestion("长期记忆");
  assert.equal(question.type, "noul");
  assert.ok(question.instructions.includes("长期记忆"));
  assert.ok(question.instructions.includes("命题级匹配"));
  assert.ok(question.criteria.true.includes("直接陈述"));
  assert.ok(question.criteria.false.includes("仅涉及相似主题"));
});

test("请求形状：每候选一次出站、model/state/questions 与官方契约一致；响应映射 noul/usage/model", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a", "b"]);
  const requests: JevTransportRequest[] = [];
  const transport: JevTransport = {
    async post(request) {
      requests.push(request);
      return okBody(0.87);
    },
  };
  const adapter = createJevAdapter(adapterOptions(transport, registry));
  const result = await adapter.decide(
    requestOf(candidatesOf(["a", "b"]), { consent: registry.get(consentId) }),
  );
  assert.equal(requests.length, 2, "P0：每候选恰好一次出站（不是 9 连跑）");
  for (const request of requests) {
    assert.equal(request.model, "jev-latest");
    assert.ok(request.state.query.includes("大上下文"));
    assert.ok("note_excerpt" in request.state, "最小状态：查询 + 单候选片段");
    assert.ok(!("apiKey" in request) && !JSON.stringify(request).includes("Bearer"), "凭证不进请求对象");
    assert.equal(request.questions.relevance.type, "noul");
  }
  assert.deepEqual(
    result.outcomes.map((outcome) => [outcome.candidateId, outcome.status, outcome.noul]),
    [
      ["a", "scored", 0.87],
      ["b", "scored", 0.87],
    ],
  );
  assert.equal(result.outboundCount, 2);
  assert.equal(result.inputTokens, 296 * 2);
  assert.equal(result.outputTokens, 20 * 2);
  assert.equal(result.modelVersion, "jev-1.13.0");
});

test("429 短退避重试一次后成功；恒 429 → 该候选 http_429 回退", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a"]);
  const statuses: number[] = [];
  const recover: JevTransport = {
    async post() {
      const status = statuses.length === 0 ? 429 : 200;
      statuses.push(status);
      return status === 429 ? { status: 429, body: null } : okBody(0.5);
    },
  };
  const first = await createJevAdapter(adapterOptions(recover, registry)).decide(
    requestOf(candidatesOf(["a"]), { consent: registry.get(consentId) }),
  );
  assert.deepEqual(statuses, [429, 200]);
  assert.equal(first.outcomes[0]?.status, "scored");
  assert.equal(first.outcomes[0]?.noul, 0.5);
  assert.equal(first.outboundCount, 2);

  const alwaysLimited: JevTransport = { async post() { return { status: 429, body: null }; } };
  const second = await createJevAdapter(adapterOptions(alwaysLimited, registry)).decide(
    requestOf(candidatesOf(["a"]), { consent: registry.get(consentId) }),
  );
  assert.equal(second.outcomes[0]?.status, "fallback");
  assert.equal(second.outcomes[0]?.fallbackReason, "http_429");
  assert.equal(second.outboundCount, 2, "重试一次后放弃（出站共 2 次）");
});

test("529 过载按 429 同类处理（短退避一次）", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a"]);
  const statuses: number[] = [];
  const transport: JevTransport = {
    async post() {
      statuses.push(529);
      return { status: 529, body: null };
    },
  };
  const result = await createJevAdapter(adapterOptions(transport, registry)).decide(
    requestOf(candidatesOf(["a"]), { consent: registry.get(consentId) }),
  );
  assert.deepEqual(statuses, [529, 529]);
  assert.equal(result.outcomes[0]?.fallbackReason, "http_429");
});

test("5xx / 4xx / 空响应体 / 缺答案 → 回退且不抛异常", async () => {
  const registry = new DecisionConsentRegistry();
  const ids = ["a", "b", "c", "d"];
  const consentId = grantFor(registry, ids);
  const scripted: Array<() => JevTransportResponse> = [
    () => ({ status: 503, body: null }),
    () => ({ status: 422, body: null }),
    () => ({ status: 200, body: null }),
    () => ({ status: 200, body: { model: "jev-1", answers: {} } }),
  ];
  let index = 0;
  const transport: JevTransport = {
    async post() {
      const step = scripted[index];
      index += 1;
      return step ? step() : { status: 200, body: null };
    },
  };
  const adapter = createJevAdapter({ ...adapterOptions(transport, registry), concurrency: 4 });
  const result = await adapter.decide(
    requestOf(candidatesOf(ids), { consent: registry.get(consentId) }),
  );
  assert.equal(result.outboundCount, 4);
  assert.ok(result.outcomes.every((outcome) => outcome.status === "fallback"));
  const reasons = new Set(result.outcomes.map((outcome) => outcome.fallbackReason));
  assert.ok(reasons.has("http_5xx"), "5xx → http_5xx");
  assert.ok(reasons.has("provider_error"), "4xx/空体/缺答案 → provider_error");
});

test("非法评分（NaN/出界/缺类型/非数值）→ invalid_score 回退", async () => {
  const registry = new DecisionConsentRegistry();
  const ids = ["a", "b", "c", "d"];
  const consentId = grantFor(registry, ids);
  const scripted: Array<() => JevTransportResponse> = [
    () => ({ status: 200, body: { model: "jev-1", answers: { relevance: { type: "noul", noul: Number.NaN } } } }),
    () => ({ status: 200, body: { model: "jev-1", answers: { relevance: { type: "noul", noul: 1.2 } } } }),
    () => ({ status: 200, body: { model: "jev-1", answers: { relevance: { type: "choice", choice: "x" } } } }),
    () => ({
      status: 200,
      body: { model: "jev-1", answers: { relevance: { type: "noul", noul: "0.5" as unknown as number } } },
    }),
  ];
  let index = 0;
  const transport: JevTransport = {
    async post() {
      const step = scripted[index];
      index += 1;
      return step ? step() : { status: 200, body: null };
    },
  };
  const adapter = createJevAdapter({ ...adapterOptions(transport, registry), concurrency: 4 });
  const result = await adapter.decide(
    requestOf(candidatesOf(ids), { consent: registry.get(consentId) }),
  );
  assert.ok(result.outcomes.every((outcome) => outcome.fallbackReason === "invalid_score"));
});

test("授权逐调用重查：撤销后未开始的候选不出站（fail-closed）", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a", "b", "c"]);
  let outbound = 0;
  const transport: JevTransport = {
    async post() {
      outbound += 1;
      // 第一个候选出站后撤销授权：其余候选的调用前重查必须失败。
      registry.revoke(consentId);
      return okBody(0.8);
    },
  };
  const adapter = createJevAdapter({ ...adapterOptions(transport, registry), concurrency: 1 });
  const result = await adapter.decide(
    requestOf(candidatesOf(["a", "b", "c"]), { consent: registry.get(consentId) }),
  );
  assert.equal(outbound, 1);
  assert.equal(result.outcomes[0]?.status, "scored");
  assert.ok(result.outcomes.slice(1).every((outcome) => outcome.fallbackReason === "consent_revoked"));
});

test("授权范围不匹配（chunkSha 不在授权集合）→ 不出站", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a"]);
  let outbound = 0;
  const transport: JevTransport = {
    async post() {
      outbound += 1;
      return okBody(0.8);
    },
  };
  const adapter = createJevAdapter(adapterOptions(transport, registry));
  const result = await adapter.decide(
    requestOf(candidatesOf(["a", "b"]), { consent: registry.get(consentId) }),
  );
  assert.equal(outbound, 1);
  assert.equal(result.outcomes[1]?.fallbackReason, "consent_scope_mismatch");
});

test("授权过期 → consent_expired，不出站", async () => {
  const registry = new DecisionConsentRegistry();
  const consent = registry.grant({
    providerId: JEV_PROVIDER_ID,
    vaultId: "vault-1",
    sourceEpoch: 3,
    queryHash: QUERY_HASH,
    candidateHashes: new Set(["sha-a"]),
    grantedAtMs: 0,
    expiresAtMs: 1000,
  });
  let outbound = 0;
  const transport: JevTransport = {
    async post() {
      outbound += 1;
      return okBody(0.8);
    },
  };
  const adapter = createJevAdapter({ ...adapterOptions(transport, registry), perCallTimeoutMs: 50, stageBudgetMs: 500 });
  // expiresAtMs=1000 < Date.now()（真实时钟）→ 门禁与调用前重查均拒绝。
  const result = await adapter.decide(requestOf(candidatesOf(["a"]), { consent }));
  assert.equal(outbound, 0);
  assert.equal(result.outcomes[0]?.fallbackReason, "consent_expired");
});

test("无授权（consent=null）→ 全部 consent_missing，零出站", async () => {
  const registry = new DecisionConsentRegistry();
  let outbound = 0;
  const transport: JevTransport = {
    async post() {
      outbound += 1;
      return okBody(0.8);
    },
  };
  const adapter = createJevAdapter(adapterOptions(transport, registry));
  const result = await adapter.decide(requestOf(candidatesOf(["a", "b"]), { consent: null }));
  assert.equal(outbound, 0);
  assert.ok(result.outcomes.every((outcome) => outcome.fallbackReason === "consent_missing"));
});

test("阶段取消：未发起候选补齐 cancelled 回退；在途调用立即中止", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a", "b", "c", "d"]);
  const controller = new AbortController();
  let outbound = 0;
  const transport: JevTransport = {
    async post(request) {
      outbound += 1;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1000);
        request.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(null);
        }, { once: true });
      });
      if (request.signal.aborted) throw new Error("stage-cancelled");
      return okBody(0.5);
    },
  };
  const adapter = createJevAdapter(adapterOptions(transport, registry));
  const pending = adapter.decide(
    requestOf(candidatesOf(["a", "b", "c", "d"]), {
      consent: registry.get(consentId),
      signal: controller.signal,
    }),
  );
  // 并发 2：前两个在途；等一拍后取消。
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  const result = await pending;
  assert.ok(outbound <= 2, "取消后不再发起新调用");
  assert.ok(result.outcomes.every((outcome) => outcome.status === "fallback"));
  assert.ok(result.outcomes.every((outcome) => outcome.fallbackReason === "cancelled"));
});

test("慢响应超时 → 单候选 timeout 回退，不拖垮阶段", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a", "b"]);
  const transport: JevTransport = {
    async post(request) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        request.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(null);
        }, { once: true });
      });
      throw new Error("per-call-timeout");
    },
  };
  const adapter = createJevAdapter({ ...adapterOptions(transport, registry), perCallTimeoutMs: 50 });
  const startedAt = Date.now();
  const result = await adapter.decide(
    requestOf(candidatesOf(["a", "b"]), { consent: registry.get(consentId) }),
  );
  assert.ok(result.outcomes.every((outcome) => outcome.fallbackReason === "timeout"));
  assert.ok(Date.now() - startedAt < 1500, "per-call 超时生效，不等待慢响应");
});

test("出站候选截断：maxCandidates 之外的候选不进请求池（skippedCount 记录）", async () => {
  const registry = new DecisionConsentRegistry();
  const consentId = grantFor(registry, ["a", "b", "c"]);
  let requests = 0;
  const transport: JevTransport = {
    async post() {
      requests += 1;
      return okBody(0.6);
    },
  };
  const adapter = createJevAdapter(adapterOptions(transport, registry));
  const result = await adapter.decide(
    requestOf(candidatesOf(["a", "b", "c"]), {
      consent: registry.get(consentId),
      maxCandidates: 2,
    }),
  );
  assert.equal(requests, 2);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(
    result.outcomes.map((outcome) => outcome.candidateId),
    ["a", "b"],
  );
});

test("默认 HTTP transport：对本地假服务器逐字段断言已验证的官方线格式", async () => {
  const { createTypeSafeHttpTransport } = await import("../src/knowledge/decision/jevTransport.js");
  const { createServer } = await import("node:http");
  const seen: Array<{ url: string | undefined; auth: string | undefined; body: unknown }> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      seen.push({
        url: req.url,
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(okBody(0.91).body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const transport = createTypeSafeHttpTransport({
      apiKey: "test-key-do-not-use",
      baseUrl: `http://127.0.0.1:${address.port}`,
      model: "jev-latest",
    });
    const controller = new AbortController();
    const response = await transport.post({
      state: { query: "合成测试查询", note_excerpt: "合成测试片段" },
      model: "jev-latest",
      questions: { relevance: mergedNoulQuestion("合成测试查询") },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body?.answers.relevance?.noul, 0.91);
    assert.equal(seen.length, 1);
    const record = seen[0] as { url: string; auth: string; body: Record<string, unknown> };
    assert.equal(record.url, "/v1/systemone", "官方路径（2026-10-10 api.md）");
    assert.equal(record.auth, "Bearer test-key-do-not-use", "Bearer 鉴权头");
    assert.deepEqual(Object.keys(record.body), ["state", "model", "questions"]);
  } finally {
    server.close();
  }
});

test("默认 HTTP transport：缺 API Key 构造即抛错（绝不静默出站）", async () => {
  const { createTypeSafeHttpTransport } = await import("../src/knowledge/decision/jevTransport.js");
  assert.throws(() => createTypeSafeHttpTransport({ apiKey: "  " }), /API Key/u);
});
