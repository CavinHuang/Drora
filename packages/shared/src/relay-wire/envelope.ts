// relay 线协议·data 应用帧信封的形状校验与盖章（spec: mobile-relay-server.md §3）。
// 来源：提取自 packages/relay-server/src/protocol.ts（原文件保留 re-export，
// desktop / 未来的 relay-client 与服务端三方同源）。

/** 入站消息的运行时形状校验（协议级；业务校验在端侧）。 */
export interface IncomingDataEnvelope {
  type: "data";
  payload: Record<string, unknown>;
  client_ts: number;
}

export function isDataEnvelope(value: unknown): value is IncomingDataEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "data" &&
    typeof record.payload === "object" &&
    record.payload !== null &&
    typeof record.client_ts === "number"
  );
}

/** 转发前盖章：官方手机页入站信封含 server_ts（schema 取证），由服务端在转发时写入。 */
export function stampServerTs<T extends Record<string, unknown>>(
  envelope: T,
  ts: number,
): T & { server_ts: number } {
  return { ...envelope, server_ts: ts };
}

/**
 * transportId（bridgeSessionId 等）字符集白名单。
 * 取证自官方手机页 transportEnvelopeIdMaxChars schema；越界信封静默丢弃
 * （spec §3 校验面：payload 非对象 / bridgeSessionId 超出 [A-Za-z0-9._~-]{1,64}）。
 */
export const TRANSPORT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/u;
