#!/usr/bin/env node
// 干净重建重编译 addon(此环境 MSVC 增量 PDB 频繁损坏,一律 clean build)。
// Windows SDK 路径自动探测(注册 Program Files 与 D 盘两个常见位置),
// 经 gyp -Dwin_sdk 注入 binding.gyp,CI 与本机均可复现。
import { rmSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
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

function detectWindowsSdk() {
  const bases = [
    "C:/Program Files (x86)/Windows Kits/10/Include",
    "D:/Windows Kits/10/Include",
    process.env.WindowsSdkDir ? process.env.WindowsSdkDir.replace(/\\/g, "/") + "/Include" : null,
  ].filter(Boolean);
  const candidates = [];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    for (const ver of readdirSync(base)) {
      const inc = `${base}/${ver}`;
      if (existsSync(`${inc}/cppwinrt/winrt/Windows.Graphics.Capture.h`)) {
        candidates.push(inc);
      }
    }
  }
  candidates.sort(); // 字典序即版本序,取最新
  return candidates.at(-1) ?? null;
}

const sdk = detectWindowsSdk();
if (!sdk) {
  console.error(
    "未找到含 cppwinrt 的 Windows SDK(需要 10.0.19041+ 与 Windows.Graphics.Capture 头)",
  );
  process.exit(1);
}
console.log("Windows SDK:", sdk);

rmSync(join(root, "build"), { recursive: true, force: true });
for (const args of [["configure", `-Dwin_sdk=${sdk}`], ["build"]]) {
  const r = spawnSync(process.execPath, [gyp, ...args], { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("rebuilt:", join(root, "build/Release/ax_native_win.node"));
