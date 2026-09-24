#!/usr/bin/env node
// 构建 macOS 端 ZCode Computer Use.app（Node SEA 单可执行 Helper）。
// 还原自原版管线（payload 构建路径 .tmp/cua-helper-build-*/helper.cjs 可证）：
//   1. esbuild 将 src/helper-sea-entry.ts 打成 CJS bundle（helper.cjs）
//   2. node --experimental-sea-config 生成 SEA blob
//   3. postject 把 blob 注入拷贝自本机 node 的可执行骨架
//   4. 组装 .app（Info.plist / AppIcon / ax_native.node），可选用 codesign 签名
// Windows 端走 packages/zcode-cua-helper/build.mjs（dist/windows-helper.js）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import process from "node:process";
import { build as esbuildBuild } from "esbuild";

const packageRoot = import.meta.dirname;
const workspaceRoot = resolve(packageRoot, "..", "..");
const distDir = join(packageRoot, "dist");
const bundlePath = join(distDir, "helper.cjs");
const seaConfigPath = join(distDir, "helper-sea-config.json");
const blobPath = join(distDir, "helper.blob");
const outAppDir = resolve(packageRoot, "dist-cua-helper");
const appName = "ZCode Computer Use.app";
const nodeBinary = process.execPath;

const require = createRequire(import.meta.url);

// SEA blob 格式随 node 主版本变化；骨架（原版 Helper 可执行）是 node 22 基座
// （modules 127，见 gitignore 的 SEA 基座注释与原版 provenance 冒烟输出）。
// 实测兼容矩阵：node 24（modules 137）生成的 blob 可注入 node 22 骨架；
// node 25 生成的 blob 会在 SEA 加载期 v8 崩溃（ToLocalChecked Empty，实测复现）。
// 构建按仓库 mise 约定固定在 node 24（modules 137）。
if (process.versions.modules !== "137") {
  throw new Error(
    `build-cua-helper-app requires node 24 (modules 137, per mise.toml); current node ${process.version} (modules ${process.versions.modules}). SEA blob/骨架版本错配会导致产物启动崩溃。`,
  );
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

// 1) CJS bundle（SEA 只接受 CJS 主脚本）
mkdirSync(distDir, { recursive: true });
await esbuildBuild({
  bundle: true,
  entryPoints: [join(packageRoot, "src", "helper-sea-entry.ts")],
  format: "cjs",
  platform: "node",
  target: "node24",
  outfile: bundlePath,
  legalComments: "none",
  minify: true,
  // 原生插件不能被内联：helperAddonLoader 按 ZCODE_CUA_HELPER_ADDON 运行时加载
  external: ["sharp", "koffi", "ax_native.node"],
});

// 2) SEA 配置 + blob
writeFileSync(
  seaConfigPath,
  JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
  }),
);
run(process.execPath, ["--experimental-sea-config", seaConfigPath], { cwd: packageRoot });

// 3) 组装 .app
const skeletonName =
  process.platform === "darwin" ? "node" : process.platform === "win32" ? "node.exe" : "node";
rmSync(outAppDir, { recursive: true, force: true });
const contentsDir = join(outAppDir, appName, "Contents");
const macosDir = join(contentsDir, "MacOS");
const resourcesDir = join(contentsDir, "Resources");
mkdirSync(macosDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });

const helperExecutable = join(macosDir, "ZCode Computer Use");
// SEA 注入骨架优先级：
//   1. NODE_SEA_SKELETON env（CI 用官方 node 发行版，自带 NODE_JS_FUSE sentinel）
//   2. 仓库内原版 Helper 可执行文件（自带 NODE_SEA 段与 sentinel，--overwrite 换入新 blob；
//      修改内容会使原签名失效，走 dev unsigned 流程，发布仍需 CI 完整重签）
//   3. 当前 node 进程的可执行文件（要求发行版 node）
// fused 骨架已熔丝且含 NODE_SEA 段；全新 node 骨架必须由 postject --sentinel-fuse
// 熔丝，否则 SEA 永不激活（spec: specs/mac-cua-helper-app-alignment.md §二.1）。
const repoOriginalHelperExe = resolve(
  workspaceRoot,
  "packages/desktop/resources/cua-helper/ZCode Computer Use.app/Contents/MacOS/ZCode Computer Use",
);
const skeletonCandidates = [
  { path: process.env.NODE_SEA_SKELETON, fused: false },
  { path: repoOriginalHelperExe, fused: true },
  { path: nodeBinary, fused: false },
];
const skeletonCandidate = skeletonCandidates.find((c) => {
  try {
    return c.path && existsSync(c.path);
  } catch {
    return false;
  }
});
if (!skeletonCandidate) {
  throw new Error("No SEA skeleton available: set NODE_SEA_SKELETON to an official node binary");
}
const skeleton = skeletonCandidate.path;
const skeletonNeedsFuse = !skeletonCandidate.fused;
copyFileSync(skeleton, helperExecutable);

// 4) postject 注入 SEA blob（Mach-O 段 NODE_SEA / __NODE_SEA_BLOB）
const postject = createRequire(resolve(workspaceRoot, "package.json")).resolve(
  "postject/dist/cli.js",
);
try {
  run(process.execPath, [
    postject,
    helperExecutable,
    "NODE_SEA_BLOB",
    blobPath,
    "--overwrite",
    ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : []),
    ...(skeletonNeedsFuse
      ? ["--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"]
      : []),
  ]);
} catch (error) {
  console.warn(
    "[build-cua-helper-app] postject failed, falling back to direct Mach-O patch:",
    String(error.message ?? error).split("\n")[0],
  );
  if (!patchNodeSeaBlobMacho(helperExecutable, blobPath)) {
    throw error;
  }
}

// 直接补丁/重注入会破坏骨架既有的代码签名，arm64 上会被内核直接 SIGKILL。
// dev 构建 ad-hoc 重签；发布构建由 CI 用正式身份对整个 .app 重签。
try {
  run("/usr/bin/codesign", ["--force", "--sign", "-", helperExecutable]);
} catch {}

// Info.plist：LSUIElement 后台应用；签名身份/TeamID 与宿主校验链一致。
// 版本与 BuildId 可注入（env CUA_HELPER_VERSION / CUA_HELPER_BUILD_ID），
// 缺省对齐 parity 基线 3.11.2 / local-dev（spec: specs/mac-cua-helper-app-alignment.md §二.4）。
const helperVersion = process.env.CUA_HELPER_VERSION?.trim() || "3.11.2";
const helperBuildId = process.env.CUA_HELPER_BUILD_ID?.trim() || "local-dev";
writeFileSync(
  join(contentsDir, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>ZCode Computer Use</string>
  <key>CFBundleExecutable</key><string>ZCode Computer Use</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>dev.zcode.cua-helper</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>ZCode Computer Use</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${helperVersion}</string>
  <key>CFBundleVersion</key><string>${helperVersion}</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>ZCode Computer Use needs to control System Events to activate target apps for computer use.</string>
  <key>ZCodeCUAHelperBuildId</key><string>${helperBuildId}</string>
</dict></plist>
`,
);

// AppIcon：优先复用已拷贝的原版 icns；缺失时跳过（不影响功能）
const repoIcon = resolve(
  workspaceRoot,
  "packages/desktop/resources/cua-helper/ZCode Computer Use.app/Contents/Resources/AppIcon.icns",
);
try {
  copyFileSync(repoIcon, join(resourcesDir, "AppIcon.icns"));
} catch {}

// 原生插件（AX / 窗口服务集成）随包放入 Resources。
// darwin 用仓库内原版二进制副本 ax_native_mac.node（与官方 .app 内字节一致，
// 修复历史 bug：此前引用不存在的 native/ax_native.node 导致构建 ENOENT）。
// Resources 不 staging node_modules：原版 SEA blob 的 sharp 解析基不含 Resources
// 相对基（strings 实证），该目录在原版包内不被 load-sharp 消费，能力无关
//（spec: specs/mac-cua-helper-app-alignment.md §二.3）。
const nativeAddon = join(packageRoot, "native", "ax_native_mac.node");
if (!existsSync(nativeAddon)) {
  throw new Error(`mac native addon missing: ${nativeAddon}`);
}
// .node 对齐（spec §一：原生层字节级一致）：钉扎官方 3.11.2 基线 SHA-256。
// 原生插件是能力底座，任何字节变化都意味着能力面漂移，必须显式升版：
// 更新基线常量或临时以 CUA_NATIVE_ADDON_SHA256 覆盖（仅在审计过的升级时）。
const NATIVE_ADDON_SHA256_BASELINE =
  process.env.CUA_NATIVE_ADDON_SHA256?.trim() ||
  "1ecb13fd2a54b316eff0e5c7d055e21689574d8f8b01c1d951c71335a7c3a5c1";
const addonHash = createHash("sha256").update(readFileSync(nativeAddon)).digest("hex");
if (addonHash !== NATIVE_ADDON_SHA256_BASELINE) {
  throw new Error(
    `ax_native_mac.node SHA-256 ${addonHash} does not match the pinned official baseline ${NATIVE_ADDON_SHA256_BASELINE}. ` +
      "升级原生插件需先经官方发行物对齐审计，再更新 build-cua-helper-app.mjs 的基线常量。",
  );
}
copyFileSync(nativeAddon, join(resourcesDir, "ax_native.node"));

// Resources/node_modules：对齐原版 mac 打包形态（官方 .app 携带 darwin sharp
// seed 四件套）。功能注记：helper 内 sharp 唯一消费者是 linuxWindowCapture
// （平台门 linux），SEA 解析链也不含 Resources 基——mac 上为非功能资产，
// staging 是打包形态对齐而非能力项（裁定记录见 spec §二.3 与 restore manifest）。
// 来源优先级：官方 staging 副本（desktop/resources/cua-helper）→ 跳过并提示。
const officialStagedApp = resolve(
  workspaceRoot,
  "packages/desktop/resources/cua-helper/ZCode Computer Use.app",
);
const stagedNodeModules = join(officialStagedApp, "Contents", "Resources", "node_modules");
if (existsSync(stagedNodeModules)) {
  run("/usr/bin/ditto", [stagedNodeModules, join(resourcesDir, "node_modules")]);
} else {
  console.warn(
    "[build-cua-helper-app] official staging copy has no Resources/node_modules; " +
      "packaging will be smaller than the official bundle (capability unaffected).",
  );
}

// ---- postject 备用方案：直接解析 Mach-O，覆写 NODE_SEA 段内的 blob ----
// postject 的 wasm 补丁器对 >100MB 的二进制可能内存越界；SEA blob 尺寸不大于
// 骨架既有 NODE_SEA_BLOB section 时，直接改写内容并修正 size 字段即可。
function patchNodeSeaBlobMacho(executablePath, blobPath) {
  const blob = readFileSync(blobPath);
  const buf = readFileSync(executablePath);
  if (buf.readUInt32LE(0) !== 0xfeedfacf) throw new Error("not a little-endian 64-bit Mach-O");
  const ncmds = buf.readUInt32LE(16);
  let off = 32;
  for (let i = 0; i < ncmds; i += 1) {
    const cmd = buf.readUInt32LE(off);
    const cmdsize = buf.readUInt32LE(off + 4);
    if (cmd === 0x19) {
      // LC_SEGMENT_64
      const segname = buf
        .subarray(off + 8, off + 24)
        .toString("ascii")
        .replace(/\0+$/, "");
      if (segname === "NODE_SEA") {
        const nsects = buf.readUInt32LE(off + 64);
        for (let s = 0; s < nsects; s += 1) {
          const sect = off + 72 + s * 80;
          const sectname = buf
            .subarray(sect, sect + 16)
            .toString("ascii")
            .replace(/\0+$/, "");
          if (sectname !== "__NODE_SEA_BLOB") continue;
          const addr = buf.readBigUInt64LE(sect + 32);
          const size = buf.readBigUInt64LE(sect + 40);
          const fileoff = Number(buf.readBigUInt64LE(sect + 48));
          if (BigInt(blob.length) > size) {
            throw new Error(
              `SEA blob ${blob.length}B exceeds skeleton section ${size}B; provide a bigger NODE_SEA_SKELETON`,
            );
          }
          blob.copy(buf, fileoff);
          // 残余旧字节清零（SEA loader 按 section size 读取，清零防误读）
          if (blob.length < Number(size)) {
            buf.fill(0, fileoff + blob.length, fileoff + Number(size));
          }
          buf.writeBigUInt64LE(BigInt(blob.length), sect + 40);
          // LC_SEGMENT_64: vmaddr(24) vmsize(32) fileoff(40) filesize(48)
          const vmsize = buf.readBigUInt64LE(off + 32);
          if (BigInt(blob.length) > vmsize) {
            throw new Error(`SEA blob exceeds segment vmsize ${vmsize}`);
          }
          buf.writeBigUInt64LE(BigInt(blob.length), off + 48);
          writeFileSync(executablePath, buf);
          return true;
        }
      }
    }
    off += cmdsize;
  }
  return false;
}

console.log(`[build-cua-helper-app] assembled ${join(outAppDir, appName)}`);

// 5) 签名（可选）：提供 CODESIGN_IDENTITY 时对 Helper 与外层做 deep 签名
if (process.env.CODESIGN_IDENTITY) {
  run("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    process.env.CODESIGN_IDENTITY,
    join(outAppDir, appName),
  ]);
  console.log("[build-cua-helper-app] codesigned with", process.env.CODESIGN_IDENTITY);
}
