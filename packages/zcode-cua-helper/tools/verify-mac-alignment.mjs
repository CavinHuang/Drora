#!/usr/bin/env node
// mac CUA 对齐全套验收一键 runner（spec: specs/mac-cua-helper-app-alignment.md）。
// 用法：node tools/verify-mac-alignment.mjs [--fast]
//   --fast：跳过 .app 重建与真实 LS 发射（复用上一次产物）。
// 串行执行七套验收，任一失败即非零退出；全部通过打印汇总。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const packageRoot = new URL("..", import.meta.url).pathname;
const workspaceRoot = resolve(packageRoot, "../..");
const fast = process.argv.includes("--fast");
const builtApp = resolve(packageRoot, "dist-cua-helper/ZCode Computer Use.app");
const builtExe = join(builtApp, "Contents", "MacOS", "ZCode Computer Use");
const stagedApp = resolve(
  workspaceRoot,
  "packages/desktop/resources/cua-helper/ZCode Computer Use.app",
);

const run = (label, cmd, args, env) => {
  const startedAt = Date.now();
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: packageRoot,
    env: { ...process.env, ...env },
  });
  const ok = result.status === 0;
  console.log(
    `\n[${ok ? "PASS" : "FAIL"}] ${label} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)\n`,
  );
  if (!ok) process.exit(1);
};

// 1. 构建 .app（--fast 跳过）
if (!fast) {
  run("build:darwin-app", process.execPath, [join(packageRoot, "build-cua-helper-app.mjs")]);
} else if (!existsSync(builtExe)) {
  console.error("--fast 需要既有产物；先不带 --fast 跑一次。");
  process.exit(2);
}

// 2. 溯源冒烟
run("provenance smoke", builtExe, ["--cua-helper-provenance-smoke"]);

// 3. ax_native 接口（117 导出 + 双向漂移）
const addonPath = join(builtApp, "Contents", "Resources", "ax_native.node");
run("probe ax_native (117 exports)", process.execPath, [
  join(packageRoot, "tools/probe-ax-native.mjs"),
  addonPath,
]);
run("interface drift check", process.execPath, [
  join(packageRoot, "tools/check-ax-native-interface.mjs"),
  addonPath,
]);

// 4. ax_native 字节级对齐（官方 staging 副本存在时；不入库资产，CI 缺席为常态）
if (existsSync(join(stagedApp, "Contents", "Resources", "ax_native.node"))) {
  const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const ours = sha(addonPath);
  const orig = sha(join(stagedApp, "Contents", "Resources", "ax_native.node"));
  if (ours !== orig) {
    console.error(`ax_native byte mismatch: ${ours} vs ${orig}`);
    process.exit(1);
  }
  console.log(`[PASS] ax_native byte-identical (${ours.slice(0, 16)}…)\n`);
} else {
  console.log("[SKIP] ax_native byte identity (官方 staging 副本不在本机)\n");
}

// 5. zcode-cua 包测试链（restored-smoke + embedded-build-id + 发射契约 A–G）
//    发射契约 E2E 段需要产品 launcher 祖先（ZCode 桌面进程树内）；CI 设
//    MAC_LAUNCH_CONTRACT_E2E=0 只跑离线段。
run("restored smoke (mock broker)", process.execPath, [
  join(packageRoot, "../zcode-cua/test/restored-smoke.mjs"),
]);
run("embeddedBuildId wiring", process.execPath, [
  join(packageRoot, "../zcode-cua/test/embedded-build-id.mjs"),
  stagedApp,
]);
run("launch contract A–G", process.execPath, [
  join(packageRoot, "../zcode-cua/test/mac-launch-contract.mjs"),
  builtApp,
]);

// 6. 双 broker parity（对照官方 staging；缺席则整段跳过——CI 同理）
if (existsSync(join(stagedApp, "Contents", "MacOS", "ZCode Computer Use"))) {
  run("dual-broker parity (4 scenarios)", process.execPath, [
    join(packageRoot, "tools/parity-mac-helper.mjs"),
    builtApp,
    stagedApp,
  ]);
} else {
  console.log("[SKIP] dual-broker parity (官方 staging 副本不在本机)\n");
}

console.log("mac CUA 对齐全套验收通过 ✓");
