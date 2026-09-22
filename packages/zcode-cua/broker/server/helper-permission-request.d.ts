export interface HelperPermissionRequestOptions {
    /** Helper .app 路径（必须已通过安装校验） */
    appPath: string;
    /** 请求超时；open -W 等 Helper 进程退出 */
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}
export interface HelperPermissionRequestResult {
    ok: boolean;
    reason?: string;
}
/**
 * 通过 LaunchServices（`open -W`）以请求模式拉起 Helper，让 Helper 进程内的原生
 * 插件触发 TCC 提示。返回 ok=true 表示请求已成功递交给 Helper（提示已弹出），
 * 不代表用户已授权；授权结果以 permission_status 查询为准。
 */
export declare function requestHelperPermissionViaLaunchServices(permission: "accessibility" | "screen_recording", options: HelperPermissionRequestOptions): Promise<HelperPermissionRequestResult>;
export declare function requestHelperAccessibilityPermissionViaLaunchServices(options: HelperPermissionRequestOptions): Promise<HelperPermissionRequestResult>;
export declare function requestHelperScreenRecordingPermissionViaLaunchServices(options: HelperPermissionRequestOptions): Promise<HelperPermissionRequestResult>;
