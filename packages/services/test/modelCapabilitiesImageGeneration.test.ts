/**
 * Host 图像生成服务单测（specs/model-capabilities.md §6.1/§6.3；MC-4/MC-6/MC-7/MC-8）。
 *
 * 出站全部 mock（fetchImpl 注入）：断言 fail-closed（未启用/未配置零出站）、
 * OpenAI images 兼容请求形状（n=1、Bearer、baseUrl 归一）、b64/url 双路径、
 * 错误分类照 testJevConnection 风格（401/403、429、4xx/5xx 透传、坏 JSON 结构化、
 * 8MiB/20MiB 上限）、凭据不进任何返回文案。
 */
import assert from "node:assert/strict";
import { it } from "vitest";
import { defaultModelCapabilitiesFile, modelCapabilityCredentialKey } from "@drora/shared";
import {
  createImageGenerationService,
  type ImageGenerationResult,
} from "../src/model-capabilities/index.js";

const API_KEY = "sk-test-key-do-not-leak";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeFetch(
  handler: (url: string) => {
    status: number;
    json?: unknown;
    text?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  },
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlText = typeof url === "string" ? url : url.toString();
    calls.push({ url: urlText, init });
    const response = handler(urlText);
    const headers = new Map(Object.entries(response.headers ?? {}));
    return {
      status: response.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      json: async () => {
        if (response.json === undefined) throw new Error("not json");
        return response.json;
      },
      text: async () => response.text ?? "",
      arrayBuffer: async () => {
        const bytes = response.body ?? new Uint8Array(0);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      body: undefined,
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function makeCapabilities(overrides: Partial<Record<string, unknown>> = {}) {
  const file = defaultModelCapabilitiesFile();
  file.migratedFromLegacySettings = true;
  file.capabilities["image-generation"] = {
    enabled: true,
    baseUrl: "https://api.example/v1",
    modelId: "cogview-4-flash",
    ...overrides,
  } as (typeof file.capabilities)["image-generation"];
  return { get: async () => file };
}

function makeCredentialStore(value: string | null = API_KEY) {
  return {
    load: async (key: string) =>
      key === modelCapabilityCredentialKey.imageGeneration ? value : null,
  };
}

function makeService(overrides: {
  capabilities?: ReturnType<typeof makeCapabilities>;
  credentials?: ReturnType<typeof makeCredentialStore>;
  fetchImpl: typeof fetch;
}) {
  return createImageGenerationService({
    modelCapabilities: overrides.capabilities ?? makeCapabilities(),
    credentialService: overrides.credentials ?? makeCredentialStore(),
    fetchImpl: overrides.fetchImpl,
  });
}

function b64Success(imageBase64: string, bytes: number): { status: number; json: unknown } {
  return { status: 200, json: { data: [{ b64_json: imageBase64 }] } };
}

it("MC-4/MC-7：档案未启用 → disabled 结构化失败（含设置页指引），零出站", async () => {
  const { fetchImpl, calls } = makeFetch(() => b64Success("aGk=", 2));
  const service = makeService({
    capabilities: makeCapabilities({ enabled: false }),
    fetchImpl,
  });
  const result: ImageGenerationResult = await service.generate({ prompt: "a cat" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "disabled");
    assert.match(result.message, /模型设置页 → 图像生成配置/);
  }
  assert.equal(calls.length, 0, "fail-closed：未启用不得出站");
});

it("MC-7：baseUrl/modelId 缺失或 key 缺失 → not_configured，零出站", async () => {
  const cases: Array<{ overrides: Partial<Record<string, unknown>>; key: string | null }> = [
    { overrides: { baseUrl: "" }, key: API_KEY },
    { overrides: { modelId: "" }, key: API_KEY },
    { overrides: { baseUrl: "http://api.example/v1" }, key: API_KEY },
    { overrides: { baseUrl: "not a url" }, key: API_KEY },
    { overrides: {}, key: null },
  ];
  for (const testCase of cases) {
    const { fetchImpl, calls } = makeFetch(() => b64Success("aGk=", 2));
    const service = makeService({
      capabilities: makeCapabilities(testCase.overrides),
      credentials: makeCredentialStore(testCase.key),
      fetchImpl,
    });
    const result = await service.generate({ prompt: "a cat" });
    assert.equal(result.ok, false);
    assert.equal((result as { errorKind: string }).errorKind, "not_configured");
    assert.match((result as { message: string }).message, /模型设置页 → 图像生成配置/);
    assert.equal(calls.length, 0, "fail-closed：未配置不得出站");
  }
});

it("MC-6：b64_json 正常链 → ok:true（imageBase64/contentType/bytes），请求 OpenAI images 兼容形状", async () => {
  const imageBase64 = Buffer.from("png-bytes").toString("base64");
  const { fetchImpl, calls } = makeFetch(() => b64Success(imageBase64, 9));
  const service = makeService({ fetchImpl });

  const result = await service.generate({ prompt: "a cat", size: "1024x1024" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.imageBase64, imageBase64);
    assert.equal(result.contentType, "image/png");
    assert.equal(result.bytes, 9);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example/v1/images/generations");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${API_KEY}`);
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body, { model: "cogview-4-flash", prompt: "a cat", size: "1024x1024", n: 1 });
});

it("MC-6：baseUrl 尾斜杠归一后拼接 images/generations；localhost http 例外允许出站", async () => {
  const imageBase64 = Buffer.from("png").toString("base64");
  const { fetchImpl, calls } = makeFetch(() => b64Success(imageBase64, 3));
  const service = makeService({
    capabilities: makeCapabilities({ baseUrl: "http://localhost:9000/v1/" }),
    fetchImpl,
  });
  const result = await service.generate({ prompt: "a cat" });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "http://localhost:9000/v1/images/generations");
});

it("MC-8：401/403 → auth_failed；429 → rate_limited；5xx → endpoint_error 透传状态码；凭据不进文案", async () => {
  const cases: Array<{ status: number; errorKind: string; messageMatch: RegExp }> = [
    { status: 401, errorKind: "auth_failed", messageMatch: /认证失败/ },
    { status: 403, errorKind: "auth_failed", messageMatch: /认证失败/ },
    { status: 429, errorKind: "rate_limited", messageMatch: /限流/ },
    { status: 500, errorKind: "endpoint_error", messageMatch: /端点返回 500/ },
    { status: 400, errorKind: "endpoint_error", messageMatch: /端点返回 400/ },
  ];
  for (const testCase of cases) {
    const { fetchImpl } = makeFetch(() => ({
      status: testCase.status,
      text: "upstream said something",
    }));
    const service = makeService({ fetchImpl });
    const result = await service.generate({ prompt: "a cat" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errorKind, testCase.errorKind);
      assert.match(result.message, testCase.messageMatch);
      assert.ok(!result.message.includes(API_KEY), "凭据不得出现在错误文案");
    }
  }
});

it("MC-8：坏 JSON / data[0] 缺图像字段 → bad_response 结构化报错", async () => {
  const badPayloads: unknown[] = [{ data: [] }, { data: [{}] }, { data: [{ b64_json: "" }] }, {}];
  for (const json of badPayloads) {
    const { fetchImpl } = makeFetch(() => ({ status: 200, json }));
    const service = makeService({ fetchImpl });
    const result = await service.generate({ prompt: "a cat" });
    assert.equal(result.ok, false);
    assert.equal((result as { errorKind: string }).errorKind, "bad_response");
  }
  // 非 JSON 响应体。
  const { fetchImpl: notJsonFetch } = makeFetch(() => ({ status: 200 }));
  const notJsonService = makeService({ fetchImpl: notJsonFetch });
  const notJsonResult = await notJsonService.generate({ prompt: "a cat" });
  assert.equal(notJsonResult.ok, false);
  assert.equal((notJsonResult as { errorKind: string }).errorKind, "bad_response");
});

it("MC-8：b64 载荷超 8MiB → payload_too_large 并提示换小尺寸", async () => {
  const oversized = "a".repeat(8 * 1024 * 1024 + 1);
  const { fetchImpl } = makeFetch(() => b64Success(oversized, 6 * 1024 * 1024));
  const service = makeService({ fetchImpl });
  const result = await service.generate({ prompt: "a cat" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "payload_too_large");
    assert.match(result.message, /8MiB/);
    assert.match(result.message, /更小的尺寸/);
  }
});

it("MC-6：仅 url 响应 → Host 下载（content-type image/*）后转 base64 返回", async () => {
  const imageBytes = new TextEncoder().encode("png-from-url");
  const { fetchImpl, calls } = makeFetch((url) =>
    url === "https://cdn.example/image.png"
      ? { status: 200, headers: { "content-type": "image/png" }, body: imageBytes }
      : { status: 200, json: { data: [{ url: "https://cdn.example/image.png" }] } },
  );
  const service = makeService({ fetchImpl });
  const result = await service.generate({ prompt: "a cat" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.contentType, "image/png");
    assert.equal(result.bytes, imageBytes.byteLength);
    assert.equal(result.imageBase64, Buffer.from(imageBytes).toString("base64"));
  }
  assert.equal(calls.length, 2, "生成 + 下载各一次出站");
});

it("MC-8：url 下载 content-type 非 image/* → bad_response", async () => {
  const { fetchImpl } = makeFetch((url) =>
    url === "https://cdn.example/file"
      ? {
          status: 200,
          headers: { "content-type": "text/html" },
          body: new TextEncoder().encode("<html>"),
        }
      : { status: 200, json: { data: [{ url: "https://cdn.example/file" }] } },
  );
  const service = makeService({ fetchImpl });
  const result = await service.generate({ prompt: "a cat" });
  assert.equal(result.ok, false);
  assert.equal((result as { errorKind: string }).errorKind, "bad_response");
});

it("MC-8：url 下载超 20MiB → payload_too_large", async () => {
  const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
  const { fetchImpl } = makeFetch((url) =>
    url === "https://cdn.example/huge.png"
      ? { status: 200, headers: { "content-type": "image/png" }, body: oversized }
      : { status: 200, json: { data: [{ url: "https://cdn.example/huge.png" }] } },
  );
  const service = makeService({ fetchImpl });
  const result = await service.generate({ prompt: "a cat" });
  assert.equal(result.ok, false);
  assert.equal((result as { errorKind: string }).errorKind, "payload_too_large");
});

it("MC-8：网络异常（含超时）→ network 分类，不携带凭据", async () => {
  const { fetchImpl } = makeFetch(() => {
    throw new Error("fetch failed");
  });
  const service = makeService({ fetchImpl });
  const result = await service.generate({ prompt: "a cat" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorKind, "network");
    assert.ok(!result.message.includes(API_KEY));
  }
});
