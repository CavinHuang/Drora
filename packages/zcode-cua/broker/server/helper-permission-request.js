// oxlint-disable-file -- host 侧权限请求：通过 LaunchServices 拉起 Helper 的
// `--permission-request <kind>` 模式（Helper 侧实现见 packages/zcode-cua-helper
// src/broker/server/helperMain.ts 的 runAccessibilityPermissionRequest /
// runScreenRecordingPermissionRequest，由本模块的 open 参数契约驱动）。
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { brokerRuntimeDir } from "../socket-path.js";
const LAUNCH_CANCEL_DIR_NAME = ".permission-request";
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
/** 在 Helper 的 .launch-cancel 同级目录准备本次请求的哨兵目录。 */
function requestRuntimeDir(env) {
    const dir = join(brokerRuntimeDir(env), LAUNCH_CANCEL_DIR_NAME);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}
/**
 * 通过 LaunchServices（`open -W`）以请求模式拉起 Helper，让 Helper 进程内的原生
 * 插件触发 TCC 提示。返回 ok=true 表示请求已成功递交给 Helper（提示已弹出），
 * 不代表用户已授权；授权结果以 permission_status 查询为准。
 */
export async function requestHelperPermissionViaLaunchServices(permission, options) {
    const env = options.env ?? process.env;
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const deadlineEpochMs = Date.now() + timeoutMs;
    const cancelFilePath = join(requestRuntimeDir(env), `.permission-request-${randomUUID()}.sentinel`);
    const args = [
        "-W",
        "-n",
        "-g",
        options.appPath,
        "--args",
        "--permission-request",
        permission,
        "--permission-request-deadline-epoch-ms",
        String(deadlineEpochMs),
        "--permission-request-cancel-file",
        cancelFilePath,
    ];
    return new Promise((resolveRequest) => {
        execFile("/usr/bin/open", args, { env, timeout: timeoutMs, killSignal: "SIGKILL" }, (error) => {
            if (error) {
                resolveRequest({
                    ok: false,
                    reason: `Failed to launch ${options.appPath} for ${permission} permission request: ${error.message}`,
                });
                return;
            }
            resolveRequest({ ok: true });
        });
    });
}
export async function requestHelperAccessibilityPermissionViaLaunchServices(options) {
    return requestHelperPermissionViaLaunchServices("accessibility", options);
}
export async function requestHelperScreenRecordingPermissionViaLaunchServices(options) {
    return requestHelperPermissionViaLaunchServices("screen_recording", options);
}
