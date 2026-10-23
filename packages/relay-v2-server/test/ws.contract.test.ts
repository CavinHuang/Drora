// L0 契约一致性 · WS 组（specs/relay-v2-server.md §5.2/§6.4/§6.5/§10，行为逐条对照可执行
// 参照 packages/shared/test/fixtures/fake-relay-v2.ts:181-302 的升级与消息状态机分支）。
// 场景：升级 401 全分支（缺失/未知/过期/复用）、auth 矩阵（未认证 query/data、重复认证、
// 非法 JSON/字段、跨用户 SID、已删 SID、二进制帧、毫秒 client_ts）、配对全流程
// （auth_ack 形状含 device_sid 回显、terminal_sid 公式含 terminal 查询得空串反例、
// 推送 ack terminal_sid 恒空、双向透传 + server_ts 秒级）、KICKED 顺序与 stale close
// 防护、断连通知两分支、无对端 data INTERNAL 不关闭。服务端消息先过 shared 入站解析器。

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { parseWebRemoteControlRelayV2IncomingMessage } from "@drora/shared/web-remote-relay";
import {
  api,
  authAndAck,
  closeStartedRelays,
  createTokenStoreForTest,
  expectUpgradeUnauthorized,
  expectUnixSeconds,
  issueToken,
  JWT_ALICE,
  JWT_BOB,
  messages,
  openClient,
  PATHS,
  registerDevice,
  startRelay,
  type RelayClient,
} from "./helpers.js";

afterEach(closeStartedRelays);

/** 轮询到「最后一条事件是 close」，随后断言消息序列 */
async function awaitClosed(client: RelayClient): Promise<void> {
  await expect
    .poll(() => client.events.at(-1)?.kind, { timeout: 2_000, interval: 20 })
    .toBe("close");
}

describe("WS 组：升级鉴权（spec §5.2 规则 1/2）", () => {
  it("升级 401：token 缺失", async () => {
    const relay = await startRelay();
    await expectUpgradeUnauthorized(relay.wsUrl);
  });

  it("升级 401：未知 token", async () => {
    const relay = await startRelay();
    await expectUpgradeUnauthorized(`${relay.wsUrl}?token=not-a-token`);
  });

  it("升级 401：错误路径（入口只认 ws2）", async () => {
    const relay = await startRelay();
    const token = await issueToken(relay, "device");
    await expectUpgradeUnauthorized(
      `ws://127.0.0.1:${relay.port}/api/v1/remote/ws1?token=${token}`,
    );
  });

  it("升级 401：token 已消费（复用被拒，原连接不受影响）", async () => {
    const relay = await startRelay();
    const token = await issueToken(relay, "device");
    const first = await openClient(relay, token); // 升级即原子消费
    await expectUpgradeUnauthorized(`${relay.wsUrl}?token=${encodeURIComponent(token)}`);
    expect(first.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("升级 401：token 过期；过期不影响已建立的连接", async () => {
    let nowMs = 1_700_000_000_000;
    const relay = await startRelay({ tokens: createTokenStoreForTest(() => nowMs) });
    const { sid } = await registerDevice(relay, "machine");
    const used = await issueToken(relay, "device");
    const client = await openClient(relay, used);
    client.send({ type: "auth_init", device_sid: sid });
    await expect
      .poll(() => messages(client).some((message) => message.type === "auth_ack"), {
        timeout: 2_000,
      })
      .toBe(true);

    const unused = await issueToken(relay, "terminal");
    nowMs += 61_000; // 越过 60 秒有效期
    await expectUpgradeUnauthorized(`${relay.wsUrl}?token=${encodeURIComponent(unused)}`);
    await expectUpgradeUnauthorized(`${relay.wsUrl}?token=${encodeURIComponent(used)}`);

    // 契约：过期不影响已建立的连接
    client.send({ type: "pair_status_query", client_ts: 1_700_000_005 });
    await expect
      .poll(() => messages(client).at(-1)?.type, { timeout: 2_000 })
      .toBe("pair_status_ack");
  });
});

describe("WS 组：auth 矩阵（spec §5.2 消息规则）", () => {
  it.each([
    {
      name: "未认证 pair_status_query",
      message: { type: "pair_status_query", client_ts: 1_700_000_000 },
    },
    { name: "未认证 data", message: { type: "data", payload: "before-auth" } },
  ])("$name → AUTH_FAILED + 关闭", async ({ message }) => {
    const relay = await startRelay();
    const client = await openClient(relay, await issueToken(relay, "terminal"));
    client.send(message);
    await awaitClosed(client);
    expect(messages(client)).toEqual([
      { type: "error", code: "AUTH_FAILED", server_ts: expect.any(Number) },
    ]);
  });

  it.each([
    {
      name: "重复 auth_init",
      act: (client: RelayClient, sid: string) =>
        client.send({ type: "auth_init", device_sid: sid }),
    },
    {
      name: "非法 JSON 文本帧",
      act: (client: RelayClient) => client.sendRaw("{not-json"),
    },
    {
      name: "auth_init 携带未声明 role 字段",
      act: (client: RelayClient, sid: string) =>
        client.send({ type: "auth_init", device_sid: sid, role: "device" }),
    },
    {
      name: "data 缺 payload",
      act: (client: RelayClient) => client.send({ type: "data", client_ts: 1_700_000_000 }),
    },
    {
      name: "client_ts 为毫秒值",
      act: (client: RelayClient) =>
        client.send({ type: "pair_status_query", client_ts: 1_700_000_000_000 }),
    },
    {
      name: "二进制帧",
      act: (client: RelayClient) => client.sendBinary(Buffer.from("binary-bytes")),
    },
  ])("已认证连接：$name → WRONG_PARAM + 关闭", async ({ act }) => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const client = await authAndAck(relay, sid, "device");
    act(client, sid);
    await awaitClosed(client);
    expect(messages(client).at(-1)).toMatchObject({ type: "error", code: "WRONG_PARAM" });
  });

  it("跨用户 SID → AUTH_FAILED + 关闭，原连接不受影响", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine", JWT_ALICE);
    const device = await authAndAck(relay, sid, "device", JWT_ALICE);
    const foreign = await openClient(relay, await issueToken(relay, "terminal", JWT_BOB));
    foreign.send({ type: "auth_init", device_sid: sid });
    await awaitClosed(foreign);
    expect(messages(foreign)).toEqual([
      { type: "error", code: "AUTH_FAILED", server_ts: expect.any(Number) },
    ]);
    await device.pingBarrier();
    expect(device.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("不存在的 SID → AUTH_FAILED + 关闭", async () => {
    const relay = await startRelay();
    const client = await openClient(relay, await issueToken(relay, "device"));
    client.send({ type: "auth_init", device_sid: "d_does-not-exist" });
    await awaitClosed(client);
    expect(messages(client)).toEqual([
      { type: "error", code: "AUTH_FAILED", server_ts: expect.any(Number) },
    ]);
  });

  it("已删除的 SID（换新 token）→ AUTH_FAILED + 关闭", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const deleted = await api(relay, PATHS.delete.path, {
      body: { device_sid: sid },
      jwt: JWT_ALICE,
    });
    expect(deleted.status).toBe(200);
    const client = await openClient(relay, await issueToken(relay, "terminal"));
    client.send({ type: "auth_init", device_sid: sid });
    await awaitClosed(client);
    expect(messages(client).at(-1)).toMatchObject({ type: "error", code: "AUTH_FAILED" });
  });
});

describe("WS 组：配对全流程（spec §5.2/§6.6）", () => {
  it("auth_ack 形状含 device_sid 回显、terminal_sid 公式、推送恒空、双向透传 + server_ts 秒级", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");

    // device 认证：auth_ack 回显 device_sid，terminal_sid 恒空，未配对 waiting
    const device = await authAndAck(relay, sid, "device");
    const deviceAck = messages(device)[0];
    expect(deviceAck).toEqual({
      type: "auth_ack",
      device_sid: sid,
      terminal_sid: "",
      pair_status: "waiting",
      server_ts: expect.any(Number),
    });
    expect(parseWebRemoteControlRelayV2IncomingMessage(deviceAck)).not.toBeNull();
    expectUnixSeconds(deviceAck.server_ts);

    // terminal 认证：分配 t_ SID、matched；device_sid 同样回显
    const terminal = await authAndAck(relay, sid, "terminal");
    const terminalAck = messages(terminal)[0];
    expect(terminalAck).toEqual({
      type: "auth_ack",
      device_sid: sid,
      terminal_sid: expect.stringMatching(/^t_[0-9a-f-]{36}$/),
      pair_status: "matched",
      server_ts: expect.any(Number),
    });
    expect(parseWebRemoteControlRelayV2IncomingMessage(terminalAck)).not.toBeNull();
    const terminalSid = terminalAck.terminal_sid as string;

    // 推送语义 pair_status_ack（配对成功）：matched 且 terminal_sid 恒空
    await expect
      .poll(() => messages(device).some((message) => message.type === "pair_status_ack"), {
        timeout: 2_000,
      })
      .toBe(true);
    expect(messages(device)[1]).toEqual({
      type: "pair_status_ack",
      pair_status: "matched",
      terminal_sid: "",
      server_ts: expect.any(Number),
    });

    // 查询语义：device 查询得到对端 terminal 的 SID
    device.send({ type: "pair_status_query", client_ts: 1_700_000_005 });
    await expect
      .poll(
        () => messages(device).at(-1)?.type === "pair_status_ack" && messages(device).length >= 3,
        {
          timeout: 2_000,
        },
      )
      .toBe(true);
    expect(messages(device).at(-1)).toEqual({
      type: "pair_status_ack",
      pair_status: "matched",
      terminal_sid: terminalSid,
      server_ts: expect.any(Number),
    });

    // 反例：terminal 查询时对端是 device，terminal_sid 得空串（不回显自己的 SID）
    terminal.send({ type: "pair_status_query", client_ts: 1_700_000_006 });
    await expect
      .poll(() => messages(terminal).at(-1)?.type, { timeout: 2_000 })
      .toBe("pair_status_ack");
    expect(messages(terminal).at(-1)).toEqual({
      type: "pair_status_ack",
      pair_status: "matched",
      terminal_sid: "",
      server_ts: expect.any(Number),
    });

    // 列表实时 join：online + auth_init 上报的 meta
    const list = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
    expect((list.body as { data: Array<Record<string, unknown>> }).data[0]).toMatchObject({
      device_sid: sid,
      online: true,
      meta: { name: "device" },
    });

    // 双向透传：payload 原样（嵌套对象/中文不改写），server_ts 为 Unix 秒
    const payload = { user_id: "opaque", nested: [1, null, "中文"], request_id: "r-1" };
    terminal.send({ type: "data", payload, client_ts: 1_700_000_007 });
    await expect.poll(() => messages(device).at(-1)?.type, { timeout: 2_000 }).toBe("data");
    expect(messages(device).at(-1)).toEqual({
      type: "data",
      payload,
      server_ts: expect.any(Number),
    });
    expect(parseWebRemoteControlRelayV2IncomingMessage(messages(device).at(-1))).not.toBeNull();
    expectUnixSeconds(messages(device).at(-1)?.server_ts);

    device.send({ type: "data", payload: "reply", client_ts: 1_700_000_008 });
    await expect.poll(() => messages(terminal).at(-1)?.type, { timeout: 2_000 }).toBe("data");
    expect(messages(terminal).at(-1)).toEqual({
      type: "data",
      payload: "reply",
      server_ts: expect.any(Number),
    });
    expectUnixSeconds(messages(terminal).at(-1)?.server_ts);
  });

  it("无对端 data → INTERNAL 且连接保持打开；对端接入后通路恢复", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");

    device.send({ type: "data", payload: "lonely" });
    await expect
      .poll(
        () =>
          messages(device).some(
            (message) => message.type === "error" && message.code === "INTERNAL",
          ),
        { timeout: 2_000 },
      )
      .toBe(true);
    // 官方语义：INTERNAL 可恢复，不关闭连接
    await device.pingBarrier();
    expect(device.ws.readyState).toBe(WebSocket.OPEN);

    const terminal = await authAndAck(relay, sid, "terminal");
    device.send({ type: "data", payload: "after-pair" });
    await expect.poll(() => messages(terminal).at(-1)?.type, { timeout: 2_000 }).toBe("data");
    expect(messages(terminal).at(-1)).toMatchObject({ type: "data", payload: "after-pair" });
  });
});

describe("WS 组：同角色替换与断连通知（spec §6.4/§6.5）", () => {
  it.each(["device", "terminal"] as const)(
    "同角色替换（%s）：KICKED 先于 close，stale close 不清掉新 owner",
    async (role) => {
      const relay = await startRelay();
      const { sid } = await registerDevice(relay, "machine");
      const old = await authAndAck(relay, sid, role);
      const other = await authAndAck(relay, sid, role === "device" ? "terminal" : "device");
      // 稳定基线：配对推送发给新连接的对端（即 old），等到它收到 matched 推送再替换
      await expect
        .poll(() => messages(old).some((message) => message.type === "pair_status_ack"), {
          timeout: 2_000,
        })
        .toBe(true);

      const replacement = await authAndAck(relay, sid, role);

      // §6.4 顺序：旧连接先收 error KICKED 消息，后发生 close
      await awaitClosed(old);
      const kickedIndex = old.events.findIndex(
        (event) => event.kind === "message" && event.message.code === "KICKED",
      );
      const closeIndex = old.events.findIndex((event) => event.kind === "close");
      expect(kickedIndex).toBeGreaterThanOrEqual(0);
      expect(closeIndex).toBeGreaterThan(kickedIndex);
      expect(old.events[kickedIndex]).toEqual({
        kind: "message",
        message: { type: "error", code: "KICKED", server_ts: expect.any(Number) },
      });

      // stale close 防护：旧连接迟到的 close 不得移除新 owner——data 继续路由到替换连接
      other.send({ type: "data", payload: "new-owner" });
      await expect
        .poll(
          () =>
            messages(replacement).some(
              (message) => message.type === "data" && message.payload === "new-owner",
            ),
          { timeout: 2_000 },
        )
        .toBe(true);
      await other.pingBarrier();
      expect(other.ws.readyState).toBe(WebSocket.OPEN);
      if (role === "device") {
        // 被替换的是 device：对端不得因旧连接迟到 close 收到 DEVICE_OFFLINE 或 waiting
        expect(
          messages(other).some(
            (message) => message.type === "error" && message.code === "DEVICE_OFFLINE",
          ),
        ).toBe(false);
        expect(
          messages(other).every(
            (message) => message.type !== "pair_status_ack" || message.pair_status === "matched",
          ),
        ).toBe(true);
      }
    },
  );

  it("device 断连：terminal 收 waiting 推送 → DEVICE_OFFLINE → close，列表回离线", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");
    const terminal = await authAndAck(relay, sid, "terminal");
    // 稳定基线：配对推送发给 terminal 的对端（即 device），等到它收到 matched 推送
    await expect
      .poll(() => messages(device).some((message) => message.type === "pair_status_ack"), {
        timeout: 2_000,
      })
      .toBe(true);

    device.ws.close();
    await awaitClosed(terminal);
    const closeIndex = terminal.events.findIndex((event) => event.kind === "close");
    // §6.5 device 断分支：先 waiting 推送，再 DEVICE_OFFLINE，最后 close
    expect(terminal.events.slice(closeIndex - 2, closeIndex)).toEqual([
      {
        kind: "message",
        message: {
          type: "pair_status_ack",
          pair_status: "waiting",
          terminal_sid: "",
          server_ts: expect.any(Number),
        },
      },
      {
        kind: "message",
        message: { type: "error", code: "DEVICE_OFFLINE", server_ts: expect.any(Number) },
      },
    ]);

    const list = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
    expect((list.body as { data: Array<Record<string, unknown>> }).data[0]).toMatchObject({
      online: false,
      meta: {},
    });
  });

  it("terminal 断连：device 仅收 waiting 推送，保持连接继续心跳等待", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");
    const device = await authAndAck(relay, sid, "device");
    const terminal = await authAndAck(relay, sid, "terminal");
    // 稳定基线：等 device 收到 matched 推送
    await expect
      .poll(() => messages(device).some((message) => message.type === "pair_status_ack"), {
        timeout: 2_000,
      })
      .toBe(true);

    terminal.ws.close();
    // 等待 waiting 推送（对端断开的 §6.5 terminal 断分支通知）
    await expect
      .poll(
        () =>
          messages(device).some(
            (message) => message.type === "pair_status_ack" && message.pair_status === "waiting",
          ),
        { timeout: 2_000 },
      )
      .toBe(true);
    const waitingAck = messages(device).find(
      (message) => message.type === "pair_status_ack" && message.pair_status === "waiting",
    );
    expect(waitingAck).toEqual({
      type: "pair_status_ack",
      pair_status: "waiting",
      terminal_sid: "",
      server_ts: expect.any(Number),
    });
    expect(messages(device).some((message) => message.type === "error")).toBe(false);
    // device 保留连接：ping 屏障证明仍 OPEN
    await device.pingBarrier();
    expect(device.ws.readyState).toBe(WebSocket.OPEN);

    // 对端消失后 data：INTERNAL（可恢复语义），连接依旧不关
    device.send({ type: "data", payload: "anyone-there" });
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
});
