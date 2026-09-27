// Koffi native runtime staging for the bundled CUA MCP server.
//
// The CUA server externalizes koffi because esbuild cannot bundle its
// platform-dispatching `.node` requires. The installed agent has no hoisted
// node_modules, so keep only the target binary beside the plugin.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

function resolveKoffiRoot(koffiPackageRoot) {
  const candidates = [
    resolve(koffiPackageRoot),
    resolve(koffiPackageRoot, "node_modules", "koffi"),
  ];
  const virtualStore = resolve(koffiPackageRoot, "..", "..", "..", "..", "node_modules", ".pnpm");
  candidates.push(resolve(virtualStore, "..", "koffi"));
  if (existsSync(virtualStore)) {
    for (const entry of readdirSync(virtualStore)) {
      if (entry.startsWith("koffi@"))
        candidates.push(resolve(virtualStore, entry, "node_modules", "koffi"));
    }
  }
  for (const candidate of candidates) {
    const packageJson = resolve(candidate, "package.json");
    if (!existsSync(packageJson)) continue;
    try {
      if (JSON.parse(readFileSync(packageJson, "utf8")).name === "koffi") return candidate;
    } catch {
      // Continue searching other installation locations.
    }
  }
  throw new Error(
    `[koffi-package-assets] cannot resolve installed koffi package from ${koffiPackageRoot}`,
  );
}

function koffiPlatformKey(targetPlatform) {
  return `${targetPlatform.os}_${targetPlatform.arch}`;
}

export function stageKoffiIntoBundledAgents({ koffiPackageRoot, glmDir, targetPlatform }) {
  if (!koffiPackageRoot || !glmDir || !targetPlatform?.os || !targetPlatform?.arch) {
    throw new Error(
      "[koffi-package-assets] koffiPackageRoot, glmDir and targetPlatform are required",
    );
  }
  const sourceRoot = resolveKoffiRoot(koffiPackageRoot);
  const platformKey = koffiPlatformKey(targetPlatform);
  const sourceNativeDir = resolve(sourceRoot, "build", "koffi", platformKey);
  if (!existsSync(resolve(sourceNativeDir, "koffi.node"))) {
    throw new Error(
      `[koffi-package-assets] missing target native addon: ${sourceNativeDir}/koffi.node`,
    );
  }

  const targetRoot = resolve(glmDir, "node_modules", "koffi");
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(resolve(targetRoot, "build", "koffi", platformKey), { recursive: true });
  for (const file of ["index.js", "package.json", "index.d.ts"]) {
    cpSync(resolve(sourceRoot, file), resolve(targetRoot, file));
  }
  // 第五十三轮：官方形态对齐——官方发行物的 darwin natives 为自建产物（同版本
  // 但与 npm prebuilt 字节不同）。版本一致时以仓内官方种子
  // （resources/glm-natives-3.14.3，gitignored，源自官方 3.14.3 glm）替换 staging
  // 字节；版本漂移时 fail-open 用 npm 字节并告警（能力面同版本等价）。
  // 种子目录从 glmDir 向上有界回溯定位：stager 的两个调用位形（glm 根 / 插件目录）
  // 到 desktop 包根的层级不同，写死相对层数必错其一。
  const findSeedRoot = (fromDir) => {
    let current = resolve(fromDir);
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = resolve(current, "resources", "glm-natives-3.14.3");
      if (existsSync(candidate)) return candidate;
      const parent = resolve(current, "..");
      if (parent === current) return null;
      current = parent;
    }
    return null;
  };
  const officialSeed = resolve(
    findSeedRoot(glmDir) ?? "",
    "koffi",
    "build",
    "koffi",
    platformKey,
    "koffi.node",
  );
  const stagedNative = resolve(targetRoot, "build", "koffi", platformKey, "koffi.node");
  cpSync(resolve(sourceNativeDir, "koffi.node"), stagedNative);
  if (platformKey.startsWith("darwin") && existsSync(officialSeed)) {
    const stagedVersion = JSON.parse(readFileSync(resolve(targetRoot, "package.json"), "utf8")).version;
    if (stagedVersion === "2.15.6") {
      cpSync(officialSeed, stagedNative);
      console.log("[koffi-package-assets] darwin native 以官方 3.14.3 种子字节替换（koffi 2.15.6）");
    } else {
      console.warn(
        `[koffi-package-assets] koffi 版本 ${stagedVersion} != 种子基线 2.15.6，保留 npm 字节（种子需随官方升级重取）`,
      );
    }
  }
  return stagedNative;
}

export function verifyStagedKoffi({
  resourcesDir,
  targetPlatform,
  pluginRelativePath = "packages/zcode-cua-plugin",
}) {
  const platformKey = koffiPlatformKey(targetPlatform);
  const koffiRoot = resolve(resourcesDir, "glm", pluginRelativePath, "node_modules", "koffi");
  const nativePath = resolve(koffiRoot, "build", "koffi", platformKey, "koffi.node");
  return existsSync(nativePath) && existsSync(resolve(koffiRoot, "index.js"))
    ? []
    : [`missing staged koffi runtime for ${platformKey}: ${nativePath}`];
}
