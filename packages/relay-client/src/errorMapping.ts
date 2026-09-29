// Drora Relay Client · 错误码 → 失败卡 reason 映射（spec §2 十一卡验收面）。
// 官方 3.14.3 手机页错误分派取证（hVn.handleRelayError，还原稿 index-NjWRUABD.js
// @281119-281127）：
//   KICKED → session-conflict（已被其他设备接管，终态）；
//   DEVICE_OFFLINE → desktop-disconnected（带 15s 宽限，见 relaySession）；
//   AUTH_FAILED / WRONG_PARAM → 鉴权失败面（invalid-mobile-connection：QR/凭据无效
//   或参数被拒；WRONG_PARAM 属协议误用，同样归该面，避免第二套文案）；
//   INTERNAL → 不落失败卡（paired 迁回 waiting / 非 paired 立即重连，relaySession
//   拦截，不会走到本映射）；
//   其余未知错误码 → relay-unavailable（官方 default 分支 enterTerminalFailure）。
import type { RelayErrorCode, RelayFailureReason } from "./types.js";

/**
 * 服务端 error 帧可映射的终态失败面（默认 = 官方 default 分支的 relay-unavailable，
 * P1-5① 对齐：未知错误码不再落 unexpected-error）。
 */
export function mapRelayErrorToFailure(code: string): RelayFailureReason {
  switch (code as RelayErrorCode) {
    case "KICKED":
      return "session-conflict";
    case "DEVICE_OFFLINE":
      return "desktop-disconnected";
    case "AUTH_FAILED":
    case "WRONG_PARAM":
      return "invalid-mobile-connection";
    default:
      // 未知错误码（含 INTERNAL——但 INTERNAL 在 relaySession 先行拦截，不落终态）。
      return "relay-unavailable";
  }
}

/** DEVICE_OFFLINE 走宽限路径，不立即终态（relaySession 消费）。 */
export function isGraceEligibleError(code: string): boolean {
  return code === "DEVICE_OFFLINE";
}

/** KICKED 是终态踢出：不再重连（官方 kicked 终态，防乒乓）。 */
export function isTerminalKick(code: string): boolean {
  return code === "KICKED";
}

/**
 * INTERNAL 是可恢复错误（P1-5③，官方 handleRelayError INTERNAL 分支取证
 * @281119-281124）：paired 迁回 waiting 等桌面回归；非 paired 立即重连
 * （recoverFromRelayInternal）——两种路径都不落失败卡。
 */
export function isRelayInternalError(code: string): boolean {
  return code === "INTERNAL";
}
