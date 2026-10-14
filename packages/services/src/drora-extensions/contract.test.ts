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
import type { ISettingService } from "../setting/setting.js";
import { assembleDroraKnowledgeHost } from "./knowledgeHost.js";
it("unreadable settings fail closed without blocking the Host or creating a semantic model", async () => {
  const warn = vi.fn();
  const settingService = {
    get: vi.fn(async () => {
      throw new Error("settings_unavailable");
    }),
  } as unknown as ISettingService;
  const host = await assembleDroraKnowledgeHost(settingService, { warn });
  expect(host.knowledgeEmbeddingPort).toBeNull();
  expect(await host.knowledgeJevConfigSource()).toBeNull();
  expect(warn).toHaveBeenCalledTimes(2);
});
