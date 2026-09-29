// Drora Relay Client · WebSocket 传输绑定（浏览器原生 WebSocket / node ws 包同构面）。
// 平台差异收敛在这里：两者都有 addEventListener("open"/"message"/"close"/"error")、
// send(string)、close()；node ws 的 message.data 是 Buffer|string，统一转文本。
// 环境差异（平台注入）遵循 AGENTS.md 平台边界：本包不做平台探测，由装配方传入实现。
import type { RelayTransportEvents, RelayTransportFactory, RelayTransportPort } from "./ports.js";

/** 最小 WebSocket 形状（浏览器 WebSocket 与 node ws 的公共子集）。 */
export interface WebSocketLike {
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: {
      data?: unknown;
      code?: number;
      reason?: string;
      wasClean?: boolean;
      message?: string;
    }) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type WebSocketConstructorLike = new (url: string) => WebSocketLike;

function toText(data: unknown): string {
  if (typeof data === "string") return data;
  // node ws 的 Buffer（UInt8Array 子类）。
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  return "";
}

/**
 * 传输工厂：session 每次连接（含重连）调用，生成新一代 socket。
 * close 用 1000 正常关闭（relay 对 terminal 关闭无特殊码语义）。
 */
export function createWebSocketTransportFactory(
  WebSocketImpl: WebSocketConstructorLike,
): RelayTransportFactory {
  return ({ url, events }: { url: string; events: RelayTransportEvents }) => {
    let open = false;
    let closedByUs = false;
    const socket = new WebSocketImpl(url);
    socket.addEventListener("open", () => {
      open = true;
      events.onOpen();
    });
    socket.addEventListener("message", (event) => {
      events.onText(toText(event.data));
    });
    socket.addEventListener("close", (event) => {
      open = false;
      events.onClose({
        code: event.code ?? 1006,
        reason: event.reason ?? "",
        wasClean: closedByUs || event.wasClean === true,
      });
    });
    socket.addEventListener("error", (event) => {
      events.onError(event.message ?? "websocket error");
    });
    const port: RelayTransportPort = {
      connect() {
        // 构造即连接（浏览器语义）；保留显式入口以对齐端口注释。
      },
      sendText(text) {
        if (open) socket.send(text);
      },
      isOpen() {
        return open;
      },
      close() {
        closedByUs = true;
        try {
          socket.close();
        } catch {
          // 已关闭的 socket 关闭再抛错属平台噪音，吞掉（对齐官方 close 容错）。
        }
      },
    };
    return port;
  };
}
