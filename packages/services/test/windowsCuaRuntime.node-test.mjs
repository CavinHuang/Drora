// 第四十四轮回归测试：Windows CUA 运行时解析的 dev/product 双路径配对。
// 此前改名清扫把两处期望统一成 @drora/drora-cua，与随仓/随包实体的真实包名脱配：
// 产品路径对上游 runtime-manifest（@zcode/zcode-cua）必拒、dev 路径无任何包可满足。
// 本测试用真实实体（随仓运行时包 + 其 runtime-manifest）验证修复后的两条路径。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  resolveWindowsCuaRuntime,
  WindowsCuaDevRuntimeResolutionError,
} from "../src/cua-permission-broker/windowsCuaDevRuntime.ts";

const REPO_RUNTIME_ROOT = resolve(
  import.meta.dirname,
  "../../../packages/zcode-cua-helper/runtime/cua-helper",
);
const manifest = JSON.parse(
  await readFile(join(REPO_RUNTIME_ROOT, "runtime-manifest.json"), "utf8"),
);

function makeTempRoot(prefix) {
  const base = resolve(import.meta.dirname, ".tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

test("dev 路径：随仓运行时包（含 droraCuaRuntime 契约）解析成功", async () => {
  const runtime = await resolveWindowsCuaRuntime({
    platform: "win32",
    env: { DRORA_CUA_DEV_ROOT: REPO_RUNTIME_ROOT },
  });
  assert.equal(runtime.entryPath.endsWith(manifest.entry), true);
  assert.equal(runtime.addonPath.endsWith(manifest.addon), true);
  assert.equal(runtime.commandEnv.ELECTRON_RUN_AS_NODE, "1");
});

test("dev 路径：缺契约的包 fail-closed（invalid-package）", async () => {
  const root = makeTempRoot("win-cua-nopkg-");
  try {
    await assert.rejects(
      resolveWindowsCuaRuntime({ platform: "win32", env: { DRORA_CUA_DEV_ROOT: root } }),
      (error) =>
        error instanceof WindowsCuaDevRuntimeResolutionError && error.reason === "invalid-package",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("产品路径：staged 布局（resources/tools/cua-helper + 上游 manifest）解析成功", async () => {
  // 模拟打包产物布局：extraResources 把 bundled-tools/<plat>/cua-helper 映射到 tools/cua-helper。
  const resourcesRoot = makeTempRoot("win-cua-product-");
  try {
    cpSync(REPO_RUNTIME_ROOT, join(resourcesRoot, "tools", "cua-helper"), { recursive: true });
    const runtime = await resolveWindowsCuaRuntime({
      platform: "win32",
      resourcesPath: resourcesRoot,
      arch: manifest.arch,
      electronVersion: manifest.electronVersion,
    });
    assert.equal(runtime.root, join(resourcesRoot, "tools", "cua-helper"));
    assert.equal(runtime.entryPath.endsWith(manifest.entry), true);
  } finally {
    rmSync(resourcesRoot, { recursive: true, force: true });
  }
});

test("产品路径：arch 不匹配 fail-closed（incompatible-runtime-manifest）", async () => {
  const resourcesRoot = makeTempRoot("win-cua-arch-");
  try {
    cpSync(REPO_RUNTIME_ROOT, join(resourcesRoot, "tools", "cua-helper"), { recursive: true });
    await assert.rejects(
      resolveWindowsCuaRuntime({
        platform: "win32",
        resourcesPath: resourcesRoot,
        arch: manifest.arch === "x64" ? "arm64" : "x64",
        electronVersion: manifest.electronVersion,
      }),
      (error) =>
        error instanceof WindowsCuaDevRuntimeResolutionError &&
        error.reason === "incompatible-runtime-manifest",
    );
  } finally {
    rmSync(resourcesRoot, { recursive: true, force: true });
  }
});

test("非 win32 平台直接拒绝", async () => {
  await assert.rejects(
    resolveWindowsCuaRuntime({ platform: "darwin" }),
    (error) =>
      error instanceof WindowsCuaDevRuntimeResolutionError &&
      error.reason === "unsupported-platform",
  );
});
