#!/usr/bin/env node
// 干净重建重编译 addon(此环境 MSVC 增量 PDB 频繁损坏,一律 clean build)。
import { rmSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const gyp = join(root, "../../../../node_modules/node-gyp/bin/node-gyp.js");

// node-addon-api 头是构建期依赖(不入库,gitignore 忽略 reverse/node_modules);
// 每次构建从仓库根 node_modules 拷入,保证 clone 后即可复现构建。
const addonApiSrc = join(root, "../../../../node_modules/node-addon-api");
const addonApiDst = join(root, "node_modules/node-addon-api");
if (existsSync(addonApiSrc) && !existsSync(addonApiDst)) {
  mkdirSync(join(root, "node_modules"), { recursive: true });
  cpSync(addonApiSrc, addonApiDst, { recursive: true });
  console.log("staged node-addon-api from workspace root");
}

rmSync(join(root, "build"), { recursive: true, force: true });
for (const args of [["configure"], ["build"]]) {
  const r = spawnSync(process.execPath, [gyp, ...args], { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("rebuilt:", join(root, "build/Release/ax_native_win.node"));
