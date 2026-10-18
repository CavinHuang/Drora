/**
 * W09 L2 写路径开关回归（specs/obsidian-knowledge.md §5e.12，WSG-UI-3/4）。
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
  loadVaultConfig,
  setVaultReviewWritePathEnabled,
  vaultConfigPath,
} from "../src/obsidian-vault/config.js";
import { createKnowledgeServices } from "../src/knowledge/knowledgeServices.js";
import { isReleasedReviewWriteAuthority } from "../src/knowledge/review/reviewReleasePolicy.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("S03 release policy grants local desktop capability only; user opt-in still defaults off", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-release-policy-"));
  setDataBaseDir(root);
  try {
    for (const authority of [undefined, "desktop-local", "desktop-attached-remote"] as const) {
      const services = createKnowledgeServices({
        databasePath: join(root, "knowledge.sqlite"),
        pluginDataDir: join(root, "plugin-data"),
        reviewWriteSafetyGatePassed: isReleasedReviewWriteAuthority(authority),
      });
      try {
        assert.equal(
          services.reviewService.isWritePathActivationAllowed(),
          authority === "desktop-local",
        );
        assert.equal(services.reviewService.isWritePathEnabled(), false);
        if (authority !== "desktop-local") {
          await assert.rejects(services.reviewService.setWritePathEnabled(true), /runtime gate/);
        }
      } finally {
        services.dispose();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

    // 坏值（非 boolean）被解析器剥离为缺省（=关闭）：SV-6（2026-10-18 终审）——
    // 原断言读回原始 JSON 判 "yes" !== true 对序列化恒真；改为真驱动 loadVaultConfig，
    // 断言 parseVaultConfigShape 剔除坏值字段（undefined），且坏值不连坐判坏整个配置。
    await writeFile(
      vaultConfigPath(pluginDataDir),
      JSON.stringify({ ...afterOff, reviewWritePathEnabled: "yes" }),
      "utf-8",
    );
    const reloaded = await loadVaultConfig(pluginDataDir);
    assert.ok(reloaded, "坏值不得导致整个配置被判损坏");
    assert.equal(
      reloaded.reviewWritePathEnabled,
      undefined,
      "非 boolean 坏值必须被剥离为缺省（关闭）",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S03 NO-GO: production never restores or activates L2 writes from a persisted true flag", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-toggle-nogo-"));
  setDataBaseDir(root);
  try {
    const pluginDataDir = join(root, "plugin-data");
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
    assert.notEqual(await setVaultReviewWritePathEnabled(pluginDataDir, true), null);
    const services = createKnowledgeServices({
      databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
      pluginDataDir,
    });
    try {
      assert.equal(services.reviewService.isWritePathActivationAllowed(), false);
      assert.equal(services.reviewService.isWritePathEnabled(), false);
      await sleep(40);
      assert.equal(services.reviewService.isWritePathEnabled(), false);
      await assert.rejects(
        services.reviewService.setWritePathEnabled(true),
        /S03 Hard Write Safety NO-GO/,
      );
      assert.equal(services.reviewService.isWritePathEnabled(), false);
      // Config may still retain a stale true, but it grants no runtime permission.
      assert.equal((await readConfigField(pluginDataDir)).reviewWritePathEnabled, true);
      await services.reviewService.setWritePathEnabled(false);
      assert.equal((await readConfigField(pluginDataDir)).reviewWritePathEnabled, false);
    } finally {
      services.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S03 explicit verified gate: persisted preference restores, toggles are serialized and survive restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-toggle-approved-"));
  setDataBaseDir(root);
  try {
    const pluginDataDir = join(root, "plugin-data");
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
    const databasePath = join(root, "knowledge", "knowledge-index.sqlite");
    // This flag is test-only until an independently verified S03 host gate is wired.
    const options = { databasePath, pluginDataDir, reviewWriteSafetyGatePassed: true };
    const first = createKnowledgeServices(options);
    try {
      assert.equal(first.reviewService.isWritePathActivationAllowed(), true);
      assert.equal(first.reviewService.isWritePathEnabled(), false);
      await first.reviewService.setWritePathEnabled(true);
      assert.equal(first.reviewService.isWritePathEnabled(), true);
      assert.equal((await readConfigField(pluginDataDir)).reviewWritePathEnabled, true);
      const immediateRevocation = first.reviewService.setWritePathEnabled(false);
      assert.equal(first.reviewService.isWritePathEnabled(), false, "revocation must not await IO");
      await immediateRevocation;
      await first.reviewService.setWritePathEnabled(true);
      // Three concurrent requests must commit in invocation order, not IO completion order.
      await Promise.all([
        first.reviewService.setWritePathEnabled(false),
        first.reviewService.setWritePathEnabled(true),
        first.reviewService.setWritePathEnabled(false),
      ]);
      assert.equal(first.reviewService.isWritePathEnabled(), false);
      assert.equal((await readConfigField(pluginDataDir)).reviewWritePathEnabled, false);
      await first.reviewService.setWritePathEnabled(true);
    } finally {
      first.dispose();
    }
    const second = createKnowledgeServices(options);
    try {
      await sleep(40);
      assert.equal(second.reviewService.isWritePathEnabled(), true);
      // A user toggle made while the startup read is in flight must win.
      const third = createKnowledgeServices(options);
      try {
        await third.reviewService.setWritePathEnabled(false);
        await sleep(40);
        assert.equal(third.reviewService.isWritePathEnabled(), false);
        assert.equal((await readConfigField(pluginDataDir)).reviewWritePathEnabled, false);
      } finally {
        third.dispose();
      }
    } finally {
      second.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("S03 approved runtime cannot carry an L2 preference to a newly configured Vault", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-toggle-cross-vault-"));
  setDataBaseDir(root);
  try {
    const pluginDataDir = join(root, "plugin-data");
    const firstVault = join(root, "first-vault");
    const secondVault = join(root, "second-vault");
    await mkdir(firstVault, { recursive: true });
    await mkdir(secondVault, { recursive: true });
    await configureVaultAt(pluginDataDir, firstVault, { allowAgentWrites: true });
    const services = createKnowledgeServices({
      databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
      pluginDataDir,
      reviewWriteSafetyGatePassed: true,
    });
    try {
      await services.reviewService.setWritePathEnabled(true);
      assert.equal(services.reviewService.isWritePathEnabled(), true);
      await configureVaultAt(pluginDataDir, secondVault, { allowAgentWrites: true });
      assert.notEqual((await readConfigField(pluginDataDir)).reviewWritePathEnabled, true);
      const rejected = await services.reviewService.applyProposal({ proposalId: "missing" });
      assert.equal(rejected.outcome, "blocked");
      assert.equal(rejected.reason, "write_path_disabled");
    } finally {
      services.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("L2 toggle fails closed when no valid Vault configuration is available", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-toggle-no-vault-"));
  setDataBaseDir(root);
  try {
    const services = createKnowledgeServices({
      databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
      pluginDataDir: join(root, "plugin-data"),
      reviewWriteSafetyGatePassed: true,
    });
    try {
      await assert.rejects(
        services.reviewService.setWritePathEnabled(true),
        /configuration unavailable/,
      );
      assert.equal(services.reviewService.isWritePathEnabled(), false);
    } finally {
      services.dispose();
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
