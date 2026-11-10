import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// 还原自发行 bundle（官方 3.17.2 / 0.6.5 SEA，payload dist/broker/socketPath.js 区）。
// R3.3（specs/cua-gap-remediation-2026-11-09.md）：补齐官方第三兜底三常量 +
// resolveBrokerSocketPath 四返回路径，逐字锚定官方字节偏移——
//   var BROKER_SOCKET_ENV @ 85316105（字面量 @ 85316109）
//   var BROKER_SOCKET_FILENAME @ 85316167
//   var WINDOWS_NAMED_PIPE_PREFIX @ 85316211
//   function resolveBrokerSocketPath @ 85316277（方案 SEA 锚 463742-463754）
// 此前我方仅还原 brokerRuntimeDir/isWindowsNamedPipePath，主入口裸启动（无 --socket、
// 无 env）时第三兜底缺失直接 exit(2)；补齐后与官方同为三段兜底。
// 契约键单一出处：BROKER_SOCKET_ENV 是 ZCODE_CUA_PERMISSION_BROKER_SOCKET 唯一常量定义，
// 消费方 helperMain.ts main() 的 socket 三段解析（引用而非字面量重写）。
export var BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export var BROKER_SOCKET_FILENAME = "broker.sock";
export var WINDOWS_NAMED_PIPE_PREFIX = "\\\\.\\pipe\\zcode-cua-helper-";
export function resolveBrokerSocketPath(options?) {
  const env = options?.env ?? process.env;
  const explicit = env[BROKER_SOCKET_ENV];
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit;
  }
  if (process.platform === "win32") {
    return `${WINDOWS_NAMED_PIPE_PREFIX}default`;
  }
  if (options?.dir) {
    return join(options.dir, BROKER_SOCKET_FILENAME);
  }
  return join(brokerRuntimeDir(env), BROKER_SOCKET_FILENAME);
}
export var STALE_SOCKET_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
/**
 * broker socket 的 runtime 目录：XDG_RUNTIME_DIR/zcode → win32 %LOCALAPPDATA%
 * → darwin /tmp/zcode-cua-<uid> → 其余 ~/.zcode/cua-broker。
 * （还原自 payload dist/broker/socketPath.js）
 */
export function brokerRuntimeDir(env = process.env) {
  const xdg = env.XDG_RUNTIME_DIR;
  if (typeof xdg === "string" && xdg.trim().length > 0) {
    return join(xdg, "zcode-cua");
  }
  if (process.platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    if (typeof localAppData === "string" && localAppData.trim().length > 0) {
      return join(localAppData, "zcode", "cua-broker");
    }
    return join(homedir(), "AppData", "Local", "zcode", "cua-broker");
  }
  if (process.platform === "darwin") {
    const uid = typeof process.getuid === "function" ? process.getuid() : "nouid";
    return join("/tmp", `zcode-cua-${uid}`);
  }
  return join(homedir(), ".zcode", "cua-broker");
}

export function isWindowsNamedPipePath(path) {
  return path.startsWith("\\\\.\\pipe\\");
}
