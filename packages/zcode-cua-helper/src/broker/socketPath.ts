import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

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

export var STALE_SOCKET_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
export function isWindowsNamedPipePath(path) {
  return path.startsWith("\\\\.\\pipe\\");
}
