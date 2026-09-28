// Drora Relay Server 公共入口（协议兼容自建云中继，spec: mobile-relay-server.md）。
export {
  MAX_WS_PAYLOAD_BYTES,
  REGISTER_RATE_PER_MINUTE,
  MAX_LIVE_SIDS_PER_DEVICE_MID,
  TRANSPORT_ID_PATTERN,
  computeProof,
  verifyProof,
  makeDeviceSid,
  makeTerminalSid,
  makeNonce,
  isDataEnvelope,
  stampServerTs,
  type RelayRole,
  type DeviceRecord,
  type IncomingDataEnvelope,
} from "./protocol.js";
export {
  createDeviceRegistry,
  createFileDeviceRegistryStorage,
  type DeviceRegistry,
  type DeviceRegistryStorage,
} from "./deviceRegistry.js";
export {
  createSessionStore,
  type SessionEndpoint,
  type SessionView,
  type AttachResult,
} from "./sessionStore.js";
export {
  createRelayServer,
  type RelayServerOptions,
  type RelayServerLogger,
} from "./relayServer.js";
