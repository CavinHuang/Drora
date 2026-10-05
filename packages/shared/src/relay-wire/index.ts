// relay 线协议纯逻辑聚合（spec D2：desktop / relay-server / relay-client 三方同源）。
// 本包纪律：只放线协议纯函数、常量与无 IO 有状态簿记（rpc-frame 组装/编码、发送侧
// 重放缓冲——R3 P2a 起有意放宽：desktop / relay-client / 移动页三方需要逐字节同构的
// 传输语义，见 specs/mobile-relay-r3-frontend.md §12/§13；连接级有状态逻辑
// （SessionStore/会话状态机）仍不进本包）。与官方兼容的线协议字面量（zcode_type、
// role 值等）是官方兼容键，保持原名不 ZCode 化。
export { base64ToBytes, bytesToBase64 } from "./base64.js";
export { bytesToBase64Url, hmacSha256Bytes, sha256Bytes, utf8Bytes } from "./hmacSha256.js";
export {
  RELAY_PROOF_ROLES,
  buildRelayProofMessage,
  computeProof,
  type RelayProofParams,
  type RelayWireRole,
} from "./proof.js";
export {
  TRANSPORT_ID_PATTERN,
  isDataEnvelope,
  stampServerTs,
  type IncomingDataEnvelope,
} from "./envelope.js";
export {
  RELAY_REPLAY_BUFFER_GRACE_MS,
  RELAY_REPLAY_BUFFER_MAX_BYTES,
  RELAY_SATURATION_HIGH_WATER_MARK_BYTES,
  RELAY_SATURATION_LOW_WATER_MARK_BYTES,
} from "./constants.js";
export {
  RPC_FRAME_FRAGMENT_DATA_BYTES,
  RPC_FRAME_MAX_FRAGMENTS,
  RPC_FRAME_MAX_MESSAGE_BYTES,
  RpcFrameAssembler,
  buildRpcFrameAck,
  checksumValueFromWire,
  crc32,
  crc32ToWire,
  encodeRpcTransportMessage,
  identityFields,
  parseRpcTransportFrame,
  type RpcFrameIdentity,
  type RpcTransportFrame,
} from "./rpcFrame.js";
export {
  RELAY_REPLAY_DEGRADED_ACK_GRACE,
  RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED,
  RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE,
  RELAY_REPLAY_DEGRADED_FUTURE_ACK,
  RelayReplayBuffer,
  createRelayReplayBuffer,
  type RelayReplayAckResult,
  type RelayReplayBufferOptions,
  type RelayReplayReserveResult,
} from "./replayBuffer.js";
