// Drora Relay Client · 依赖注入 port：传输 / 线编解码 / 时钟。
// R3 D2/P1 已换源：proof/信封校验由 @drora/shared relay-wire 提供单一出处，默认
// 编解码见 codec.ts；port 保留为测试注入点。本包不含平台 WebSocket 代码：浏览器
// 装配用原生 WebSocket，node 测试装配用 ws 包（见 test/）。
import type { RelayWireFrame } from "./types.js";

/** 传输事件（session 以回调集注入 factory；仅当前代 socket 的事件被消费）。 */
export interface RelayTransportEvents {
  onOpen(): void;
  onText(text: string): void;
  onClose(info: { code: number; reason: string; wasClean: boolean }): void;
  onError(message: string): void;
}

/** 平台无关传输面：连接/发送/关闭由外部注入（浏览器=原生 WebSocket，node=ws）。 */
export interface RelayTransportPort {
  /** 建立连接。结果经 events（onOpen/onError/onClose）回报；不抛异常。 */
  connect(): void;
  /** 发送一条已序列化的线帧文本；socket 未就绪时静默丢弃（对齐官方 send 语义）。 */
  sendText(text: string): void;
  /** socket 是否处于 OPEN。 */
  isOpen(): boolean;
  /** 主动关闭（clean close 握手；平台实现选择 close 码）。 */
  close(): void;
}

/**
 * 传输工厂：每次连接（含重连）调用一次，生成新一代 socket。
 * request.url 为 session 组装好的 relay 端点（含 ?mid= 查询，对齐官方 connect）。
 */
export type RelayTransportFactory = (request: {
  url: string;
  events: RelayTransportEvents;
}) => RelayTransportPort;

/**
 * 线编解码 port（帧/proof 原语注入点；P1 已换源 @drora/shared，此处保留为测试注入替身）：
 * - computeProof：proof=HMAC-SHA256(passHash, "<nonce>|terminal|<deviceSid>", base64url)；
 * - parseFrame：入站 JSON → 帧对象；非法帧返回 null（静默丢弃，对齐官方）；
 * - serializeFrame：出站帧 → JSON 文本。
 */
export interface RelayWireCodecPort {
  computeProof(params: {
    passHash: string;
    nonce: string;
    role: "terminal";
    deviceSid: string;
  }): string | Promise<string>;
  parseFrame(raw: string): RelayWireFrame | null;
  serializeFrame(frame: RelayWireFrame): string;
}

/** 定时器句柄（不透明；由注入的时钟实现解释）。 */
export interface RelayTimerHandle {
  readonly id: number;
}

/**
 * 时钟 port：生产装配用系统时钟（clock.ts），单测注入手控时钟（fake timers）
 * 驱动全部超时/心跳/退避/宽限路径，不依赖 node:test mock.timers。
 */
export interface RelayClockPort {
  now(): number;
  setTimeout(handler: () => void, timeoutMs: number): RelayTimerHandle;
  clearTimeout(handle: RelayTimerHandle): void;
}
