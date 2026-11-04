/**
 * 模型能力档案一次性迁移单测（specs/model-capabilities.md §3.3 / MC-2）。
 *
 * 断言：含旧 knowledgeJev 系列与 voice 系列键的 setting.json + 旧凭据 → 初始化后档案值按
 * §3.3 表一一对应（含 voiceVendorBaseUrl 与 voice 凭据单键双写 asr+tts）、旧
 * AppSettings 键物理删除（批次二起 schema 已删 14 键：种子直接写原始 setting.json，
 * 迁移读原始文件、清理走空补丁整写剥离旧键）、旧凭据键删除；二次启动（标记已存在）
 * 不重复迁移。
 *
 * settingService 用真实实现（HOME 指向临时目录）钉住「Host 进程内直调 update 清理」
 * 的真实落盘语义；credentialService 用内存假实现（迁移逻辑与其加解密无关）。
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, it } from "vitest";
import {
  MODEL_CAPABILITIES_FILE_NAME,
  MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS,
  modelCapabilityCredentialKey,
} from "@drora/shared";
import { setDataBaseDir } from "../src/paths.js";
import { createSettingService } from "../src/setting/settingService.js";
import { createModelCapabilitiesService } from "../src/model-capabilities/index.js";

const originalHome = process.env.HOME;
const tempRoots: string[] = [];

function createFakeCredentialStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    load: async (key: string) => store.get(key) ?? null,
    save: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "drora-model-cap-mig-"));
  tempRoots.push(root);
  setDataBaseDir(root);
  process.env.HOME = root;
  return root;
}

function archivePath(root: string): string {
  return join(root, ".drora", "v2", MODEL_CAPABILITIES_FILE_NAME);
}

function settingsPath(root: string): string {
  return join(root, ".drora", "v2", "setting.json");
}

afterEach(async () => {
  setDataBaseDir(null);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

/**
 * 全量旧键 + 旧凭据种子（每类值各异，防迁移错位互相掩盖）。
 * 批次二起 14 键已从 AppSettings schema 删除——种子是升级用户 setting.json 的原始
 * 形态（宽松 Record，不经 schema），迁移源读原始文件。
 */
const LEGACY_SETTINGS: Record<string, unknown> = {
  knowledgeJevEnabled: true,
  knowledgeJevProvider: "openrouter",
  knowledgeJevOpenrouterBaseUrl: "https://or.example/api",
  knowledgeJevOpenrouterModel: "typesafe/jev-latest",
  knowledgeJevAiGatewayBaseUrl: "https://agw.example/jev",
  knowledgeJevAiGatewayModel: "tenant/jev-1",
  knowledgeJevBaseUrl: "https://typesafe-override.example",
  knowledgeSemanticEnabled: true,
  voiceAsrEngine: "remote",
  voiceVendorBaseUrl: "https://vendor.example/v1",
  voiceAsrVendorModel: "asr-model-1",
  voiceTtsEngine: "cloud",
  voiceTtsVendorModel: "tts-model-1",
  voiceTtsVendorVoice: "vendor-voice-9",
};

const LEGACY_CREDENTIALS: Record<string, string> = {
  [MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev.typesafe]: "sk-typesafe",
  [MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev.openrouter]: "sk-openrouter",
  [MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev["ai-gateway"]]: "sk-agw",
  [MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.voiceVendor]: "sk-voice",
};

it("MC-2：旧设置 + 旧凭据 → 档案一一对应（voice 双写）、旧键删除、幂等标记", async () => {
  const root = await makeRoot();
  const settingService = createSettingService();
  // 批次二（schema 已删 14 键）：patch/update 无法承载旧键——种子直接写原始
  // setting.json（升级用户的真实文件形态），迁移源读原始文件。
  await mkdir(dirname(settingsPath(root)), { recursive: true });
  await writeFile(settingsPath(root), JSON.stringify({ ...LEGACY_SETTINGS }, null, 2));
  const credentials = createFakeCredentialStore({ ...LEGACY_CREDENTIALS });

  const service = createModelCapabilitiesService({
    settingService,
    credentialService: credentials,
  });
  const snapshot = await service.get();

  // --- 档案值按 §3.3 表一一对应 ---
  assert.equal(snapshot.migratedFromLegacySettings, true);
  const decisionJev = snapshot.capabilities["decision-jev"];
  assert.equal(decisionJev.enabled, true);
  assert.equal(decisionJev.providerKind, "openrouter");
  assert.equal(decisionJev.baseUrl, "https://or.example/api", "按激活提供商取对应旧键");
  assert.equal(decisionJev.modelId, "typesafe/jev-latest");
  assert.equal(snapshot.capabilities.embedding.enabled, true);
  assert.equal(snapshot.capabilities.asr.engine, "remote");
  assert.equal(
    snapshot.capabilities.asr.baseUrl,
    "https://vendor.example/v1",
    "voice 单键双写 asr",
  );
  assert.equal(snapshot.capabilities.asr.modelId, "asr-model-1");
  assert.equal(snapshot.capabilities.tts.engine, "cloud");
  assert.equal(
    snapshot.capabilities.tts.baseUrl,
    "https://vendor.example/v1",
    "voice 单键双写 tts",
  );
  assert.equal(snapshot.capabilities.tts.modelId, "tts-model-1");
  assert.equal(snapshot.capabilities.tts.voice, "vendor-voice-9");

  // --- 凭据迁移：三键一一对应 + voice 双写 asr/tts 同值 ---
  assert.equal(
    credentials.store.get(modelCapabilityCredentialKey.decisionJev("openrouter")),
    "sk-openrouter",
  );
  assert.equal(
    credentials.store.get(modelCapabilityCredentialKey.decisionJev("typesafe")),
    "sk-typesafe",
  );
  assert.equal(
    credentials.store.get(modelCapabilityCredentialKey.decisionJev("ai-gateway")),
    "sk-agw",
  );
  assert.equal(credentials.store.get(modelCapabilityCredentialKey.asr), "sk-voice");
  assert.equal(credentials.store.get(modelCapabilityCredentialKey.tts), "sk-voice");

  // --- 旧键清理（批次二语义）：空补丁整写经 schema strip，14 旧键全部物理删除 ---
  const rawSettings = JSON.parse(await readFile(settingsPath(root), "utf-8")) as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(LEGACY_SETTINGS)) {
    assert.equal(rawSettings[key], undefined, `旧键应物理删除：${key}`);
  }
  for (const key of Object.keys(LEGACY_CREDENTIALS)) {
    assert.equal(credentials.store.has(key), false, `旧凭据键应删除：${key}`);
  }
  assert.ok(existsSync(archivePath(root)), "档案已落盘");
});

it("MC-2：二次启动不重复迁移（标记跳过；重播旧键不再影响档案）", async () => {
  const root = await makeRoot();
  const settingService = createSettingService();
  // 批次二（schema 已删 14 键）：旧键种子/回放均直接写原始 setting.json（迁移源读原始文件）。
  await mkdir(dirname(settingsPath(root)), { recursive: true });
  await writeFile(
    settingsPath(root),
    JSON.stringify({
      knowledgeJevEnabled: true,
      knowledgeJevProvider: "typesafe",
      knowledgeJevBaseUrl: "https://typesafe-override.example",
    }),
  );
  const credentials = createFakeCredentialStore({
    [MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev.typesafe]: "sk-typesafe",
  });
  const first = createModelCapabilitiesService({ settingService, credentialService: credentials });
  await first.get();
  assert.equal(credentials.store.has(modelCapabilityCredentialKey.decisionJev("typesafe")), true);

  // 模拟旧来源回放（如旧版本进程再写一次旧键）后二次启动：标记存在 → 跳过迁移。
  const replayed = JSON.parse(await readFile(settingsPath(root), "utf-8")) as Record<
    string,
    unknown
  >;
  replayed.knowledgeJevEnabled = false;
  replayed.voiceTtsEngine = "cloud";
  await writeFile(settingsPath(root), JSON.stringify(replayed));
  credentials.store.set(
    MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev.typesafe,
    "sk-old-again",
  );

  const second = createModelCapabilitiesService({ settingService, credentialService: credentials });
  const snapshot = await second.get();
  assert.equal(snapshot.capabilities["decision-jev"].enabled, true, "档案值不被旧键回放覆盖");
  assert.equal(snapshot.capabilities.tts.engine, "system", "未迁移过的旧值不事后生效");
  assert.equal(
    credentials.store.get(modelCapabilityCredentialKey.decisionJev("typesafe")),
    "sk-typesafe",
    "凭据不重复迁移覆盖",
  );
  const rawSettings = await readFile(settingsPath(root), "utf-8");
  assert.equal(
    rawSettings.includes('"knowledgeJevEnabled"'),
    true,
    "标记已存在时不再删旧键（迁移一次性）",
  );
});

it("MC-2：无旧键的全新安装 → 档案全默认 + 标记落盘，旧值缺失不阻断", async () => {
  const root = await makeRoot();
  const settingService = createSettingService();
  const credentials = createFakeCredentialStore();
  const service = createModelCapabilitiesService({
    settingService,
    credentialService: credentials,
  });
  const snapshot = await service.get();
  assert.equal(snapshot.migratedFromLegacySettings, true);
  assert.equal(snapshot.capabilities["decision-jev"].enabled, false);
  assert.equal(snapshot.capabilities.asr.engine, "webSpeech");
  assert.ok(existsSync(archivePath(root)));
  // 迁移读取异常按「旧值缺失」处理：原始 setting.json 解析失败也不阻断降级。
  // （新根目录保证走「无档案 → 迁移」路径，而非命中上一实例的标记跳过。）
  const degradedRoot = await makeRoot();
  await mkdir(dirname(settingsPath(degradedRoot)), { recursive: true });
  await writeFile(settingsPath(degradedRoot), "{half-written-json");
  const broken = createModelCapabilitiesService({
    settingService: { update: async () => undefined },
    credentialService: credentials,
  });
  const degraded = await broken.get();
  assert.equal(degraded.capabilities.embedding.enabled, false, "读取失败 = 旧值缺失");
  assert.equal(degraded.capabilities["decision-jev"].enabled, false);
  assert.equal(degraded.migratedFromLegacySettings, true);
});

it("MC-2 回归（合规修复）：迁移标记落盘失败 → 旧设置键与旧凭据键全部保留（删除以标记落盘成功为前提）", async () => {
  const root = await makeRoot();
  const v2 = join(root, ".drora", "v2");
  await mkdir(v2, { recursive: true });
  // 旧值种子直接写原始 setting.json（迁移源读原始文件；写在 chmod 前完成）。
  await writeFile(
    settingsPath(root),
    JSON.stringify({ knowledgeJevEnabled: true, voiceAsrEngine: "remote" }),
  );
  // 档案目录只读 → persist（临时文件写入）失败；设置/凭据走内存假实现不受影响，
  // 构造「标记落盘失败 + 旧键清理本可成功」的独立失败窗口。
  await chmod(v2, 0o500);
  const updateCalls: unknown[] = [];
  const settingService = {
    update: async (patch: unknown) => {
      updateCalls.push(patch);
    },
  };
  const credentials = createFakeCredentialStore({ ...LEGACY_CREDENTIALS });
  try {
    const service = createModelCapabilitiesService({
      settingService,
      credentialService: credentials,
    });
    const snapshot = await service.get();
    // 读路径不阻断：进程内仍服务迁移结果。
    assert.equal(snapshot.capabilities["decision-jev"].enabled, true);
    assert.equal(snapshot.capabilities.asr.engine, "remote");
    // spec §3.3 顺序不变式：标记未落盘 → 不得清理任何旧键（否则下次重迁移
    // 只能拿到默认值，用户配置不可逆丢失）。
    assert.equal(updateCalls.length, 0, "落盘失败时不得删除旧设置键");
    assert.equal(
      credentials.store.has(MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev.typesafe),
      true,
      "落盘失败时不得删除旧凭据键",
    );
    assert.equal(
      credentials.store.has(MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.voiceVendor),
      true,
    );
    // 新凭据键已写（凭据面与档案文件独立）；重试同值覆盖，幂等。
    assert.equal(
      credentials.store.get(modelCapabilityCredentialKey.decisionJev("typesafe")),
      "sk-typesafe",
    );
    assert.equal(credentials.store.get(modelCapabilityCredentialKey.asr), "sk-voice");
  } finally {
    await chmod(v2, 0o700);
  }
});

it("MC-2 回归（合规修复）：新凭据键写失败 → 该旧凭据键保留（不半删），其余键正常迁移", async () => {
  await makeRoot();
  const failingKeys = new Set([modelCapabilityCredentialKey.decisionJev("openrouter")]);
  const store = new Map<string, string>(Object.entries(LEGACY_CREDENTIALS));
  const credentials = {
    store,
    load: async (key: string) => store.get(key) ?? null,
    save: async (key: string, value: string) => {
      if (failingKeys.has(key)) throw new Error("credential save injected failure");
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  const service = createModelCapabilitiesService({
    settingService: { update: async () => undefined },
    credentialService: credentials,
  });
  await service.get();
  // openrouter 新键写失败 → 旧键保留、新键不存在（API key 不丢）。
  assert.equal(
    store.has(MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev.openrouter),
    true,
    "新键写失败的旧键必须保留",
  );
  assert.equal(store.has(modelCapabilityCredentialKey.decisionJev("openrouter")), false);
  // 其余键正常迁移并删旧键。
  assert.equal(store.get(modelCapabilityCredentialKey.decisionJev("typesafe")), "sk-typesafe");
  assert.equal(store.has(MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev.typesafe), false);
  assert.equal(store.get(modelCapabilityCredentialKey.decisionJev("ai-gateway")), "sk-agw");
  assert.equal(
    store.has(MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev["ai-gateway"]),
    false,
  );
});

it("MC-2 回归（合规修复）：voice 双写任一腿失败 → 旧 voice 键保留；已写腿保留同值（幂等重试）", async () => {
  await makeRoot();
  const failingKeys = new Set([modelCapabilityCredentialKey.tts]);
  const store = new Map<string, string>([
    [MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.voiceVendor, "sk-voice"],
  ]);
  const credentials = {
    store,
    load: async (key: string) => store.get(key) ?? null,
    save: async (key: string, value: string) => {
      if (failingKeys.has(key)) throw new Error("credential save injected failure");
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
  const service = createModelCapabilitiesService({
    settingService: { update: async () => undefined },
    credentialService: credentials,
  });
  await service.get();
  assert.equal(
    store.has(MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.voiceVendor),
    true,
    "tts 腿写失败时旧 voice 键必须保留",
  );
  assert.equal(store.get(modelCapabilityCredentialKey.asr), "sk-voice", "asr 腿已写，同值重试幂等");
  assert.equal(store.has(modelCapabilityCredentialKey.tts), false);
});
