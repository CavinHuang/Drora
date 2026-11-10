import { isCuaDevModeRequested } from "../shared/cua-env.js";
import {
  HELPER_ALLOW_UNSIGNED_LAUNCHER_LOCAL_DEV_ARG,
  isCuaHelperBundleId,
} from "../helperConstants.js";
import { isCuaLocalDevelopmentRuntime } from "./helperRuntimeTrustPolicy.js";

function isExplicitLocalDevOptIn(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}
// 还原自发行 bundle（官方 0.6.5 win32 entry dist/windows-helper.js:19866，字节偏移
// 761722；官方 0.6.3 vendored runtime 同文）：peer 身份门临时全开常量。win 0.6.5
// 鉴权=版本门+管道命名空间，token 已退场（specs/win32-cua-0.6.5-implementation-design.md
// §四 L2.3）。消费方=windowsDevHelperMain（官方 :34181-34185 开门+stderr 告警）。
export var WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN = true;
export function isUnauthenticatedLocalDevRequested(env = process.env) {
  if (!isCuaLocalDevelopmentRuntime(env)) return false;
  return (
    isExplicitLocalDevOptIn(env.ZCODE_CUA_HELPER_ALLOW_UNAUTHENTICATED_LOCAL) ||
    isCuaDevModeRequested(env)
  );
}

export function isUnauthenticatedLocalDevAllowed(
  env: any,
  authorizationSubject: any,
  embeddedAllowsUnsignedLauncherLocalDev = false,
) {
  return (
    isUnauthenticatedLocalDevRequested(env) &&
    helperRuntimeAllowsUnsignedLauncherLocalDev(
      authorizationSubject,
      embeddedAllowsUnsignedLauncherLocalDev,
    )
  );
}
export function isUnsignedLauncherLocalDevAllowed(
  argv: string[],
  authorizationSubject: any,
  embeddedAllowsUnsignedLauncherLocalDev = false,
) {
  return (
    argv.includes(HELPER_ALLOW_UNSIGNED_LAUNCHER_LOCAL_DEV_ARG) &&
    helperRuntimeAllowsUnsignedLauncherLocalDev(
      authorizationSubject,
      embeddedAllowsUnsignedLauncherLocalDev,
    )
  );
}
function helperRuntimeAllowsUnsignedLauncherLocalDev(
  authorizationSubject: any,
  embeddedAllowsUnsignedLauncherLocalDev = false,
) {
  return (
    embeddedAllowsUnsignedLauncherLocalDev &&
    authorizationSubject.kind === "zcode_helper" &&
    isCuaHelperBundleId(authorizationSubject.bundle_id) &&
    isCuaHelperBundleId(authorizationSubject.code_signing_identifier) &&
    Boolean(authorizationSubject.app_bundle_path)
  );
}
