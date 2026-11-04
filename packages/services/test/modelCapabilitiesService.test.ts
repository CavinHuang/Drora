/**
 * 模型能力档案服务单测（specs/model-capabilities.md §4 / MC-1、MC-4 可单测部分）。
 *
 * 断言：update → 档案原子落盘 → onDidChange 收到新快照；条目浅合并不清空兄弟字段；
 * 凭据写删走 ICredentialService（null/空串=删除，ApiKeyRow 语义）；坏 JSON 启动
 * 降级为全默认 + 按内容确定性备份原文件（fail-closed，各能力默认关闭）。
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import {
  MODEL_CAPABILITIES_FILE_NAME,
  modelCapabilityCredentialKey,
  type ModelCapabilitiesFile,
} from "@drora/shared";
import { setDataBaseDir } from "../src/paths.js";
import {
  createModelCapabilitiesService,
  type ModelCapabilitiesServiceDependencies,
} from "../src/model-capabilities/node.js";

const tempRoots: string[] = [];

function fakeSettingService() {
  return {
    update: async () => {
      throw new Error("无旧键时迁移不得写设置");
    },
  };
}

/** 迁移旧值读取注入空对象（隔离真实 HOME 的 setting.json；MC-1 只测档案面）。 */
const emptyLegacySettings = async () => ({}) as Record<string, unknown>;

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

function createService(overrides: Partial<ModelCapabilitiesServiceDependencies> = {}) {
  const credentials = createFakeCredentialStore();
  const service = createModelCapabilitiesService({
    settingService: fakeSettingService(),
    readLegacySettings: emptyLegacySettings,
    credentialService: credentials,
    ...overrides,
  });
  return { service, credentials };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "drora-model-cap-"));
  tempRoots.push(root);
  setDataBaseDir(root);
  return root;
}

function archivePath(root: string): string {
  return join(root, ".drora", "v2", MODEL_CAPABILITIES_FILE_NAME);
}

afterEach(async () => {
  setDataBaseDir(null);
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

it("MC-1：首启无档案 → get 迁移落盘全默认（标记 true）；update → 原子落盘 + onDidChange 新快照 + 凭据写入", async () => {
  const root = await makeRoot();
  const { service, credentials } = createService();
  const received: ModelCapabilitiesFile[] = [];
  service.onDidChange((snapshot) => received.push(snapshot));

  const initial = await service.get();
  assert.equal(initial.migratedFromLegacySettings, true, "首次初始化即写迁移标记");
  assert.equal(initial.capabilities["decision-jev"].enabled, false);
  assert.ok(existsSync(archivePath(root)), "迁移应落盘档案文件");

  const updated = await service.update({
    capabilities: {
      "decision-jev": {
        enabled: true,
        providerKind: "openrouter",
        // 档案按原样持久化（spec §3.2 schema 无 trim transform）；消费方解析时
        // trim（jevAssembly normalizeBaseURL，knowledgeJevAssembly.test.ts K-JEV-9 已覆盖）。
        baseUrl: "https://or.example/api",
        modelId: "typesafe/jev-latest",
      },
    },
    credentials: {
      decisionJev: { providerKind: "openrouter", value: " sk-or " },
    },
  });
  assert.equal(updated.capabilities["decision-jev"].enabled, true);
  assert.equal(updated.capabilities["decision-jev"].baseUrl, "https://or.example/api");

  const onDisk = JSON.parse(await readFile(archivePath(root), "utf-8")) as ModelCapabilitiesFile;
  assert.equal(onDisk.capabilities["decision-jev"].providerKind, "openrouter");
  assert.equal(onDisk.capabilities["image-generation"].enabled, false, "未触及条目保持默认");
  assert.equal(onDisk.migratedFromLegacySettings, true);

  assert.equal(
    credentials.store.get(modelCapabilityCredentialKey.decisionJev("openrouter")),
    "sk-or",
    "凭据写入（trim）且不进档案文件",
  );
  assert.equal(JSON.stringify(onDisk).includes("sk-or"), false, "apiKey 不得进档案文件");

  assert.equal(received.length, 1, "update 触发一次广播");
  assert.equal(received[0].capabilities["decision-jev"].enabled, true);
});

it("MC-1：条目浅合并——补丁只覆盖给定字段，兄弟字段与其余条目不动", async () => {
  await makeRoot();
  const { service } = createService();
  await service.update({
    capabilities: {
      tts: { engine: "cloud", providerRef: "custom:tts", modelId: "tts-1" },
    },
  });
  const updated = await service.update({
    capabilities: {
      tts: { voice: "alloy" },
      "image-generation": { enabled: true, providerRef: "custom:img", modelId: "cogview" },
    },
  });
  assert.equal(updated.capabilities.tts.engine, "cloud", "兄弟字段不被清空");
  assert.equal(updated.capabilities.tts.providerRef, "custom:tts");
  assert.equal(updated.capabilities.tts.voice, "alloy");
  assert.equal(updated.capabilities["image-generation"].modelId, "cogview");
  assert.equal(updated.capabilities["decision-jev"].enabled, false, "其余条目不动");
});

it("MC-1：凭据留空保存即删除（ApiKeyRow 语义）；纯凭据更新也广播", async () => {
  await makeRoot();
  const { service, credentials } = createService();
  const jevKey = modelCapabilityCredentialKey.decisionJev("typesafe");
  const orKey = modelCapabilityCredentialKey.decisionJev("openrouter");
  await service.update({
    credentials: {
      decisionJev: { providerKind: "typesafe", value: "sk-jev" },
    },
  });
  await service.update({
    credentials: {
      decisionJev: { providerKind: "openrouter", value: "sk-or" },
    },
  });
  assert.equal(credentials.store.get(jevKey), "sk-jev");
  assert.equal(credentials.store.get(orKey), "sk-or", "providerKind 分键互不影响");

  const received: ModelCapabilitiesFile[] = [];
  service.onDidChange((snapshot) => received.push(snapshot));
  await service.update({ credentials: { decisionJev: { providerKind: "typesafe", value: "" } } });
  assert.equal(credentials.store.has(jevKey), false, "空串删除该 providerKind 键");
  assert.equal(credentials.store.get(orKey), "sk-or", "兄弟 providerKind 键不受影响");
  assert.equal(received.length, 1, "纯凭据变更也触发广播");
});

it("MC-1：坏 JSON → 备份原文件 + 降级全默认（fail-closed），不阻断读路径", async () => {
  const root = await makeRoot();
  const corrupt = "{ not valid json !!";
  const file = archivePath(root);
  await mkdir(join(root, ".drora", "v2"), { recursive: true });
  await writeFile(file, corrupt, "utf-8");

  const { service } = createService();
  const snapshot = await service.get();
  assert.equal(snapshot.capabilities["decision-jev"].enabled, false, "降级全默认");
  assert.equal(snapshot.capabilities.embedding.enabled, false);

  const backups = readdirSync(join(root, ".drora", "v2")).filter((name) =>
    /\.corrupt-[0-9a-f]+\.bak$/.test(name),
  );
  assert.equal(backups.length, 1, "按内容确定性备份一份");
  assert.equal(await readFile(join(root, ".drora", "v2", backups[0]), "utf-8"), corrupt);
});

it("MC-1：坏 schema（未来版本号）同样降级；get 返回克隆快照", async () => {
  const root = await makeRoot();
  await mkdir(join(root, ".drora", "v2"), { recursive: true });
  await writeFile(
    archivePath(root),
    JSON.stringify({ schemaVersion: 99, capabilities: {} }),
    "utf-8",
  );
  const { service } = createService();
  const snapshot = await service.get();
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.capabilities.asr.engine, "webSpeech");

  snapshot.capabilities.asr.engine = "remote";
  const reread = await service.get();
  assert.notEqual(reread.capabilities.asr.engine, "remote", "返回克隆，外部改动不回写服务状态");
});
