import { join } from "node:path";
import { app } from "electron";
import { HELPER_APP_NAME } from "@drora/drora-cua/broker/helperConstants";
import {
  canonicalizeCuaHelperInstallerOptions,
  createCuaHelperInstaller,
  type CuaHelperInstaller,
  type CuaHelperInstallerOptions,
} from "@drora/services/node";
import { readBundledHelperBuildIdentity } from "./desktopCuaHelperBuildIdentity.js";
import { resolveDroraHome } from "./desktopRuntimeEnv.js";

type InstallerFactory = (options: CuaHelperInstallerOptions) => CuaHelperInstaller;

export { normalizeCuaHelperArch, normalizeCuaHelperArchs } from "@drora/services/node";

interface DesktopCuaHelperInstallerOptions extends Pick<
  CuaHelperInstallerOptions,
  "env" | "logger"
> {
  bundledHelperAppPath?: string;
  platform?: NodeJS.Platform | string;
  isPackaged?: boolean;
  resourcesPath?: string;
}

function resolvePackagedCuaHelperAppPath(
  options: Pick<DesktopCuaHelperInstallerOptions, "platform" | "isPackaged" | "resourcesPath"> = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const resourcesPath =
    options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const normalizedResourcesPath = resourcesPath?.trim();
  return platform === "darwin" && isPackaged && normalizedResourcesPath
    ? join(normalizedResourcesPath, "cua-helper", HELPER_APP_NAME)
    : undefined;
}

export function createDesktopCuaHelperInstaller(
  options: DesktopCuaHelperInstallerOptions,
  createInstaller: InstallerFactory = createCuaHelperInstaller,
): CuaHelperInstaller {
  const bundledAppPath = options.bundledHelperAppPath ?? resolvePackagedCuaHelperAppPath(options);
  const env = { ...options.env };
  // The unsigned-local escape hatch belongs only to unpackaged development.
  // A signed app with a bundled Helper must be deterministic even when its
  // LaunchServices environment was polluted by an earlier dev session.
  if (bundledAppPath) {
    delete env.DRORA_CUA_HELPER_ALLOW_UNSIGNED_LOCAL;
  }
  // 第二十九轮方案 A 的 main 进程侧补全：设置页安装流（本包装饰器）与 host
  // 产品流必须使用同一安装根——zcode-cua 安装链以 ZCODE_HOME||~/.zcode 解析，
  // 路由到 Drora 数据根（DRORA_HOME||~/.drora）后，两者都落在
  // ~/.drora/computer-use，并与 spawnHostProcess 的 host env 注入一致。
  // 非 darwin / 无 bundled 路径时不动 env（win32 走独立安装链）。
  if (bundledAppPath && (options.platform ?? process.platform) === "darwin") {
    env.ZCODE_HOME = resolveDroraHome(process.env);
  }
  const buildIdentity = bundledAppPath ? readBundledHelperBuildIdentity(bundledAppPath) : undefined;
  // 路线 A 分发 profile：桌面以 adhoc 签名分发时，安装校验放宽为
  // local_dev_unsigned（由打包配置注入 DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1）
  const adhocDistribution = process.env.DRORA_CUA_HELPER_ADHOC_DISTRIBUTION === "1";
  return createInstaller(
    canonicalizeCuaHelperInstallerOptions({
      env,
      logger: options.logger,
      bundledAppPath,
      ...(adhocDistribution ? { allowUnsignedDistribution: true } : {}),
      ...buildIdentity,
    }),
  );
}
