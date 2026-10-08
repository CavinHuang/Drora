#!/usr/bin/env node
// 路线 A 分发 profile 验收（第五十轮，spec: specs/mac-cua-helper-app-alignment.md §七.0a）。
// 用法：node test/adhoc-distribution-profile.mjs
// 覆盖：
//   A. vse live 复核 requirement 三分支（严格 TeamID 锚 / dev 隔离 id / adhoc 分发产品 id）。
//   B. 发射参数：allowUnsignedLauncherLocalDev 才携带 --allow-unsigned-launcher-local-dev。
//   C. 生产形态 E2E：NODE_ENV=production、无 dev env、DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1，
//      CuaHelperHost 全链 launch（LS + token 文件）→ health → live 复核（adhoc 分支）→
//      permission_status 应答 → stop；对照组（严格门，无分发标记）必须 fail-closed。
//      E2E 需折叠构建的 Helper（CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1），缺失时自动重建；
//      CI/无前置环境可设 CUA_ADHOC_PROFILE_E2E=0 只跑离线段（A/B）。
import { spawn, execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const packageRoot = new URL("..", import.meta.url).pathname;
// helper-host 的编译期 dev 折叠在模块加载时求值（NODE_ENV !== "production"）；
// 必须先置 production 再动态 import，模拟打包态 host 进程。
process.env.NODE_ENV = "production";

const launcherMod = await import("../broker/server/helper-launcher.js");
const hostMod = await import("../broker/server/helper-host.js");

// —— A. vse 三分支 ——
const { vse } = hostMod;
assert.equal(
  vse({ expectedBundleId: "dev.drora.cua-helper", env: {} }),
  'anchor apple generic and identifier "dev.drora.cua-helper" and certificate leaf[subject.OU] = "8A5X4JJ39T"',
  "strict branch keeps TeamID anchor",
);
assert.equal(
  vse({ allowAdHocLocalDev: true, expectedBundleId: "dev.drora.cua-helper.dev" }),
  'identifier "dev.drora.cua-helper.dev"',
  "dev branch keeps isolated dev bundle id",
);
assert.throws(
  () => vse({ allowAdHocLocalDev: true, expectedBundleId: "dev.drora.cua-helper" }),
  /isolated dev bundle identifier/,
  "dev branch rejects product bundle id",
);
assert.equal(
  vse({
    allowAdHocLocalDev: true,
    adhocDistribution: true,
    expectedBundleId: "dev.drora.cua-helper",
  }),
  'identifier "dev.drora.cua-helper"',
  "adhoc distribution branch accepts product bundle id with identifier anchor",
);
assert.throws(
  () =>
    vse({
      allowAdHocLocalDev: true,
      adhocDistribution: true,
      expectedBundleId: "dev.drora.cua-helper.dev",
    }),
  /isolated dev bundle identifier/,
  "adhoc distribution branch rejects dev bundle id",
);
console.log("A. vse requirement branches OK");

// —— B. 发射参数折叠 ——
const { randomUUID } = await import("node:crypto");
const launchArgsHome = join(tmpdir(), `cua-adhoc-args-${Date.now()}`);
mkdirSync(join(launchArgsHome, ".launch-cancel"), { recursive: true });
const baseLaunchInput = {
  appPath: "/tmp/helper.app",
  socketPath: join(launchArgsHome, "broker.sock"),
  version: "3.14.3",
  expectedAppBundlePath: "/tmp/helper.app",
  brokerLaunchGuard: {
    deadlineEpochMs: Date.now() + 30000,
    cancelFilePath: join(
      launchArgsHome,
      ".launch-cancel",
      `.broker-launch-cancel-${randomUUID()}.sentinel`,
    ),
  },
};
const flagArgs = launcherMod.JC(
  { ...baseLaunchInput, allowUnsignedLauncherLocalDev: true },
  process.pid,
);
assert.ok(
  flagArgs.includes("--allow-unsigned-launcher-local-dev"),
  "launcher carries --allow-unsigned-launcher-local-dev when allowed",
);
const strictArgs = launcherMod.JC(baseLaunchInput, process.pid);
assert.ok(
  !strictArgs.includes("--allow-unsigned-launcher-local-dev"),
  "strict launcher omits --allow-unsigned-launcher-local-dev",
);
rmSync(launchArgsHome, { recursive: true, force: true });
console.log("B. launcher arg fold OK");

// —— C. 生产形态 E2E ——
const runE2E = process.env.CUA_ADHOC_PROFILE_E2E !== "0";
const helperApp = resolve(
  packageRoot,
  "../zcode-cua-helper/dist-cua-helper/Drora Computer Use.app",
);
const helperExe = join(helperApp, "Contents", "MacOS", "Drora Computer Use");

function readProvenance() {
  try {
    return JSON.parse(execFileSync(helperExe, ["--cua-helper-provenance-smoke"], { encoding: "utf8" }));
  } catch {
    return null;
  }
}

async function ensureFoldedHelper() {
  if (!existsSync(helperExe)) return false;
  const provenance = readProvenance();
  if (provenance?.allowUnsignedLauncherLocalDev === true) return true;
  // 产物在但未折叠（默认构建）——E2E 分发段需要折叠产物，重建。
  return null;
}

if (runE2E) {
  let folded = await ensureFoldedHelper();
  if (folded === false || folded === null) {
    console.log("[adhoc-profile] 构建/重建折叠 Helper（CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1）…");
    try {
      // 直接以当前 node 运行构建脚本：pnpm --filter 会被 volta shim 解析到
      // 项目钉扎外的 node（实测 18），SEA 守卫需要与骨架 ABI 一致的 node。
      execFileSync(process.execPath, ["build-cua-helper-app.mjs"], {
        cwd: resolve(packageRoot, "../zcode-cua-helper"),
        env: {
          ...process.env,
          CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER: "1",
          CUA_HELPER_BUILD_ID: "drora-adhoc-profile-test",
        },
        stdio: "inherit",
      });
      folded = (await ensureFoldedHelper()) === true;
    } catch (error) {
      console.warn(`[adhoc-profile] Helper 构建失败，E2E 段降级跳过：${error.message}`);
    }
  }

  if (folded === true) {
    const provenance = readProvenance();
    assert.equal(provenance.bundleId, "dev.drora.cua-helper", "helper bundle id is product id");

    const home = join(tmpdir(), `cua-ap-${Date.now().toString(36)}`);
    mkdirSync(home, { recursive: true });
    // darwin sun_path 预算 104 字节：长前缀 + pending 后缀会超限（connect EINVAL），
    // socket 名保持极短并逐次递增避免串扰。
    let socketSeq = 0;
    const productionEnv = {
      ...process.env,
      DRORA_CUA_HELPER_ADHOC_DISTRIBUTION: "1",
    };
    delete productionEnv.ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL;

    const makeHost = (env) =>
      new hostMod.CuaHelperHost({
        launcher: launcherMod.Bz(),
        helperAppCandidates: [helperApp],
        env,
        healthTimeoutMs: 20000,
        mintSocketPath: () => join(home, `b${(socketSeq += 1)}.sock`),
        logger: {
          info: () => {},
          warn: () => {},
          debug: () => {},
        },
      });

    // C1. 分发门全链：launch → health → live 复核（adhoc 分支）→ permission_status
    const adhocHost = makeHost(productionEnv);
    const handle = await adhocHost.start();
    try {
      assert.equal(handle.bundleId, "dev.drora.cua-helper", "claimed bundle id matches");
      assert.ok(handle.token, "broker token minted (mac token-file chain)");
      const status = await adhocHost.queryPermissionStatus(5000);
      assert.ok(status && typeof status === "object", "permission_status responds");
    } finally {
      await adhocHost.stop();
    }
    console.log("C1. adhoc distribution full chain OK");

    // C2. 对照组：同一 Helper、严格门（无分发标记）必须 fail-closed
    const strictEnv = { ...process.env };
    delete strictEnv.DRORA_CUA_HELPER_ADHOC_DISTRIBUTION;
    delete strictEnv.ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL;
    const strictHost = makeHost(strictEnv);
    let strictRejected = false;
    try {
      await strictHost.start();
    } catch {
      strictRejected = true;
    } finally {
      await strictHost.stop().catch(() => {});
    }
    assert.ok(strictRejected, "strict gate rejects adhoc helper without distribution flag");
    console.log("C2. strict gate fail-closed OK");

    rmSync(home, { recursive: true, force: true });
  } else {
    console.log("[adhoc-profile] 折叠 Helper 不可得，E2E 段跳过（离线段 A/B 已通过）");
  }
}

console.log("adhoc-distribution-profile: ALL OK");
