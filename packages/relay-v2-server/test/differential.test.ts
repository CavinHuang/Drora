// 差异测试（specs/relay-v2-server.md §3/§10 L0）：同一场景函数分别对两套实现执行——
// ① fake relay（packages/shared/test/fixtures/fake-relay-v2.ts，经 @drora/shared/testing/fake-relay-v2
// 公开导出，可执行规范）；② 本服务（createRelayServer 真实 loopback，listenPort=0 随机端口）。
// 每个场景把客户端可观测结果（HTTP status 序列与响应体、每连接收到的消息序列、错误码、
// close 码、存活态、rpc-frame 往返字节）沉淀为 transcript，两端各跑一遍后整体 deep-equal；
// 分歧即测试失败，vitest diff 直接给出两份 transcript 的差异。
//
// 场景取材（本 ask 指定 + 既有消费方）：
// - packages/shared/test/fakeRelayV2.test.ts（fake relay 自身的行为套件 = 可执行规范）
// - packages/desktop/test/webRemoteControlTransport.test.ts（桌面 device transport：配对、
//   KICKED、心跳、data 暂停/恢复的代表场景）
// - packages/web/test/webRemoteControlTransportV2.test.ts（手机 terminal transport：一次性
//   token → auth_init → 业务透传的代表场景）
//
// 可复用入口（本 ask 裁定）：协议级客户端用 shared 契约解析器同款严格校验面 + ws 裸 socket；
// rpc-frame 往返复用 @drora/client 公开导出 createWebRemoteControlRelayProtocol（生产桌面
// webRemoteControlManager.ts:1061 / 手机 main.tsx:1702 用其 acknowledged 变体——同一 data
// 透传面之上的端到端层，relay 可观测行为一致）+ @drora/rpc VSBuffer。桌面/手机 transport
// 本体（WebRemoteControlDeviceTransport / WebRemoteControlTerminalTransport）经 #src 子路径
// 导入、所在包未公开导出，无法从包外装配——按 ask 如实裁剪，不硬搬。
//
// 归一化：SID/token 由服务端随机生成，按「第 n 个出现的 d_ uuid / t_ uuid」映射为稳定别名；
// 时钟两端注入同一条可推进时间线，server_ts / created_at 逐字节相等；token 本体脱敏 <token>。
// 时序纪律：每个 checkpoint 前必须 waitFor 该阶段全部预期事件到齐，消除两端到达时序差异。
// CORS：spec §5.1 规则 7 把开关定为有意分歧（真实服务默认关），差异面用 corsEnabled: true
// 对齐 fake relay 的常开行为，测协议不测该开关。

import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { expect, it } from "vitest";
import { createFakeRelayV2 } from "@drora/shared/testing/fake-relay-v2";
import { WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH } from "@drora/shared/web-remote-relay";
import { createWebRemoteControlRelayProtocol } from "@drora/client";
import { VSBuffer } from "@drora/rpc";
import { createRelayServer, type RelayV2ServerHandle } from "../src/index.js";
import type { RelayConfig } from "../src/config.js";

const FIXED_MS = 1_600_000_000_000;
/** fake relay 行为测试同款双账号（跨用户隔离用例依赖） */
const USERS = { "jwt-alice": "alice", "jwt-bob": "bob" } as const;
const JWT_ALICE = "jwt-alice";
const JWT_BOB = "jwt-bob";

type Flavor = "fake" | "real";

interface Endpoint {
  httpUrl: string;
  wsUrl: string;
}

/** 服务端随机值的稳定别名表（每个 scenario×flavor 一份，按首见顺序编号） */
type Aliases = Map<string, string>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function aliasOf(aliases: Aliases, prefix: string, value: string): string {
  let alias = aliases.get(value);
  if (alias === undefined) {
    alias = `${prefix}${aliases.size + 1}`;
    aliases.set(value, alias);
  }
  return alias;
}

/** 递归把 d_<uuid>/t_<uuid> 换成稳定别名；其余原样（含 data.payload 逐字节） */
function normalize(value: unknown, aliases: Aliases): unknown {
  if (typeof value === "string") {
    if (value.startsWith("d_") && UUID_RE.test(value.slice(2)))
      return aliasOf(aliases, "SID", value);
    if (value.startsWith("t_") && UUID_RE.test(value.slice(2)))
      return aliasOf(aliases, "TSID", value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item, aliases));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalize(item, aliases),
      ]),
    );
  }
  return value;
}

interface RelayClient {
  /** 登记名（checkpoint 快照与 waitFor 超时诊断读取）；registerClient 是唯一赋值点 */
  name: string;
  messages: unknown[];
  closeCode: number | null;
  closed: Promise<number>;
  /** rpc-frame 场景钩子：每条下行消息（含 data）回调一次 */
  onData: ((message: unknown) => void) | undefined;
  send(message: unknown): void;
  sendRaw(text: string): void;
  sendBinary(data: Buffer): void;
  close(): void;
  isOpen(): boolean;
}

interface HttpInit {
  body?: unknown;
  jwt?: string;
  method?: "GET" | "POST" | "OPTIONS";
  headers?: Record<string, string>;
}

interface DiffHarness {
  readonly endpoint: Endpoint;
  /** 推进两端共享的注入时钟（token 过期用例） */
  advanceClock(ms: number): void;
  /** 调远控接口；响应记入 transcript，返回原始 body 供场景推进 */
  http(path: string, init?: HttpInit): Promise<{ status: number; body: unknown }>;
  /** 签发一次性 token（校验 200 + no-store + expires_in 60）；token 本体在 transcript 里是 <token> */
  issueToken(role: "device" | "terminal", jwt?: string): Promise<string>;
  /** 打开 WS 连接并纳入 checkpoint 快照集合 */
  connect(name: string, token: string, extraQuery?: string): Promise<RelayClient>;
  /** token 缺失/未知/过期/复用的升级拒绝（原始 socket 401） */
  connectExpectUpgradeRejected(name: string, token: string, extraQuery?: string): Promise<void>;
  /** 连接 + auth_init 并等到 auth_ack（fakeRelayV2.test.ts 的 authenticate 同款） */
  auth(
    name: string,
    sid: string,
    role: "device" | "terminal",
    extraQuery?: string,
  ): Promise<RelayClient>;
  /** 连接 + auth_init，等待该连接被服务端关闭（拒绝类用例） */
  authExpectRejected(name: string, sid: string): Promise<RelayClient>;
  /** 轮询直到谓词成立（3 秒超时）；谓词通常闭包捕获某 client.messages */
  waitFor(predicate: () => boolean, label: string): Promise<void>;
  /** 沉淀全部客户端的可观测状态（须在所有预期事件 waitFor 到齐后调用） */
  checkpoint(label: string): void;
}

interface Scenario {
  name: string;
  run(harness: DiffHarness): Promise<void>;
}

function realConfig(): RelayConfig {
  return {
    bindHost: "127.0.0.1",
    listenPort: 0,
    dbPath: ":memory:",
    jwtMode: "decode",
    jwtIdClaims: ["sub", "id"],
    jwtRealmMode: "iss",
    authTimeoutMs: 15_000,
    idleTimeoutMs: 120_000,
    deviceTtlDays: 180,
    // spec §5.1 规则 7：开关默认关是有意分歧，差异面对齐 fake relay 常开行为
    corsEnabled: true,
    logLevel: "error",
    msgTrace: false,
  };
}

async function startEndpoint(
  flavor: Flavor,
  clock: { ms: number },
): Promise<{ endpoint: Endpoint; dispose: () => Promise<void> }> {
  if (flavor === "fake") {
    const relay = await createFakeRelayV2({ users: USERS, now: () => clock.ms });
    return {
      endpoint: { httpUrl: relay.httpUrl, wsUrl: relay.wsUrl },
      dispose: () => relay.close(),
    };
  }
  const handle: RelayV2ServerHandle = await createRelayServer({
    config: realConfig(),
    users: USERS,
    now: () => clock.ms,
  });
  return {
    endpoint: {
      httpUrl: `http://127.0.0.1:${handle.port}`,
      wsUrl: `ws://127.0.0.1:${handle.port}${WEB_REMOTE_CONTROL_RELAY_V2_WS_PATH}`,
    },
    dispose: () => handle.stop(),
  };
}

const WAIT_TIMEOUT_MS = 3_000;

const messagesOfType = (client: RelayClient, type: string): unknown[] =>
  client.messages.filter((message) => (message as { type?: string }).type === type);

/** data payload 的深相等谓词：消息经 JSON 往返是新对象，不能用引用相等 */
const hasPayload = (client: RelayClient, expected: unknown): boolean =>
  client.messages.some((message) => {
    const payload = (message as { payload?: unknown }).payload;
    return JSON.stringify(payload) === JSON.stringify(expected);
  });

async function runAgainst(flavor: Flavor, run: (harness: DiffHarness) => Promise<void>) {
  const clock = { ms: FIXED_MS };
  const aliases: Aliases = new Map();
  const transcript: unknown[] = [];
  const clients = new Map<string, RelayClient>();
  const { endpoint, dispose } = await startEndpoint(flavor, clock);

  try {
    const registerClient = (name: string, ws: WebSocket): RelayClient => {
      let resolveClosed!: (code: number) => void;
      const client: RelayClient = {
        name,
        messages: [],
        closeCode: null,
        closed: new Promise<number>((resolve) => {
          resolveClosed = resolve;
        }),
        onData: undefined,
        send(message) {
          ws.send(JSON.stringify(message));
        },
        sendRaw(text) {
          ws.send(text);
        },
        sendBinary(data) {
          ws.send(data);
        },
        close() {
          ws.close();
        },
        isOpen() {
          return ws.readyState === WebSocket.OPEN;
        },
      };
      // 服务端 terminate 等异常断开走 error 事件；挂空 handler 防未处理异常
      ws.on("error", () => {});
      ws.on("message", (data) => {
        const parsed = JSON.parse(String(data)) as unknown;
        client.messages.push(parsed);
        client.onData?.(parsed);
      });
      ws.on("close", (code) => {
        client.closeCode = code;
        resolveClosed(code);
      });
      clients.set(name, client);
      return client;
    };

    const harness: DiffHarness = {
      endpoint,
      advanceClock(ms) {
        clock.ms += ms;
      },
      async http(path, init = {}) {
        const hasBody = init.body !== undefined;
        const method = init.method ?? (hasBody ? "POST" : "GET");
        const headers: Record<string, string> = { ...init.headers };
        if (init.jwt !== undefined) headers.Authorization = `Bearer ${init.jwt}`;
        if (hasBody) headers["Content-Type"] = "application/json";
        const response = await fetch(`${endpoint.httpUrl}${path}`, {
          method,
          headers,
          body: hasBody ? JSON.stringify(init.body) : undefined,
        });
        const text = await response.text();
        const rawBody: unknown = text.length === 0 ? undefined : JSON.parse(text);
        // token 本体脱敏：一次性 token 是测试凭据，不进断言输出（spec §9 红线）
        const masked =
          path === "/api/v1/remote/token" && rawBody !== null && typeof rawBody === "object"
            ? {
                ...(rawBody as Record<string, unknown>),
                data: { token: "<token>", expires_in: 60 },
              }
            : rawBody;
        transcript.push({
          http: {
            method,
            path,
            status: response.status,
            cacheControl: response.headers.get("cache-control"),
            body: masked === undefined ? undefined : normalize(masked, aliases),
          },
        });
        return { status: response.status, body: rawBody };
      },
      async issueToken(role, jwt = JWT_ALICE) {
        const { status, body } = await harness.http("/api/v1/remote/token", {
          body: { role },
          jwt,
        });
        expect(status).toBe(200);
        const data = body as { data: { token: string; expires_in: number } };
        expect(data.data.expires_in).toBe(60);
        return data.data.token;
      },
      async connect(name, token, extraQuery = "") {
        const ws = new WebSocket(
          `${endpoint.wsUrl}?token=${encodeURIComponent(token)}${extraQuery}`,
        );
        const client = registerClient(name, ws);
        await once(ws, "open");
        return client;
      },
      async connectExpectUpgradeRejected(name, token, extraQuery = "") {
        const ws = new WebSocket(
          `${endpoint.wsUrl}?token=${encodeURIComponent(token)}${extraQuery}`,
        );
        try {
          const error = await new Promise<Error>((resolve, reject) => {
            ws.once("error", resolve);
            ws.once("open", () => reject(new Error("升级不应成功")));
          });
          // 强断言（评审 diff-401-strong）：升级拒绝必须来自 401 原始应答，而不是任何 error；
          // transcript 布尔仅作冗余对照，不承担判别职责
          expect(error.message).toContain("401");
          transcript.push({
            upgradeRejected: { name, unauthorized: error.message.includes("401") },
          });
        } finally {
          ws.terminate();
        }
      },
      async auth(name, sid, role, extraQuery = "") {
        const client = await harness.connect(name, await harness.issueToken(role), extraQuery);
        client.send({
          type: "auth_init",
          device_sid: sid,
          meta: { name: role },
          client_ts: 1_600_000_000,
        });
        await harness.waitFor(
          () => messagesOfType(client, "auth_ack").length > 0,
          `${name} auth_ack`,
        );
        return client;
      },
      async authExpectRejected(name, sid) {
        const client = await harness.connect(name, await harness.issueToken("terminal"));
        client.send({ type: "auth_init", device_sid: sid, client_ts: 1_600_000_000 });
        await harness.waitFor(() => client.closeCode !== null, `${name} 被拒绝关闭`);
        return client;
      },
      async waitFor(predicate, label) {
        const deadline = Date.now() + WAIT_TIMEOUT_MS;
        while (!predicate()) {
          if (Date.now() > deadline) {
            const state = [...clients.values()]
              .map(
                (client) =>
                  `${client.name}: open=${client.isOpen()} close=${client.closeCode} types=${JSON.stringify(
                    client.messages.map(
                      (m) =>
                        (m as { type?: string; code?: string }).type ??
                        (m as { code?: string }).code,
                    ),
                  )}`,
              )
              .join(" | ");
            throw new Error(`差异场景等待超时: ${label}；当前客户端状态 → ${state}`);
          }
          await delay(15);
        }
      },
      checkpoint(label) {
        transcript.push({
          at: label,
          clients: [...clients.values()].map((client) => ({
            name: client.name,
            open: client.isOpen(),
            closeCode: client.closeCode,
            messages: normalize(client.messages, aliases),
          })),
        });
      },
    };

    await run(harness);
    return transcript;
  } finally {
    await dispose();
  }
}

const registerDevice = async (h: DiffHarness, deviceMid: string): Promise<string> => {
  const { status, body } = await h.http("/api/v1/remote/device", {
    body: { device_mid: deviceMid },
    jwt: JWT_ALICE,
  });
  expect(status).toBe(200);
  return (body as { data: { device_sid: string } }).data.device_sid;
};

const scenarios: Scenario[] = [
  {
    name: "HTTP 注册/列表/删除全生命周期与错误信封一致",
    async run(h) {
      const sid = await registerDevice(h, "machine-1");
      h.checkpoint("registered");

      await h.http("/api/v1/remote/device", { jwt: JWT_ALICE }); // 列表（本人）
      await h.http("/api/v1/remote/device", { jwt: JWT_BOB }); // 列表（他人 → 空）
      await h.http("/api/v1/remote/device/delete", { body: { device_sid: sid }, jwt: JWT_BOB }); // 异账号 → 1006
      await h.http("/api/v1/remote/device/delete", {
        body: { device_sid: "d_missing" },
        jwt: JWT_ALICE,
      }); // 不存在 → 幂等 200
      await h.http("/api/v1/remote/device/delete", { body: { device_sid: sid }, jwt: JWT_ALICE }); // 自己离线设备 → 200
      await h.http("/api/v1/remote/device", { jwt: JWT_ALICE }); // 列表 → 空

      // 浏览器预检：fake relay 常开；真实服务 corsEnabled: true 对齐（spec §5.1 规则 7）
      const preflight = await h.http("/api/v1/remote/token", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      });
      expect(preflight.status).toBe(204);

      // 参数校验：严格 schema 拒绝未知字段/空白值 → 400 3001（fake relay 同款信封）
      await h.http("/api/v1/remote/token", { body: { role: "admin" }, jwt: JWT_ALICE });
      await h.http("/api/v1/remote/device", {
        body: { device_mid: "machine", user_id: "bob" },
        jwt: JWT_ALICE,
      });
      await h.http("/api/v1/remote/device/delete", { body: { device_sid: " " }, jwt: JWT_ALICE });

      // 鉴权边界：非 Bearer / 未知凭据 → 401；未知路径 → 404
      const noBearer = await h.http("/api/v1/remote/device", {
        method: "GET",
        headers: { Authorization: JWT_ALICE },
      });
      expect(noBearer.status).toBe(401);
      await h.http("/api/v1/remote/device", { jwt: "jwt-unknown" });
      await h.http("/api/v1/remote/nope", { jwt: JWT_ALICE });

      // 同 MID 重注册产生新 SID（不合并）
      await registerDevice(h, "machine-1");
      h.checkpoint("final");
    },
  },
  {
    name: "配对、心跳 pair_status_query 与 data 双向透传一致",
    async run(h) {
      const sid = await registerDevice(h, "machine");
      const device = await h.auth("device", sid, "device");
      h.checkpoint("device-waiting");

      // mid 网关路由提示：接受但忽略（spec §5.2，fake relay 测试 #9 同款）
      const terminal = await h.auth("terminal", sid, "terminal", "&mid=machine");
      await h.waitFor(
        () => messagesOfType(device, "pair_status_ack").length >= 1,
        "device 收到 matched 推送",
      );
      h.checkpoint("paired");

      // 列表实时 join：online/meta；在线设备删除 → 3005
      await h.http("/api/v1/remote/device", { jwt: JWT_ALICE });
      await h.http("/api/v1/remote/device/delete", { body: { device_sid: sid }, jwt: JWT_ALICE });

      // 双向透传：payload 不解析原样转发 + server_ts（时钟冻结，两端逐字节相等）
      const payload = { user_id: "bob", device_sid: "not-the-route", arbitrary: [1, null, "中文"] };
      terminal.send({ type: "data", payload, client_ts: 1 });
      await h.waitFor(() => hasPayload(device, payload), "device 收到下行 data");
      device.send({ type: "data", payload: "reply", client_ts: 2 });
      await h.waitFor(() => hasPayload(terminal, "reply"), "terminal 收到上行 data");
      h.checkpoint("data-exchanged");

      // 心跳查询：device 查到 terminal SID；terminal 查询得 ""（不回显自己 SID，spec §5.2 反例）
      device.send({ type: "pair_status_query", client_ts: 1_600_000_005 });
      await h.waitFor(
        () => messagesOfType(device, "pair_status_ack").length >= 2,
        "device 查询 ack",
      );
      terminal.send({ type: "pair_status_query", client_ts: 1_600_000_006 });
      await h.waitFor(
        () => messagesOfType(terminal, "pair_status_ack").length >= 1,
        "terminal 查询 ack",
      );
      h.checkpoint("after-queries");
    },
  },
  {
    name: "KICKED 同角色替换（device/terminal 两角色）事件顺序一致",
    async run(h) {
      const sid = await registerDevice(h, "machine");
      const device = await h.auth("device", sid, "device");
      const terminal = await h.auth("terminal", sid, "terminal");
      await h.waitFor(() => messagesOfType(device, "pair_status_ack").length >= 1, "初始配对推送");
      h.checkpoint("paired");

      // 角色当前 owner 追踪：替换后推送/data 都路由到「现任」对端，不是被踢的旧变量
      const owners: Record<"device" | "terminal", RelayClient> = { device, terminal };
      for (const role of ["device", "terminal"] as const) {
        const old = owners[role];
        const otherRole: "device" | "terminal" = role === "device" ? "terminal" : "device";
        const peer = owners[otherRole];
        const peerAcksBefore = messagesOfType(peer, "pair_status_ack").length;
        // KICKED 窗口显式钉点（评审 kicked-window-injection）：replacement 认证开始前，
        // 对端预发一条 data——此刻 (SID, role) 的现任 owner 仍是旧连接，data 的可观测
        // 归宿是旧连接收到（路由到旧连接，或最迟 INTERNAL 且连接存活；两端 transcript
        // 必须一致），窗口内不许出现 data 静默丢失。
        peer.send({ type: "data", payload: "pre-kick-window", client_ts: 3 });
        await h.waitFor(
          () => hasPayload(old, "pre-kick-window"),
          `KICKED 窗口 data 路由到现任 owner（${role}）`,
        );
        const replacement = await h.auth(`replacement-${role}`, sid, role);
        await h.waitFor(() => old.closeCode !== null, `旧 ${role} 连接被关闭`);
        // 对端推送（bind 的第 ③ 步）也要等齐再快照，消除两端到达时序差
        await h.waitFor(
          () => messagesOfType(peer, "pair_status_ack").length >= peerAcksBefore + 1,
          `对端收到替换推送（${role}）`,
        );
        h.checkpoint(`kicked-${role}`);

        peer.send({ type: "data", payload: "new owner", client_ts: 4 });
        await h.waitFor(
          () => hasPayload(replacement, "new owner"),
          `替换后 data 路由到新 owner（${role}）`,
        );
        h.checkpoint(`routed-${role}`);
        owners[role] = replacement;
      }
      h.checkpoint("final");
    },
  },
  {
    name: "device 断连通知 terminal、恢复重连与 terminal 离开保留 device 一致",
    async run(h) {
      const sid = await registerDevice(h, "machine");
      const device = await h.auth("device", sid, "device");
      const terminal = await h.auth("terminal", sid, "terminal");
      await h.waitFor(() => messagesOfType(device, "pair_status_ack").length >= 1, "初始配对推送");
      h.checkpoint("paired");

      device.close();
      await h.waitFor(
        () =>
          terminal.closeCode !== null &&
          terminal.messages.some((m) => (m as { code?: string }).code === "DEVICE_OFFLINE"),
        "terminal 收到 DEVICE_OFFLINE 并关闭",
      );
      h.checkpoint("device-offline");
      await h.http("/api/v1/remote/device", { jwt: JWT_ALICE }); // online:false meta:{}

      const device2 = await h.auth("device2", sid, "device");
      h.checkpoint("device-reconnected");
      const terminal2 = await h.auth("terminal2", sid, "terminal");
      await h.waitFor(
        () =>
          messagesOfType(device2, "pair_status_ack").some(
            (m) => (m as { pair_status?: string }).pair_status === "matched",
          ),
        "device2 收到重新配对推送",
      );
      h.checkpoint("re-paired");

      terminal2.send({ type: "data", payload: "after-recovery", client_ts: 3 });
      await h.waitFor(
        () =>
          device2.messages.some((m) => (m as { payload?: unknown }).payload === "after-recovery"),
        "恢复后 data 通路",
      );
      h.checkpoint("data-after-recovery");

      // terminal 断开：device 只收 waiting 推送，保留连接继续心跳等待（spec §6.5）
      terminal2.close();
      await h.waitFor(
        () =>
          messagesOfType(device2, "pair_status_ack").some(
            (m) => (m as { pair_status?: string }).pair_status === "waiting",
          ),
        "device2 收到 waiting 推送",
      );
      h.checkpoint("terminal-left");
    },
  },
  {
    name: "认证拒绝矩阵与一次性 token 生命周期一致",
    async run(h) {
      const sid = await registerDevice(h, "machine");
      const sid2 = await registerDevice(h, "machine");
      expect(sid2).not.toBe(sid); // 同 MID 不合并（别名归一后仍可辨识两次注册）

      const device = await h.auth("device", sid, "device");
      h.checkpoint("device-authenticated");

      // 异账号归属：bob 的 token 认 alice 的设备 → AUTH_FAILED + 关闭
      const foreignToken = await h.issueToken("device", JWT_BOB);
      const foreign = await h.connect("foreign", foreignToken);
      foreign.send({ type: "auth_init", device_sid: sid, client_ts: 1_600_000_000 });
      await h.waitFor(() => foreign.closeCode !== null, "foreign 关闭");
      h.checkpoint("foreign-rejected");

      // 消费即删：同一 token 再次升级 → 401
      await h.connectExpectUpgradeRejected("reused", foreignToken);

      // 重复认证：同一连接二次 auth_init → WRONG_PARAM + 关闭
      device.send({ type: "auth_init", device_sid: sid, client_ts: 1_600_000_000 });
      await h.waitFor(
        () =>
          device.closeCode !== null &&
          device.messages.some((m) => (m as { code?: string }).code === "WRONG_PARAM"),
        "device 重复认证关闭",
      );
      h.checkpoint("double-auth");

      // 未认证连接的各种消息与非法帧（每例独立连接独立 token）
      const cases: Array<{ name: string; act: (client: RelayClient) => void }> = [
        { name: "preAuthData", act: (c) => c.send({ type: "data", payload: "before-auth" }) },
        { name: "preAuthQuery", act: (c) => c.send({ type: "pair_status_query" }) },
        {
          name: "extraField",
          act: (c) => c.send({ type: "auth_init", device_sid: "d_1", role: "device" }),
        },
        { name: "badJson", act: (c) => c.sendRaw("invalid-json") },
        { name: "binaryFrame", act: (c) => c.sendBinary(Buffer.from([0, 1, 2, 3])) },
      ];
      for (const item of cases) {
        const client = await h.connect(item.name, await h.issueToken("terminal"));
        item.act(client);
        await h.waitFor(() => client.closeCode !== null, `${item.name} 关闭`);
      }
      h.checkpoint("invalid-frames");

      // 已删除 SID：新 token 也无法 auth_init → AUTH_FAILED
      await h.http("/api/v1/remote/device/delete", { body: { device_sid: sid2 }, jwt: JWT_ALICE });
      await h.authExpectRejected("deletedSid", sid2);
      h.checkpoint("deleted-sid");

      // 60 秒过期：过期/垃圾/空 token 全部 401；之后新建连接与查询不受影响
      const unused = await h.issueToken("terminal");
      h.advanceClock(60_000);
      await h.connectExpectUpgradeRejected("expired", unused);
      await h.connectExpectUpgradeRejected("garbage", "not-a-token");
      await h.connectExpectUpgradeRejected("empty", "");
      const survivor = await h.auth("survivor", sid, "device");
      survivor.send({ type: "pair_status_query", client_ts: 1_600_000_060 });
      await h.waitFor(
        () => messagesOfType(survivor, "pair_status_ack").length >= 1,
        "过期后已建连接仍可用",
      );
      h.checkpoint("token-expiry");
    },
  },
  {
    name: "data 无对端返回 INTERNAL 且不关闭连接一致",
    async run(h) {
      const sid = await registerDevice(h, "machine");
      const device = await h.auth("device", sid, "device");
      device.send({ type: "pair_status_query", client_ts: 1 });
      await h.waitFor(() => messagesOfType(device, "pair_status_ack").length >= 1, "waiting 查询");
      h.checkpoint("waiting-query");
      device.send({ type: "data", payload: "lonely", client_ts: 2 });
      await h.waitFor(
        () => device.messages.some((m) => (m as { code?: string }).code === "INTERNAL"),
        "INTERNAL 错误",
      );
      h.checkpoint("internal-no-close");
      // INTERNAL 不关闭：连接仍可继续心跳（terminal 快速重连窗口按可恢复处理）
      device.send({ type: "pair_status_query", client_ts: 3 });
      await h.waitFor(
        () => messagesOfType(device, "pair_status_ack").length >= 2,
        "INTERNAL 后连接存活",
      );
      h.checkpoint("still-open");

      // solo terminal 查询（无任何 device owner）：terminal_sid 必须回 ""（spec §5.2 填充
      // 规则的 peer 缺失分支——terminal 自己的 SID 是 t_*，回显即分歧；与 solo device 查询
      // 不可互换，device 的 terminalSid 恒 ""，踩不到该分支）
      const sid2 = await registerDevice(h, "machine-solo");
      const soloTerminal = await h.auth("soloTerminal", sid2, "terminal");
      soloTerminal.send({ type: "pair_status_query", client_ts: 4 });
      await h.waitFor(
        () => messagesOfType(soloTerminal, "pair_status_ack").length >= 1,
        "solo terminal 查询 ack",
      );
      h.checkpoint("solo-terminal-query");
    },
  },
  {
    name: "rpc-frame 经 @drora/client 协议层双向往返一致",
    async run(h) {
      const sid = await registerDevice(h, "machine");
      const device = await h.auth("device", sid, "device");
      const terminal = await h.auth("terminal", sid, "terminal");
      await h.waitFor(() => messagesOfType(device, "pair_status_ack").length >= 1, "初始配对推送");
      h.checkpoint("paired");

      // 生产桌面（webRemoteControlManager.ts:1061）/手机（main.tsx:1702）在 data 透传面之上
      // 用的都是 @drora/client 的 rpc-frame 协议层；这里按同一方式在裸 socket 上接线，
      // 验证 relay 对分帧 payload 的保序保真（ack/缓冲是端到端语义，不属 relay 面）。
      const wire = (client: RelayClient) => {
        const received: string[] = [];
        const adapter = createWebRemoteControlRelayProtocol({
          bridgeSessionId: "bridge-differential-1",
          // 帧即时送达不进缓冲；显式 null 防用例间残留定时器
          bufferedFrameTimeoutMs: null,
          sendFrame: (frame) => {
            client.send({ type: "data", payload: frame });
          },
        });
        adapter.protocol.onMessage((buffer) => {
          received.push(buffer.toString());
        });
        client.onData = (message) => {
          // 只喂 data.payload 本体（acceptPayload 消费应用层 payload，不含 relay 信封）；
          // 非 data 消息（ack/error）没有 payload 字段，跳过
          const payload = (message as { payload?: unknown }).payload;
          if (payload === null || typeof payload !== "object") return;
          // 参数类型取自 acceptPayload 自身签名（WebRemoteControlAppPayload 在 @drora/shared
          // 根出口，从包根 import 会违反架构 requires 声明，故不经包根类型导入）
          adapter.acceptPayload(payload as Parameters<typeof adapter.acceptPayload>[0]);
        };
        return { adapter, received };
      };
      const deviceSide = wire(device);
      const terminalSide = wire(terminal);

      // 下行三帧（含 CJK 与 64KiB 大帧）：seq 连续、字节一致、顺序保持
      const outbound = ["你好 relay-α", "x".repeat(65_536), JSON.stringify({ op: "three", n: 3 })];
      for (const text of outbound) {
        terminalSide.adapter.protocol.send(VSBuffer.fromString(text));
      }
      await h.waitFor(() => deviceSide.received.length >= 3, "device 收齐 3 帧");
      h.checkpoint("rpc-frame-downlink");
      expect(deviceSide.received).toEqual(outbound);

      // 上行一帧
      deviceSide.adapter.protocol.send(VSBuffer.fromString("ack-回执"));
      await h.waitFor(() => terminalSide.received.length >= 1, "terminal 收到上行帧");
      h.checkpoint("rpc-frame-uplink");
      expect(terminalSide.received).toEqual(["ack-回执"]);
    },
  },
];

it.each(scenarios)("$name", { timeout: 30_000 }, async (scenario) => {
  const fake = await runAgainst("fake", scenario.run);
  const real = await runAgainst("real", scenario.run);
  expect(real).toEqual(fake);
});
