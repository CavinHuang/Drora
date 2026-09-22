export interface ExecFileTextResult {
    stdout: string;
    stderr: string;
}
/** promisified execFile（utf8）；失败时把 stderr 附进错误消息，方便上层直接展示。 */
export declare function Hr(e: string, t: readonly string[]): Promise<ExecFileTextResult>;
export declare function jn(e: unknown): string;
/**
 * 构建期注入的“本地开发 runtime”折叠常量；Helper bundle 由 build-cua-helper-app.mjs
 * define 折叠，桌面 host bundle 缺省回退 NODE_ENV !== "production"。
 */
export declare var Ere: boolean;
export declare function bn(e?: NodeJS.ProcessEnv, t?: boolean): boolean;
export { Hr as execFileText, jn as formatErrorMessage, Ere as COMPILED_LOCAL_DEVELOPMENT_RUNTIME, bn as isCuaLocalDevelopmentRuntime, };
