// 第五十五轮回归测试：host 托管路径安装器的随包构建身份注入。
// 缺陷：services 侧 host installer 构造不传 embeddedBuildId，plan 期望回落 WC 常量
// （官方 pipeline id），与随包自建 Helper（drora-<版本>）buildId 必然失配——agent 首次
// 驱动 CUA 的 ensureInstalled 校验即 verification_failed。
// 修复契约（spec §六：main 是 bundled 身份唯一读取点）：main 经
// DRORA_CUA_HELPER_EMBEDDED_BUILD_ID/_VERSION 下发，host 侧 readEmbeddedCuaHelperBuildIdentityFromEnv 消费。
// 本测试用我方构建副本（packages/zcode-cua-helper/dist-cua-helper，dev 机构建产物；
// CI 缺席自动跳过）做行为级验证：注入真实身份 → 安装校验通过（路线 A 放行，镜像
// 生产 adhoc 分发形态）；注入错误身份 → fail-closed。官方 staging 参照副本自
// 2026-09-28 Helper 身份 Drora 化后保留官方身份与原名，不再作为安装对象
// （specs/drora-rename.md）。
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  createCanonicalCuaHelperInstaller,
  readEmbeddedCuaHelperBuildIdentityFromEnv,
  DRORA_CUA_HELPER_EMBEDDED_BUILD_ID_ENV,
} from "../src/node.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const stagedHelperApp = join(repoRoot, "zcode-cua-helper/dist-cua-helper/Drora Computer Use.app");
const runIfStaged = existsSync(join(stagedHelperApp, "Contents/Info.plist")) ? test : test.skip;

function readPlistKey(app, key) {
  return execFileSync(
    "/usr/bin/plutil",
    ["-extract", key, "raw", "-o", "-", join(app, "Contents/Info.plist")],
    {
      encoding: "utf8",
    },
  ).trim();
}

test("readEmbeddedCuaHelperBuildIdentityFromEnv 解析并裁剪", () => {
  const identity = readEmbeddedCuaHelperBuildIdentityFromEnv({
    [DRORA_CUA_HELPER_EMBEDDED_BUILD_ID_ENV]: "  drora-0.0.1  ",
    DRORA_CUA_HELPER_EMBEDDED_VERSION: "3.14.3\n",
  });
  assert.equal(identity.embeddedBuildId, "drora-0.0.1");
  assert.equal(identity.version, "3.14.3");
  assert.deepEqual(readEmbeddedCuaHelperBuildIdentityFromEnv({}), {});
});

runIfStaged("注入随包真实 buildId → 安装校验通过", async () => {
  const home = mkdtempSync(join(tmpdir(), "cua-host-bid-"));
  try {
    const installer = createCanonicalCuaHelperInstaller({
      env: {
        ...process.env,
        NODE_ENV: "production",
        ZCODE_HOME: home,
        DRORA_CUA_HELPER_ADHOC_DISTRIBUTION: "1",
      },
      // 生产 host 路径在 adhoc 分发态注入的同款放行（node.ts 主机安装器同源）。
      allowUnsignedDistribution: true,
      bundledAppPath: stagedHelperApp,
      embeddedBuildId: readPlistKey(stagedHelperApp, "ZCodeCUAHelperBuildId"),
      version: readPlistKey(stagedHelperApp, "CFBundleShortVersionString"),
    });
    const appPath = await installer.ensureInstalled();
    assert.equal(appPath, join(home, "computer-use/Drora Computer Use.app"));
    await installer.verifyInstalled(appPath);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

runIfStaged("身份回落 WC 常量与自建 buildId 失配 → fail-closed（缺陷回归锚）", async () => {
  const home = mkdtempSync(join(tmpdir(), "cua-host-bid-ctrl-"));
  try {
    // 模拟修复前形态：不注入 embeddedBuildId（期望回落 WC 官方 pipeline id），
    // 对一个 buildId=drora-* 的 bundled Helper 必然失配。
    const installer = createCanonicalCuaHelperInstaller({
      env: { ...process.env, NODE_ENV: "production", ZCODE_HOME: home },
      bundledAppPath: stagedHelperApp,
      embeddedBuildId: "drora-0.0.1",
    });
    await assert.rejects(
      () => installer.ensureInstalled(),
      (error) => {
        assert.match(error.message, /does not match drora-0\.0\.1/);
        return true;
      },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("buildStandaloneCuaHelperLaunchArgs：路线 A 分发/严格态的 flag 门控（第五十六轮）", async () => {
  const { buildStandaloneCuaHelperLaunchArgs } = await import("../src/node.ts");
  const base = {
    appPath: "/tmp/H.app",
    socketPath: "/tmp/b.sock",
    tokenFile: "/tmp/t",
    launcherPid: 1234,
  };
  const withAdhoc = buildStandaloneCuaHelperLaunchArgs({
    ...base,
    env: { DRORA_CUA_HELPER_ADHOC_DISTRIBUTION: "1" },
  });
  assert.ok(withAdhoc.includes("--allow-unsigned-launcher-local-dev"), "路线 A 传 launcher 放行");
  assert.ok(
    withAdhoc.includes("--allow-external-broker-client-local-dev"),
    "路线 A 传外部 peer 放行",
  );
  // 严格态必须同时压掉 dev 分支：测试进程 NODE_ENV 未设时编译期 dev 回退为真。
  const strict = buildStandaloneCuaHelperLaunchArgs({
    ...base,
    env: { NODE_ENV: "production", ZCODE_RUNTIME_ENV: "production" },
  });
  assert.ok(
    !strict.includes("--allow-unsigned-launcher-local-dev"),
    "严格态不传（对照：生产包此前恒拒的根因锚）",
  );
});
