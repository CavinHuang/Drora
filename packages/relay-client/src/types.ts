// Drora Relay Client · 类型面（terminal 角色）。
// 状态机与失败码族对齐 specs/mobile-relay-r3-frontend.md §2 清单；线协议形状对齐
// specs/mobile-relay-server.md §3 与官方 3.14.3 手机页 bundle 取证（见各类型注释）。
// R3 D2/P1 已换源：proof/信封校验由 @drora/shared relay-wire 提供，默认编解码见
// codec.ts，port 保留为测试注入点；本包帧类型（terminal 视角类型面）保持本地定义。

/** relay 配对状态（线协议 pair_status 字面量，官方兼容键不 Drora 化）。 */
export type RelayPairStatus = "waiting" | "matched";

/**
 * RelaySession（terminal）状态机九态，对照 spec §2 过渡状态机表：
 * idle → connecting → authenticating → waiting → paired（配对）/ reconnecting /
 * suspended / kicked（终态）/ error（终态或可重试）。
 */
export type RelaySessionState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "waiting"
  | "paired"
  | "reconnecting"
  | "suspended"
  | "kicked"
  | "error";

/**
 * 11 张失败卡 code 集合（spec §2；官方失败面 reason 词汇表）。
 * 类型联合即验收面：onFailure 只允许产出这 11 个 code。
 */
export type RelayFailureReason =
  | "session-not-found"
  | "session-expired"
  | "session-conflict"
  | "workspace-closed"
  | "desktop-disconnected"
  | "invalid-mobile-connection"
  | "desktop-bootstrap-timeout"
  | "connection-recovery-timeout"
  | "relay-unavailable"
  | "unsupported-action"
  | "unexpected-error";

/** 终态失败事件（官方 I9 构造形状：{reason, message?}）。 */
export interface RelayFailure {
  reason: RelayFailureReason;
  message?: string;
}

/** 服务端 error 帧错误码族（specs/mobile-relay-server.md §5）。 */
export type RelayErrorCode =
  | "AUTH_FAILED"
  | "WRONG_PARAM"
  | "KICKED"
  | "DEVICE_OFFLINE"
  | "INTERNAL";

/**
 * relay 线协议帧（terminal 视角）。字段名保持官方兼容键（`zcode_type` 族同规则：
 * 互操作必需，不做 Drora 化）。
 */
export type RelayWireFrame =
  | {
      type: "auth_init";
      role: "terminal";
      device_sid: string;
      meta?: Record<string, unknown>;
      client_ts: number;
    }
  | { type: "auth_challenge"; nonce: string; server_ts?: number }
  | { type: "auth_response"; device_sid: string; proof: string; client_ts: number }
  | {
      type: "auth_ack";
      pair_status: RelayPairStatus;
      device_sid: string;
      terminal_sid: string;
      server_ts?: number;
    }
  | { type: "pair_status_query"; device_sid: string; client_ts: number }
  | {
      type: "pair_status_ack";
      pair_status: RelayPairStatus;
      terminal_sid?: string;
      server_ts?: number;
    }
  | { type: "data"; payload: Record<string, unknown>; client_ts: number; server_ts?: number }
  | { type: "error"; code: RelayErrorCode | string; message?: string; server_ts?: number };

/** data 帧下行应用负载（zcode_type 应用帧族，桥/页面上层消费）。 */
export type RelayAppPayload = Record<string, unknown>;

/** sendPayload 出站结果（对齐官方 sendPayloadResult 判别）。 */
export type RelayPayloadSendResult =
  | { kind: "sent"; bytes: number }
  | { kind: "oversize"; bytes: number; maxBytes: number }
  | { kind: "unavailable" };

/** D3 诊断事件 7 类：state-transition / pair-status / recover-* / socket-*。 */
export type RelayDiagnostic =
  | { type: "state-transition"; previousState: RelaySessionState; state: RelaySessionState }
  | { type: "pair-status"; pairStatus: RelayPairStatus; state: RelaySessionState }
  | { type: "recover-scheduled"; state: RelaySessionState; attempt: number; delayMs: number }
  | { type: "recover-start"; state: RelaySessionState }
  | { type: "socket-open"; state: RelaySessionState }
  | {
      type: "socket-close";
      code: number;
      reason: string;
      wasClean: boolean;
      wasPaired: boolean;
      state: RelaySessionState;
    }
  | { type: "socket-error"; state: RelaySessionState; message: string };
