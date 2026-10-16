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
