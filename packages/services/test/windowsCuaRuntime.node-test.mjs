// 第四十四轮回归测试：Windows CUA 运行时解析的 dev/product 双路径配对。
// 此前改名清扫把两处期望统一成 @drora/drora-cua，与随仓/随包实体的真实包名脱配：
// 产品路径对上游 runtime-manifest（@zcode/zcode-cua）必拒、dev 路径无任何包可满足。
// 本测试用真实实体（随仓运行时包 + 其 runtime-manifest）验证修复后的两条路径。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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

// 祖先符号链接回归夹具：Windows 无开发者模式/管理员权限时创建符号链接会失败，
// 此时显式 skip（不静默弱化断言）；macOS/Linux 及具备权限的 Windows 均执行。
function trySymlinkSync(target, path) {
  try {
    symlinkSync(target, path);
    return true;
  } catch {
    return false;
  }
}

// manifest 里的相对路径是正斜杠；Windows join 出的是反斜杠路径，endsWith 逐字比较
// 会恒假（分叉原版断言只在 POSIX 成立，Windows 本地跑必挂）。按段比较与分隔符无关。
const endsWithManifestPath = (runtimePath, manifestRelative) => {
  const segments = runtimePath.split(/[\\/]/u);
  const expected = manifestRelative.split("/");
  return (
    segments.length >= expected.length &&
    expected.every(
      (segment, index) => segments[segments.length - expected.length + index] === segment,
    )
  );
};

test("dev 路径：随仓运行时包（含 droraCuaRuntime 契约）解析成功", async () => {
  const runtime = await resolveWindowsCuaRuntime({
    platform: "win32",
    env: { DRORA_CUA_DEV_ROOT: REPO_RUNTIME_ROOT },
  });
  assert.equal(endsWithManifestPath(runtime.entryPath, manifest.entry), true);
  assert.equal(endsWithManifestPath(runtime.addonPath, manifest.addon), true);
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
    assert.equal(endsWithManifestPath(runtime.entryPath, manifest.entry), true);
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

// 修复回归（第 1 轮门禁）：samePhysicalPath 曾把 root 与 realpath(root) 做字符串全等
// 比较，祖先目录是符号链接（macOS 系统 tmpdir 的 /var → /private/var、Windows
// junction/subst）即被误判越界——标准 mkdtemp 布局下的产品解析必挂。规格只要求根
// 目录自身非 symlink/junction（docs/cua/windows-product-runtime.md「源码准入和 staging」段），
// 祖先链接由 artifact realpath 物理包含兜底。以下两条锁定修正后的边界。
test("dev 路径：祖先符号链接不构成越界（根自身为普通目录）", async (t) => {
  const tmp = makeTempRoot("win-cua-dev-ancestor-");
  try {
    cpSync(REPO_RUNTIME_ROOT, join(tmp, "real", "cua-helper"), { recursive: true });
    if (!trySymlinkSync(join(tmp, "real"), join(tmp, "link"))) {
      t.skip("host cannot create symlinks");
      return;
    }
    const runtime = await resolveWindowsCuaRuntime({
      platform: "win32",
      env: { DRORA_CUA_DEV_ROOT: join(tmp, "link", "cua-helper") },
    });
    assert.equal(endsWithManifestPath(runtime.entryPath, manifest.entry), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("产品路径：resourcesPath 祖先为符号链接仍可解析", async (t) => {
  const tmp = makeTempRoot("win-cua-product-ancestor-");
  try {
    cpSync(REPO_RUNTIME_ROOT, join(tmp, "real", "tools", "cua-helper"), { recursive: true });
    if (!trySymlinkSync(join(tmp, "real"), join(tmp, "link"))) {
      t.skip("host cannot create symlinks");
      return;
    }
    const runtime = await resolveWindowsCuaRuntime({
      platform: "win32",
      resourcesPath: join(tmp, "link"),
      arch: manifest.arch,
      electronVersion: manifest.electronVersion,
    });
    assert.equal(endsWithManifestPath(runtime.entryPath, manifest.entry), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 加固语义不降级：根目录自身是 symlink（或 lstat 与 realpath 之间被替换）仍必须拒绝。
test("dev 路径：根目录自身是符号链接仍 fail-closed", async (t) => {
  const tmp = makeTempRoot("win-cua-dev-rootlink-");
  try {
    cpSync(REPO_RUNTIME_ROOT, join(tmp, "target"), { recursive: true });
    if (!trySymlinkSync(join(tmp, "target"), join(tmp, "root-link"))) {
      t.skip("host cannot create symlinks");
      return;
    }
    await assert.rejects(
      resolveWindowsCuaRuntime({
        platform: "win32",
        env: { DRORA_CUA_DEV_ROOT: join(tmp, "root-link") },
      }),
      (error) =>
        error instanceof WindowsCuaDevRuntimeResolutionError &&
        error.reason === "development-root-not-found",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("产品路径：runtime 根自身是符号链接仍 fail-closed", async (t) => {
  const tmp = makeTempRoot("win-cua-product-rootlink-");
  try {
    cpSync(REPO_RUNTIME_ROOT, join(tmp, "target"), { recursive: true });
    mkdirSync(join(tmp, "resources", "tools"), { recursive: true });
    if (!trySymlinkSync(join(tmp, "target"), join(tmp, "resources", "tools", "cua-helper"))) {
      t.skip("host cannot create symlinks");
      return;
    }
    await assert.rejects(
      resolveWindowsCuaRuntime({
        platform: "win32",
        resourcesPath: join(tmp, "resources"),
        arch: manifest.arch,
        electronVersion: manifest.electronVersion,
      }),
      (error) =>
        error instanceof WindowsCuaDevRuntimeResolutionError &&
        error.reason === "invalid-runtime-manifest",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
