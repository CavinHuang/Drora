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
// 第十五轮：一次性 token 文件链（原版 mac 3.11.2 发射器 F9/Xxe/Yxe 还原）
export { writeOneShotHelperTokenFile, createHelperTokenFileReceipt, scheduleHelperTokenFileCleanup, } from "./helper-launcher.js";
export { bn as isCuaLocalDevelopmentRuntime } from "./trust-policy.js";
// —— refresh marker ——
export { Bu as cuaBrokerRefreshMarkerPath, XU as publishCuaBrokerRefreshMarker, } from "./refresh-marker.js";
// —— orphan reaper / AX 角色表 ——
export { oW as reapOrphanedHelpers, Ooe as ROLE_TO_KIND } from "./orphan-reaper.js";
import { Ooe } from "./orphan-reaper.js";
export function roleToKind(role) {
    return Ooe[role];
}
// —— helper host（macOS 产品 host）——
export { CuaHelperHost, FW as isScreenCaptureProbeSuccess } from "./helper-host.js";
// —— 产品级 helper host / resolver / 生命周期 ——
export { JW as createProductCuaHelperHost, QW as createCuaProductMcpServerResolver, Vh as CuaProductHelperWorkspaceRegistry, Jh as CuaHelperLifecycleManager, Vu as waitForCuaHelperStartup, zi as markCuaProductHelperAgentEnvUnavailable, Rr as hasCuaProductHelperAgentEnvUnavailable, XW as clearCuaProductHelperAgentEnvUnavailable, } from "./product-helper-host.js";
// —— agent MCP server 识别 / 权限 broker 配置注入 ——
export { ga as isPotentialZCodeCuaAgentMcpServer, sz as injectPermissionBrokerConfig, cz as injectPermissionBrokerAgentMcpServers, ZC as isAuthorizedOfficialZCodeCuaPluginServer, dz as omitUnbrokeredZCodeCuaAgentMcpServers, } from "./permission-broker-config.js";
export { n$ as isOfficialCuaPluginEnabledForWorkspace } from "./permission-broker-client.js";
// —— fail-closed 残面（与原发行物一致） ——
import { CuaHelperError } from "../client.js";
const UNAVAILABLE = "Computer Use is not available in this build.";
/** Windows 开发态 helper 控制协议（原发行物按平台条件提供；本包当前不启用）。 */
export const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";
// 第五十五轮：由 fail-closed 桩恢复为真身。授权引导（onboarding/拖拽浮窗）以
// HelperPermissionSubjectIdentity（appPath/executablePath/displayName/bundleId）
// 作为 TCC 授权主体与会话协调 key——此前恒抛 unavailable，设置页点击授权在
// 安装成功后必死在身份解析。四元组全部来自 .app 的 Info.plist 与路径拼接，
// 与 desktop 侧 readBundledHelperBuildIdentity 同款 plutil 读取；plist 缺失或
// 键不全时维持 fail-closed（CuaHelperError unavailable），不产出半套身份。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join as __join } from "node:path";
export async function resolveHelperPermissionSubjectIdentity(appPath) {
    const plistPath = __join(appPath, "Contents", "Info.plist");
    if (!appPath?.trim() || !existsSync(plistPath)) {
        throw new CuaHelperError("unavailable", `${UNAVAILABLE} (missing Helper bundle: ${appPath})`);
    }
    const readKey = (key) => {
        const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
            encoding: "utf8",
            timeout: 2000,
            maxBuffer: 64 * 1024,
        });
        const value = (result.stdout ?? "").trim();
        return result.status === 0 && value ? value : undefined;
    };
    const bundleId = readKey("CFBundleIdentifier");
    const displayName = readKey("CFBundleDisplayName") ?? readKey("CFBundleName");
    const executableName = readKey("CFBundleExecutable");
    if (!bundleId || !displayName || !executableName) {
        throw new CuaHelperError("unavailable", `${UNAVAILABLE} (incomplete Info.plist identity)`);
    }
    const executablePath = __join(appPath, "Contents", "MacOS", executableName);
    return { appPath, executablePath, displayName, bundleId };
}
export function loadRealNativeAddon(_options) {
    throw new CuaHelperError("unavailable", UNAVAILABLE);
}
export function resolvePackagedNativeAddonPath(_options) {
    return undefined;
}
export function resolveInTreeAddonPath(_options) {
    return undefined;
}
export function createAxReadOnlyMethods(_source, _registry, _options) {
    return {};
}
export async function requestHelperAccessibilityPermissionViaLaunchServices(_options) {
    return { ok: false, reason: UNAVAILABLE };
}
export async function requestHelperScreenRecordingPermissionViaLaunchServices(_options) {
    return { ok: false, reason: UNAVAILABLE };
}
