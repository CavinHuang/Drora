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
