export var HELPER_APP_NAME = "ZCode Computer Use.app";
export var HELPER_DISPLAY_NAME = "ZCode Computer Use";
export var HELPER_BUNDLE_ID = "dev.zcode.cua-helper";
var DEV_CUA_HELPER_BUNDLE_ID = "dev.zcode.cua-helper.dev";
export var CUA_HELPER_BUNDLE_IDS = /* @__PURE__ */ new Set([
  HELPER_BUNDLE_ID,
  DEV_CUA_HELPER_BUNDLE_ID,
]);
export var HELPER_ADDON_ENV = "ZCODE_CUA_HELPER_ADDON";
export var DEV_HELPER_APP_NAME = "ZCode Computer Use Dev.app";
export var HELPER_TEAM_ID = "8A5X4JJ39T";
export var CUA_HELPER_INSTALL_VARIANT_ENV = "ZCODE_CUA_HELPER_INSTALL_VARIANT";
export var CUA_HELPER_INSTALL_VARIANTS = ["stable", "preview", "dev-desktop", "standalone"];
export var HELPER_CONTROLLER_VARIANT_ARG = "--controller-variant";
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
