/**
 * 迁自 packages/services/src/logger/serviceLogger.ts @ bf872a6c0（specs/
 * obsidian-vault-phase2-true-extraction.md §1-C1/§10-P3）：迁入的知识栈 7 处
 * createServiceLogger 导入改指本副本（services 包不可被插件反向依赖，见同目录
 * descriptors.ts 头注释）。与 services 版的差异仅一处：开发态判定不再经 services 的
 * `#src/runtime-tools/nodeEnv` 私有子路径，而是直接消费同一最终事实源
 * `@drora/shared` 的 resolveDroraRuntimeEnv——判定语义（只认 DRORA_RUNTIME_ENV，
 * 不认 NODE_ENV）逐条保留。日志分级口径不变：debug 仅开发态、生产不落盘。
 */
import { formatLogPrefix, resolveDroraRuntimeEnv, type TraceId } from "@drora/shared";

interface ServiceLogSink {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug?: (...args: unknown[]) => void;
}

export interface ServiceLogger {
  debug: (traceId: TraceId | undefined, ...args: unknown[]) => void;
  info: (traceId: TraceId | undefined, ...args: unknown[]) => void;
  warn: (traceId: TraceId | undefined, ...args: unknown[]) => void;
  error: (traceId: TraceId | undefined, ...args: unknown[]) => void;
}

export function createServiceLogger(
  scope: string,
  options?: {
    pid?: number;
    sink?: ServiceLogSink;
    // debug 日志默认只在本地开发运行时打印；测试/正式安装包都使用 production 构建，避免高频日志落盘。
    isDebugEnabled?: boolean | (() => boolean);
  },
): ServiceLogger {
  const pid = options?.pid ?? process.pid;
  const sink = options?.sink ?? console;
  const debugOption = options?.isDebugEnabled;
  const resolveDebugEnabled: () => boolean =
    typeof debugOption === "function"
      ? debugOption
      : typeof debugOption === "boolean"
        ? () => debugOption
        : // 与 services nodeEnv.isEffectiveDevelopmentNodeEnv 同式：只认 DRORA_RUNTIME_ENV
          // 显式注入的 development；NODE_ENV 是用户 shell 变量，不能作为判据。
          () => resolveDroraRuntimeEnv(process.env) === "development";

  function write(
    level: "debug" | "info" | "warn" | "error",
    traceId: TraceId | undefined,
    ...args: unknown[]
  ): void {
    if (level === "debug" && !resolveDebugEnabled()) {
      return;
    }
    const source = traceId ? `${scope}][trace:${traceId}` : scope;
    const consoleFn =
      level === "error"
        ? sink.error
        : level === "warn"
          ? sink.warn
          : level === "debug"
            ? (sink.debug ?? sink.log)
            : sink.log;
    consoleFn(formatLogPrefix(source, pid), ...args);
  }

  return {
    debug: (traceId, ...args) => write("debug", traceId, ...args),
    info: (traceId, ...args) => write("info", traceId, ...args),
    warn: (traceId, ...args) => write("warn", traceId, ...args),
    error: (traceId, ...args) => write("error", traceId, ...args),
  };
}
