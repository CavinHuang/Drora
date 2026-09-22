// oxlint-disable-file
// broker/server 公共出口：把 14 个还原模块的混淆名导出
// 映射回 broker-server.d.ts 契约名。真实实现优先；原发行物里同样 fail-closed
// 的面（ax 原生插件加载、LaunchServices 权限请求等）保留 fail-closed 语义，
// 与发行物行为一致，见 restored-drafts/README.md 的「无法还原」一节。

// —— 常量 ——
export { HELPER_ADDON_ENV_VALUE as HELPER_ADDON_ENV } from "./region-constants.js";

// —— installer / verifier / launcher ——
export { qu as createCuaHelperInstaller } from "./helper-installer.js";
export { Oh as defaultCuaHelperVerifierDependencies } from "./helper-verifier.js";
export { JC as buildHelperOpenArgs } from "./helper-launcher.js";
export { bn as isCuaLocalDevelopmentRuntime } from "./trust-policy.js";

// —— refresh marker ——
export {
  Bu as cuaBrokerRefreshMarkerPath,
  XU as publishCuaBrokerRefreshMarker,
} from "./refresh-marker.js";

// —— orphan reaper / AX 角色表 ——
export { oW as reapOrphanedHelpers, Ooe as ROLE_TO_KIND } from "./orphan-reaper.js";
import { Ooe } from "./orphan-reaper.js";
export function roleToKind(role: string): string | undefined {
  return Ooe[role];
}

// —— helper host（macOS 产品 host）——
export { CuaHelperHost, FW as isScreenCaptureProbeSuccess } from "./helper-host.js";

// —— 产品级 helper host / resolver / 生命周期 ——
export {
  JW as createProductCuaHelperHost,
  QW as createCuaProductMcpServerResolver,
  Vh as CuaProductHelperWorkspaceRegistry,
  Jh as CuaHelperLifecycleManager,
  Vu as waitForCuaHelperStartup,
  zi as markCuaProductHelperAgentEnvUnavailable,
  Rr as hasCuaProductHelperAgentEnvUnavailable,
  XW as clearCuaProductHelperAgentEnvUnavailable,
} from "./product-helper-host.js";

// —— agent MCP server 识别 / 权限 broker 配置注入 ——
export {
  ga as isPotentialZCodeCuaAgentMcpServer,
  sz as injectPermissionBrokerConfig,
  cz as injectPermissionBrokerAgentMcpServers,
  ZC as isAuthorizedOfficialZCodeCuaPluginServer,
  dz as omitUnbrokeredZCodeCuaAgentMcpServers,
} from "./permission-broker-config.js";
export { n$ as isOfficialCuaPluginEnabledForWorkspace } from "./permission-broker-client.js";

// —— fail-closed 残面（与原发行物一致） ——
import { CuaHelperError } from "../client.js";

const UNAVAILABLE = "Computer Use is not available in this build.";

/** Windows 开发态 helper 控制协议（原发行物按平台条件提供；本包当前不启用）。 */
export const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";

export async function resolveHelperPermissionSubjectIdentity(_appPath: string): Promise<never> {
  throw new CuaHelperError("unavailable", UNAVAILABLE);
}

export function loadRealNativeAddon(_options?: unknown): never {
  throw new CuaHelperError("unavailable", UNAVAILABLE);
}

export function resolvePackagedNativeAddonPath(_options?: unknown): string | undefined {
  return undefined;
}

export function resolveInTreeAddonPath(_options?: unknown): string | undefined {
  return undefined;
}

export function createAxReadOnlyMethods(
  _source: unknown,
  _registry?: unknown,
  _options?: unknown,
): Record<string, unknown> {
  return {};
}

export async function requestHelperAccessibilityPermissionViaLaunchServices(
  _options?: unknown,
): Promise<{
  ok: false;
  reason: string;
}> {
  return { ok: false, reason: UNAVAILABLE };
}

export async function requestHelperScreenRecordingPermissionViaLaunchServices(
  _options?: unknown,
): Promise<{
  ok: false;
  reason: string;
}> {
  return { ok: false, reason: UNAVAILABLE };
}
