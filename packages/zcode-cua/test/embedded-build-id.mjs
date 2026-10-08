#!/usr/bin/env node
// embeddedBuildId 接线验收（spec: specs/mac-cua-helper-app-alignment.md §六）。
// 用法：node test/embedded-build-id.mjs [bundled.app]
//   缺省对照 packages/zcode-cua-helper/dist-cua-helper/Drora Computer Use.app（我方构建副本）。
//
// 覆盖两段：
//   A. 身份读取机制：plutil -extract 从 bundled Info.plist 读出
//      ZCodeCUAHelperBuildId / CFBundleShortVersionString（desktop
//      desktopCuaHelperBuildIdentity.ts 的同款命令与键）。
//   B. 安装链组合：读取结果作为 embeddedBuildId/version 传入
//      createCuaHelperInstaller（与桌面包装层同构的组合），对自建副本走
//      路线 A 放行（allowUnsignedDistribution，specs/drora-rename.md
//      2026-09-28 修订：Helper 身份已 Drora 化，官方 staging 参照副本保留
//      官方身份与原名，不再作为本测试的安装对象——其 bundle id 与我方
//      期望恒异，release 链的 bundle-id/TeamID 门由 adhoc-distribution-profile
//      的 vse 分支断言覆盖）。
// 桌面包装层本体 import electron，无法在纯 node 测试中加载；其行为由
// A（读取机制）+ B（字段组合契约）组合覆盖。
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const packageRoot = new URL("..", import.meta.url).pathname;
const bundledApp =
  process.argv[2] ??
  resolve(packageRoot, "../zcode-cua-helper/dist-cua-helper/Drora Computer Use.app");
const plistPath = join(bundledApp, "Contents", "Info.plist");

// —— A. 身份读取 ——
function readKey(key) {
  const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 64 * 1024,
  });
  const value = (result.stdout ?? "").trim();
  assert.equal(result.status, 0, `plutil -extract ${key} failed`);
  return value;
}
const embeddedBuildId = readKey("ZCodeCUAHelperBuildId");
const version = readKey("CFBundleShortVersionString");
assert.ok(embeddedBuildId.length > 0, "build id present");
assert.match(version, /^\d+\.\d+\.\d+$/, "version shape");
console.log(`A. identity read: buildId=${embeddedBuildId} version=${version}`);

// —— B. 路线 A 安装链（接线契约）——
const mod = await import("../broker/server/helper-installer.js");
const home = join(tmpdir(), `cua-wiring-${Date.now()}`);
mkdirSync(home, { recursive: true });
const logger = { info() {}, warn() {}, error() {}, debug() {} };
try {
  const installer = mod.qu({
    env: { ...process.env, ZCODE_HOME: home, ZCODE_RUNTIME_ENV: "production" },
    logger,
    bundledAppPath: bundledApp,
    embeddedBuildId,
    version,
    allowUnsignedDistribution: true,
  });
  const appPath = await installer.ensureInstalled();
  assert.ok(appPath, "installed path returned");
  const meta = JSON.parse(
    readFileSync(join(home, "computer-use", ".zcode-cua-helper-meta.json"), "utf8"),
  );
  assert.equal(meta.verificationMode, "local_dev_unsigned", "route-A verification mode");
  assert.equal(meta.releaseEligible, false, "not release eligible under route A");
  assert.equal(meta.buildId, embeddedBuildId, "meta carries the bundled build id");
  assert.equal(meta.version, version, "meta carries the bundled version");
  assert.equal(meta.bundleId, "dev.drora.cua-helper", "meta carries the Drora bundle id");
  assert.equal(meta.source, "bundled:zcode-app", "bundled source");
  const again = await installer.ensureInstalled();
  assert.equal(again, appPath, "idempotent re-install");
  console.log(
    `B. route-A install: mode=${meta.verificationMode} buildId=${meta.buildId} version=${meta.version} idempotent=ok`,
  );
  console.log("\nembeddedBuildId 接线验收通过 ✓");
} finally {
  rmSync(home, { recursive: true, force: true });
}
