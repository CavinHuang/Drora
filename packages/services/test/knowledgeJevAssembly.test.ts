/**
 * Jev 装配配置解析单测（spec §5d.10 / K-JEV-7..9、11）。
 *
 * 断言 fail-closed 语义：开关缺省/关闭、凭据缺失、该提供商任一必填项缺失一律
 * 返回 null（装配层据此不注入 decisionProviderFactory，grant 走 disabled，零出站）；
 * typesafe 的 baseURL 空白回落官方托管端点（唯一隐藏默认），openrouter /
 * ai-gateway 的 baseURL 由发行方文档/部署方提供、必填（不硬编码猜测端点）。
 * 运行：node --import tsx --test packages/services/test/knowledgeJevAssembly.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createKnowledgeJevProviderFactory,
  resolveKnowledgeJevAssembly,
} from "../src/knowledge/decision/jevAssembly.js";
import { TYPESAFE_OFFICIAL_BASE_URL } from "../src/knowledge/decision/jevTransport.js";
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

test("K-JEV-9：开关开 + Key 存在 → 快照返回，baseURL trim/空白回落官方托管端点", async () => {
  const basic = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({ knowledgeJevEnabled: true }),
    credentialService: fakeCredentialService(" sk-test "),
  });
  assert.deepEqual(basic, {
    provider: "typesafe",
    apiKey: "sk-test",
    baseUrl: TYPESAFE_OFFICIAL_BASE_URL,
  });

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
    baseUrl: TYPESAFE_OFFICIAL_BASE_URL,
  });
});

test("K-JEV-11：远程提供商缺 Key/model 任一 → fail-closed 禁用（baseURL 缺省回落内置端点）", async () => {
  const withKey = fakeCredentialService("sk-remote");
  const withoutKey = { load: async () => null };
  const cases = [
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
        knowledgeJevOpenrouterModel: "typesafe/jev-latest",
        knowledgeJevOpenrouterBaseUrl: "https://openrouter.example/api",
      },
      credential: withoutKey,
    },
    {
      label: "ai-gateway 缺 model",
      settings: {
        knowledgeJevEnabled: true,
        knowledgeJevProvider: "ai-gateway",
        knowledgeJevAiGatewayBaseUrl: "https://agw.example.ai/jev",
      },
      credential: withKey,
    },
    {
      label: "ai-gateway 缺 Key",
      settings: {
        knowledgeJevEnabled: true,
        knowledgeJevProvider: "ai-gateway",
        knowledgeJevAiGatewayModel: "typesafe/jev-latest",
        knowledgeJevAiGatewayBaseUrl: "https://agw.example.ai/jev",
      },
      credential: withoutKey,
    },
  ] as const;
  for (const { settings, credential, label } of cases) {
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

test("K-JEV-11：openrouter 配置齐备 → openrouter 快照（独立凭据键 + 必填 baseURL）", async () => {
  const loaded: string[] = [];
  const assembly = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "openrouter",
      knowledgeJevOpenrouterModel: " typesafe/jev-latest ",
      knowledgeJevOpenrouterBaseUrl: " https://openrouter.example/api ",
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
    model: "typesafe/jev-latest",
    baseUrl: "https://openrouter.example/api",
  });

  // 缺省回落内置端点（spec §5d.10 内置端点表：openrouter = alpha/decisions）。
  const defaulted = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "openrouter",
      knowledgeJevOpenrouterModel: "typesafe/jev-latest",
    }),
    credentialService: {
      load: async (key: string) => (key.endsWith("openrouter-api-key") ? "sk-openrouter" : null),
    },
  });
  assert.deepEqual(defaulted, {
    provider: "openrouter",
    apiKey: "sk-openrouter",
    model: "typesafe/jev-latest",
    baseUrl: "https://openrouter.ai/api/alpha",
  });
  assert.ok(loaded.length > 0);
  assert.ok(loaded.every((key) => key.endsWith("openrouter-api-key")));
});

test("K-JEV-11：ai-gateway 配置齐备 → ai-gateway 快照（独立凭据键 + 部署 baseURL）", async () => {
  const assembly = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "ai-gateway",
      knowledgeJevAiGatewayModel: "tenant/jev-1.13.0",
      knowledgeJevAiGatewayBaseUrl: " https://agw.example.ai/jev ",
    }),
    credentialService: {
      load: async (key: string) => (key.endsWith("ai-gateway-api-key") ? "sk-ag" : null),
    },
  });
  assert.deepEqual(assembly, {
    provider: "ai-gateway",
    apiKey: "sk-ag",
    model: "tenant/jev-1.13.0",
    baseUrl: "https://agw.example.ai/jev",
  });

  // 缺省回落内置端点（Vercel AI Gateway，初值依据见 spec 决策记录）。
  const agwDefaulted = await resolveKnowledgeJevAssembly({
    settingService: fakeSettingService({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "ai-gateway",
      knowledgeJevAiGatewayModel: "typesafe/jev-latest",
    }),
    credentialService: {
      load: async (key: string) => (key.endsWith("ai-gateway-api-key") ? "sk-ag" : null),
    },
  });
  assert.deepEqual(agwDefaulted, {
    provider: "ai-gateway",
    apiKey: "sk-ag",
    model: "typesafe/jev-latest",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
  });
});

test("provider 工厂：远程提供商标识覆盖 + typesafe 缺省注入 policy 预算", () => {
  // 工厂只闭包快照与预算；transport 构造走 createSystemOneHttpTransport（线格式由
  // knowledgeSystemOneTransport.test.ts 覆盖），此处断言两类快照都能产出可用 provider。
  const config = {
    perCallTimeoutMs: 3000,
    stageBudgetMs: 6000,
    concurrency: 4,
    rateLimitRetries: 1,
    rateLimitBackoffMs: 250,
  };
  const openrouterFactory = createKnowledgeJevProviderFactory({
    provider: "openrouter",
    apiKey: "sk-openrouter",
    model: "typesafe/jev-latest",
    baseUrl: "https://openrouter.example/api",
  });
  assert.ok(openrouterFactory({ consentRegistry: {} as never, config }));

  const typesafeFactory = createKnowledgeJevProviderFactory({
    provider: "typesafe",
    apiKey: "sk-test",
    baseUrl: TYPESAFE_OFFICIAL_BASE_URL,
  });
  assert.ok(typesafeFactory({ consentRegistry: {} as never, config }));
});
