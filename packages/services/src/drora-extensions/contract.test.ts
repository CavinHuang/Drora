import { expect, it } from "vitest";
import { buildCuaProductHelperAgentEnv } from "./cuaAgentEnvironment.js";
import { resolveDroraWebhookSecret } from "./webhookSecret.js";
it("non-CUA sessions add no helper authority or broker credentials", async () => {
  expect(await buildCuaProductHelperAgentEnv(undefined)).toEqual({});
});

it.each([
  [{}, { ok: true, secret: undefined }],
  [{ "x-zcode-bot-secret": "official" }, { ok: true, secret: "official" }],
  [{ "x-drora-bot-secret": "legacy" }, { ok: true, secret: "legacy" }],
  [
    { "x-zcode-bot-secret": "same", "x-drora-bot-secret": "same" },
    { ok: true, secret: "same" },
  ],
  [{ "x-zcode-bot-secret": "one", "x-drora-bot-secret": "two" }, { ok: false }],
] as const)(
  "webhook headers resolve once without bypassing conflicting credentials: %j",
  (headers, expected) => {
    expect(resolveDroraWebhookSecret((name) => (headers as Record<string, string>)[name])).toEqual(
      expected,
    );
  },
);

import { vi } from "vitest";
import type { IModelCapabilitiesService } from "../model-capabilities/index.js";
import { assembleDroraKnowledgeHost } from "./knowledgeHost.js";
it("unreadable model capabilities fail closed without blocking the Host or creating a semantic model", async () => {
  const warn = vi.fn();
  const modelCapabilitiesService = {
    get: vi.fn(async () => {
      throw new Error("capabilities_unavailable");
    }),
  } as unknown as IModelCapabilitiesService;
  const host = await assembleDroraKnowledgeHost(modelCapabilitiesService, { warn });
  expect(host.knowledgeEmbeddingPort).toBeNull();
  expect(await host.knowledgeSemanticSource()).toBeNull();
  expect(await host.knowledgeJevConfigSource()).toBeNull();
  // 3 次降级各告警一次：初始化预构建、显式 semanticSource 解析、jev configSource 解析。
  expect(warn).toHaveBeenCalledTimes(3);
});
