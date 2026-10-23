// L0 契约一致性 · 生产行为组（specs/relay-v2-server.md §5.3/§7/§9/§10——fake relay 明确
// 不模拟、自建必须补齐的部分）。场景：AUTH_TIMEOUT 直接关闭、IDLE_TIMEOUT 后 pair_status
// 回 waiting 且设备可删（防 3005 钉死）、1 MiB 硬闸（入站硬断 + 出站预算丢弃回 INTERNAL——
// 评审 outbound-frame-budget）、慢连接背压断连（评审 ws-backpressure）、优雅停机 INTERNAL→close、
// 停机死线真实墙钟（评审 shutdown-wallclock）、upgrade 与 stop 竞态（评审 upgrade-stop-race）、
// GC 批量删除事务原子性（评审 gc-tx-index）、重启后 SID 保留（持久 DB 文件）、
// /healthz 字段派生。超时场景把 AUTH/IDLE_TIMEOUT_MS 配小。

import { createServer } from "node:http";
import { once } from "node:events";
import { connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { createSqliteDeviceStore } from "../src/devices.js";
import { createRelayLogger } from "../src/logger.js";
import { createPairingRegistry } from "../src/pairing.js";
import { createTokenStore } from "../src/tokens.js";
import { createPairingRegistryEvents, createWsGateway } from "../src/ws.js";
import type { RelayConfig } from "../src/config.js";
import type { RelayTrafficView } from "../src/types.js";
import {
  api,
  authAndAck,
  closeStartedRelays,
  issueToken,
  JWT_ALICE,
  messages,
  openClient,
  PATHS,
  registerDevice,
  startRelay,
  tempDbPath,
} from "./helpers.js";

afterEach(closeStartedRelays);

const zeroCounters = (): RelayTrafficView => ({
  device: { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 },
  terminal: { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 },
});

interface HealthView {
  uptime: number;
  connections: number;
  owners: number;
  devices: number;
  counters: RelayTrafficView;
}

async function health(relay: Awaited<ReturnType<typeof startRelay>>): Promise<HealthView> {
  const result = await api(relay, "/healthz");
  expect(result.status).toBe(200);
  return result.body as HealthView;
}

describe("生产行为组：认证超时 / idle 检测（spec §5.3）", () => {
  it("AUTH_TIMEOUT：时限内未 auth_init → 直接关闭且不发任何错误消息", async () => {
    const relay = await startRelay({ authTimeoutMs: 150 });
    const client = await openClient(relay, await issueToken(relay, "device"));
    const code = await client.closed;
    // 直接关闭：无 error 消息；无关闭握手（terminate 表现为异常关闭码而非 1000）
    expect(messages(client)).toEqual([]);
    expect(code).not.toBe(1000);
  });

  // idle 阈值取 1s：给并行 worker 下的双端配对留足余量，同时保持用例秒级完成
  it(
    "IDLE_TIMEOUT：matched → device 静默超限清 owner → pair_status 回 waiting 且设备可删",
    { timeout: 15_000 },
    async () => {
      const relay = await startRelay({ idleTimeoutMs: 1_000 });
      const { sid } = await registerDevice(relay, "machine");
      const device = await authAndAck(relay, sid, "device");
      const terminal = await authAndAck(relay, sid, "terminal");

      // 反差基线：在线时删除被 3005 拒绝（历史故障：半开连接把状态钉死在 matched）
      const onlineDelete = await api(relay, PATHS.delete.path, {
        body: { device_sid: sid },
        jwt: JWT_ALICE,
      });
      expect(onlineDelete.status).toBe(400);
      expect(onlineDelete.body).toEqual({ code: 3005, msg: "wrong status" });

      // device 静默触发 idle；terminal 持续心跳保持自身活跃并观察 pair_status 变化
      const heartbeat = setInterval(() => {
        if (terminal.ws.readyState === WebSocket.OPEN) {
          terminal.send({ type: "pair_status_query", client_ts: 1_700_000_010 });
        }
      }, 100);
      try {
        // device idle 关闭 → §6.5 device 断分支推到 terminal
        await expect
          .poll(() => device.events.some((event) => event.kind === "close"), {
            timeout: 3_000,
            interval: 25,
          })
          .toBe(true);
        await expect
          .poll(() => terminal.events.some((event) => event.kind === "close"), {
            timeout: 3_000,
            interval: 25,
          })
          .toBe(true);
        expect(
          messages(terminal).some(
            (message) => message.type === "pair_status_ack" && message.pair_status === "waiting",
          ),
        ).toBe(true);
        expect(
          messages(terminal).some(
            (message) => message.type === "error" && message.code === "DEVICE_OFFLINE",
          ),
        ).toBe(true);
      } finally {
        clearInterval(heartbeat);
      }

      // 防 3005 钉死：owner 清理后列表回离线、设备可删
      await expect
        .poll(
          async () => {
            const list = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
            return (list.body as { data: Array<{ online: boolean }> }).data[0]?.online;
          },
          { timeout: 2_000, interval: 25 },
        )
        .toBe(false);
      const deleted = await api(relay, PATHS.delete.path, {
        body: { device_sid: sid },
        jwt: JWT_ALICE,
      });
      expect(deleted.status).toBe(200);
      expect(deleted.body).toEqual({ code: 0, msg: "" });
    },
  );
});

describe("生产行为组：1 MiB 硬闸（spec §3/§5.2 规则 3）", () => {
  it("超限帧被拒（硬断 close 1006），owner 随 close 清理、服务继续可用", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");

    device.sendRaw(JSON.stringify({ type: "data", payload: "x".repeat(1_048_576) }));
    // maxPayload 超限是硬断：与可执行参照 fake relay 的探针对照，两端客户端观测一致
    // 均为 close 1006（服务端超限中止、不发关闭帧），且此前无任何业务消息
    expect(await device.closed).toBe(1006);
    // 超限中止前无任何其他业务消息（auth_ack 之外的 INTERNAL/错误都不该出现）
    expect(messages(device).every((message) => message.type === "auth_ack")).toBe(true);

    // close → release：设备回离线（无钉死 owner），同 SID 可重新认证
    await expect
      .poll(
        async () => {
          const list = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
          return (list.body as { data: Array<{ online: boolean }> }).data[0]?.online;
        },
        { timeout: 2_000, interval: 25 },
      )
      .toBe(false);
    const reconnected = await authAndAck(relay, sid, "device");
    expect(messages(reconnected)[0]).toMatchObject({ type: "auth_ack", pair_status: "waiting" });

    // 服务整体不受影响：健康检查与新 token 签发照常
    expect((await health(relay)).devices).toBe(1);
    expect(await issueToken(relay, "terminal")).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("恰好不超限的帧正常透传（硬闸是 1 MiB 而非更小）", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");
    // JSON 外层 ~30 字节，payload 控制在 1 MiB 之内：整体必须 < 1_048_576
    const payload = "y".repeat(1_000_000);
    device.sendRaw(JSON.stringify({ type: "data", payload }));
    // 无对端 → INTERNAL（不关闭）：证明帧本身通过了硬闸并进入业务处理
    await expect
      .poll(
        () =>
          messages(device).some(
            (message) => message.type === "error" && message.code === "INTERNAL",
          ),
        { timeout: 2_000 },
      )
      .toBe(true);
    await device.pingBarrier();
    expect(device.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("出站预算与入站硬闸对称：入站贴线帧因出站信封超 1MiB → 丢帧并回 INTERNAL，不关闭（评审 outbound-frame-budget）", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");
    const terminal = await authAndAck(relay, sid, "terminal");
    await expect
      .poll(() => messages(device).some((message) => message.type === "pair_status_ack"), {
        timeout: 2_000,
      })
      .toBe(true);

    // 入站帧 = payload + 28 字节信封（无 client_ts）= 1_048_568 ≤ 1MiB 硬闸，可进业务；
    // 出站追加 `,"server_ts":<10位>`（+23 字节）= 1_048_591 > 1MiB 预算 → 该帧丢弃
    const payload = "x".repeat(1_048_540);
    device.send({ type: "data", payload });

    // 发送方收 error INTERNAL（可恢复语义），连接保持打开
    await expect
      .poll(
        () =>
          messages(device).some(
            (message) => message.type === "error" && message.code === "INTERNAL",
          ),
        { timeout: 2_000 },
      )
      .toBe(true);
    await device.pingBarrier();
    expect(device.ws.readyState).toBe(WebSocket.OPEN);
    // 接收方未收到被丢弃的帧
    expect(messages(terminal).some((message) => message.type === "data")).toBe(false);

    // 正常尺寸帧继续透传：预算丢弃是逐帧行为，不是断连
    device.send({ type: "data", payload: "small-after-drop" });
    await expect
      .poll(
        () => messages(terminal).some((message) => message.payload === "small-after-drop"),
        { timeout: 2_000 },
      )
      .toBe(true);
  });
});

describe("生产行为组：慢连接背压（评审 ws-backpressure）", () => {
  it("对端 socket 暂停后泵帧：超高水位的慢连接被服务端断开，服务仍存活可服务", { timeout: 20_000 }, async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");
    const terminal = await authAndAck(relay, sid, "terminal");
    await expect
      .poll(() => messages(device).some((message) => message.type === "pair_status_ack"), {
        timeout: 2_000,
      })
      .toBe(true);

    // 暂停 device 底层 socket：对端停读 → 服务端 socket 写缓冲（bufferedAmount）无界增长
    // （ws 无公开访问器，测试借私有 _socket 触发与运行时评审实验同款场景）
    const deviceSocket = (device.ws as unknown as { _socket: import("node:net").Socket })._socket;
    deviceSocket.pause();
    try {
      // 泵 ~9.6MB（200×48KB）>> 4MiB 高水位：内核接收缓冲先吸收若干百 KB，余量保证触发
      const frame = "z".repeat(48 * 1024);
      for (let i = 0; i < 200 && terminal.ws.readyState === WebSocket.OPEN; i += 1) {
        terminal.send({ type: "data", payload: frame });
      }

      // 慢连接被服务端 terminate：等价一次普通断连（非 1000 正常关闭码）
      deviceSocket.resume(); // 放开读侧让客户端能观察到断开
      expect(await device.closed).not.toBe(1000);
    } finally {
      deviceSocket.destroy();
    }

    // device 断开按 §6.5 清 owner：terminal 收 DEVICE_OFFLINE 关闭，连接集合出清
    await expect
      .poll(async () => (await health(relay)).connections, { timeout: 3_000, interval: 50 })
      .toBe(0);
    // 服务端仍存活可服务：healthz 正常、新 token 签发与设备重连照常
    expect((await health(relay)).devices).toBe(1);
    const reconnected = await authAndAck(relay, sid, "device");
    expect(messages(reconnected)[0]).toMatchObject({ type: "auth_ack", pair_status: "waiting" });
  });
});

describe("生产行为组：优雅停机与持久化（spec §5.3/§7）", () => {
  it("停机：存活连接先收 error INTERNAL 后关闭；持久 DB 重启后 SID 保留、已删 SID 仍不存在", async () => {
    const dbPath = await tempDbPath();
    const first = await startRelay({ dbPath });
    const kept = await registerDevice(first, "machine-a");
    const dropped = await registerDevice(first, "machine-b");
    const removeDropped = await api(first, PATHS.delete.path, {
      body: { device_sid: dropped.sid },
      jwt: JWT_ALICE,
    });
    expect(removeDropped.status).toBe(200);
    const device = await authAndAck(first, kept.sid, "device");

    await first.handle.stop();

    // §5.3 顺序：error INTERNAL 之后发生 close（客户端按可恢复错误退避重连）
    const closeIndex = device.events.findIndex((event) => event.kind === "close");
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(device.events[closeIndex - 1]).toEqual({
      kind: "message",
      message: { type: "error", code: "INTERNAL", server_ts: expect.any(Number) },
    });

    // 重启同一 DB 文件：设备与 SID 保留（含 created_at），已删 SID 不复活
    const second = await startRelay({ dbPath });
    const list = await api(second, PATHS.list.path, { jwt: JWT_ALICE });
    const rows = (
      list.body as { data: Array<{ device_sid: string; created_at: number; device_mid: string }> }
    ).data;
    expect(rows.map((row) => row.device_sid)).toEqual([kept.sid]);
    expect(rows[0]).toMatchObject({ device_mid: "machine-a", created_at: kept.createdAt });

    // 旧 SID 可重新认证（桌面已存 {deviceSid, userId, endpointOrigin} 继续有效）
    const reconnected = await authAndAck(second, kept.sid, "device");
    expect(messages(reconnected)[0]).toMatchObject({ type: "auth_ack", pair_status: "waiting" });

    // §10 追加④「双端退避重连全链路」：terminal 端同样重连，配对恢复 matched 且
    // data 通路贯通（重启后旧 owner 全清，双端重新配对到可传输状态）
    const terminal = await authAndAck(second, kept.sid, "terminal");
    expect(messages(terminal)[0]).toMatchObject({
      type: "auth_ack",
      pair_status: "matched",
      terminal_sid: expect.any(String),
    });
    reconnected.send({ type: "data", payload: "after-restart" });
    await expect
      .poll(
        () =>
          messages(terminal).some(
            (message) => message.type === "data" && message.payload === "after-restart",
          ),
        { timeout: 2_000, interval: 25 },
      )
      .toBe(true);

    const ghost = await openClient(second, await issueToken(second, "terminal"));
    ghost.send({ type: "auth_init", device_sid: dropped.sid });
    await expect
      .poll(() => ghost.events.at(-1)?.kind, { timeout: 2_000, interval: 20 })
      .toBe("close");
    expect(messages(ghost).at(-1)).toMatchObject({ type: "error", code: "AUTH_FAILED" });
  });

  it("停机死线用真实墙钟：虚拟时钟冻结下对静默连接 stop 仍能在宽限后完成（评审 shutdown-wallclock）", { timeout: 20_000 }, async () => {
    // 恒定时钟注入：旧实现（死线用注入 now）下 now() < deadline 恒真，flush 循环永不退出
    const relay = await startRelay({
      now: () => 1_700_000_000_000,
      authTimeoutMs: 60_000, // 隔离变量：认证超时不得在测试窗口内替停机收走连接
    });
    const token = await issueToken(relay, "device");
    // 原始 socket 完成升级后保持静默：不回关闭握手，逼停机走满 5s 宽限强制 terminate 路径
    const socket = connect(relay.port, "127.0.0.1");
    socket.write(
      `GET ${"/api/v1/remote/ws2"}?token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
        "Host: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
    );
    await once(socket, "data"); // 101 响应：升级回调已同步完成、连接已入集合

    const startedAt = Date.now();
    await relay.handle.stop();
    const elapsed = Date.now() - startedAt;
    // 宽限 5s + 轮询粒度余量：冻结时钟下旧实现会挂起至用例超时
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(15_000);
    socket.destroy();
  });

  it("upgrade 与 stop 竞态：token 消费后、连接入集合前停机 → 复查分支回 INTERNAL + close，不漏停机通知（评审 upgrade-stop-race）", { timeout: 15_000 }, async () => {
    // 手工装配最小网关：注入的 TokenStore 在第二次 consume 内同步触发 stop——精确复现
    // 「外层停机检查已过、upgrade 回调把连接加入集合前 stop 已扫完连接集合」的竞态窗口。
    // 先留一条已建立连接：stop 的 flush 等待使其尚未走到 wsServer.close（否则 ws 库自身的
    // CLOSING 状态会先回 HTTP 503，网关升级回调根本不执行）。
    const logger = createRelayLogger({ level: "error", trace: false, write: () => {} });
    const realTokens = createTokenStore();
    const config: RelayConfig = {
      bindHost: "127.0.0.1",
      listenPort: 0,
      dbPath: ":memory:",
      jwtMode: "decode",
      jwtIdClaims: ["sub", "id"],
      jwtRealmMode: "iss",
      authTimeoutMs: 15_000,
      idleTimeoutMs: 120_000,
      deviceTtlDays: 180,
      corsEnabled: false,
      logLevel: "error",
      msgTrace: false,
    };
    const devices = createSqliteDeviceStore({ dbPath: ":memory:" });
    const registry = createPairingRegistry(
      createPairingRegistryEvents({ logger, now: Date.now }),
    );
    let gatewayRef: ReturnType<typeof createWsGateway> | undefined;
    let stopPromise: Promise<void> | undefined;
    let consumeCount = 0;
    const tokens = {
      issue: (userId: string, role: "device" | "terminal") => realTokens.issue(userId, role),
      consume: (token: string) => {
        const identity = realTokens.consume(token);
        consumeCount += 1;
        if (consumeCount === 2 && identity !== undefined && gatewayRef !== undefined) {
          stopPromise = gatewayRef.stop();
        }
        return identity;
      },
    };
    const gateway = createWsGateway({ config, logger, tokens, devices, registry });
    gatewayRef = gateway;

    const server = createServer();
    server.on("upgrade", (request, socket, head) => gateway.handleUpgrade(request, socket, head));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const wsUrl = (token: string): string =>
      `ws://127.0.0.1:${port}/api/v1/remote/ws2?token=${encodeURIComponent(token)}`;

    const openWithEvents = async (): Promise<{
      events: Array<Record<string, unknown>>;
      closed: Promise<number>;
      ws: WebSocket;
    }> => {
      const events: Array<Record<string, unknown>> = [];
      let resolveClosed!: (code: number) => void;
      const closed = new Promise<number>((resolve) => {
        resolveClosed = resolve;
      });
      const ws = new WebSocket(wsUrl(realTokens.issue("alice", "device").token));
      ws.on("error", () => {});
      ws.on("message", (data) =>
        events.push(JSON.parse(data.toString()) as Record<string, unknown>),
      );
      ws.on("close", (code) => resolveClosed(code));
      await once(ws, "open");
      return { events, closed, ws };
    };

    // 第一条连接先建立（第 1 次 consume，不触发停机）
    const existing = await openWithEvents();

    // 竞态连接（不 await open）：其升级在 consume（第 2 次）内同步触发 stop，
    // ws 的升级回调执行时 shuttingDown 已翻转、连接集合扫描已完成
    const racedEvents: Array<Record<string, unknown>> = [];
    let resolveRacedClosed!: (code: number) => void;
    const racedClosed = new Promise<number>((resolve) => {
      resolveRacedClosed = resolve;
    });
    const racedWs = new WebSocket(wsUrl(realTokens.issue("alice", "device").token));
    racedWs.on("error", () => {});
    racedWs.on("message", (data) =>
      racedEvents.push(JSON.parse(data.toString()) as Record<string, unknown>),
    );
    racedWs.on("close", (code) => resolveRacedClosed(code));

    // 复查分支生效：竞态连接收到 INTERNAL 后才 close（等价停机语义，非裸断开）
    expect(await racedClosed).not.toBe(1000);
    expect(racedEvents).toEqual([
      { type: "error", code: "INTERNAL", server_ts: expect.any(Number) },
    ]);
    // 既有连接走正常停机路径：INTERNAL 在前
    expect(await existing.closed).not.toBe(1000);
    expect(existing.events[0]).toMatchObject({ type: "error", code: "INTERNAL" });
    // stop 正常完成：竞态连接由复查分支收尾，flush/terminate 阶段无悬挂
    expect(stopPromise).toBeDefined();
    await stopPromise;

    existing.ws.terminate();
    racedWs.terminate();
    server.close();
    devices.close();
  });
});

describe("生产行为组：设备备份（spec §7）", () => {
  it("backupDevices：VACUUM INTO 快照可独立 reopen 且行集一致；目标已存在报错且源库不受影响", async () => {
    const dbPath = await tempDbPath();
    const relay = await startRelay({ dbPath });
    const first = await registerDevice(relay, "machine-a");
    const second = await registerDevice(relay, "machine-b");

    // spec §7 前提：文件库以 WAL 运行（运行中直接 cp 会撕裂的原因）
    const probe = new DatabaseSync(dbPath);
    try {
      expect(probe.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    } finally {
      probe.close();
    }

    const backupPath = `${dbPath}.backup.sqlite`;
    relay.handle.backupDevices(backupPath);

    // 验收（spec §7 备份）：备份文件可独立打开，行集与源库一致
    const snapshot = new DatabaseSync(backupPath);
    try {
      const rows = snapshot
        .prepare("SELECT device_sid, device_mid, created_at FROM devices ORDER BY device_sid")
        .all() as Array<{ device_sid: string; device_mid: string; created_at: number }>;
      expect(rows.map((row) => row.device_sid).sort()).toEqual([first.sid, second.sid].sort());
      expect(
        rows.every((row) => row.device_mid === "machine-a" || row.device_mid === "machine-b"),
      ).toBe(true);
    } finally {
      snapshot.close();
    }

    // VACUUM INTO 目标必须不存在（SQLite 语义）：重复备份到同路径报错，服务不受影响
    expect(() => relay.handle.backupDevices(backupPath)).toThrow();
    const list = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
    expect(list.status).toBe(200);
  });

  it("注入的 DeviceStore 未提供 backup 能力 → backupDevices 抛错不伪造成功（spec §7）", async () => {
    const relay = await startRelay({
      devices: {
        register: (_userId, deviceMid) => ({
          deviceSid: "d_injected",
          deviceMid,
          userId: _userId,
          createdAt: 0,
        }),
        get: () => undefined,
        listByUser: () => [],
        delete: () => {},
        collectExpired: () => 0,
      },
    });
    expect(() => relay.handle.backupDevices("/tmp/whatever.sqlite")).toThrow(/backup/);
  });
});

describe("生产行为组：设备 GC（spec §7）", () => {
  const DAY_MS = 86_400_000;
  const TTL_DAYS = 180;

  /** 可对时挂钟：注入 createRelayServer 后 token/created_at/GC cutoff 共用同一条时间线 */
  function createClock(startMs: number): {
    now: () => number;
    advanceDays: (days: number) => void;
  } {
    let nowMs = startMs;
    return {
      now: () => nowMs,
      advanceDays: (days) => {
        nowMs += days * DAY_MS;
      },
    };
  }

  async function listSids(relay: Awaited<ReturnType<typeof startRelay>>): Promise<string[]> {
    const result = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
    expect(result.status).toBe(200);
    return (result.body as { data: Array<{ device_sid: string }> }).data.map(
      (row) => row.device_sid,
    );
  }

  it("每日 GC：早于 DEVICE_TTL_DAYS 且离线的行被删除，删除数与 cutoff 记结构化日志", async () => {
    const startMs = 1_700_000_000_000;
    const clock = createClock(startMs);
    const logLines: string[] = [];
    const logger = createRelayLogger({
      level: "info",
      trace: false,
      scope: "relay-v2",
      write: (line) => logLines.push(line),
    });
    // gcIntervalMs 配小观察真实 tick；生产缺省 24h（spec §7 每日一次）
    const relay = await startRelay({ logger, now: clock.now, gcIntervalMs: 25 });
    await registerDevice(relay, "machine-a");
    await registerDevice(relay, "machine-b");
    clock.advanceDays(TTL_DAYS + 1);

    // 两行均超 TTL 且离线 → 下一轮 tick 全部删除
    await expect.poll(() => listSids(relay), { timeout: 2_000, interval: 25 }).toEqual([]);
    // advance 前的 tick 不会误删（cutoff 未越过 created_at）：删除恰好发生在 advance 之后的一轮
    const cutoffSeconds = Math.floor(clock.now() / 1000) - TTL_DAYS * 86_400;
    const gcLogs = logLines.flatMap((line) => {
      const parsed = JSON.parse(line) as {
        msg?: string;
        removed?: number;
        cutoff_seconds?: number;
      };
      return parsed.msg === "device-gc" ? [parsed] : [];
    });
    expect(
      gcLogs.some((entry) => entry.removed === 2 && entry.cutoff_seconds === cutoffSeconds),
    ).toBe(true);
  });

  it("GC 触发时在线行跳过、下轮（离线后）再删：同轮 tick 删离线留在线", async () => {
    const startMs = 1_700_000_000_000;
    const clock = createClock(startMs);
    const relay = await startRelay({ now: clock.now, gcIntervalMs: 25 });
    const online = await registerDevice(relay, "machine-online");
    await registerDevice(relay, "machine-offline");
    const device = await authAndAck(relay, online.sid, "device");
    clock.advanceDays(TTL_DAYS + 1);

    // 同一轮 tick：离线行删除、在线行跳过（离线行消失证明 tick 已发生，在线行存活证明跳过生效）
    await expect
      .poll(() => listSids(relay), { timeout: 2_000, interval: 25 })
      .toEqual([online.sid]);

    // 设备断开回离线 → 下一轮 tick 补删（spec §7「下轮再试」）
    device.ws.close();
    await expect.poll(() => listSids(relay), { timeout: 2_000, interval: 25 }).toEqual([]);
  });

  it("GC 批量删除包进单事务：中途失败整体回滚不留删一半的中间态，恢复后整批删除（评审 gc-tx-index）", async () => {
    // 直接驱动具体存储：事务语义是 SqliteDeviceStore 实现细节，不经 relay 装配面
    const store = createSqliteDeviceStore({ dbPath: await tempDbPath() });
    try {
      const first = store.register("alice", "machine-a");
      const second = store.register("alice", "machine-b");
      const cutoff = Math.floor(Date.now() / 1000) + 1; // 两行均早于 cutoff
      // 第 1 行放行、第 2 行抛错：逐条 autocommit 的旧实现在此留下删一半的中间态
      const bomb = (deviceSid: string): boolean => {
        if (deviceSid === second.deviceSid) throw new Error("is-online-probe-failed");
        return false;
      };
      expect(() => store.collectExpired(cutoff, bomb)).toThrow("is-online-probe-failed");
      // 回滚：两行都还在
      expect(store.count()).toBe(2);
      expect(store.get(first.deviceSid)).toBeDefined();
      expect(store.get(second.deviceSid)).toBeDefined();
      // 恢复正常后整批删除成功（行为与旧实现等价）
      expect(store.collectExpired(cutoff, () => false)).toBe(2);
      expect(store.count()).toBe(0);
    } finally {
      store.close();
    }
  });
});

describe("生产行为组：/healthz（spec §9）", () => {
  it("uptime/connections/owners/devices/counters 字段随状态派生，且无需鉴权", async () => {
    const relay = await startRelay();
    const initial = await health(relay);
    expect(initial).toEqual({
      uptime: expect.any(Number),
      connections: 0,
      owners: 0,
      devices: 0,
      counters: zeroCounters(),
    });
    expect(initial.uptime).toBeGreaterThanOrEqual(0);

    const first = await registerDevice(relay, "machine-a");
    await registerDevice(relay, "machine-b");
    const device = await authAndAck(relay, first.sid, "device");
    // 认证后 device 侧计数精确为 auth_init(1) 进 / auth_ack(1) 出；terminal 侧仍为零
    await expect
      .poll(() => health(relay), { timeout: 2_000, interval: 50 })
      .toEqual({
        uptime: expect.any(Number),
        connections: 1,
        owners: 1,
        devices: 2,
        counters: {
          device: {
            framesIn: 1,
            bytesIn: expect.any(Number),
            framesOut: 1,
            bytesOut: expect.any(Number),
          },
          terminal: { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 },
        },
      });

    device.ws.close();
    await expect
      .poll(() => health(relay), { timeout: 2_000, interval: 50 })
      .toEqual({
        uptime: expect.any(Number),
        connections: 0,
        owners: 0,
        devices: 2,
        counters: zeroCounters(),
      });
  });

  it("counters 按角色聚合收发计数，连接关闭即出清（spec §4/§9「单向断」诊断面）", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");
    const terminal = await authAndAck(relay, sid, "terminal");
    device.send({ type: "data", payload: "counter-probe" });
    await expect
      .poll(() => messages(terminal).some((message) => message.type === "data"), {
        timeout: 2_000,
        interval: 25,
      })
      .toBe(true);

    const view = await health(relay);
    // device 入站：auth_init + data；出站：auth_ack + 推送 pair_status_ack(matched)
    expect(view.counters.device.framesIn).toBeGreaterThanOrEqual(2);
    expect(view.counters.device.bytesIn).toBeGreaterThan(0);
    expect(view.counters.device.framesOut).toBeGreaterThanOrEqual(2);
    expect(view.counters.device.bytesOut).toBeGreaterThan(0);
    // terminal 入站：auth_init；出站：auth_ack + data 转发
    expect(view.counters.terminal.framesIn).toBeGreaterThanOrEqual(1);
    expect(view.counters.terminal.framesOut).toBeGreaterThanOrEqual(2);

    // 连接期状态（spec §4）：连接关闭 → 聚合出清归零
    device.ws.close();
    terminal.ws.close();
    await expect
      .poll(async () => (await health(relay)).counters, { timeout: 2_000, interval: 50 })
      .toEqual(zeroCounters());
  });
});
