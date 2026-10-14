// Drora 装配适配：复用还原 SDK 的安装变体判断，品牌/数据根只在此边界转换。
import { homedir } from "node:os";
import { join } from "node:path";
import { HELPER_APP_NAME, DEV_HELPER_APP_NAME } from "./broker-helper-constants.js";
import {
  XC,
  xh,
  DEV_HELPER_APP_NAME_APP,
} from "./broker/server/helper-launcher.js";

function helperEnvironment(env) {
  const result = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("DRORA_CUA_")) result[key.replace(/^DRORA_/, "ZCODE_")] ??= value;
  }
  result.ZCODE_ENV ??= env.DRORA_ENV;
  result.ZCODE_HOME ??=
    env.DRORA_HOME?.trim() || join(env.DRORA_DATA_BASE_DIR?.trim() || homedir(), ".drora");
  return result;
}

export function resolveHelperAppName(env = process.env) {
  return xh(helperEnvironment(env)) === DEV_HELPER_APP_NAME_APP
    ? DEV_HELPER_APP_NAME
    : HELPER_APP_NAME;
}

export function resolveCuaHelperInstallRoot(env = process.env) {
  return XC(helperEnvironment(env));
}

export function standaloneHelperCandidatePaths(env = process.env) {
  const root = resolveCuaHelperInstallRoot(env);
  return root ? [join(root, resolveHelperAppName(env))] : [];
}
