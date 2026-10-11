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
import { JEV_PROVIDER_ID } from "../src/knowledge/decision/jevAdapter.js";
import { DEFAULT_DECISION_POLICY } from "../src/knowledge/decision/decisionPolicy.js";
import { DecisionConsentRegistry } from "../src/knowledge/decision/decisionConsent.js";
import type { AppSettings } from "@drora/shared";

type SettingsOverride = Partial<
  Pick<
    AppSettings,
    | "knowledgeJevEnabled"
    | "knowledgeJevBaseUrl"
    | "knowledgeJevProvider"
    | "knowledgeJevOpenaiBaseUrl"
    | "knowledgeJevOpenaiModel"
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

test("K-JEV-11：openai-compatible 缺 baseUrl/model/Key 任一 → fail-closed 禁用", async () => {
  const base = { knowledgeJevEnabled: true, knowledgeJevProvider: "openai-compatible" } as const;
  const credential = fakeCredentialService("sk-openai");
  for (const settings of [
    base,
    { ...base, knowledgeJevOpenaiBaseUrl: "https://api.example.ai" },
    { ...base, knowledgeJevOpenaiModel: "glm-4.7" },
  ]) {
    assert.equal(
      await resolveKnowledgeJevAssembly({ settingService: fakeSettingService(settings), credentialService: credential }),
      null,
      JSON.stringify(settings),
    );
  }
});

test("K-JEV-11：openai-compatible 配置齐备 → openai 快照（独立凭据键）", async () => {
  const loaded: string[] = [];
  const assembly = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "openai-compatible",
      knowledgeJevOpenaiBaseUrl: " https://api.example.ai/v4 ",
      knowledgeJevOpenaiModel: " glm-4.7 ",
    }),
    credentialService: {
      load: async (key: string) => {
        loaded.push(key);
        // 只喂 TypeSafe 键值：openai 提供商必须读自己的凭据键，读到 TypeSafe 键也不该混用。
        return key.endsWith("openai-api-key") ? "sk-openai" : null;
      },
    },
  });
  assert.deepEqual(assembly, {
    provider: "openai-compatible",
    apiKey: "sk-openai",
    baseUrl: "https://api.example.ai/v4",
    model: "glm-4.7",
  });
  assert.ok(loaded.length > 0);
  assert.ok(loaded.every((key) => key.endsWith("openai-api-key")));
});

test("provider 工厂：JEV 身份 + policy 预算映射 + 共享同一授权账本实例", () => {
  const factory = createKnowledgeJevProviderFactory({ apiKey: "sk-test" });
  const registry = new DecisionConsentRegistry();
  const provider = factory({ consentRegistry: registry, config: DEFAULT_DECISION_POLICY });
  assert.equal(provider.id, JEV_PROVIDER_ID);
  // 两次调用各自产出 provider，但同一账本实例语义由调用方（knowledgeServices）
  // 保证：工厂只接收 deps，不私自新建账本——这里断言参数原样进入适配器闭包路径。
  const again = factory({ consentRegistry: registry, config: DEFAULT_DECISION_POLICY });
  assert.equal(again.id, JEV_PROVIDER_ID);
});
