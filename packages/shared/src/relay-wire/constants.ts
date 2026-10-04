// relay 线协议·发送侧流控与重放缓冲常量（单一出处）。
// 取证：官方 chunk-C6VCYWB4.js 类体 @8551、常量表 @6729（spec: mobile-web-remote.md M4c）。
// 收敛出处与 desktop re-export 关系见同包 replayBuffer.ts 头注（desktop 现为
// re-export 消费方）；收敛到 shared 使 desktop / relay-server / relay-client 三方同源。
// 发送侧重放簿记 RelayReplayBuffer 随迁本包；连接级有状态逻辑
// （SessionStore/会话状态机）不进本包（见 index.ts 纪律注释）。

/** 饱和高水位：官方 saturationHighWaterMarkBytes=1MiB（常量表 @6729）。 */
export const RELAY_SATURATION_HIGH_WATER_MARK_BYTES = 1024 * 1024;
/** 排空低水位：官方 saturationLowWaterMarkBytes=256KiB。 */
export const RELAY_SATURATION_LOW_WATER_MARK_BYTES = 256 * 1024;
/** 重放缓冲字节上限：官方 replayBufferMaxBytes=8MiB。 */
export const RELAY_REPLAY_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
/** 未确认批次宽限期：官方 replayBufferGraceMs=45s。 */
export const RELAY_REPLAY_BUFFER_GRACE_MS = 45_000;
