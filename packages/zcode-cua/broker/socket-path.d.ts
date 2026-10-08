/** Windows 命名管道前缀（helper broker 固定管道名空间） */
export declare const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\zcode-cua-helper-";
/**
 * 回收 runtime 目录下超过 24h 的 `broker-*.sock` 残留。
 * 任何读目录/Stat 失败都静默吞掉：清淤是尽力而为，不允许影响 mint 主路径。
 */
export declare function pruneStaleBrokerSockets(dir: string): void;
/**
 * broker socket 的 runtime 目录：
 * - XDG_RUNTIME_DIR/zcode（Linux 会话目录优先）
 * - win32：%LOCALAPPDATA%/zcode/cua-broker
 * - darwin：/tmp/zcode-cua-<uid>（Per-user IPC 目录）
 * - 其余：~/.zcode/cua-broker
 */
export declare function brokerRuntimeDir(env?: NodeJS.ProcessEnv): string;
export declare function isWindowsNamedPipePath(path: string): boolean;
/** 每次调用铸造全新 socket 名（临时 transport 用），并顺手回收过期残留。 */
export declare function mintBrokerSocketPath(options?: {
    dir?: string;
    env?: NodeJS.ProcessEnv;
}): string;
/** 解析稳定 broker socket：env 注入优先，否则按平台落到固定管道/固定路径。 */
export declare function resolveBrokerSocketPath(options?: {
    dir?: string;
    env?: NodeJS.ProcessEnv;
}): string;
export declare const BROKER_SOCKET_ENV_NAME = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export declare const BROKER_UNAVAILABLE_ENV_NAME = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";
export { mintBrokerSocketPath as Uu, brokerRuntimeDir as fa, isWindowsNamedPipePath as ma, BROKER_SOCKET_ENV_NAME as oo, BROKER_UNAVAILABLE_ENV_NAME as ti, };
