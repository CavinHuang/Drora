// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
import { join } from "node:path";
// helper 安装根/候选路径解析（dev-desktop / preview / stable / standalone）。

import {
  HELPER_APP_NAME,
  DEV_HELPER_APP_NAME,
  CUA_HELPER_INSTALL_VARIANT_ENV,
  CUA_HELPER_INSTALL_VARIANTS,
} from "../helperConstants.js";
import { isCuaLocalDevelopmentRuntime } from "./helperRuntimeTrustPolicy.js";
import { isCuaDevModeRequested } from "../shared/cua-env.js";

export function isDevMode(env) {
  if (!isCuaLocalDevelopmentRuntime(env)) return false;
  const v = env.ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || isCuaDevModeRequested(env);
}
export function resolveHelperAppName(env = process.env) {
  return isDevMode(env) ? DEV_HELPER_APP_NAME : HELPER_APP_NAME;
}
export function resolveZcodeHome(env) {
  return env.ZCODE_HOME?.trim() || (env.HOME?.trim() ? join(env.HOME.trim(), ".zcode") : null);
}
export function resolveCuaHelperInstallVariant(env) {
  const requested = env[CUA_HELPER_INSTALL_VARIANT_ENV]?.trim();
  if (requested && CUA_HELPER_INSTALL_VARIANTS.includes(requested)) {
    return requested;
  }
  if (requested) return null;
  if (isCuaLocalDevelopmentRuntime(env)) return "dev-desktop";
  return env.ZCODE_ENV?.trim().toLowerCase() === "test" ? "preview" : "stable";
}
export function resolveCuaHelperInstallRoot(env) {
  const zcodeHome = resolveZcodeHome(env);
  if (!zcodeHome) return null;
  const baseRoot = join(zcodeHome, "computer-use");
  const variant = resolveCuaHelperInstallVariant(env);
  if (!variant) return null;
  if (variant === "dev-desktop" || resolveHelperAppName(env) === DEV_HELPER_APP_NAME) {
    return join(baseRoot, "dev");
  }
  return variant === "preview" ? join(baseRoot, "preview") : baseRoot;
}
export function recognizedCuaHelperInstallRoots(env = process.env) {
  const zcodeHome = resolveZcodeHome(env);
  if (!zcodeHome) return [];
  const baseRoot = join(zcodeHome, "computer-use");
  return [
    baseRoot,
    join(baseRoot, "dev"),
    ...CUA_HELPER_INSTALL_VARIANTS.map((variant) => join(baseRoot, variant)),
  ];
}
export function standaloneHelperCandidatePaths(env = process.env) {
  const installRoot = resolveCuaHelperInstallRoot(env);
  return installRoot ? [join(installRoot, resolveHelperAppName(env))] : [];
}
