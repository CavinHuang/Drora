import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HELPER_ADDON_ENV, HELPER_APP_NAME } from "../helperConstants.js";

var PACKAGED_ADDON_BASENAME = "ax_native.node";
var IN_TREE_ADDON_REL = join("build", "Release", "ax_native.node");
// darwin 的 in-tree 原生插件是 native/ax_native_mac.node（字节级官方副本）；
// build/Release/ax_native.node 是 win32 PE——darwin dev 回退命中它会报镜像格式错误。
var IN_TREE_ADDON_REL_DARWIN = join("native", "ax_native_mac.node");
function loaderModuleBase(moduleUrl?) {
  if (moduleUrl) return moduleUrl;
  const argvEntry = process.argv[1];
  return typeof argvEntry === "string" && isAbsolute(argvEntry) ? argvEntry : process.execPath;
}
function resolvePackagedNativeAddonPath(options: any = {}) {
  const env: any = options.env ?? process.env;
  const explicitAddonPath = env[HELPER_ADDON_ENV]?.trim();
  if (explicitAddonPath) return explicitAddonPath;
  const platform2: any = options.platform ?? process.platform;
  if (platform2 !== "darwin" && platform2 !== "linux" && platform2 !== "win32") {
    return null;
  }
  const execPath: any = options.execPath ?? process.execPath;
  const candidate = join(dirname(execPath), "..", "Resources", PACKAGED_ADDON_BASENAME);
  const normalizedExecPath = execPath.replaceAll("\\", "/");
  if (
    (options.fileExists ?? existsSync)(candidate) ||
    normalizedExecPath.includes(`/${HELPER_APP_NAME}/Contents/`)
  ) {
    return candidate;
  }
  return null;
}
function resolveInTreeAddonPath(options: any = {}) {
  const fileExists: any = options.fileExists ?? existsSync;
  const startDir = dirname(
    options.moduleUrl ? fileURLToPath(new URL(".", options.moduleUrl)) : loaderModuleBase(),
  );
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, IN_TREE_ADDON_REL);
    if (fileExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
// darwin 专用回退：仓库内 native/ax_native_mac.node（不参与 win32 解析）。
function resolveDarwinRepoAddonPath(options: any = {}) {
  const fileExists: any = options.fileExists ?? existsSync;
  const startDir = dirname(
    options.moduleUrl ? fileURLToPath(new URL(".", options.moduleUrl)) : loaderModuleBase(),
  );
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, IN_TREE_ADDON_REL_DARWIN);
    if (fileExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
export function loadRealNativeAddon(options: any = {}) {
  const platform2 = options.platform ?? process.platform;
  if (platform2 !== "darwin" && platform2 !== "linux" && platform2 !== "win32") {
    throw new Error(
      `Unsupported platform for CUA native addon: ${platform2} (expected darwin, linux, or win32).`,
    );
  }
  const require2: any = options.require ?? createRequire(loaderModuleBase(options.moduleUrl));
  const packagedPath = resolvePackagedNativeAddonPath({
    platform: platform2,
    env: options.env,
    execPath: options.execPath,
    fileExists: options.fileExists,
  });
  if (packagedPath) {
    return require2(packagedPath);
  }
  const inTreePath =
    (platform2 === "darwin"
      ? resolveDarwinRepoAddonPath({ fileExists: options.fileExists, moduleUrl: options.moduleUrl })
      : null) ??
    resolveInTreeAddonPath({
      fileExists: options.fileExists,
      moduleUrl: options.moduleUrl,
    });
  if (inTreePath) {
    return require2(inTreePath);
  }
  throw new Error(
    `CUA native addon (ax_native.node) not found for ${platform2}. Run \`node-gyp rebuild\` in the @drora/drora-cua package, or set ${HELPER_ADDON_ENV} to the .node path.`,
  );
}
