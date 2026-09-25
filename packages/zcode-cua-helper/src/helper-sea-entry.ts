// oxlint-disable-file
// 构建期常量折叠点（对齐原版构建机制：esbuild define 注入，缺失时回退缺省值）。
// 原版发行构建把 dev 常量折叠为 false、身份常量折叠为产品值；开源默认构建
// 不注入 → 走 parity 基线缺省，行为与此前一致。
declare const __DRORA_CUA_HELPER_VERSION__: string | undefined;
// ZCode Computer Use（macOS Helper）SEA 入口。
// 还原自原版 payload 的 helper-sea-entry.mjs：esbuild 以此为入口打 CJS bundle，
// 再经 node --experimental-sea-config + postject 注入生成单可执行 Helper。
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { main } from "./broker/server/helperMain.js";

const helperAddonName = "ax_native.node";
const smokeFlag = "--cua-helper-provenance-smoke";
const allowUnsignedLauncherLocalDev = false;
// 与 Info.plist 的 CFBundleShortVersionString / ZCodeCUAHelperBuildId 同步由
// scripts/build-cua-helper-app.mjs 注入；这里只是 SEA 内嵌的缺省值。
const embeddedVersion =
  typeof __DRORA_CUA_HELPER_VERSION__ < "u" ? __DRORA_CUA_HELPER_VERSION__ : "3.11.2";
const embeddedBundleId = "dev.zcode.cua-helper";
const embeddedDisplayName = "ZCode Computer Use";

function resourcesDir() {
  return join(dirname(process.execPath), "..", "Resources");
}
function packagedAddonPath() {
  return join(resourcesDir(), helperAddonName);
}

// ax_native.node 固定在 .app 的 Resources 下；SEA 内没有 node_modules 解析，
// helperAddonLoader 依赖这个环境变量直接定位原生插件。
const addonPath = packagedAddonPath();
process.env.ZCODE_CUA_HELPER_ADDON = addonPath;

// 发布物溯源冒烟：只加载原生插件并打印内嵌元数据，不启动 broker。
const smokeIndex = process.argv.indexOf(smokeFlag);
if (smokeIndex >= 0) {
  createRequire(pathToFileURL(process.execPath).href)(addonPath);
  process.stdout.write(
    JSON.stringify({
      arch: process.arch,
      modules: process.versions.modules,
      addonPath,
      allowUnsignedLauncherLocalDev,
      version: embeddedVersion,
      bundleId: embeddedBundleId,
      displayName: embeddedDisplayName,
    }),
  );
  process.exit(0);
}

main(process.argv.slice(1), {
  allowUnsignedLauncherLocalDev,
  version: embeddedVersion,
  bundleId: embeddedBundleId,
  displayName: embeddedDisplayName,
}).catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`ZCode Computer Use failed to start: ${message}\n`);
  process.exit(1);
});
