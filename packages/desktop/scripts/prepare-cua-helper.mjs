#!/usr/bin/env node
// macOS CUA Helper 随包资产准备（第五十轮，spec: specs/mac-cua-helper-app-alignment.md §七.0a）。
// 官方形态对齐：官方 mac 发行物恒带 Resources/cua-helper/Drora Computer Use.app。
// 此前发布链只在 resources/cua-helper（gitignored 官方签名 staging 副本）存在时才
// staging，干净检出/CI 构建静默产出"无 Helper 包"——设置页「电脑控制」因此整链不可用。
//
// 打包资产恒为自建 SEA Helper（写入 bundled-cua-helper/，electron-builder 源）：
// 官方签名副本（resources/cua-helper）只作 parity 参照物与 node_modules 种源，
// 不入包——其 launcher 门钉死 dev.zcode.app + TeamID 8A5X4JJ39T，Drora
// （dev.drora.app）无论 ad-hoc 还是自有 Developer ID 都永远无法拉起它。
// 分发 profile 折叠：路线 A 默认恒折叠 CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1。
// 严格 launcher 门（锚官方 Developer ID + TeamID 8A5X4JJ39T）只在
// DRORA_CUA_HELPER_STRICT_CHAIN=1（未来 Developer ID + spec §七.3 v2 整体
// 还原）时打开——自签名证书（spec §七.2 2026-09-27 部分裁定）无法满足严格门，
// 若按 DRORA_ENABLE_MAC_SIGN 关折叠会让签名包的 Helper 恒拒启。
// 构建失败即失败：发布构建不允许静默降级为"不带 Helper 的包"。
import process from "node:process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTargetPlatform } from "./target-platform.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const helperAppName = "Drora Computer Use.app";
const packagingStageRoot = join(desktopRoot, "bundled-cua-helper");
const stagedHelperApp = join(packagingStageRoot, helperAppName);
const builtHelperApp = join(
  workspaceRoot,
  "packages",
  "zcode-cua-helper",
  "dist-cua-helper",
  helperAppName,
);

const target = getTargetPlatform();
if (target.os !== "darwin") {
  console.log(`[prepare:cua-helper] target ${target.os}-${target.arch} 非 darwin，跳过`);
  process.exit(0);
}

// desktop 是 private 包无 version；与 build-metadata/desktop-product-identity 同源，
// 版本真源为工作区根 package.json（appVersion）。
const desktopVersion = JSON.parse(
  readFileSync(join(workspaceRoot, "package.json"), "utf8"),
).version;
// 与 SEA 内嵌缺省/Info.plist 同源的构建身份（spec §二.4/§六）：buildId 用于安装期望
// 钉扎与陈旧安装副本替换判定，取 drora-<desktop 版本> 保证每次发版可区分。
const env = {
  ...process.env,
  CUA_HELPER_BUILD_ID: process.env.CUA_HELPER_BUILD_ID ?? `drora-${desktopVersion}`,
  ...(process.env.DRORA_CUA_HELPER_STRICT_CHAIN === "1"
    ? {}
    : // 路线 A：ad-hoc/自签名分发必须折叠，否则 Helper 对非官方签名 launcher 恒拒启
      { CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER: "1" }),
};

const startMs = Date.now();
console.log(
  `[ci][timer] prepare:cua-helper build start (CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=${env.CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER ?? "0"})`,
);
try {
  // 直接以当前 node 运行构建脚本：经 pnpm --filter 会被 volta shim 解析到项目
  // 钉扎外的 node 版本（实测 18），SEA 骨架/modules 守卫需要构建 node 与骨架
  // ABI 一致，这里与桌面构建共用同一个（mise 管控的）node。
  execFileSync(process.execPath, ["build-cua-helper-app.mjs"], {
    cwd: join(workspaceRoot, "packages", "zcode-cua-helper"),
    env,
    stdio: "inherit",
  });
} finally {
  console.log(`[ci][timer] prepare:cua-helper build end duration_ms=${Date.now() - startMs}`);
}

if (!existsSync(join(builtHelperApp, "Contents", "MacOS", "Drora Computer Use"))) {
  console.error(
    `[prepare:cua-helper] 自建 Helper 产物缺失：${builtHelperApp}。` +
      "发布 mac 包必须携带 Computer Use Helper（官方发行物恒带），构建链损坏需先修复。",
  );
  process.exit(1);
}

rmSync(packagingStageRoot, { recursive: true, force: true });
execFileSync("/usr/bin/ditto", [builtHelperApp, stagedHelperApp], { stdio: "inherit" });
console.log(`[prepare:cua-helper] staged ${stagedHelperApp}`);
