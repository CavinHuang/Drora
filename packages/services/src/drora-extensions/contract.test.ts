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

// P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C7）：
// assembleDroraKnowledgeHost（knowledgeHost.ts）随本体 knowledge 栈拆除，
// 其降级语义测试随实现移除——插件 server 侧装配由 obsidian-plugin 自带测试覆盖。
