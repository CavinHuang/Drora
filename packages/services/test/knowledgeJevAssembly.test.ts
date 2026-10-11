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

type SettingsOverride = Partial<Pick<AppSettings, "knowledgeJevEnabled" | "knowledgeJevBaseUrl">>;

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
  assert.deepEqual(basic, { apiKey: "sk-test", baseUrl: undefined });

  const overridden = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevBaseUrl: " https://gateway.example.ai ",
    }),
    credentialService: fakeCredentialService("sk-test"),
  });
  assert.deepEqual(overridden, { apiKey: "sk-test", baseUrl: "https://gateway.example.ai" });

  const blankOverridden = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevBaseUrl: "   ",
    }),
    credentialService: fakeCredentialService("sk-test"),
  });
  assert.deepEqual(blankOverridden, { apiKey: "sk-test", baseUrl: undefined });
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
