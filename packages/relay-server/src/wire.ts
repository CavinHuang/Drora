// WS 出站原语：统一帧盖 server_ts、错误帧线格式、发帧后 terminate 的断开语义。
// 从 relayServer.ts 拆出以守单文件行数门禁；语义依据见 specs/mobile-relay-server.md §4/§11。
import { WebSocket } from "ws";

/** 出站统一盖 server_ts；socket 非 OPEN 时静默丢弃。 */
export function send(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ ...message, server_ts: Date.now() }));
}

// 官方错误帧线格式：message 恒空串（E2E 实测 §11 #7）——诊断细节由调用方
// emitError 降级为服务端日志，不再进线协议。
export function sendError(socket: WebSocket, code: string): void {
  send(socket, { type: "error", code, message: "" });
}

/**
 * 发帧并 terminate（E2E #3/#4 断开语义）：ws 的 send 是异步排队，发完立即 terminate
 * 会把未 flush 的帧连 TCP 一起丢掉（集成测试实锤：KICKED 帧丢失、客户端只见 1006）。
 * 这里沿 send 落盘回调串联全部帧，最后一帧 flush 后再 terminate——客户端先收到
 * 错误帧、后见到 1006，与官方行为一致。
 */
export function sendThenTerminate(
  socket: WebSocket,
  messages: Array<Record<string, unknown>>,
): void {
  if (socket.readyState !== WebSocket.OPEN) {
    socket.terminate();
    return;
  }
  let index = 0;
  const step = (): void => {
    if (index >= messages.length) {
      socket.terminate();
      return;
    }
    const message = messages[index];
    index += 1;
    socket.send(JSON.stringify({ ...message, server_ts: Date.now() }), () => step());
  };
  step();
}
