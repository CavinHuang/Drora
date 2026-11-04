/**
 * Jev 装配配置解析单测（spec §5d.10 / K-JEV-7..9、11；数据源 = 模型能力档案快照，
 * specs/model-capabilities.md §9 批次一）。
 *
 * 断言 fail-closed 语义：开关缺省/关闭、凭据缺失、该提供商任一必填项缺失一律
 * 返回 null（装配层据此不注入 decisionProviderFactory，grant 走 disabled，零出站）；
 * typesafe 的 baseURL 空白回落官方托管端点（唯一隐藏默认），openrouter /
 * ai-gateway 的 baseURL 由发行方文档/部署方提供、必填（不硬编码猜测端点）。
 * 凭据键读 modelCapabilityCredentialKey.decisionJev(kind) 新键（shared 契约单一出处）。
 */
import assert from "node:assert/strict";
import { it } from "vitest";
import {
  modelCapabilityCredentialKey,
  type KnowledgeJevProvider,
  type ModelCapabilities,
} from "@drora/shared";
import {
  createKnowledgeJevProviderFactory,
  resolveKnowledgeJevAssembly,
} from "../src/knowledge/decision/jevAssembly.js";
import { TYPESAFE_OFFICIAL_BASE_URL } from "../src/knowledge/decision/jevTransport.js";

type DecisionJevEntry = ModelCapabilities["decision-jev"];

/** 档案快照的 decision-jev 条目（服务物化后恒为全字段；测试按同形状构造）。 */
function jevEntry(overrides: Partial<DecisionJevEntry>): DecisionJevEntry {
  return { enabled: false, providerKind: "typesafe", baseUrl: "", modelId: "", ...overrides };
}

function fakeCredentialService(value: string | null) {
  return { load: async (_key: string) => value };
}

it("K-JEV-7：开关缺省/关闭 → 返回 null（fail-closed）", async () => {
  assert.equal(
    await resolveKnowledgeJevAssembly({
      modelCapabilities: { "decision-jev": jevEntry({}) },
      credentialService: fakeCredentialService("sk-test"),
    }),
    null,
  );
  assert.equal(
    await resolveKnowledgeJevAssembly({
      modelCapabilities: { "decision-jev": jevEntry({ enabled: false }) },
      credentialService: fakeCredentialService("sk-test"),
    }),
    null,
  );
});

it("K-JEV-8：开关开但 Key 缺失/空白 → 返回 null（不出站、grant disabled 同语义）", async () => {
  assert.equal(
    await resolveKnowledgeJevAssembly({
      modelCapabilities: { "decision-jev": jevEntry({ enabled: true }) },
      credentialService: fakeCredentialService(null),
    }),
    null,
  );
  assert.equal(
    await resolveKnowledgeJevAssembly({
      modelCapabilities: { "decision-jev": jevEntry({ enabled: true }) },
      credentialService: fakeCredentialService("   "),
    }),
    null,
  );
});

it("K-JEV-9：开关开 + Key 存在 → 快照返回，baseURL trim/空白回落官方托管端点", async () => {
  const basic = await resolveKnowledgeJevAssembly({
    modelCapabilities: { "decision-jev": jevEntry({ enabled: true }) },
    credentialService: fakeCredentialService(" sk-test "),
  });
  assert.deepEqual(basic, {
    provider: "typesafe",
    apiKey: "sk-test",
    baseUrl: TYPESAFE_OFFICIAL_BASE_URL,
  });

  const overridden = await resolveKnowledgeJevAssembly({
    modelCapabilities: {
      "decision-jev": jevEntry({ enabled: true, baseUrl: " https://gateway.example.ai " }),
    },
    credentialService: fakeCredentialService("sk-test"),
  });
  assert.deepEqual(overridden, {
    provider: "typesafe",
    apiKey: "sk-test",
    baseUrl: "https://gateway.example.ai",
  });

  const blankOverridden = await resolveKnowledgeJevAssembly({
    modelCapabilities: { "decision-jev": jevEntry({ enabled: true, baseUrl: "   " }) },
    credentialService: fakeCredentialService("sk-test"),
  });
  assert.deepEqual(blankOverridden, {
    provider: "typesafe",
    apiKey: "sk-test",
    baseUrl: TYPESAFE_OFFICIAL_BASE_URL,
  });
});

it("K-JEV-11：远程提供商缺 Key/model 任一 → fail-closed 禁用（baseURL 缺省回落内置端点）", async () => {
  const withKey = fakeCredentialService("sk-remote");
  const withoutKey = { load: async () => null };
  const cases = [
    {
      label: "openrouter 缺 model",
      entry: jevEntry({ enabled: true, providerKind: "openrouter" }),
      credential: withKey,
    },
    {
      label: "openrouter 缺 Key",
      entry: jevEntry({
        enabled: true,
        providerKind: "openrouter",
        modelId: "typesafe/jev-latest",
        baseUrl: "https://openrouter.example/api",
      }),
      credential: withoutKey,
    },
    {
      label: "ai-gateway 缺 model",
      entry: jevEntry({
        enabled: true,
        providerKind: "ai-gateway",
        baseUrl: "https://agw.example.ai/jev",
      }),
      credential: withKey,
    },
    {
      label: "ai-gateway 缺 Key",
      entry: jevEntry({
        enabled: true,
        providerKind: "ai-gateway",
        modelId: "tenant/jev-1.13.0",
        baseUrl: "https://agw.example.ai/jev",
      }),
      credential: withoutKey,
    },
  ] as const;
  for (const { entry, credential, label } of cases) {
    assert.equal(
      await resolveKnowledgeJevAssembly({
        modelCapabilities: { "decision-jev": entry },
        credentialService: credential,
      }),
      null,
      label,
    );
  }
});

it("K-JEV-11：openrouter 配置齐备 → openrouter 快照（按 kind 分键凭据 + 必填 baseURL）", async () => {
  const loaded: string[] = [];
  const openrouterKey = modelCapabilityCredentialKey.decisionJev("openrouter");
  const assembly = await resolveKnowledgeJevAssembly({
    modelCapabilities: {
      "decision-jev": jevEntry({
        enabled: true,
        providerKind: "openrouter",
        modelId: " typesafe/jev-latest ",
        baseUrl: " https://openrouter.example/api ",
      }),
    },
    credentialService: {
      load: async (key: string) => {
        loaded.push(key);
        return key === openrouterKey ? "sk-openrouter" : null;
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
    modelCapabilities: {
      "decision-jev": jevEntry({
        enabled: true,
        providerKind: "openrouter",
        modelId: "typesafe/jev-latest",
      }),
    },
    credentialService: {
      load: async (key: string) => (key === openrouterKey ? "sk-openrouter" : null),
    },
  });
  assert.deepEqual(defaulted, {
    provider: "openrouter",
    apiKey: "sk-openrouter",
    model: "typesafe/jev-latest",
    baseUrl: "https://openrouter.ai/api/alpha",
  });
  assert.ok(loaded.length > 0);
  assert.ok(loaded.every((key) => key === openrouterKey));
});

it("K-JEV-11：ai-gateway 配置齐备 → ai-gateway 快照（按 kind 分键凭据 + 部署 baseURL）", async () => {
  const aiGatewayKey = modelCapabilityCredentialKey.decisionJev("ai-gateway");
  const assembly = await resolveKnowledgeJevAssembly({
    modelCapabilities: {
      "decision-jev": jevEntry({
        enabled: true,
        providerKind: "ai-gateway",
        modelId: "tenant/jev-1.13.0",
        baseUrl: " https://agw.example.ai/jev ",
      }),
    },
    credentialService: {
      load: async (key: string) => (key === aiGatewayKey ? "sk-ag" : null),
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
    modelCapabilities: {
      "decision-jev": jevEntry({
        enabled: true,
        providerKind: "ai-gateway",
        modelId: "typesafe/jev-latest",
      }),
    },
    credentialService: {
      load: async (key: string) => (key === aiGatewayKey ? "sk-ag" : null),
    },
  });
  assert.deepEqual(agwDefaulted, {
    provider: "ai-gateway",
    apiKey: "sk-ag",
    model: "typesafe/jev-latest",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
  });
});

it("provider 工厂：远程提供商标识覆盖 + typesafe 缺省注入 policy 预算", () => {
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

it("MC-4（可单测部分）：档案面各能力默认关闭 → 解析零出站（configSource null）", async () => {
  // 全默认档案（enabled=false）+ 齐备凭据：装配仍为 null——开关是第一道 fail-closed 门。
  const providers: KnowledgeJevProvider[] = ["typesafe", "openrouter", "ai-gateway"];
  for (const providerKind of providers) {
    assert.equal(
      await resolveKnowledgeJevAssembly({
        modelCapabilities: {
          "decision-jev": jevEntry({
            providerKind,
            ...(providerKind === "typesafe" ? {} : { modelId: "typesafe/jev-latest" }),
          }),
        },
        credentialService: fakeCredentialService("sk-test"),
      }),
      null,
      `provider=${providerKind}`,
    );
  }
});
