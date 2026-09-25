// Sharp runtime staging for plugins that externalize sharp (node_repl host and the
// CUA/browser-use client scripts). esbuild bundles mark sharp as external, and the
// installed agent has no hoisted node_modules, so the JS runtime plus the target
// platform's @img native packages must be staged beside the plugin.
//
// 与 koffi-package-assets.mjs 同一契约：resolve 源包 → 校验目标平台 native → 拷入
// glmDir/node_modules。本仓库 desktop 不直接依赖 sharp，因此解析顺序为 desktop 的
// pnpm 安装布局优先（与官方 dev 仓库一致），不可解析时回退到 zcode-cua-plugin
// 入库的 node_modules 基线（当前为 win32-x64 natives；darwin/linux 目标需 desktop
// 安装 sharp 或基线含对应 @img 包，缺失即 fail-closed 报错）。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

function resolveVirtualStoreRoots(packageRoot) {
  const roots = [];
  const virtualStore = resolve(packageRoot, "node_modules", ".pnpm");
  if (existsSync(virtualStore)) {
    for (const entry of readdirSync(virtualStore)) {
      // .pnpm 目录形如 sharp@0.34.x/node_modules/sharp 与 @img+sharp-win32-x64@…/node_modules/@img/sharp-win32-x64；
      // scoped 包名里的 "/" 在目录名中被替换成 "+"，这里必须换回来才能拼出真实包路径。
      const marker = entry.indexOf("@", 1);
      if (marker <= 0) continue;
      const packageName = entry.slice(0, marker).replaceAll("+", "/");
      roots.push(resolve(virtualStore, entry, "node_modules", packageName));
    }
  }
  return roots;
}

function resolvePackage(name, searchRoots) {
  const candidates = [];
  for (const root of searchRoots) {
    candidates.push(resolve(root, "node_modules", name));
    candidates.push(resolve(root, name));
  }
  for (const candidate of candidates) {
    const packageJson = resolve(candidate, "package.json");
    if (!existsSync(packageJson)) continue;
    try {
      if (JSON.parse(readFileSync(packageJson, "utf8")).name === name) return candidate;
    } catch {
      // Continue searching other installation locations.
    }
  }
  throw new Error(
    `[sharp-package-assets] cannot resolve installed ${name} package from ${searchRoots.join(", ")}`,
  );
}

function buildSearchRoots(desktopPackageRoot) {
  const roots = [
    desktopPackageRoot,
    resolve(desktopPackageRoot, "..", ".."),
    // 仓库基线：zcode-cua-plugin 入库的 node_modules（desktop 未安装 sharp 时的回退源）。
    resolve(
      desktopPackageRoot,
      "..",
      "..",
      "apps",
      "drora-cli",
      "packages",
      "zcode-cua-plugin",
      "node_modules",
    ),
  ];
  for (const root of [...roots]) {
    roots.push(...resolveVirtualStoreRoots(root));
  }
  return roots;
}

function sharpNativePackages(targetPlatform) {
  const key = `${targetPlatform.os}-${targetPlatform.arch}`;
  // win32 的 libvips 闭包内嵌在 @img/sharp-win32-x64 里（lib/*.dll）；其余平台拆成
  // @img/sharp-<os>-<arch>（.node）+ @img/sharp-libvips-<os>-<arch>（lib/*.so/*.dylib）两包。
  if (targetPlatform.os === "win32") return [`@img/sharp-${key}`];
  return [`@img/sharp-${key}`, `@img/sharp-libvips-${key}`];
}

function assertSharpNativePackage(packageDir, packageName, targetPlatform) {
  const key = `${targetPlatform.os}-${targetPlatform.arch}`;
  if (packageName.startsWith("@img/sharp-libvips")) {
    if (!existsSync(resolve(packageDir, "lib"))) {
      throw new Error(`[sharp-package-assets] missing libvips libs: ${packageDir}/lib`);
    }
    return;
  }
  // .node 加载物在各平台包的 lib/ 下（win32 与 darwin/linux 同构：lib/sharp-<os>-<arch>.node）。
  if (!existsSync(resolve(packageDir, "lib", `sharp-${key}.node`))) {
    throw new Error(
      `[sharp-package-assets] missing target native addon: ${packageDir}/lib/sharp-${key}.node`,
    );
  }
}

export function stageSharpIntoBundledAgents({ desktopPackageRoot, glmDir, targetPlatform }) {
  if (!desktopPackageRoot || !glmDir || !targetPlatform?.os || !targetPlatform?.arch) {
    throw new Error(
      "[sharp-package-assets] desktopPackageRoot, glmDir and targetPlatform are required",
    );
  }
  const searchRoots = buildSearchRoots(desktopPackageRoot);
  const sharpRoot = resolvePackage("sharp", searchRoots);
  const targetRoot = resolve(glmDir, "node_modules");

  const modulesToStage = [
    { name: "sharp", sourceDir: sharpRoot },
    { name: "semver", sourceDir: resolvePackage("semver", searchRoots) },
    { name: "detect-libc", sourceDir: resolvePackage("detect-libc", searchRoots) },
    // @img/colour 是 @img/sharp-* 的运行时依赖（ICC profile 处理）；缺失不阻断，
    // 与官方发行物一致时才随包携带。
    ...resolveIfExists("@img/colour", searchRoots),
  ];
  for (const nativePackageName of sharpNativePackages(targetPlatform)) {
    const nativeDir = resolvePackage(nativePackageName, searchRoots);
    assertSharpNativePackage(nativeDir, nativePackageName, targetPlatform);
    modulesToStage.push({ name: nativePackageName, sourceDir: nativeDir });
  }

  for (const module of modulesToStage) {
    const destination = resolve(targetRoot, ...module.name.split("/"));
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    cpSync(module.sourceDir, destination, {
      recursive: true,
      // sharp npm 包自带 C++ 源码目录用于预编译回退编译；staging 只需要运行时文件，
      // 但为与官方发行物文件集一致（含 src/），不做裁剪，仅排除包内嵌 node_modules
      // 与文档/类型声明（*.md、*.d.ts——官方 staging 的运行时闭包不带这些）。
      filter: (source) => {
        if (source.includes(`${module.name}/node_modules/`)) return false;
        return !/(?:\.md|\.d\.ts(?:\.map)?)$/iu.test(source);
      },
    });
  }
  return resolve(targetRoot, "sharp");
}

function resolveIfExists(name, searchRoots) {
  try {
    return [{ name, sourceDir: resolvePackage(name, searchRoots) }];
  } catch {
    return [];
  }
}

export function verifyStagedSharp({
  resourcesDir,
  targetPlatform,
  pluginRelativePath = "packages/zcode-cua-plugin",
}) {
  const key = `${targetPlatform.os}-${targetPlatform.arch}`;
  const sharpRoot = resolve(resourcesDir, "glm", pluginRelativePath, "node_modules", "sharp");
  const nativePath = resolve(
    resourcesDir,
    "glm",
    pluginRelativePath,
    "node_modules",
    "@img",
    `sharp-${key}`,
    "lib",
    `sharp-${key}.node`,
  );
  return existsSync(nativePath) && existsSync(resolve(sharpRoot, "package.json"))
    ? []
    : [`missing staged sharp runtime for ${key}: ${nativePath}`];
}
