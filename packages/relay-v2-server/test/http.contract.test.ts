// L0 契约一致性 · HTTP 组（specs/relay-v2-server.md §5.1/§10，行为逐条对照可执行参照
// packages/shared/test/fixtures/fake-relay-v2.ts:92-180 的 HTTP 分支）。
// 场景：注册/列表/删除全语义（不存在幂等、异账号 1006、在线 3005、参数 3001）、
// 跨用户隔离、Bearer 鉴权 401 面（含一次性 relay token 不能当 JWT 用）、token 签发
// 形态与 Cache-Control: no-store、CORS 开关、鉴权前置与请求体硬上限（401 前置不消费
// 请求体 / 超限 413 / 上游不可用 503——评审 http-body-limit、auth-three-state）。
// 成功响应先过 shared 契约解析器再断言。

import { afterEach, describe, expect, it } from "vitest";
import { parseWebRemoteControlRelayV2HttpResponse } from "@drora/shared/web-remote-relay";
import {
  api,
  authAndAck,
  closeStartedRelays,
  expectUnixSeconds,
  issueToken,
  JWT_ALICE,
  JWT_BOB,
  PATHS,
  registerDevice,
  startRelay,
  type StartedRelay,
} from "./helpers.js";

afterEach(closeStartedRelays);

/** 注册响应的契约形状：成功信封 + d_ SID + Unix 秒 created_at + online:false + meta:{} */
async function expectRegistered(relay: StartedRelay, deviceMid: string): Promise<string> {
  const result = await api(relay, PATHS.register.path, {
    body: { device_mid: deviceMid },
    jwt: JWT_ALICE,
  });
  expect(result.status).toBe(200);
  const parsed = parseWebRemoteControlRelayV2HttpResponse("register", result.body);
  expect(parsed).toMatchObject({ code: 0, msg: "" });
  expect(result.body).toEqual({
    code: 0,
    msg: "",
    data: {
      device_sid: expect.stringMatching(/^d_[0-9a-f-]{36}$/),
      device_mid: deviceMid,
      created_at: expect.any(Number),
      online: false,
      meta: {},
    },
  });
  const data = (result.body as { data: { device_sid: string; created_at: number } }).data;
  // created_at 是 Unix 秒（评审 createdat-bounds：双界断言——毫秒值必然远超 ±5s 容差，
  // 过旧的时间戳同样拒绝；单侧上界曾放过「未来但小于当前毫秒」形状的漂移）
  expectUnixSeconds(data.created_at);
  return data.device_sid;
}

async function listSids(relay: StartedRelay, jwt: string): Promise<string[]> {
  const result = await api(relay, PATHS.list.path, { jwt });
  expect(result.status).toBe(200);
  expect(parseWebRemoteControlRelayV2HttpResponse("list", result.body)).toMatchObject({ code: 0 });
  return (result.body as { data: Array<{ device_sid: string }> }).data.map(
    (device) => device.device_sid,
  );
}

describe("HTTP 组：设备注册/列表/删除/token（spec §5.1）", () => {
  it("注册：信封、SID 格式、created_at Unix 秒、online:false、meta:{}；shared 契约解析器可通过", async () => {
    const relay = await startRelay();
    const sid = await expectRegistered(relay, "machine-1");
    expect(sid).toMatch(/^d_/);
  });

  it("同 MID 重复注册产生新 SID，两台都在当前账号列表且缺省 offline/meta 空", async () => {
    const relay = await startRelay();
    const first = await registerDevice(relay, "machine");
    const second = await registerDevice(relay, "machine");
    expect(second.sid).not.toBe(first.sid);
    const result = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
    const devices = (result.body as { data: Array<Record<string, unknown>> }).data;
    expect(devices.map((device) => device.device_sid).sort()).toEqual(
      [first.sid, second.sid].sort(),
    );
    for (const device of devices) {
      expect(device.online).toBe(false);
      expect(device.meta).toEqual({});
    }
  });

  it("跨用户隔离：bob 列表恒空，看不到 alice 的注册记录", async () => {
    const relay = await startRelay();
    await registerDevice(relay, "alice-machine", JWT_ALICE);
    await registerDevice(relay, "alice-machine-2", JWT_ALICE);
    const bobList = await api(relay, PATHS.list.path, { jwt: JWT_BOB });
    expect(bobList.status).toBe(200);
    expect(bobList.body).toEqual({ code: 0, msg: "", data: [] });
    expect(await listSids(relay, JWT_ALICE)).toHaveLength(2);
  });

  it("删除全语义：不存在幂等 200 → 异账号 1006 → 在线 3005 → 离线删除后列表消失", async () => {
    const relay = await startRelay();
    const { sid } = await registerDevice(relay, "machine");

    // 不存在：幂等成功，信封无 data（fake relay 同款 {code:0,msg:""}）
    const missing = await api(relay, PATHS.delete.path, {
      body: { device_sid: "d_missing" },
      jwt: JWT_ALICE,
    });
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual({ code: 0, msg: "" });
    expect(parseWebRemoteControlRelayV2HttpResponse("delete", missing.body)).toMatchObject({
      code: 0,
    });

    // 异账号：HTTP 200 + code 1006 + "no permission"，设备保留
    const foreign = await api(relay, PATHS.delete.path, {
      body: { device_sid: sid },
      jwt: JWT_BOB,
    });
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual({ code: 1006, msg: "no permission" });
    expect(await listSids(relay, JWT_ALICE)).toEqual([sid]);

    // 在线：HTTP 400 + code 3005 + "wrong status"
    const device = await authAndAck(relay, sid, "device");
    const online = await api(relay, PATHS.delete.path, {
      body: { device_sid: sid },
      jwt: JWT_ALICE,
    });
    expect(online.status).toBe(400);
    expect(online.body).toEqual({ code: 3005, msg: "wrong status" });
    expect(await listSids(relay, JWT_ALICE)).toEqual([sid]);

    // 断开回离线后：物理删除成功，列表消失
    device.ws.close();
    await expect
      .poll(
        async () => {
          const result = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
          return (result.body as { data: Array<{ online: boolean }> }).data[0]?.online;
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
    expect(await listSids(relay, JWT_ALICE)).toEqual([]);
  });

  it.each([
    { name: "token 未知 role", path: PATHS.token.path, init: { body: { role: "admin" } } },
    { name: "token 空请求体", path: PATHS.token.path, init: { rawBody: "" } },
    {
      name: "register 空白 device_mid",
      path: PATHS.register.path,
      init: { body: { device_mid: "   " } },
    },
    {
      name: "register 超 128 字符",
      path: PATHS.register.path,
      init: { body: { device_mid: "m".repeat(129) } },
    },
    {
      name: "register 携带未声明 meta（注册不收 meta）",
      path: PATHS.register.path,
      init: { body: { device_mid: "m", meta: { name: "x" } } },
    },
    { name: "register 非法 JSON 原文", path: PATHS.register.path, init: { rawBody: "{oops" } },
    {
      name: "delete 空白 device_sid",
      path: PATHS.delete.path,
      init: { body: { device_sid: " " } },
    },
    {
      name: "delete 携带未声明字段",
      path: PATHS.delete.path,
      init: { body: { device_sid: "d_x", reason: "y" } },
    },
    { name: "delete 空请求体", path: PATHS.delete.path, init: { rawBody: "" } },
  ])(`参数 3001：$name → HTTP 400 parameter error 信封`, async ({ path, init }) => {
    const relay = await startRelay();
    const result = await api(relay, path, { ...init, jwt: JWT_ALICE });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ code: 3001, msg: "parameter error" });
  });

  it("token 签发：22 字符 base64url 形态（契约解析器校验）、expires_in 60、no-store", async () => {
    const relay = await startRelay();
    for (const role of ["device", "terminal"] as const) {
      const result = await api(relay, PATHS.token.path, { body: { role }, jwt: JWT_ALICE });
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(result.status).toBe(200);
      const parsed = parseWebRemoteControlRelayV2HttpResponse("token", result.body);
      expect(parsed).toMatchObject({ code: 0 });
      const data = (result.body as { data: { token: string; expires_in: number } }).data;
      expect(data.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(data.expires_in).toBe(60);
    }
  });

  it("token 响应 no-store 覆盖鉴权失败分支（与 fake relay 同位置设置）", async () => {
    const relay = await startRelay();
    const denied = await api(relay, PATHS.token.path, { body: { role: "device" } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
  });

  it("Bearer 鉴权 401 面：缺失 / 非 Bearer 形态 / 未知 JWT / 一次性 token 冒充 JWT", async () => {
    const relay = await startRelay();
    const noHeader = await api(relay, PATHS.list.path);
    expect(noHeader.status).toBe(401);
    expect(noHeader.body).toEqual({ code: 401, msg: "" });

    const noBearerScheme = await api(relay, PATHS.list.path, {
      headers: { Authorization: JWT_ALICE },
    });
    expect(noBearerScheme.status).toBe(401);

    const unknownJwt = await api(relay, PATHS.list.path, { jwt: "jwt-nobody" });
    expect(unknownJwt.status).toBe(401);

    // 一次性 relay token 不在 stub users 映射里，不能当 Bearer JWT 换取用户身份
    const relayToken = await issueToken(relay, "device");
    const asBearer = await api(relay, PATHS.list.path, { jwt: relayToken });
    expect(asBearer.status).toBe(401);
  });

  it("未知路径返回 404 业务信封", async () => {
    const relay = await startRelay();
    const result = await api(relay, "/api/v1/remote/unknown", { jwt: JWT_ALICE });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({ code: 404, msg: "" });
  });

  it("CORS：默认关（不带跨源头）；开启后预检 204 + fake relay 同款头", async () => {
    const closed = await startRelay();
    const denied = await api(closed, PATHS.list.path, { jwt: JWT_ALICE });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const open = await startRelay({ corsEnabled: true });
    const preflight = await api(open, PATHS.token.path, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("HTTP 组：鉴权前置与请求体硬上限（评审 http-body-limit / auth-three-state）", () => {
  it("无效凭据 + 超大 body：不消费请求体、快速 401（不 hang），服务保持可用", async () => {
    const relay = await startRelay();
    const startedAt = Date.now();
    // 8MB body：旧实现（先读体后鉴权）会把整块缓冲进堆；新实现鉴权前置，读取前拒绝。
    // vitest 默认 5s 用例超时本身就是「不 hang」闸，此处再显式断言快速返回。
    const denied = await api(relay, PATHS.register.path, {
      rawBody: "x".repeat(8 * 1024 * 1024),
      jwt: "jwt-nobody",
    });
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ code: 401, msg: "" });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    // 服务端未被超大上传拖垮：healthz 正常（评审 healthz-test-coverage 的 401 前置断言）
    expect((await api(relay, "/healthz")).status).toBe(200);
    // 同一服务继续可服务合法请求
    await registerDevice(relay, "after-401");
  });

  it("合法凭据 + 超 Content-Length 上限 body：413 并断开，服务不受影响", async () => {
    const relay = await startRelay();
    // 65537 > 64KiB 上限：Content-Length 预检路径，读取前拒绝
    const tooLarge = await api(relay, PATHS.register.path, {
      rawBody: "x".repeat(65_537),
      jwt: JWT_ALICE,
    });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toEqual({ code: 413, msg: "" });
    // 上限内（64KiB 恰好）不被误拒：业务参数错误仍是 400 而非 413
    const withinLimit = await api(relay, PATHS.register.path, {
      rawBody: `{"device_mid":${"m".repeat(64_000)}}`,
      jwt: JWT_ALICE,
    });
    expect(withinLimit.status).toBe(400);
    expect(withinLimit.body).toEqual({ code: 3001, msg: "parameter error" });
    // 服务端不受超限请求影响：healthz 正常（评审 healthz-test-coverage 的 413 断言）
    expect((await api(relay, "/healthz")).status).toBe(200);
    await registerDevice(relay, "after-413");
  });

  it("无 Content-Length（chunked）流式超限：流式累积计数生效 → 413", async () => {
    const relay = await startRelay();
    // 3×32KB 分块传输：无 Content-Length，走流式累积计数路径（第二块累计 64KB+ 触发）
    const chunk = "y".repeat(32 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i += 1) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const response = await fetch(`${relay.httpUrl}${PATHS.register.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT_ALICE}` },
      body,
      // @types/node 的 RequestInit 未含 duplex（undici 流式请求体必填）
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
    await response.text();
    expect((await api(relay, "/healthz")).status).toBe(200);
  });

  it("鉴权三态：上游不可用 → 503（可重试语义）；凭据缺失仍 401（评审 auth-three-state）", async () => {
    const relay = await startRelay({
      auth: {
        authenticate: async (authorizationHeader) =>
          authorizationHeader === undefined
            ? { status: "credentials-invalid" }
            : { status: "upstream-unavailable" },
      },
    });
    const unavailable = await api(relay, PATHS.list.path, { jwt: JWT_ALICE });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ code: 503, msg: "" });
    // healthz 不经鉴权，上游不可用时运维面仍可用（评审 healthz-test-coverage 的 503 断言）
    expect((await api(relay, "/healthz")).status).toBe(200);
    const invalid = await api(relay, PATHS.list.path);
    expect(invalid.status).toBe(401);
  });
});
