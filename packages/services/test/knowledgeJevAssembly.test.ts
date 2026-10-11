/**
 * Jev 装配配置解析单测（spec §5d.10 / K-JEV-7..9）。
 *
 * 断言 fail-closed 语义：开关缺省/关闭、凭据缺失一律返回 null（装配层据此
 * 不注入 decisionProviderFactory，grant 走 disabled，零出站）；快照规范化
 * （baseURL trim、空白回落官方默认）；provider 工厂把 policy 预算映射进
 * JevAdapter 并复用同一授权账本实例。
 * 运行：node --import tsx --test packages/services/test/knowledgeJevAssembly.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createKnowledgeJevProviderFactory,
  resolveKnowledgeJevAssembly,
} from "../src/knowledge/decision/jevAssembly.js";
import type { AppSettings } from "@drora/shared";

type SettingsOverride = Partial<
  Pick<
    AppSettings,
    | "knowledgeJevEnabled"
    | "knowledgeJevBaseUrl"
    | "knowledgeJevProvider"
    | "knowledgeJevOpenrouterModel"
    | "knowledgeJevOpenrouterBaseUrl"
    | "knowledgeJevAiGatewayModel"
    | "knowledgeJevAiGatewayBaseUrl"
  >
>;

function fakeSettingService(settings: SettingsOverride) {
  return {
    get: async () => ({ ...settings }) as AppSettings,
  };
}

function fakeCredentialService(value: string | null) {
  return { load: async (_key: string) => value };
}

test("K-JEV-7：开关缺省/关闭 → 返回 null（fail-closed）", async () => {
  assert.equal(
    await resolveKnowledgeJevAssembly({
      settingService: fakeSettingService({}),
      credentialService: fakeCredentialService("sk-test"),
    }),
    null,
  );
  assert.equal(
    await resolveKnowledgeJevAssembly({
      settingService: fakeSettingService({ knowledgeJevEnabled: false }),
      credentialService: fakeCredentialService("sk-test"),
    }),
    null,
  );
});

test("K-JEV-8：开关开但 Key 缺失/空白 → 返回 null（不出站、grant disabled 同语义）", async () => {
  assert.equal(
    await resolveKnowledgeJevAssembly({
      settingService: fakeSettingService({ knowledgeJevEnabled: true }),
      credentialService: fakeCredentialService(null),
    }),
    null,
  );
  assert.equal(
    await resolveKnowledgeJevAssembly({
      settingService: fakeSettingService({ knowledgeJevEnabled: true }),
      credentialService: fakeCredentialService("   "),
    }),
    null,
  );
});

test("K-JEV-9：开关开 + Key 存在 → 快照返回，baseURL trim/空白回落官方默认", async () => {
  const basic = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({ knowledgeJevEnabled: true }),
    credentialService: fakeCredentialService(" sk-test "),
  });
  assert.deepEqual(basic, { provider: "typesafe", apiKey: "sk-test", baseUrl: undefined });

  const overridden = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevBaseUrl: " https://gateway.example.ai ",
    }),
    credentialService: fakeCredentialService("sk-test"),
  });
  assert.deepEqual(overridden, {
    provider: "typesafe",
    apiKey: "sk-test",
    baseUrl: "https://gateway.example.ai",
  });

  const blankOverridden = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevBaseUrl: "   ",
    }),
    credentialService: fakeCredentialService("sk-test"),
  });
  assert.deepEqual(blankOverridden, {
    provider: "typesafe",
    apiKey: "sk-test",
    baseUrl: undefined,
  });
});

test("K-JEV-11：远程提供商缺 model/Key 任一 → fail-closed 禁用", async () => {
  const withKey = fakeCredentialService("sk-remote");
  const withoutKey = { load: async () => null };
  for (const { settings, credential, label } of [
    {
      label: "openrouter 缺 model",
      settings: { knowledgeJevEnabled: true, knowledgeJevProvider: "openrouter" },
      credential: withKey,
    },
    {
      label: "openrouter 缺 Key",
      settings: {
        knowledgeJevEnabled: true,
        knowledgeJevProvider: "openrouter",
        knowledgeJevOpenrouterModel: "openai/gpt-4o-mini",
      },
      credential: withoutKey,
    },
    {
      label: "ai-gateway 缺 model",
      settings: { knowledgeJevEnabled: true, knowledgeJevProvider: "ai-gateway" },
      credential: withKey,
    },
    {
      label: "ai-gateway 缺 Key",
      settings: {
        knowledgeJevEnabled: true,
        knowledgeJevProvider: "ai-gateway",
        knowledgeJevAiGatewayModel: "openai/gpt-4o-mini",
      },
      credential: withoutKey,
    },
  ] as const) {
    assert.equal(
      await resolveKnowledgeJevAssembly({
        settingService: fakeSettingService(settings as SettingsOverride),
        credentialService: credential,
      }),
      null,
      label,
    );
  }
});

test("K-JEV-11：openrouter 配置齐备 → openrouter 快照（独立凭据键 + 官方端点缺省）", async () => {
  const loaded: string[] = [];
  const assembly = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "openrouter",
      knowledgeJevOpenrouterModel: " openai/gpt-4o-mini ",
    }),
    credentialService: {
      load: async (key: string) => {
        loaded.push(key);
        return key.endsWith("openrouter-api-key") ? "sk-openrouter" : null;
      },
    },
  });
  assert.deepEqual(assembly, {
    provider: "openrouter",
    apiKey: "sk-openrouter",
    model: "openai/gpt-4o-mini",
    baseUrl: undefined,
  });
  assert.ok(loaded.length > 0);
  assert.ok(loaded.every((key) => key.endsWith("openrouter-api-key")));
});

test("K-JEV-11：ai-gateway 配置齐备 → ai-gateway 快照（独立凭据键 + 端点覆盖）", async () => {
  const assembly = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "ai-gateway",
      knowledgeJevAiGatewayModel: "openai/gpt-4o-mini",
      knowledgeJevAiGatewayBaseUrl: " https://proxy.example.ai/v1 ",
    }),
    credentialService: {
      load: async (key: string) => (key.endsWith("ai-gateway-api-key") ? "sk-ag" : null),
    },
  });
  assert.deepEqual(assembly, {
    provider: "ai-gateway",
    apiKey: "sk-ag",
    model: "openai/gpt-4o-mini",
    baseUrl: "https://proxy.example.ai/v1",
  });
});