// oxlint-disable-file
// 还原自原版 helper SEA payload。
import { HELPER_TEAM_ID } from "../helperConstants.js";
import { isCuaLocalDevelopmentRuntime } from "./helperRuntimeTrustPolicy.js";

var SAFE_CODESIGN_TOKEN = /^[A-Za-z0-9.-]+$/;
var DEFAULT_CUA_LAUNCHER_BUNDLE_ID = "dev.zcode.app";
var PREVIEW_CUA_LAUNCHER_BUNDLE_ID = "dev.zcode.app.preview";
export var DEFAULT_CUA_LAUNCHER_BUNDLE_IDS = Object.freeze([
  DEFAULT_CUA_LAUNCHER_BUNDLE_ID,
  PREVIEW_CUA_LAUNCHER_BUNDLE_ID,
]);

// launcher 代码签名要求（dev 可用 env 覆盖 bundle id / team id，产品用固定 team）。
export function resolveZCodeLauncherCodeRequirement(env = process.env) {
  const localDevelopmentRuntime = isCuaLocalDevelopmentRuntime(env);
  const bundleOverride = localDevelopmentRuntime
    ? env.ZCODE_CUA_LAUNCHER_BUNDLE_ID?.trim()
    : void 0;
  const teamOverride = localDevelopmentRuntime ? env.ZCODE_CUA_HELPER_TEAM_ID?.trim() : void 0;
  const safeBundleOverride =
    bundleOverride && SAFE_CODESIGN_TOKEN.test(bundleOverride) ? bundleOverride : null;
  const teamId =
    teamOverride && SAFE_CODESIGN_TOKEN.test(teamOverride) ? teamOverride : HELPER_TEAM_ID;
  const identifierRequirement = safeBundleOverride
    ? `identifier "${safeBundleOverride}"`
    : `(${DEFAULT_CUA_LAUNCHER_BUNDLE_IDS.map((id) => `identifier "${id}"`).join(" or ")})`;
  return `anchor apple generic and ${identifierRequirement} and certificate leaf[subject.OU] = "${teamId}"`;
}

// peer 签名门 requirement（官方 SEA resolveCuaPeerTeamRequirement 逐字，2026-11-10 R10）：
// 与 launcher 门不同——纯 team 锚（无 identifier 约束），用于 verifyPeer 的
// audit_token/父进程双签名门（任何同 Team 签名进程可作 peer，presentation 角色
// 资格另由 isPresentationPeerEligible 把关）。
export function resolveCuaPeerTeamRequirement(env = process.env) {
  return `anchor apple generic and certificate leaf[subject.OU] = "${resolvePinnedTeamId(env)}"`;
}
function resolvePinnedTeamId(env = process.env) {
  const localDevelopmentRuntime = isCuaLocalDevelopmentRuntime(env);
  const teamOverride = localDevelopmentRuntime ? env.ZCODE_CUA_HELPER_TEAM_ID?.trim() : void 0;
  return teamOverride && SAFE_CODESIGN_TOKEN.test(teamOverride) ? teamOverride : HELPER_TEAM_ID;
}
