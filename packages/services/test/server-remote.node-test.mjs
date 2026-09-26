// 第 46 轮 C 项：Server 型远程工作区客户端链回归测试。
// 覆盖端点解析（对齐官方 resolveServerRemoteEndpoints/IRe）、server-info 与
// host capability 拉取（官方 RRe/ARe，错误文案逐字对齐）、/ws/host 连接的
// URL/header 构造与 close-before-ready 文案（官方 ERe/JJ）。
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveServerRemoteEndpoints } from "@drora/shared";
import {
  connectServerRemoteTarget,
  fetchServerRemoteHostCapability,
  fetchServerRemoteInfo,
} from "../src/server-remote/index.ts";

const SERVER_INFO_PAYLOAD = {
  serverId: "srv-1",
  name: "Drora Server",
  version: "1.2.3",
  protocolVersion: 1,
  authRequired: true,
  workspaces: [{ path: "/home/user/proj", label: "proj" }],
  capabilities: { desktopContinuous: true, websocketRpc: true },
};

const HOST_CAPABILITY_PAYLOAD = { capability: "cap-123", expiresAt: 1893456000000 };

function createFetchMock(handler) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  };
  return { fetchImpl, calls };
}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

class MockWebSocket {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    this.closed = false;
    MockWebSocket.instances.push(this);
  }

  once(event, listener) {
    this.listeners.set(event, listener);
  }

  emit(event, ...args) {
    const listener = this.listeners.get(event);
    if (listener) {
      listener(...args);
    }
  }

  close() {
    this.closed = true;
  }
}

test("resolveServerRemoteEndpoints: http 输入产出四端点并升级 ws 协议", () => {
  const endpoints = resolveServerRemoteEndpoints("http://192.168.1.5:3030");
  assert.equal(endpoints.infoUrl, "http://192.168.1.5:3030/api/server-info");
  assert.equal(endpoints.wsUrl, "ws://192.168.1.5:3030/ws");
  assert.equal(endpoints.hostCapabilityUrl, "http://192.168.1.5:3030/api/rpc-host-capability");
  assert.equal(endpoints.hostWsUrl, "ws://192.168.1.5:3030/ws/host");
});

test("resolveServerRemoteEndpoints: https/wss 输入端到端映射", () => {
  const httpsEndpoints = resolveServerRemoteEndpoints("https://example.com/drora");
  assert.equal(httpsEndpoints.infoUrl, "https://example.com/drora/api/server-info");
  assert.equal(httpsEndpoints.wsUrl, "wss://example.com/drora/ws");
  assert.equal(
    httpsEndpoints.hostCapabilityUrl,
    "https://example.com/drora/api/rpc-host-capability",
  );
  assert.equal(httpsEndpoints.hostWsUrl, "wss://example.com/drora/ws/host");

  const wssEndpoints = resolveServerRemoteEndpoints("wss://example.com/drora");
  assert.equal(wssEndpoints.infoUrl, "https://example.com/drora/api/server-info");
  assert.equal(wssEndpoints.wsUrl, "wss://example.com/drora/ws");
  assert.equal(wssEndpoints.hostCapabilityUrl, "https://example.com/drora/api/rpc-host-capability");
  assert.equal(wssEndpoints.hostWsUrl, "wss://example.com/drora/ws/host");
});

test("resolveServerRemoteEndpoints: ws 输入降级 http 并保留 ws 端点", () => {
  const endpoints = resolveServerRemoteEndpoints("ws://10.0.0.2:8080");
  assert.equal(endpoints.infoUrl, "http://10.0.0.2:8080/api/server-info");
  assert.equal(endpoints.wsUrl, "ws://10.0.0.2:8080/ws");
  assert.equal(endpoints.hostCapabilityUrl, "http://10.0.0.2:8080/api/rpc-host-capability");
  assert.equal(endpoints.hostWsUrl, "ws://10.0.0.2:8080/ws/host");
});

test("resolveServerRemoteEndpoints: 剥离用户粘贴的 /ws 与 /ws/host 后缀", () => {
  const fromWs = resolveServerRemoteEndpoints("http://192.168.1.5:3030/ws");
  const fromHostWs = resolveServerRemoteEndpoints("http://192.168.1.5:3030/ws/host");
  const base = resolveServerRemoteEndpoints("http://192.168.1.5:3030");
  assert.deepEqual(fromWs, base);
  assert.deepEqual(fromHostWs, base);

  const nested = resolveServerRemoteEndpoints("http://host.example/base/ws/host");
  assert.equal(nested.wsUrl, "ws://host.example/base/ws");
  assert.equal(nested.hostWsUrl, "ws://host.example/base/ws/host");
});

test("resolveServerRemoteEndpoints: 清空 search 与 hash", () => {
  const endpoints = resolveServerRemoteEndpoints("http://192.168.1.5:3030/?x=1&y=2#frag");
  assert.equal(endpoints.infoUrl, "http://192.168.1.5:3030/api/server-info");
  assert.equal(endpoints.wsUrl, "ws://192.168.1.5:3030/ws");
  assert.equal(endpoints.hostCapabilityUrl, "http://192.168.1.5:3030/api/rpc-host-capability");
  assert.equal(endpoints.hostWsUrl, "ws://192.168.1.5:3030/ws/host");
});

test("resolveServerRemoteEndpoints: 非法协议与空输入文案逐字对齐官方", () => {
  assert.throws(() => resolveServerRemoteEndpoints("ftp://example.com"), {
    message: "Unsupported server URL protocol: ftp:",
  });
  assert.throws(() => resolveServerRemoteEndpoints("  "), {
    message: "Server URL is required",
  });
  assert.throws(() => resolveServerRemoteEndpoints(""), {
    message: "Server URL is required",
  });
});

test("fetchServerRemoteInfo: token 走 Bearer header 与查询参数双通道", async () => {
  const { fetchImpl, calls } = createFetchMock(() => jsonResponse(SERVER_INFO_PAYLOAD));
  const info = await fetchServerRemoteInfo(
    "http://192.168.1.5:3030/api/server-info",
    { token: "tok-1" },
    fetchImpl,
  );
  assert.equal(info.serverId, SERVER_INFO_PAYLOAD.serverId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "http://192.168.1.5:3030/api/server-info?token=tok-1");
  assert.deepEqual(calls[0].init.headers, { authorization: "Bearer tok-1" });
});

test("fetchServerRemoteInfo: 无 token 不带鉴权头与查询参数", async () => {
  const { fetchImpl, calls } = createFetchMock(() => jsonResponse(SERVER_INFO_PAYLOAD));
  await fetchServerRemoteInfo("http://host/api/server-info", { token: "   " }, fetchImpl);
  assert.equal(calls[0].input, "http://host/api/server-info");
  assert.equal(calls[0].init.headers, undefined);
});

test("fetchServerRemoteInfo: 非 ok 与非法响应文案逐字对齐官方", async () => {
  const failed = createFetchMock(() => jsonResponse({}, 500));
  await assert.rejects(fetchServerRemoteInfo("http://host/api/server-info", {}, failed.fetchImpl), {
    message: "Server info request failed: 500",
  });

  const invalid = createFetchMock(() => jsonResponse({ serverId: "" }));
  await assert.rejects(
    fetchServerRemoteInfo("http://host/api/server-info", {}, invalid.fetchImpl),
    { message: "Server info response is invalid" },
  );
});

test("fetchServerRemoteHostCapability: POST、查询参数 token、无 Authorization 头", async () => {
  const { fetchImpl, calls } = createFetchMock(() => jsonResponse(HOST_CAPABILITY_PAYLOAD));
  const capability = await fetchServerRemoteHostCapability(
    "http://192.168.1.5:3030/api/rpc-host-capability",
    { token: "tok-1" },
    fetchImpl,
  );
  assert.equal(capability, "cap-123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "http://192.168.1.5:3030/api/rpc-host-capability?token=tok-1");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers, undefined);
});

test("fetchServerRemoteHostCapability: 非 ok 与非法响应文案逐字对齐官方", async () => {
  const failed = createFetchMock(() => jsonResponse({}, 401));
  await assert.rejects(
    fetchServerRemoteHostCapability("http://host/api/rpc-host-capability", {}, failed.fetchImpl),
    { message: "Host capability request failed: 401" },
  );

  const invalid = createFetchMock(() => jsonResponse({ capability: "cap", expiresAt: "later" }));
  await assert.rejects(
    fetchServerRemoteHostCapability("http://host/api/rpc-host-capability", {}, invalid.fetchImpl),
    { message: "Host capability response is invalid" },
  );
});

test("connectServerRemoteTarget: 组合三步并携带 capability header 建立 /ws/host", async () => {
  MockWebSocket.instances.length = 0;
  const { fetchImpl } = createFetchMock((input) => {
    if (input.includes("/api/server-info")) {
      return jsonResponse(SERVER_INFO_PAYLOAD);
    }
    return jsonResponse(HOST_CAPABILITY_PAYLOAD);
  });

  const pending = connectServerRemoteTarget(
    { url: "http://192.168.1.5:3030", token: "tok-1" },
    { fetchImpl, webSocket: MockWebSocket },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(MockWebSocket.instances.length, 1);
  const socket = MockWebSocket.instances[0];
  assert.equal(socket.url, "ws://192.168.1.5:3030/ws/host?token=tok-1");
  assert.deepEqual(socket.options.headers, {
    authorization: "Bearer tok-1",
    "x-drora-rpc-host-capability": "cap-123",
  });

  socket.emit("open");
  const connection = await pending;
  assert.equal(connection.serverInfo.serverId, "srv-1");
  assert.equal(connection.capability, "cap-123");
  assert.equal(connection.socket, socket);
  assert.equal(socket.closed, false);
  connection.dispose();
  assert.equal(socket.closed, true);
});

test("connectServerRemoteTarget: close-before-open 文案逐字对齐官方", async () => {
  const { fetchImpl } = createFetchMock((input) =>
    input.includes("/api/server-info")
      ? jsonResponse(SERVER_INFO_PAYLOAD)
      : jsonResponse(HOST_CAPABILITY_PAYLOAD),
  );

  const withReason = connectServerRemoteTarget(
    { url: "http://host" },
    { fetchImpl, webSocket: MockWebSocket },
  );
  await new Promise((resolve) => setImmediate(resolve));
  MockWebSocket.instances.at(-1).emit("close", 4401, Buffer.from("capability expired"));
  await assert.rejects(withReason, {
    message: "WebSocket closed before ready: capability expired",
  });

  const withoutReason = connectServerRemoteTarget(
    { url: "http://host" },
    { fetchImpl, webSocket: MockWebSocket },
  );
  await new Promise((resolve) => setImmediate(resolve));
  MockWebSocket.instances.at(-1).emit("close", 1006, Buffer.alloc(0));
  await assert.rejects(withoutReason, {
    message: "WebSocket closed before ready (1006)",
  });
});

test("connectServerRemoteTarget: open 前的 error 事件直接 reject", async () => {
  const { fetchImpl } = createFetchMock((input) =>
    input.includes("/api/server-info")
      ? jsonResponse(SERVER_INFO_PAYLOAD)
      : jsonResponse(HOST_CAPABILITY_PAYLOAD),
  );
  const pending = connectServerRemoteTarget(
    { url: "ws://host" },
    { fetchImpl, webSocket: MockWebSocket },
  );
  await new Promise((resolve) => setImmediate(resolve));
  MockWebSocket.instances.at(-1).emit("error", new Error("connect ECONNREFUSED"));
  await assert.rejects(pending, { message: "connect ECONNREFUSED" });
});
