export { HELPER_ADDON_ENV_VALUE as HELPER_ADDON_ENV } from "./region-constants.js";
export { qu as createCuaHelperInstaller } from "./helper-installer.js";
export { Oh as defaultCuaHelperVerifierDependencies } from "./helper-verifier.js";
export { JC as buildHelperOpenArgs } from "./helper-launcher.js";
export { bn as isCuaLocalDevelopmentRuntime } from "./trust-policy.js";
export { Bu as cuaBrokerRefreshMarkerPath, XU as publishCuaBrokerRefreshMarker, } from "./refresh-marker.js";
export { oW as reapOrphanedHelpers, Ooe as ROLE_TO_KIND } from "./orphan-reaper.js";
export declare function roleToKind(role: string): string | undefined;
export { CuaHelperHost, FW as isScreenCaptureProbeSuccess } from "./helper-host.js";
export { JW as createProductCuaHelperHost, QW as createCuaProductMcpServerResolver, Vh as CuaProductHelperWorkspaceRegistry, Jh as CuaHelperLifecycleManager, Vu as waitForCuaHelperStartup, zi as markCuaProductHelperAgentEnvUnavailable, Rr as hasCuaProductHelperAgentEnvUnavailable, XW as clearCuaProductHelperAgentEnvUnavailable, } from "./product-helper-host.js";
export { ga as isPotentialZCodeCuaAgentMcpServer, sz as injectPermissionBrokerConfig, cz as injectPermissionBrokerAgentMcpServers, ZC as isAuthorizedOfficialZCodeCuaPluginServer, dz as omitUnbrokeredZCodeCuaAgentMcpServers, } from "./permission-broker-config.js";
export { n$ as isOfficialCuaPluginEnabledForWorkspace } from "./permission-broker-client.js";
/** Windows 开发态 helper 控制协议（原发行物按平台条件提供；本包当前不启用）。 */
export declare const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";
export declare function resolveHelperPermissionSubjectIdentity(_appPath: string): Promise<never>;
export declare function loadRealNativeAddon(_options?: unknown): never;
export declare function resolvePackagedNativeAddonPath(_options?: unknown): string | undefined;
export declare function resolveInTreeAddonPath(_options?: unknown): string | undefined;
export declare function createAxReadOnlyMethods(_source: unknown, _registry?: unknown, _options?: unknown): Record<string, unknown>;
export declare function requestHelperAccessibilityPermissionViaLaunchServices(_options?: unknown): Promise<{
    ok: false;
    reason: string;
}>;
export declare function requestHelperScreenRecordingPermissionViaLaunchServices(_options?: unknown): Promise<{
    ok: false;
    reason: string;
}>;
