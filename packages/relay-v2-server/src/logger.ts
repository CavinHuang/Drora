// Relay V2 结构化日志（specs/relay-v2-server.md §9）。
// 红线（不得绕过）：
// 1. 任何日志不输出 JWT、一次性 token、data.payload 正文与完整设备名；
//    生命周期事件只带 realm 前缀 userId、device_sid 前缀、role、事件类型与错误码。
// 2. 消息级 trace 仅 MSG_TRACE=true 时输出，字段被 traceMessage 的入参类型结构性限定为
//    摘要集（type / pair_status / role / code / drora_type / requestId / bridgeSessionId / bytes，
//    docs/web-remote-control-relay-message-logging.md 的仓库既有裁决），永不接受 payload 正文。
// 输出：JSON Lines 到 stdout（经注入 write；禁 console.log，仓库日志纪律）。

export type RelayLogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<RelayLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 消息级 trace 的摘要字段全集——红线：不接受 payload 正文（spec §9） */
export interface RelayMessageTraceFields {
  type?: string;
  pair_status?: string;
  role?: string;
  code?: string;
  /** payload 的 drora 协议类型名摘要；只允许类型名，不允许正文 */
  drora_type?: string;
  requestId?: string;
  bridgeSessionId?: string;
  bytes?: number;
}

/** 生命周期/诊断日志字段：仅允许标量，结构上排除嵌套对象（防 payload 顺带落盘） */
export interface RelayLogFields {
  [field: string]: string | number | boolean | undefined;
}

export interface RelayLogger {
  debug(message: string, fields?: RelayLogFields): void;
  info(message: string, fields?: RelayLogFields): void;
  warn(message: string, fields?: RelayLogFields): void;
  error(message: string, fields?: RelayLogFields): void;
  /** 消息级 trace：仅 trace 总开关开启时输出；字段限定为摘要集（spec §9） */
  traceMessage(fields: RelayMessageTraceFields): void;
}

export interface CreateRelayLoggerOptions {
  level: RelayLogLevel;
  /** MSG_TRACE 总开关（spec §9，默认关） */
  trace: boolean;
  /** 每行附带的固定 scope 标识，便于区分 HTTP/WS/registry 事件来源 */
  scope?: string;
  /** 输出汇；默认逐行写 process.stdout（异步刷新由 Node 调度） */
  write?: (line: string) => void;
  now?: () => number;
}

export function createRelayLogger(options: CreateRelayLoggerOptions): RelayLogger {
  const write = options.write ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const now = options.now ?? Date.now;
  const threshold = LEVEL_WEIGHT[options.level];
  const base: RelayLogFields = options.scope === undefined ? {} : { scope: options.scope };
  const emit = (level: RelayLogLevel, message: string, fields?: RelayLogFields) => {
    // JSON.stringify 丢弃 undefined 值字段，未提供字段不出现在行内
    if (LEVEL_WEIGHT[level] < threshold) return;
    write(JSON.stringify({ ts: now(), level, msg: message, ...base, ...fields }));
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    traceMessage: (fields) => {
      // 红线：trace 关闭时静默；开启时也只输出上面接口允许的摘要字段
      if (!options.trace) return;
      write(
        JSON.stringify({
          ts: now(),
          level: "debug",
          msg: "relay-message-trace",
          ...base,
          ...fields,
        }),
      );
    },
  };
}
