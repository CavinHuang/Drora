// relay-wire rpc-frame / 重放缓冲 / base64 单测（spec D2/P2a：三方同源，收敢单点）。
// 方法学与 relayWire.test.ts 一致：具体向量值以 node:crypto / Buffer 权威实现锚定
// （crc32 用 IEEE 标准向量 "123456789" → 0xcbf43926；base64 用 RFC 4648 向量族 +
// Buffer 交叉），避免凭记忆写错。桌面侧同名实现已收敛到本包（desktopMobileRelayProtocol
// re-export），desktop/relay-client 双方语义一致性由本文件与
// packages/desktop/test/relayWire.test.ts 共同锚定。
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  RPC_FRAME_FRAGMENT_DATA_BYTES,
  RPC_FRAME_MAX_FRAGMENTS,
  RPC_FRAME_MAX_MESSAGE_BYTES,
  RELAY_REPLAY_BUFFER_GRACE_MS,
  RELAY_REPLAY_BUFFER_MAX_BYTES,
  RELAY_SATURATION_HIGH_WATER_MARK_BYTES,
  RELAY_SATURATION_LOW_WATER_MARK_BYTES,
  RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED,
  RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE,
  RELAY_REPLAY_DEGRADED_FUTURE_ACK,
  RelayReplayBuffer,
  RpcFrameAssembler,
  base64ToBytes,
  buildRpcFrameAck,
  bytesToBase64,
  crc32,
  crc32ToWire,
  checksumValueFromWire,
  encodeRpcTransportMessage,
  parseRpcTransportFrame,
} from "../src/relay-wire/index.js";

// —— base64（RFC 4648 向量族 + Buffer 交叉） ——

test("bytesToBase64 对齐 RFC 4648 向量族", () => {
  const vectors: Array<[string, string]> = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(bytesToBase64(new TextEncoder().encode(input)), expected);
  }
});

test("base64 与 Buffer 权威实现随机交叉", () => {
  for (const size of [0, 1, 2, 3, 63, 64, 65, 4096]) {
    const bytes = new Uint8Array(randomBytes(size));
    const expected = Buffer.from(bytes).toString("base64");
    assert.equal(bytesToBase64(bytes), expected, `size=${size}`);
    assert.deepEqual(Buffer.from(base64ToBytes(expected)).equals(bytes), true, `size=${size}`);
  }
});

// —— crc32（IEEE 标准向量 + Buffer 无关性） ——

test("crc32 对齐 IEEE 标准向量", () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32ToWire(crc32(new TextEncoder().encode("123456789"))), "cbf43926");
});

// —— 常量值（官方常量表锚定，防漂移） ——

test("rpc-frame 常量与官方值一致", () => {
  assert.equal(RPC_FRAME_MAX_MESSAGE_BYTES, 16 * 1024 * 1024);
  assert.equal(RPC_FRAME_MAX_FRAGMENTS, 64);
  assert.equal(RPC_FRAME_FRAGMENT_DATA_BYTES, 640 * 1024);
  assert.equal(RELAY_SATURATION_HIGH_WATER_MARK_BYTES, 1024 * 1024);
  assert.equal(RELAY_SATURATION_LOW_WATER_MARK_BYTES, 256 * 1024);
  assert.equal(RELAY_REPLAY_BUFFER_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(RELAY_REPLAY_BUFFER_GRACE_MS, 45_000);
});

test("checksumValueFromWire 兼容数值与 8 位 hex 两种线格式", () => {
  assert.equal(checksumValueFromWire(0xcbf43926), 0xcbf43926);
  assert.equal(checksumValueFromWire("cbf43926"), 0xcbf43926);
  assert.equal(checksumValueFromWire("CBF43926"), null);
  assert.equal(checksumValueFromWire("12345"), null);
  assert.equal(checksumValueFromWire(-1), null);
  assert.equal(checksumValueFromWire(undefined), null);
});

// —— 编码/组装闭环 ——

const identity = { bridgeSessionId: "b-1", bridgeGeneration: 2, recoveryId: "r-1" } as const;

test("encode → parse → assemble 闭环（单分片）", () => {
  const message = new TextEncoder().encode('{"hello":"relay"}');
  const { frames, nextPhysicalSeq, checksum } = encodeRpcTransportMessage({
    message,
    identity,
    firstPhysicalSeq: 7,
    messageSeq: 3,
  });
  assert.equal(frames.length, 1);
  assert.equal(nextPhysicalSeq, 8);
  assert.equal(checksum, crc32(message));
  const parsed = parseRpcTransportFrame(frames[0]);
  assert.ok(parsed);
  const assembled = new RpcFrameAssembler(identity).accept(parsed);
  assert.ok(assembled);
  assert.equal(assembled.messageSeq, 3);
  assert.deepEqual(Buffer.from(assembled.message).equals(message), true);
});

test("encode → assemble 闭环（跨分片 > 640KiB）", () => {
  const message = new Uint8Array(randomBytes(RPC_FRAME_FRAGMENT_DATA_BYTES + 1024));
  const { frames } = encodeRpcTransportMessage({
    message,
    identity,
    firstPhysicalSeq: 0,
    messageSeq: 1,
  });
  assert.equal(frames.length, 2);
  const assembler = new RpcFrameAssembler(identity);
  // 首片未齐：null。
  const first = parseRpcTransportFrame(frames[0]);
  assert.equal(assembler.accept(first!), null);
  const second = parseRpcTransportFrame(frames[1]);
  const assembled = assembler.accept(second!);
  assert.ok(assembled);
  assert.deepEqual(Buffer.from(assembled.message).equals(message), true);
});

test("组装器拒绝身份不匹配与坏 checksum", () => {
  const message = new TextEncoder().encode("payload");
  const { frames } = encodeRpcTransportMessage({
    message,
    identity,
    firstPhysicalSeq: 0,
    messageSeq: 1,
  });
  const otherIdentity = { bridgeSessionId: "b-other" };
  assert.equal(new RpcFrameAssembler(otherIdentity).accept(frames[0]!), null);
  const corrupted = { ...frames[0]!, dataBase64: bytesToBase64(new Uint8Array([1, 2, 3])) };
  assert.equal(new RpcFrameAssembler(identity).accept(corrupted), null);
});

test("parseRpcTransportFrame 拒绝非 rpc-frame 与缺字段", () => {
  assert.equal(parseRpcTransportFrame(null), null);
  assert.equal(parseRpcTransportFrame({ zcode_type: "data" }), null);
  assert.equal(parseRpcTransportFrame({ ...identity, zcode_type: "rpc-frame" }), null);
});

test("encode 超限拒绝（空消息 / 超 16MiB / 超 64 分片不可能）", () => {
  assert.throws(
    () =>
      encodeRpcTransportMessage({
        message: new Uint8Array(0),
        identity,
        firstPhysicalSeq: 0,
        messageSeq: 1,
      }),
    /emptyMessage/,
  );
  assert.throws(
    () =>
      encodeRpcTransportMessage({
        message: new Uint8Array(RPC_FRAME_MAX_MESSAGE_BYTES + 1),
        identity,
        firstPhysicalSeq: 0,
        messageSeq: 1,
      }),
    /messageTooLarge/,
  );
});

test("buildRpcFrameAck 线格式", () => {
  assert.deepEqual(buildRpcFrameAck({ identity, ackMessageSeq: 9 }), {
    zcode_type: "rpc-frame-ack",
    bridgeSessionId: "b-1",
    bridgeGeneration: 2,
    recoveryId: "r-1",
    ackMessageSeq: 9,
  });
});

// —— 发送侧重放缓冲（官方 AcknowledgedRelayProtocol 簿记） ——

function frameFor(messageSeq: number): Parameters<RelayReplayBuffer["reserve"]>[2] {
  const { frames } = encodeRpcTransportMessage({
    message: new Uint8Array([1, 2, 3]),
    identity,
    firstPhysicalSeq: 0,
    messageSeq,
  });
  return frames;
}

test("重放缓冲：reserve/ack 水位与饱和边沿", () => {
  const buffer = new RelayReplayBuffer({
    highWaterMarkBytes: 100,
    lowWaterMarkBytes: 40,
    maxBytes: 1000,
    graceMs: 5000,
    now: () => 1000,
  });
  assert.equal(buffer.reserve(1, 60, frameFor(1)).saturated, false);
  const second = buffer.reserve(2, 60, frameFor(2));
  // 120 > 100 → 饱和沿。
  assert.equal(second.saturated, true);
  // 缓冲超限：拒收。
  const overflow = buffer.reserve(3, 1000, frameFor(3));
  assert.equal(overflow.overflow, true);
  assert.equal(RELAY_REPLAY_DEGRADED_BUFFER_EXCEEDED, "remote.rpcFrame.replayBufferExceeded");
  // ack(2)：释放 120 字节 → 0 ≤ 40 → drained。
  const acked = buffer.ack(2);
  assert.equal(acked.releasedBytes, 120);
  assert.equal(acked.drained, true);
  // 落后/重复 ack 无操作。
  assert.equal(buffer.ack(2).releasedBytes, 0);
  // future-ack。
  assert.equal(buffer.ack(9).futureAck, true);
  assert.equal(RELAY_REPLAY_DEGRADED_FUTURE_ACK, "remote.rpcFrame.futureAck");
});

test("重放缓冲：grace 超时与重放帧", () => {
  let now = 1000;
  const buffer = new RelayReplayBuffer({ graceMs: 5000, now: () => now });
  buffer.reserve(1, 10, frameFor(1));
  now = 4000;
  buffer.reserve(2, 10, frameFor(2));
  assert.equal(buffer.graceExceeded(6000), false);
  assert.equal(buffer.graceExceeded(6001), true);
  assert.equal(buffer.oldestQueuedAt(), 1000);
  const replayed = buffer.replayFrames();
  assert.equal(replayed.length, 2);
  assert.equal(replayed[0]!.messageSeq, 1);
  assert.equal(buffer.ack(1).releasedBytes, 10);
  assert.equal(buffer.oldestQueuedAt(), 4000);
  assert.equal(buffer.graceExceeded(6001), false);
  assert.equal(RELAY_REPLAY_DEGRADED_ENVELOPE_TOO_LARGE, "remote.rpcFrame.envelopeTooLarge");
});
