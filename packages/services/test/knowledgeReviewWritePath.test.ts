/**
 * W09 L2 写路径开关回归（specs/obsidian-knowledge.md §5f.3，WSG-UI-3/4）。
 *
 * 覆盖：vault-config.json 持久化（唯一写入入口 setVaultReviewWritePathEnabled）、
 * 缺省/坏值视为关闭、引擎未显式传参时从配置异步加载初值、setWritePathEnabled
 * 先持久化后翻转、重启（同 root 新实例）保持、显式传参（测试形态）不读配置。
 * 全部 mkdtemp 合成临时 Vault，零模型/零网络。
 * 运行：node --import tsx --test packages/services/test/knowledgeReviewWritePath.test.ts
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import {
  configureVaultAt,
  setVaultReviewWritePathEnabled,
  vaultConfigPath,
} from "../src/obsidian-vault/config.js";
import { createKnowledgeServices } from "../src/knowledge/knowledgeServices.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readConfigField(pluginDataDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(vaultConfigPath(pluginDataDir), "utf-8")) as Record<
    string,
    unknown
  >;
}

test("WSG-UI-3：setVaultReviewWritePathEnabled 持久化读-改-写；坏值视为关闭", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-toggle-file-"));
  setDataBaseDir(root);
  try {
    const pluginDataDir = join(root, "plugin-data");
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });

    // 缺省文件无字段 → 视为关闭。
    const fresh = await readConfigField(pluginDataDir);
    assert.notEqual(fresh.reviewWritePathEnabled, true);

    assert.notEqual(await setVaultReviewWritePathEnabled(pluginDataDir, true), null);
    const afterOn = await readConfigField(pluginDataDir);
    assert.equal(afterOn.reviewWritePathEnabled, true);
    // 其余字段原样保留（读-改-写，不是覆盖式重建）。
    assert.equal(afterOn.allowAgentWrites, true);

    assert.notEqual(await setVaultReviewWritePathEnabled(pluginDataDir, false), null);
    const afterOff = await readConfigField(pluginDataDir);
    assert.equal(afterOff.reviewWritePathEnabled, false);

    // 坏值（非 boolean）视为关闭：解析器不接收，引擎加载判定不为 true。
    await writeFile(
      vaultConfigPath(pluginDataDir),
      JSON.stringify({ ...afterOff, reviewWritePathEnabled: "yes" }),
      "utf-8",
    );
    const reloaded = await readConfigField(pluginDataDir);
    assert.notEqual(reloaded.reviewWritePathEnabled, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WSG-UI-4：未显式传参（生产形态）从配置加载；开关先持久化后翻转；重启（同 root 新实例）保持", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-toggle-engine-"));
  setDataBaseDir(root);
  try {
    const pluginDataDir = join(root, "plugin-data");
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
    const databasePath = join(root, "knowledge", "knowledge-index.sqlite");

    // 生产形态：不传 reviewWritePathEnabled → 加载完成前按关闭判定（fail-closed）。
    const first = createKnowledgeServices({ databasePath, pluginDataDir });
    try {
      assert.equal(first.reviewService.isWritePathEnabled(), false);
      await sleep(30);
      // 配置文件此时无字段 → 加载后仍为关闭。
      assert.equal(first.reviewService.isWritePathEnabled(), false);

      // 开关：持久化成功后进程内状态才翻转。
      await first.reviewService.setWritePathEnabled(true);
      assert.equal(first.reviewService.isWritePathEnabled(), true);
      const persisted = await readConfigField(pluginDataDir);
      assert.equal(persisted.reviewWritePathEnabled, true);
    } finally {
      first.dispose();
    }

    // 重启语义：同一 root 的新实例（仍未显式传参）从配置加载到 true。
    const second = createKnowledgeServices({ databasePath, pluginDataDir });
    try {
      await sleep(30);
      assert.equal(second.reviewService.isWritePathEnabled(), true);
    } finally {
      second.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WSG-UI-4b：显式传参（测试形态）以参数为准、不读配置——false 保持关闭", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-toggle-override-"));
  setDataBaseDir(root);
  try {
    const pluginDataDir = join(root, "plugin-data");
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
    const services = createKnowledgeServices({
      databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
      pluginDataDir,
      reviewWritePathEnabled: false,
    });
    try {
      // 即使配置随后被置 true，显式传参的实例不读配置（测试确定性）。
      assert.notEqual(await setVaultReviewWritePathEnabled(pluginDataDir, true), null);
      await sleep(30);
      assert.equal(services.reviewService.isWritePathEnabled(), false);
    } finally {
      services.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
