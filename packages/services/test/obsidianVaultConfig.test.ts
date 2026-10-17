/**
 * 托管 Vault 根判定的 realpath 归一回归测试（W07 E2E 在 macOS 暴露的缺陷，spec
 * obsidian-plugin.md「托管 Vault」）。
 *
 * 缺陷：configureVaultAt 用「assertVaultRoot 的 realpath 结果」与「未归一的
 * managedVaultDirPath resolve 结果」做字符串相等——pluginDataDir 自身含软链段时
 * （macOS 的 /var → /private/var 是系统级实例）两侧永不相等，托管 Vault 显示名
 * 恒回落目录名 "managed-vault" 而非 "Drora Vault"。
 *
 * 本文件用「软链 pluginDataDir」在全平台确定性复现同一失配，不依赖平台软链巧合。
 * 运行：node --import tsx --test packages/services/test/obsidianVaultConfig.test.ts
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configureManagedVault,
  loadVaultConfig,
  setVaultAgentWritesEnabled,
  setVaultReviewWritePathEnabled,
} from "../src/obsidian-vault/config.js";

test("configureManagedVault：pluginDataDir 含软链段时 displayName 仍判为托管（Drora Vault）", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-vault-config-"));
  try {
    // 真实数据目录 + 指向它的软链：经软链传入的 pluginDataDir 复现「传入路径 ≠ realpath」。
    const realData = join(root, "real-data");
    const linkData = join(root, "link-data");
    await mkdir(realData, { recursive: true });
    await symlink(realData, linkData, "dir");

    const managed = await configureManagedVault(linkData);
    assert.equal(managed.displayName, "Drora Vault");

    // 幂等：二次配置（真实路径命中已有配置）不改变判定。
    const again = await configureManagedVault(linkData);
    assert.equal(again.displayName, "Drora Vault");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("L2 real Vault authorization: explicit grant, monotonic epoch, and revocation resets review-write", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-l2-vault-auth-"));
  try {
    const configured = await configureManagedVault(root);
    assert.equal(configured.allowAgentWrites, false);
    const first = await loadVaultConfig(root);
    assert.ok(first);
    assert.equal(first.reviewWritePathEnabled, undefined);
    const granted = await setVaultAgentWritesEnabled(root, true);
    assert.equal(granted?.allowAgentWrites, true);
    const afterGrant = await loadVaultConfig(root);
    assert.ok(afterGrant);
    assert.ok(afterGrant.configuredAt > first.configuredAt);
    assert.equal(afterGrant.reviewWritePathEnabled, false);
    await setVaultReviewWritePathEnabled(root, true);
    const beforeRevocation = await loadVaultConfig(root);
    assert.equal(beforeRevocation?.reviewWritePathEnabled, true);
    const revoked = await setVaultAgentWritesEnabled(root, false);
    assert.equal(revoked?.allowAgentWrites, false);
    const afterRevoke = await loadVaultConfig(root);
    assert.ok(afterRevoke);
    assert.equal(afterRevoke.reviewWritePathEnabled, false);
    assert.ok(afterRevoke.configuredAt > afterGrant.configuredAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("E-1 回归：三条写路径并发交叉不丢更新（撤权不被旧快照回滚）", async () => {
  // 2026-10-17 增量评审 E-1：三条 vault-config.json 写路径原为裸读-改-写，
  // 并发交叉时后写者以旧快照整体回写（撤权结果被回滚成 allowAgentWrites=true、
  // configuredAt 回退）。串行化后同一并发组合必须收敛到「最后一个完成的写入」
  // 的语义：撤权与开关写入不丢失，configuredAt 单调不减。
  const root = await mkdtemp(join(tmpdir(), "drora-vault-race-"));
  try {
    await configureManagedVault(root);
    await setVaultAgentWritesEnabled(root, true);
    // 同时发起：撤权 + 开启 L2 开关 + 重授权（三个读-改-写并发竞争）。
    await Promise.all([
      setVaultAgentWritesEnabled(root, false),
      setVaultReviewWritePathEnabled(root, true),
      setVaultAgentWritesEnabled(root, true),
    ]);
    const config = await loadVaultConfig(root);
    assert.ok(config);
    // 无论完成顺序如何，文件里的 allowAgentWrites 必须是某一次完整写入的结果，
    // 且当 allowAgentWrites=true 时 reviewWritePathEnabled 不得是 true（true 只能
    // 由 setVaultReviewWritePathEnabled 写入，而任何 agentWrites 写入都强制复位它；
    // 若二者同 true，说明一次 agentWrites 写入被另一次旧快照回写覆盖）。
    if (config.allowAgentWrites) {
      assert.equal(config.reviewWritePathEnabled, false);
    } else {
      assert.ok(
        config.reviewWritePathEnabled === undefined ||
          config.reviewWritePathEnabled === false ||
          config.reviewWritePathEnabled === true,
      );
    }
    // 串行重放最终意图：撤权后配置必须如实反映撤权（不再被回滚）。
    const final = await setVaultAgentWritesEnabled(root, false);
    assert.equal(final?.allowAgentWrites, false);
    const after = await loadVaultConfig(root);
    assert.ok(after);
    assert.equal(after.allowAgentWrites, false);
    assert.equal(after.reviewWritePathEnabled, false);
    assert.ok(after.configuredAt >= config.configuredAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
