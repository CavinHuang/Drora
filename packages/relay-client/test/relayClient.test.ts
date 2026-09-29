// RelayClient 会话语义单测（specs/mobile-relay-r3-frontend.md §2 状态机 + §13 P2a 验收）。
// 方法学：内存假 relay（握手/配对/data 透传/error 注入）+ 手控时钟（ports 注入，
// 不依赖 mock.timers），驱动九态状态机全部超时/宽限/重连路径。桌面侧互操作真链路
// 集成属 P4 真机验收；本文件锚定手机端单侧语义。
import assert from "node:assert/strict";
import test from "node:test";
import {
  RELAY_REPLAY_DEGRADED_ACK_GRACE,
  TRANSPORT_ID_PATTERN,
  computeProof,
  encodeRpcTransportMessage,
} from "@drora/shared";
import { AppFrameChannel, measureAppFrameEnvelope } from "../src/appFrameChannel.js";
import { mapRelayErrorToFailure } from "../src/errorMapping.js";
import { RelayClient, createRelayClient } from "../src/index.js";
import { RpcFrameChannel } from "../src/rpcFrameChannel.js";
import { RelaySession } from "../src/relaySession.js";
import type { RelayClockPort, RelayTimerHandle } from "../src/ports.js";
import type { RelayFailure } from "../src/types.js";

// —— 手控时钟 ——

class FakeClock implements RelayClockPort {
  nowValue = 1_000_000;
  private seq = 0;
  private readonly jobs = new Map<
    number,
    { at: number; handler: () => void; handle: RelayTimerHandle }
  >();

  now(): number {
    return this.nowValue;
  }

  setTimeout(handler: () => void, timeoutMs: number): RelayTimerHandle {
    const id = ++this.seq;
    const handle: RelayTimerHandle = { id };
    this.jobs.set(id, { at: this.nowValue + timeoutMs, handler, handle });
    return handle;
  }

  clearTimeout(handle: RelayTimerHandle): void {
    this.jobs.delete(handle.id);
  }

  /** 推进时间并按到期顺序执行（handler 内新增的定时器停在队列，不递归推进）。 */
  advance(ms: number): void {
    const target = this.nowValue + ms;
    for (;;) {
      const due = [...this.jobs.values()]
        .filter((job) => job.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.jobs.delete(due.handle.id);
      this.nowValue = Math.max(this.nowValue, due.at);
      due.handler();
    }
    this.nowValue = target;
  }
}

// —— 假 relay：终端视角的线协议对端 ——

interface SentFrame {
  frame: Record<string, unknown>;
  raw: string;
}

class FakeRelay {
  events:
    | {
        onOpen(): void;
        onText(text: string): void;
        onClose(info: { code: number; reason: string; wasClean: boolean }): void;
        onError(message: string): void;
      }
    | undefined;
  sent: SentFrame[] = [];
  open = false;
  /**
   * 自动应答模式（真实服务端行为：每条 pair_status_query 必应答，terminal 应答附
   * terminal_sid:""，relayServer handlePairStatusQuery @393-396）。null = 不自动应答。
   */
  autoPairStatus: "waiting" | "matched" | null = null;
  private nonceCount = 0;

  factory(): (request: { url: string; events: NonNullable<FakeRelay["events"]> }) => unknown {
    return (request) => {
      this.events = request.events;
      return {
        connect: () => {
          this.open = true;
          this.events?.onOpen();
        },
        sendText: (text: string) => {
          const frame = JSON.parse(text) as Record<string, unknown>;
          this.sent.push({ raw: text, frame });
          // 每 query 必答（服务端语义）：乒乓与否由客户端是否继续发 query 决定。
          if (frame.type === "pair_status_query" && this.autoPairStatus) {
            this.pairAck(this.autoPairStatus);
          }
        },
        isOpen: () => this.open,
        close: () => {
          if (!this.open) return;
          this.open = false;
          this.events?.onClose({ code: 1000, reason: "", wasClean: true });
        },
      };
    };
  }

  last(): SentFrame {
    return this.sent[this.sent.length - 1]!;
  }

  /** 终端发出的全部 pair_status_query（乒乓断言用）。 */
  queries(): SentFrame[] {
    return this.sent.filter((entry) => entry.frame.type === "pair_status_query");
  }

  /** 服务端 → 终端：challenge。 */
  challenge(): void {
    this.nonceCount += 1;
    this.events?.onText(
      JSON.stringify({ type: "auth_challenge", nonce: `nonce-${this.nonceCount}` }),
    );
  }

  ack(pairStatus: "waiting" | "matched"): void {
    this.events?.onText(
      JSON.stringify({
        type: "auth_ack",
        pair_status: pairStatus,
        device_sid: "d_test",
        terminal_sid: "t_test",
      }),
    );
  }

  /** pair_status_ack（服务端 terminal 应答形状：terminal_sid:""）。 */
  pairAck(pairStatus: "waiting" | "matched"): void {
    this.events?.onText(
      JSON.stringify({ type: "pair_status_ack", pair_status: pairStatus, terminal_sid: "" }),
    );
  }

  error(code: string, message = ""): void {
    this.events?.onText(JSON.stringify({ type: "error", code, message }));
  }

  /** data 应用帧下发（信封盖 server_ts，桌面出站同款）。 */
  pushPayload(payload: Record<string, unknown>): void {
    this.events?.onText(JSON.stringify({ type: "data", payload, client_ts: 1, server_ts: 2 }));
  }
}

interface Harness {
  clock: FakeClock;
  relay: FakeRelay;
  session: RelaySession;
  failures: RelayFailure[];
  generations: number[];
  resendReady: number[];
}

function makeSession(overrides?: {
  timings?: Partial<ConstructorParameters<typeof RelaySession>[0]["timings"]>;
}): Harness {
  const clock = new FakeClock();
  const relay = new FakeRelay();
  const failures: RelayFailure[] = [];
  const generations: number[] = [];
  const resendReady: number[] = [];
  const session = new RelaySession({
    url: "ws://relay.test/ws",
    credential: { deviceSid: "d_test", passHash: "pass-hash" },
    transportFactory: relay.factory() as never,
    clock,
    random: () => 0,
    timings: overrides?.timings,
    onFailure: (failure) => failures.push(failure),
    onPaired: (info) => generations.push(info.generation),
  });
  session.onResendReady = (generation) => resendReady.push(generation);
  return { clock, relay, session, failures, generations, resendReady };
}

/** 驱动到 paired（challenge → proof → ack matched）。challenge 后 flush 微任务。 */
async function pairUp(
  harness: Harness,
  pairStatus: "waiting" | "matched" = "matched",
): Promise<void> {
  harness.session.connect();
  harness.relay.challenge();
  await Promise.resolve();
  await Promise.resolve();
  if (pairStatus === "matched") {
    harness.relay.ack("matched");
  } else {
    harness.relay.ack("waiting");
  }
  await Promise.resolve();
}

// —— 错误码映射 ——

test("错误码映射：KICKED/DEVICE_OFFLINE/AUTH_FAILED/WRONG_PARAM；未知码→relay-unavailable", () => {
  assert.equal(mapRelayErrorToFailure("KICKED"), "session-conflict");
  assert.equal(mapRelayErrorToFailure("DEVICE_OFFLINE"), "desktop-disconnected");
  assert.equal(mapRelayErrorToFailure("AUTH_FAILED"), "invalid-mobile-connection");
  assert.equal(mapRelayErrorToFailure("WRONG_PARAM"), "invalid-mobile-connection");
  // P1-5①：官方 default 分支 = relay-unavailable。INTERNAL 在会话层先行拦截
  //（迁回 waiting / 立即重连），函数级默认同样归 relay-unavailable 面。
  assert.equal(mapRelayErrorToFailure("INTERNAL"), "relay-unavailable");
  assert.equal(mapRelayErrorToFailure("RELAY_MAINTENANCE"), "relay-unavailable");
});

// —— 握手与配对 ——

test("握手：auth_init → challenge → proof（shared 单一出处）→ matched → paired + 心跳", async () => {
  const harness = makeSession({ timings: { heartbeatIntervalMs: 10_000 } });
  const { relay, session, clock, failures, generations } = harness;
  session.connect();
  assert.equal(relay.last().frame.type, "auth_init");
  assert.equal(relay.last().frame.role, "terminal");
  relay.challenge();
  await Promise.resolve();
  await Promise.resolve();
  // 心跳尚未开始：最后一条即 proof 响应。
  assert.equal(relay.last().frame.type, "auth_response");
  const challengeNonce = "nonce-1";
  assert.equal(
    relay.last().frame.proof,
    computeProof({
      passHash: "pass-hash",
      nonce: challengeNonce,
      role: "terminal",
      deviceSid: "d_test",
    }),
  );
  relay.ack("matched");
  assert.equal(session.state, "paired");
  assert.deepEqual(generations, [1]);
  const before = relay.sent.length;
  clock.advance(10_000);
  assert.equal(relay.sent[before]!.frame.type, "pair_status_query");
  assert.equal(failures.length, 0);
  session.disconnect();
  assert.equal(session.state, "idle");
});

test("P0 waiting 乒乓：waiting 期间 query 有界（停心跳），重复 waiting ack 不刷新配对窗", async () => {
  const harness = makeSession();
  const { relay, session, clock, failures } = harness;
  relay.autoPairStatus = "waiting"; // 服务端每 query 必答形态
  await pairUp(harness, "waiting");
  assert.equal(session.state, "waiting");
  // 官方 waiting 分支 stopHeartbeat：等待窗内两个心跳周期都不应再发 query（无乒乓）。
  clock.advance(20_000);
  assert.equal(relay.queries().length, 0);
  // 重复 waiting ack（服务端重复推送形态）：不清配对窗、不重启心跳、不重挂配对窗。
  relay.pairAck("waiting");
  relay.pairAck("waiting");
  assert.equal(session.state, "waiting");
  clock.advance(9_999);
  assert.equal(failures.length, 0);
  // 进入 waiting 后 30s 整：配对窗只挂一次，仍按期触发终态。
  clock.advance(1);
  assert.equal(failures[0]?.reason, "invalid-mobile-connection");
  assert.equal(session.state, "error");
  assert.equal(relay.queries().length, 0);
});

test("waiting 配对窗：30s 超时 → invalid-mobile-connection 终态；matched 及时可配对", async () => {
  // 超时路径。
  const timeout = makeSession();
  await pairUp(timeout, "waiting");
  assert.equal(timeout.session.state, "waiting");
  timeout.clock.advance(30_000);
  assert.equal(timeout.failures[0]?.reason, "invalid-mobile-connection");
  assert.equal(timeout.session.state, "error");

  // 及时配对路径（四步卡第 3 步 → 第 4 步；服务端 attach 推送 matched）。
  const timely = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(timely, "waiting");
  timely.relay.pairAck("matched");
  assert.equal(timely.session.state, "paired");
  assert.deepEqual(timely.generations, [1]);
});

// —— P2-2 paired→waiting ——

test("P2-2 paired→waiting：停心跳迁回 waiting + 重挂配对窗，matched 回归再配对", async () => {
  const harness = makeSession({ timings: { heartbeatIntervalMs: 10_000 } });
  const { relay, session, clock, failures, generations, resendReady } = harness;
  await pairUp(harness);
  assert.equal(session.state, "paired");
  const queriesWhilePaired = relay.queries().length;
  assert.ok(queriesWhilePaired >= 1);
  // 桌面离开：paired 态收 waiting ack → 迁回 waiting（桌面 applyPairStatus 分支语义）。
  relay.pairAck("waiting");
  assert.equal(session.state, "waiting");
  // 迁回后心跳停：一个心跳周期内无新 query。
  clock.advance(10_000);
  assert.equal(relay.queries().length, queriesWhilePaired);
  // 服务端 matched 推送（relay-server attach.statusChanged）→ 再配对 + 重放沿。
  relay.pairAck("matched");
  assert.equal(session.state, "paired");
  assert.deepEqual(generations, [1, 2]);
  assert.deepEqual(resendReady, [2]);
  // 再度 paired→waiting：配对窗重挂，30s 超时终态。
  relay.pairAck("waiting");
  assert.equal(session.state, "waiting");
  clock.advance(30_000);
  assert.equal(failures[0]?.reason, "invalid-mobile-connection");
  assert.equal(session.state, "error");
});

// —— 终态与宽限 ——

test("KICKED：终态 session-conflict，不再心跳/重连", async () => {
  const harness = makeSession();
  await pairUp(harness);
  harness.relay.error("KICKED", "taken over");
  assert.equal(harness.session.state, "kicked");
  assert.equal(harness.failures[0]?.reason, "session-conflict");
  const sentCount = harness.relay.sent.length;
  harness.clock.advance(120_000);
  assert.equal(harness.relay.sent.length, sentCount);
});

test("P1-5① 未知错误码：relay-unavailable 终态，不再重连", async () => {
  const harness = makeSession();
  await pairUp(harness);
  harness.relay.error("RELAY_MAINTENANCE", "server restarting");
  assert.equal(harness.failures[0]?.reason, "relay-unavailable");
  assert.equal(harness.session.state, "error");
  const sentCount = harness.relay.sent.length;
  harness.clock.advance(60_000);
  assert.equal(harness.relay.sent.length, sentCount);
});

test("P1-5② 从未配对断开：relay-unavailable 终态，不再无限重连", () => {
  const harness = makeSession();
  harness.session.connect();
  assert.equal(harness.session.state, "authenticating");
  harness.relay.events?.onClose({ code: 1006, reason: "network", wasClean: false });
  assert.equal(harness.failures[0]?.reason, "relay-unavailable");
  assert.equal(harness.session.state, "error");
  const sentCount = harness.relay.sent.length;
  harness.clock.advance(60_000);
  assert.equal(harness.relay.sent.length, sentCount); // 无重连握手
});

test("P1-5③ INTERNAL：paired 迁回 waiting 可回归；非 paired 立即重连", async () => {
  // paired 路径：迁回 waiting（不落失败卡），matched 回归再配对。
  const paired = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(paired);
  paired.relay.error("INTERNAL", "server hiccup");
  assert.equal(paired.session.state, "waiting");
  assert.equal(paired.failures.length, 0);
  paired.relay.pairAck("matched");
  assert.equal(paired.session.state, "paired");

  // 非 paired 路径：立即走重连（recoverFromRelayInternal）。
  const fresh = makeSession();
  fresh.session.connect();
  fresh.relay.error("INTERNAL");
  assert.equal(fresh.session.state, "reconnecting");
  fresh.clock.advance(500);
  assert.equal(fresh.session.state, "authenticating");
  assert.equal(fresh.failures.length, 0);
});

test("DEVICE_OFFLINE 宽限：matched 回归撤销，超时才终态 desktop-disconnected", async () => {
  // 回归撤销路径。
  const recovered = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(recovered);
  recovered.relay.error("DEVICE_OFFLINE");
  assert.equal(recovered.session.state, "paired");
  recovered.relay.pairAck("matched");
  recovered.clock.advance(20_000);
  assert.equal(recovered.failures.length, 0);

  // 超时终态路径。
  const expired = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(expired);
  expired.relay.error("DEVICE_OFFLINE");
  expired.clock.advance(15_000);
  assert.equal(expired.failures[0]?.reason, "desktop-disconnected");
  assert.equal(expired.session.state, "error");
});

// —— 重连与重放 ——

test("断线重连：退避 500ms 首试，重配对触发 onResendReady", async () => {
  const harness = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(harness);
  assert.deepEqual(harness.generations, [1]);
  harness.relay.events?.onClose({ code: 1006, reason: "gone", wasClean: false });
  assert.equal(harness.session.state, "reconnecting");
  harness.clock.advance(500);
  assert.equal(harness.session.state, "authenticating");
  harness.relay.challenge();
  harness.relay.ack("matched");
  assert.deepEqual(harness.generations, [1, 2]);
  assert.deepEqual(harness.resendReady, [2]);
  assert.equal(harness.session.state, "paired");
});

test("P2-3 suspended 恢复：3s 健康检查断开重连；15s 未回归终态；matched 即清两定时器", async () => {
  // 3s 快路径：到点仍挂起 → 主动断开 → 重连握手（官方 reconnectNow 语义）。
  const fast = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(fast);
  fast.session.notifyHidden();
  assert.equal(fast.session.state, "suspended");
  fast.session.notifyVisible();
  assert.equal(fast.relay.last().frame.type, "pair_status_query");
  fast.clock.advance(3_000);
  assert.equal(fast.session.state, "reconnecting");
  fast.clock.advance(500);
  assert.equal(fast.session.state, "authenticating");
  assert.equal(fast.relay.last().frame.type, "auth_init");

  // matched 回归：恢复窗（15s）与健康检查（3s）一并解除，不再终态。
  const matched = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(matched);
  matched.session.notifyHidden();
  matched.session.notifyVisible();
  matched.relay.pairAck("matched");
  assert.equal(matched.session.state, "paired");
  matched.clock.advance(30_000);
  assert.equal(matched.failures.length, 0);

  // 15s 截止跨重连存活：健康检查断开 + 重连后桌面仍未回归 → connection-recovery-timeout。
  const slow = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  await pairUp(slow);
  slow.session.notifyHidden();
  slow.session.notifyVisible();
  slow.clock.advance(3_000); // 健康检查断开
  slow.clock.advance(500); // 重连 → authenticating
  slow.relay.challenge();
  slow.relay.ack("waiting");
  assert.equal(slow.session.state, "waiting");
  slow.clock.advance(11_500); // notifyVisible 后 15s 整
  assert.equal(slow.failures[0]?.reason, "connection-recovery-timeout");
  assert.equal(slow.session.state, "error");
});

test("心跳 ack 看门狗：30s 无 ack 强制断开重连", async () => {
  const harness = makeSession({ timings: { heartbeatIntervalMs: 10_000 } });
  await pairUp(harness);
  harness.clock.advance(10_000);
  harness.clock.advance(30_000);
  // 看门狗触发强制断开 → 退避 500ms 内自动重开（同一时间窗内已推进到新一代握手）。
  assert.equal(harness.session.state, "authenticating");
  assert.equal(harness.relay.last().frame.type, "auth_init");
});

test("鉴权监督：challenge/ack 迟到 → 10s 重开连接（自发关闭不走从未配对终态）", () => {
  const harness = makeSession({ timings: { heartbeatIntervalMs: 60_000 } });
  harness.session.connect();
  assert.equal(harness.session.state, "authenticating");
  harness.clock.advance(10_000);
  assert.equal(harness.session.state, "reconnecting");
});

// —— AppFrameChannel ——

test("AppFrameChannel：oversize 拒收 + requestId 关联 + 超时 null", async () => {
  const sent: string[] = [];
  const channel = new AppFrameChannel({ now: () => 1000, sendText: (t) => sent.push(t) });
  assert.equal(channel.send({ zcode_type: "x", blob: "y".repeat(1024 * 1024) }).kind, "oversize");
  const ok = channel.send({ zcode_type: "mobile-diagnostic" });
  assert.equal(ok.kind, "sent");
  assert.ok(measureAppFrameEnvelope({ a: 1 }, 5) > 0);

  const timers: Array<() => void> = [];
  const { requestId, response } = channel.request(
    { zcode_type: "bootstrap-request" },
    5000,
    (handler) => {
      timers.push(handler);
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
  );
  assert.match(requestId, /^mc_/);
  channel.acceptIncoming({
    zcode_type: "bootstrap-response",
    requestId,
    success: true,
    result: {},
  });
  const resolved = await response;
  assert.equal((resolved as { success?: boolean } | null)?.success, true);

  // 超时路径：响应未达 → null。
  const timeoutResponse = channel.request({ zcode_type: "bootstrap-request" }, 5000, (handler) => {
    handler();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }).response;
  assert.equal(await timeoutResponse, null);
});

// —— RpcFrameChannel ——

interface BridgeHarness {
  bridge: RpcFrameChannel;
  appFrames: Record<string, unknown>[];
  messages: Uint8Array[];
  degraded: string[];
  saturation: boolean[];
}

function makeBridge(): BridgeHarness {
  const appFrames: Record<string, unknown>[] = [];
  const messages: Uint8Array[] = [];
  const degraded: string[] = [];
  const saturation: boolean[] = [];
  const bridge = new RpcFrameChannel(
    {
      identity: { bridgeSessionId: "b1" },
      sendAppFrame: (payload) => appFrames.push(payload),
      measureEnvelopeBytes: (payload) => measureAppFrameEnvelope(payload, 0),
      now: () => 1000,
    },
    {
      onDegraded: (reason) => degraded.push(reason),
      onSaturationChange: (saturated) => saturation.push(saturated),
    },
  );
  bridge.onMessage = (message) => messages.push(message);
  return { bridge, appFrames, messages, degraded, saturation };
}

test("RpcFrameChannel：发送 → ack 释放水位；future-ack 终态降级", () => {
  const { bridge, appFrames, degraded } = makeBridge();
  assert.equal(bridge.send(new TextEncoder().encode("hello")), true);
  assert.equal(appFrames.length, 1);
  assert.equal(appFrames[0]!.zcode_type, "rpc-frame");
  assert.equal(typeof appFrames[0]!.dataBase64, "string");
  assert.ok(bridge.unacknowledgedBytes > 0);
  bridge.acceptAck({ ackMessageSeq: 1 });
  assert.equal(bridge.unacknowledgedBytes, 0);
  assert.equal(bridge.send(new TextEncoder().encode("second")), true);
  bridge.acceptAck({ ackMessageSeq: 9 });
  assert.match(degraded[0] ?? "", /futureAck/);
  assert.ok(bridge.degraded);
  assert.equal(bridge.send(new TextEncoder().encode("third")), false);
});

test("RpcFrameChannel：入站重组 + 自动回 ack + 完整消息上抛", () => {
  const { bridge, appFrames, messages } = makeBridge();
  const payload = new TextEncoder().encode(JSON.stringify({ inner: "v4" }));
  const { frames } = encodeRpcTransportMessage({
    message: payload,
    identity: { bridgeSessionId: "b1" },
    firstPhysicalSeq: 0,
    messageSeq: 1,
  });
  bridge.acceptFrame(frames[0] as unknown as Record<string, unknown>);
  assert.equal(messages.length, 1);
  assert.ok(Buffer.from(messages[0]!).equals(payload));
  const ack = appFrames[appFrames.length - 1]!;
  assert.equal(ack.zcode_type, "rpc-frame-ack");
  assert.equal(ack.ackMessageSeq, 1);
});

test("RpcFrameChannel：grace 超时判定与重放缓冲", () => {
  const { bridge } = makeBridge();
  assert.equal(bridge.oldestQueuedAt(), null);
  bridge.send(new TextEncoder().encode("x"));
  assert.ok(bridge.oldestQueuedAt() !== null);
  assert.equal(bridge.graceExceeded(1000 + bridge.graceMs + 1), true);
  assert.equal(bridge.replayUnacknowledged(), 1);
});

test("RpcFrameChannel：多分片消息记账 = 全部物理帧信封字节之和（desktop :777 同式）", () => {
  const { bridge, appFrames } = makeBridge();
  // >640KiB 单分片预算 → 2 个物理帧。
  const big = new TextEncoder().encode("x".repeat(640 * 1024 + 1024));
  assert.equal(bridge.send(big), true);
  assert.equal(appFrames.length, 2);
  const expectedSum = appFrames.reduce(
    (sum, frame) => sum + measureAppFrameEnvelope(frame as Record<string, unknown>, 0),
    0,
  );
  assert.ok(expectedSum > 640 * 1024);
  // P1-3：unacknowledgedBytes 记两帧之和，不再取单帧最大值。
  assert.equal(bridge.unacknowledgedBytes, expectedSum);
  bridge.acceptAck({ ackMessageSeq: 1 });
  assert.equal(bridge.unacknowledgedBytes, 0);
});

test("RpcFrameChannel：degradeAckGrace 公开降级面（宿主看门狗触发入口）", () => {
  const { bridge, degraded } = makeBridge();
  assert.equal(bridge.degraded, null);
  bridge.degradeAckGrace();
  assert.equal(bridge.degraded, RELAY_REPLAY_DEGRADED_ACK_GRACE);
  assert.deepEqual(degraded, [RELAY_REPLAY_DEGRADED_ACK_GRACE]);
  assert.equal(bridge.send(new TextEncoder().encode("after")), false);
});

// —— RelayClient 端到端（假 relay 桥接面） ——

interface ClientHarness {
  clock: FakeClock;
  relay: FakeRelay;
  client: RelayClient;
  failures: RelayFailure[];
}

function makeClient(overrides?: { heartbeatAckTimeoutMs?: number }): ClientHarness {
  const clock = new FakeClock();
  const relay = new FakeRelay();
  const failures: RelayFailure[] = [];
  const client = createRelayClient({
    url: "ws://relay.test/ws",
    credential: { deviceSid: "d_test", passHash: "pass-hash" },
    transportFactory: relay.factory() as never,
    clock,
    random: () => 0,
    timings: {
      heartbeatIntervalMs: 60_000,
      ...(overrides?.heartbeatAckTimeoutMs
        ? { heartbeatAckTimeoutMs: overrides.heartbeatAckTimeoutMs }
        : {}),
    },
    onFailure: (failure) => failures.push(failure),
    // 桥通道时钟与会话时钟同一手控实例：grace 看门狗/重放时间戳全部可推进。
    bridgeClock: clock,
  });
  return { clock, relay, client, failures };
}

/** workspace-bridge-ready 回声（桌面 openWorkspaceBridge 原样回显请求 identity）。 */
function respondBridgeReady(harness: ClientHarness, openReq: SentFrame): void {
  const payload = openReq.frame.payload;
  harness.relay.pushPayload({
    zcode_type: "workspace-bridge-ready",
    requestId: payload.requestId,
    bridgeSessionId: payload.bridgeSessionId,
    bridgeGeneration: payload.bridgeGeneration,
    workspaceKey: "/w",
    workspacePath: "/w",
    kind: "local",
  });
}

/** 驱动 client 到 paired 并开好桥（ready 回声 = 请求生成的 bridgeSessionId）。 */
async function pairAndOpenBridge(harness: ClientHarness): Promise<RpcFrameChannel> {
  harness.client.connect();
  harness.relay.challenge();
  harness.relay.ack("matched");
  await harness.client.whenPaired();
  const bridgePromise = harness.client.openWorkspaceBridge({ workspaceKey: "/w" });
  await Promise.resolve();
  const openReq = harness.relay.last();
  assert.equal(openReq.frame.payload.zcode_type, "workspace-bridge-open");
  respondBridgeReady(harness, openReq);
  return bridgePromise;
}

test("P1-4 openWorkspaceBridge：客户端生成 bridgeSessionId 与自增 bridgeGeneration", async () => {
  const harness = makeClient();
  harness.client.connect();
  harness.relay.challenge();
  harness.relay.ack("matched");
  await harness.client.whenPaired();

  const open1 = harness.client.openWorkspaceBridge({ workspaceKey: "/w" });
  await Promise.resolve();
  const req1 = harness.relay.last();
  assert.equal(req1.frame.payload.zcode_type, "workspace-bridge-open");
  const id1 = String(req1.frame.payload.bridgeSessionId);
  assert.match(id1, /^bridge-/);
  assert.ok(TRANSPORT_ID_PATTERN.test(id1), `生成的 id 须匹配 TRANSPORT_ID_PATTERN: ${id1}`);
  assert.equal(req1.frame.payload.bridgeGeneration, 1);
  respondBridgeReady(harness, req1);
  const bridge1 = await open1;
  assert.equal(bridge1.identity.bridgeSessionId, id1);
  assert.equal(bridge1.identity.bridgeGeneration, 1);

  // 第二次 open：新 id + 代数自增。
  const open2 = harness.client.openWorkspaceBridge({ workspaceKey: "/w" });
  await Promise.resolve();
  const req2 = harness.relay.last();
  const id2 = String(req2.frame.payload.bridgeSessionId);
  assert.notEqual(id2, id1);
  assert.ok(TRANSPORT_ID_PATTERN.test(id2));
  assert.equal(req2.frame.payload.bridgeGeneration, 2);
  respondBridgeReady(harness, req2);
  const bridge2 = await open2;
  assert.equal(bridge2.identity.bridgeSessionId, id2);
  assert.equal(bridge2.identity.bridgeGeneration, 2);
  harness.client.disconnect();
});

test("P1-2 ackGrace 看门狗：45s 未确认降级并上抛 onBridgeDegraded", async () => {
  const harness = makeClient({ heartbeatAckTimeoutMs: 600_000 });
  const degradedReasons: string[] = [];
  harness.client.onBridgeDegraded = (bridgeSessionId, reasonCode) =>
    degradedReasons.push(`${bridgeSessionId}:${reasonCode}`);
  const bridge = await pairAndOpenBridge(harness);
  assert.equal(bridge.send(new TextEncoder().encode("unacked")), true);
  assert.equal(bridge.degraded, null);
  // graceMs 缺省 45s（RELAY_REPLAY_BUFFER_GRACE_MS）：45s+1ms 判定边界后复核成立。
  harness.clock.advance(45_001);
  assert.equal(bridge.degraded, RELAY_REPLAY_DEGRADED_ACK_GRACE);
  assert.deepEqual(degradedReasons, [
    `${bridge.identity.bridgeSessionId}:${RELAY_REPLAY_DEGRADED_ACK_GRACE}`,
  ]);
  assert.equal(bridge.send(new TextEncoder().encode("after-degraded")), false);
  harness.client.disconnect();
});

test("P1-2 ackGrace 看门狗：ack 排空解除；再次发送重新挂载", async () => {
  const harness = makeClient({ heartbeatAckTimeoutMs: 600_000 });
  const degradedReasons: string[] = [];
  harness.client.onBridgeDegraded = (_bridgeSessionId, reasonCode) =>
    degradedReasons.push(reasonCode);
  const bridge = await pairAndOpenBridge(harness);
  assert.equal(bridge.send(new TextEncoder().encode("m1")), true);
  bridge.acceptAck({ ackMessageSeq: 1 });
  assert.equal(bridge.unacknowledgedBytes, 0);
  // 排空后无未确认批次：看门狗解除，60s 内不降级。
  harness.clock.advance(60_000);
  assert.equal(bridge.degraded, null);
  assert.deepEqual(degradedReasons, []);
  // 再次发送：看门狗重新挂载，45s+1ms 后降级。
  assert.equal(bridge.send(new TextEncoder().encode("m2")), true);
  harness.clock.advance(45_001);
  assert.equal(bridge.degraded, RELAY_REPLAY_DEGRADED_ACK_GRACE);
  assert.deepEqual(degradedReasons, [RELAY_REPLAY_DEGRADED_ACK_GRACE]);
  harness.client.disconnect();
});

test("RelayClient：bootstrap 关联响应；桥 open→ready→rpc 双向", async () => {
  const harness = makeClient();
  harness.client.connect();
  harness.relay.challenge();
  harness.relay.ack("matched");
  await harness.client.whenPaired();

  // bootstrap 请求-响应（requestId 回声）。
  const bootstrapPromise = harness.client.bootstrap(5000);
  await Promise.resolve();
  const bootstrapReq = harness.relay.last();
  assert.equal(bootstrapReq.frame.payload.zcode_type, "bootstrap-request");
  harness.relay.pushPayload({
    zcode_type: "bootstrap-response",
    requestId: bootstrapReq.frame.payload.requestId,
    success: true,
    result: { workspaces: [], tasks: [] },
  });
  const bootstrap = await bootstrapPromise;
  const bootstrapResult = bootstrap?.result as { workspaces?: unknown[] } | null;
  assert.equal(bootstrapResult?.workspaces?.length, 0);

  // 桥（客户端生成 id，桌面原样回显注册）。
  const bridge = await pairAndOpenBridge(harness);
  const bridgeId = bridge.identity.bridgeSessionId;
  assert.match(bridgeId, /^bridge-/);

  // 桥内消息：client → 桌面（rpc-frame 物理帧上线，带生成 bridgeSessionId）。
  const receivedByDesktop: Uint8Array[] = [];
  harness.client.onBridgeMessage = (_id, message) => receivedByDesktop.push(message);
  assert.equal(bridge.send(new TextEncoder().encode('{"cmd":"subscribe"}')), true);
  const physical = harness.relay.last();
  assert.equal(physical.frame.payload.zcode_type, "rpc-frame");
  assert.equal(physical.frame.payload.bridgeSessionId, bridgeId);

  // 桌面 → client（shared 编码器 = 桌面同源实现；桌面按 open 请求 identity 原样
  // 回显 bridgeGeneration，组包器按 identity 严格匹配）。
  const down = encodeRpcTransportMessage({
    message: new TextEncoder().encode('{"event":"row"}'),
    identity: {
      bridgeSessionId: bridgeId,
      ...(bridge.identity.bridgeGeneration !== undefined
        ? { bridgeGeneration: bridge.identity.bridgeGeneration }
        : {}),
    },
    firstPhysicalSeq: 0,
    messageSeq: 1,
  });
  const countBefore = receivedByDesktop.length;
  for (const frame of down.frames) {
    harness.relay.pushPayload(frame as unknown as Record<string, unknown>);
  }
  await Promise.resolve();
  assert.equal(receivedByDesktop.length, countBefore + 1);
  // 桌面应收到我方对下行消息的 ack。
  const ackFrame = harness.relay.sent
    .filter((f) => f.frame.payload?.zcode_type === "rpc-frame-ack")
    .pop();
  assert.equal(ackFrame?.frame.payload.ackMessageSeq, 1);

  // 桥销毁后 rpc-frame 静默丢弃。
  harness.client.releaseBridge(bridgeId);
  const countAfter = receivedByDesktop.length;
  for (const frame of down.frames) {
    harness.relay.pushPayload(frame as unknown as Record<string, unknown>);
  }
  await Promise.resolve();
  assert.equal(receivedByDesktop.length, countAfter);
  assert.equal(harness.failures.length, 0);
  harness.client.disconnect();
});

test("重连后 onSendReady：未确认 rpc 帧全量重放（官方 applyPairStatus 语义）", async () => {
  const harness = makeClient();
  const bridge = await pairAndOpenBridge(harness);
  bridge.send(new TextEncoder().encode("pending-message"));
  const before = harness.relay.sent.length;
  harness.relay.events?.onClose({ code: 1006, reason: "", wasClean: false });
  harness.clock.advance(500);
  harness.relay.challenge();
  harness.relay.ack("matched");
  await harness.client.whenPaired();
  const replayed = harness.relay.sent
    .slice(before)
    .filter((frame) => frame.frame.payload?.zcode_type === "rpc-frame");
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0]!.frame.payload.messageSeq, 1);
  harness.client.disconnect();
});
