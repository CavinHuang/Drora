#!/usr/bin/env node

import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 防呆（2026-09-26）：clean 会删除全部依赖与构建缓存，必须显式 --yes。
// 不带参数时只打印将删除的路径并退出，避免"查看用法"式调用误触发。
if (!process.argv.includes("--yes")) {
  console.log("This will permanently remove all node_modules/dist/build caches.");
  console.log("Re-run with --yes to execute: node scripts/clean.mjs --yes");
  process.exit(2);
}



const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const packagesDir = join(repoRoot, "packages");
const removableNames = new Set(["node_modules", "dist"]);

function collectPackageDirs() {
  if (!existsSync(packagesDir)) {
    return [];
  }

  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name));
}

function assertSafeTarget(targetPath, ownerDir) {
  if (!removableNames.has(basename(targetPath)) || dirname(targetPath) !== ownerDir) {
    throw new Error(`Refuse to remove unexpected path: ${targetPath}`);
  }
}

function removeTarget(targetPath, ownerDir) {
  assertSafeTarget(targetPath, ownerDir);

  if (!existsSync(targetPath)) {
    return false;
  }

  rmSync(targetPath, { force: true, recursive: true });
  console.log(`removed ${targetPath}`);
  return true;
}


// apps/drora-cli 是独立 workspace（有自己的 node_modules 与包内 dist）。
const droraCliDir = join(repoRoot, "apps", "drora-cli");
const droraCliPackagesDir = join(droraCliDir, "packages");

// desktop 构建缓存与 staging 产物（out/dist 由构建再生；bundled-* 由 prepare 脚本再生）。
const desktopDir = join(repoRoot, "packages", "desktop");
const desktopBuildCaches = [
  join(desktopDir, "out"),
  join(desktopDir, "dist"),
  join(desktopDir, "bundled-agents"),
  join(desktopDir, "bundled-tools"),
  join(desktopDir, "mock-cdn"),
];

const ownerDirs = [repoRoot, ...collectPackageDirs()];
let removedCount = 0;

for (const ownerDir of ownerDirs) {
  for (const name of removableNames) {
    if (removeTarget(join(ownerDir, name), ownerDir)) {
      removedCount += 1;
    }
  }
}



function collectDroraCliPackageDirs() {
  const dir = droraCliPackagesDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name));
}

// drora-cli 的 node_modules/dist 不在此清理：独立 workspace install 耗时且无再生
// 脚本；需要全量清理时手动删除 apps/drora-cli/{node_modules,packages/*/dist}。

for (const cacheDir of desktopBuildCaches) {
  if (!existsSync(cacheDir)) continue;
  rmSync(cacheDir, { force: true, recursive: true });
  console.log(`removed ${cacheDir}`);
  removedCount += 1;
}

console.log(`clean removed ${removedCount} director${removedCount === 1 ? "y" : "ies"}`);
