/**
 * 模型能力档案服务单测（specs/model-capabilities.md §4 / MC-1、MC-4 可单测部分）。
 *
 * 断言：update → 档案原子落盘 → onDidChange 收到新快照；条目浅合并不清空兄弟字段；
 * 坏 JSON 启动降级为全默认 + 按内容确定性备份原文件（fail-closed，各能力默认关闭）。
 * P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C11）：Jev 决策与
 * 本地语义嵌入两节点随 knowledge 栈迁插件拆除——凭据补丁面（credentials）随
 * decision-jev 分键拆除，本测试只剩档案面三条目（asr/tts/image-generation）。
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import {
  MODEL_CAPABILITIES_FILE_NAME,
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

it("MC-1：首启无档案 → get 迁移落盘全默认（标记 true）；update → 原子落盘 + onDidChange 新快照", async () => {
  const root = await makeRoot();
  const { service } = createService();
  const received: ModelCapabilitiesFile[] = [];
  service.onDidChange((snapshot) => received.push(snapshot));

  const initial = await service.get();
  assert.equal(initial.migratedFromLegacySettings, true, "首次初始化即写迁移标记");
  assert.equal(initial.capabilities.asr.engine, "webSpeech");
  assert.ok(existsSync(archivePath(root)), "迁移应落盘档案文件");

  const updated = await service.update({
    capabilities: {
      asr: {
        engine: "remote",
        // 档案按原样持久化（spec §3.2 schema 无 trim transform）；消费方解析时
        // trim（与语音适配器既有语义一致）。
        providerRef: "custom:asr",
        modelId: "asr-model-1",
        baseUrlOverride: "https://asr.example/api",
      },
    },
  });
  assert.equal(updated.capabilities.asr.engine, "remote");
  assert.equal(updated.capabilities.asr.baseUrlOverride, "https://asr.example/api");

  const onDisk = JSON.parse(await readFile(archivePath(root), "utf-8")) as ModelCapabilitiesFile;
  assert.equal(onDisk.capabilities.asr.providerRef, "custom:asr");
  assert.equal(onDisk.capabilities["image-generation"].enabled, false, "未触及条目保持默认");
  assert.equal(onDisk.migratedFromLegacySettings, true);

  assert.equal(received.length, 1, "update 触发一次广播");
  assert.equal(received[0].capabilities.asr.engine, "remote");
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
  assert.equal(updated.capabilities.asr.engine, "webSpeech", "其余条目不动");
});

it("MC-1：坏 JSON → 备份原文件 + 降级全默认（fail-closed），不阻断读路径", async () => {
  const root = await makeRoot();
  const corrupt = "{ not valid json !!";
  const file = archivePath(root);
  await mkdir(join(root, ".drora", "v2"), { recursive: true });
  await writeFile(file, corrupt, "utf-8");

  const { service } = createService();
  const snapshot = await service.get();
  assert.equal(snapshot.capabilities.asr.engine, "webSpeech", "降级全默认");
  assert.equal(snapshot.capabilities.tts.engine, "system");

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
