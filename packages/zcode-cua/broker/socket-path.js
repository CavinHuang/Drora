// oxlint-disable-file
// 还原自发行 bundle 的 socket-path 模块（function-map 257-300 行，
// 名称按 region.pretty.js.txt 的 i(fn,"原始名") 注解恢复；模块内保留草稿混淆名别名，
// 供尚未完成语义化的 server 模块渐进迁移）。
import { randomBytes } from "node:crypto";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
/** 过期 socket 文件的回收阈值（24h） */
const STALE_SOCKET_MAX_AGE_MS = 1440 * 60 * 1000;
/** Windows 命名管道前缀（helper broker 固定管道名空间） */
export const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\zcode-cua-helper-";
/** 默认 socket 文件名（稳定 socket，跨进程共享） */
const DEFAULT_SOCKET_FILE_NAME = "broker.sock";
/** 刷新窗口内 16 位 hex（mint 唯一 socket 名） */
function randomHexId() {
    return randomBytes(8).toString("hex");
}
/**
 * 回收 runtime 目录下超过 24h 的 `broker-*.sock` 残留。
 * 任何读目录/Stat 失败都静默吞掉：清淤是尽力而为，不允许影响 mint 主路径。
 */
export function pruneStaleBrokerSockets(dir) {
    try {
        const cutoffMs = Date.now() - STALE_SOCKET_MAX_AGE_MS;
        for (const entry of readdirSync(dir)) {
            if (!/^broker-[0-9a-f]{16}\.sock$/u.test(entry))
                continue;
            const socketPath = join(dir, entry);
            try {
                if (statSync(socketPath).mtimeMs >= cutoffMs)
                    continue;
                unlinkSync(socketPath);
            }
            catch {
                // 单个条目回收失败不阻断其余条目。
            }
        }
    }
    catch {
        // 目录不存在或不可读时直接放弃。
    }
}
/**
 * broker socket 的 runtime 目录：
 * - XDG_RUNTIME_DIR/zcode（Linux 会话目录优先）
 * - win32：%LOCALAPPDATA%/zcode/cua-broker
 * - darwin：/tmp/zcode-cua-<uid>（Per-user IPC 目录）
 * - 其余：~/.zcode/cua-broker
 */
export function brokerRuntimeDir(env = process.env) {
    const xdgRuntimeDir = env.XDG_RUNTIME_DIR;
    if (typeof xdgRuntimeDir === "string" && xdgRuntimeDir.trim().length > 0) {
        return join(xdgRuntimeDir, "zcode-cua");
    }
    if (process.platform === "win32") {
        const localAppData = env.LOCALAPPDATA;
        return typeof localAppData === "string" && localAppData.trim().length > 0
            ? join(localAppData, "zcode", "cua-broker")
            : join(homedir(), "AppData", "Local", "zcode", "cua-broker");
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
/** 每次调用铸造全新 socket 名（临时 transport 用），并顺手回收过期残留。 */
export function mintBrokerSocketPath(options = {}) {
    const env = options.env ?? process.env;
    if (process.platform === "win32") {
        return `${WINDOWS_PIPE_PREFIX}${randomHexId()}`;
    }
    const dir = options.dir ?? brokerRuntimeDir(env);
    pruneStaleBrokerSockets(dir);
    return join(dir, `broker-${randomHexId()}.sock`);
}
/** 解析稳定 broker socket：env 注入优先，否则按平台落到固定管道/固定路径。 */
export function resolveBrokerSocketPath(options = {}) {
    const env = options.env ?? process.env;
    const fromEnv = env[BROKER_SOCKET_ENV_NAME];
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0)
        return fromEnv;
    if (process.platform === "win32")
        return `${WINDOWS_PIPE_PREFIX}default`;
    if (options.dir)
        return join(options.dir, DEFAULT_SOCKET_FILE_NAME);
    return join(brokerRuntimeDir(env), DEFAULT_SOCKET_FILE_NAME);
}
export const BROKER_SOCKET_ENV_NAME = "DRORA_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV_NAME = "DRORA_CUA_PERMISSION_BROKER_UNAVAILABLE";
// —— 草稿混淆名别名（server 模块尚未完成语义化，保持原导入可解析） ——
export { mintBrokerSocketPath as Uu, brokerRuntimeDir as fa, isWindowsNamedPipePath as ma, BROKER_SOCKET_ENV_NAME as oo, BROKER_UNAVAILABLE_ENV_NAME as ti, };
