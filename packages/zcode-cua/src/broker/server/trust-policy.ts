// oxlint-disable-file
// 还原自发行 bundle 的 trust-policy 模块（名称按原始语义恢复；
// execFileText/formatErrorMessage/isCuaLocalDevelopmentRuntime 见 function-map 477-489 行）。
import { execFile } from "node:child_process";

export interface ExecFileTextResult {
  stdout: string;
  stderr: string;
}

/** promisified execFile（utf8）；失败时把 stderr 附进错误消息，方便上层直接展示。 */
export function Hr(e: string, t: readonly string[]): Promise<ExecFileTextResult> {
  return new Promise((n, r) => {
    execFile(
      e,
      [...t],
      {
        encoding: "utf8",
      },
      (o: Error | null, s: string, a: string) => {
        if (o) {
          let c = `${e} ${t.join(" ")} failed: ${jn(o)}${
            a
              ? `

${a}`
              : ""
          }`;
          r(new Error(c));
          return;
        }
        n({
          stdout: s,
          stderr: a,
        });
      },
    );
  });
}

export function jn(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 构建期注入的“本地开发 runtime”折叠常量；Helper bundle 由 build-cua-helper-app.mjs
 * define 折叠，桌面 host bundle 缺省回退 NODE_ENV !== "production"。
 */
export var Ere =
  typeof __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__ < "u"
    ? __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__
    : process.env.NODE_ENV !== "production";

export function bn(e: NodeJS.ProcessEnv = process.env, t: boolean = Ere): boolean {
  return t && e.ZCODE_RUNTIME_ENV?.trim().toLowerCase() !== "production";
}

// —— 语义名别名 ——
export {
  Hr as execFileText,
  jn as formatErrorMessage,
  Ere as COMPILED_LOCAL_DEVELOPMENT_RUNTIME,
  bn as isCuaLocalDevelopmentRuntime,
};
