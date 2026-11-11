#!/usr/bin/env node
// 干净重建重编译 addon(此环境 MSVC 增量 PDB 频繁损坏,一律 clean build)。
// Windows SDK 路径自动探测(注册 Program Files 与 D 盘两个常见位置),
// 经 gyp -Dwin_sdk 注入 binding.gyp,CI 与本机均可复现。
//
// 目标 ABI(spes/win32-cua-0.6.5-implementation-design.md §四 L1/W1):
//   默认 electron 44.7.0(--target=44.7.0 --dist-url=https://electronjs.org/headers
//   注入 configure,写进 build/config.gypi;desktop 已 electron 44.7.0,vendored
//   0.6.3 addon 是 41 ABI,fork 宿主加载必败——W1 换装即换 44 ABI 产物)。
//   需要本机 node ABI 时用 --abi=node 覆盖(WIN_ADDON_ABI=node)。
import { rmSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const gyp = join(root, "../../../../node_modules/node-gyp/bin/node-gyp.js");

// —— 目标 ABI 解析:--abi=node → 宿主 node;缺省/--abi=electron[:ver] → electron 头 ——
const abiArgIdx = process.argv.indexOf("--abi");
const abiArg = abiArgIdx >= 0 ? process.argv[abiArgIdx + 1] : process.env.WIN_ADDON_ABI;
const ELECTRON_DEFAULT = "44.7.0";
let configureAbiFlags = [];
let abiLabel = `node(${process.version})`;
if (abiArg !== "node") {
  const electronTarget =
    abiArg && abiArg.startsWith("electron:") ? abiArg.slice("electron:".length)
    : typeof abiArg === "string" && abiArg && abiArg !== "electron" ? abiArg
    : ELECTRON_DEFAULT;
  configureAbiFlags = [
    `--target=${electronTarget}`,
    "--dist-url=https://electronjs.org/headers",
  ];
  abiLabel = `electron(${electronTarget})`;
}
console.log("target ABI:", abiLabel);

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
// configure 全量生成 vcxproj（含 mac 目标——win 机上不可编），随后绕过
// node-gyp build（它对 binding.sln 全量构建，mac 目标在 win 机必败），
// 直接以 MSBuild 只编 ax_native_win.vcxproj。
{
  const r = spawnSync(process.execPath, [gyp, "configure", `-Dwin_sdk=${sdk}`, ...configureAbiFlags],
    { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function findMsbuild() {
  const candidates = [
    "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe",
  ];
  for (const vswhere of candidates) {
    if (!existsSync(vswhere)) continue;
    const r = spawnSync(vswhere,
      ["-latest", "-requires", "Microsoft.Component.MSBuild", "-find", "MSBuild/**/Bin/MSBuild.exe"],
      { encoding: "utf8" });
    const found = (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (found.length) return found[0];
  }
  // vswhere 缺席时按常见安装位兜底（本机 VS 装在 D:\software）
  const roots = [
    "D:/software/Microsoft Visual Studio2022",
    "C:/Program Files/Microsoft Visual Studio/2022",
    "C:/Program Files (x86)/Microsoft Visual Studio/2022",
  ];
  for (const vsRoot of roots) {
    if (!existsSync(vsRoot)) continue;
    for (const edition of readdirSync(vsRoot)) {
      for (const suffix of ["MSBuild/Current/Bin/MSBuild.exe", "MSBuild/15.0/Bin/MSBuild.exe"]) {
        const p = `${vsRoot}/${edition}/${suffix}`;
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

const msbuild = findMsbuild();
if (!msbuild) {
  console.error("未找到 MSBuild.exe（vswhere 与常见安装位均未命中）");
  process.exit(1);
}
console.log("MSBuild:", msbuild);
{
  const vcxproj = join(root, "build", "ax_native_win.vcxproj");
  const r = spawnSync(msbuild, [vcxproj, "/p:Configuration=Release;Platform=x64", "/m", "/nodeReuse:false"],
    { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("rebuilt:", join(root, "build/Release/ax_native_win.node"), `(${abiLabel})`);
