export var HELPER_APP_NAME = "Drora Computer Use.app";
export var HELPER_DISPLAY_NAME = "Drora Computer Use";
export var HELPER_BUNDLE_ID = "dev.drora.cua-helper";
var DEV_CUA_HELPER_BUNDLE_ID = "dev.drora.cua-helper.dev";
export var CUA_HELPER_BUNDLE_IDS = /* @__PURE__ */ new Set([
  HELPER_BUNDLE_ID,
  DEV_CUA_HELPER_BUNDLE_ID,
]);
export var HELPER_ADDON_ENV = "ZCODE_CUA_HELPER_ADDON";
export var DEV_HELPER_APP_NAME = "Drora Computer Use Dev.app";
export var HELPER_TEAM_ID = "8A5X4JJ39T";
export var CUA_HELPER_INSTALL_VARIANT_ENV = "ZCODE_CUA_HELPER_INSTALL_VARIANT";
export var CUA_HELPER_INSTALL_VARIANTS = ["stable", "preview", "dev-desktop", "standalone"];
export var HELPER_CONTROLLER_VARIANT_ARG = "--controller-variant";
// 还原自发行 bundle（官方 3.17.2 / 0.6.5 SEA）：cps 旋钮与多光标旋钮的接收侧常量，
// 逐字锚定官方字节偏移——HELPER_DISABLE_CPS_ACTIVATION_ARG var @ 85321460
// （字面量 "--disable-cps-activation" @ 85321464）、HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG
// var @ 85321528。方案依据 specs/cua-gap-remediation-2026-11-09.md R3.1/R3.2：此前我方
// 缺这两个接收侧旋钮，launcher 传入的禁用开关被 Helper 静默忽略。
export var HELPER_DISABLE_CPS_ACTIVATION_ARG = "--disable-cps-activation";
export var HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG = "--disable-multi-cursor-overlay";
export var HELPER_ALLOW_UNSIGNED_LAUNCHER_LOCAL_DEV_ARG = "--allow-unsigned-launcher-local-dev";
export var HELPER_ALLOW_EXTERNAL_BROKER_CLIENT_LOCAL_DEV_ARG =
  "--allow-external-broker-client-local-dev";
export var HELPER_GHOST_CURSOR_OVERLAY_ARG = "--ghost-cursor-overlay";
export var HELPER_BACKGROUND_MODE_ARG = "--background-mode";
export var HELPER_PIP_MODE_ARG = "--pip-mode";
export var HELPER_PIP_LIVE_PROBE_ARG = "--pip-live-probe";
export var HELPER_GHOST_CURSOR_CAPTURE_ARG = "--ghost-cursor-capture";
export var HELPER_PERMISSION_REQUEST_DEADLINE_ARG = "--permission-request-deadline-epoch-ms";
export var HELPER_PERMISSION_REQUEST_CANCEL_FILE_ARG = "--permission-request-cancel-file";
export var HELPER_PERMISSION_PREFLIGHT_ARG = "--permission-preflight";
export var HELPER_PERMISSION_PREFLIGHT_RESULT_FILE_ARG = "--permission-preflight-result-file";
export function isCuaHelperBundleId(bundleId) {
  return typeof bundleId === "string" && CUA_HELPER_BUNDLE_IDS.has(bundleId);
}
