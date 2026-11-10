// 第 47 轮：Server 型远程工作区在窗口 Host 内的连接与服务组装回归测试。
// v3.15.1 集成（780721e74）重构了 host 接线面：connectServerRemoteHostConnection 并入
// connectServerRemote（onDidClose→onClose、移除 webSocket 注入与 disposeAndWait 包装）、
// createServerRemoteWorkspaceServiceCollection 移至 remoteWorkspaceServiceCollection.ts 并
// 以 targetKind 区分形态。本文件按重构后 API 重接，逐项保留原回归意图：
// - onClose 映射（code/reason）只上报一次；
// - dispose 回收底层 socket 且幂等（原 disposeAndWait 超时语义随包装层一并退役，
//   由 droraProtocolClient/HostApiNetworkTransport 层持有，不在本模块断言）；
// - 官方注册清单（REMOTE_WORKSPACE_RPC_REGISTRATIONS 单一出处）逐项落到远端代理，
//   clientConfig 保留本地实例，conversationShare 在 server 形态固定禁用门禁；
// - legacy channel 缺失时按新文案 fail-fast。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { IClientConfigService, IConversationShareService } from "@drora/services";
import { WebSocketServer } from "ws";
import {
  DRORA_RPC_HOST_CAPABILITY_HEADER,
  SERVER_REMOTE_PROTOCOL_VERSION,
  windowHostRemoteWorkspaceDescriptorSchema,
} from "@drora/shared";
import { connectServerRemote } from "../src/host/serverRemoteConnection.ts";
import {
  createServerRemoteWorkspaceServiceCollection,
  REMOTE_WORKSPACE_RPC_REGISTRATIONS,
} from "../src/host/remoteWorkspaceServiceCollection.ts";
import { createWindowRemoteConnectionRegistry } from "../src/host/windowRemoteConnectionRegistry.ts";

const SERVER_INFO_PAYLOAD = {
  serverId: "srv-host-1",
  version: "1.2.3",
  protocolVersion: SERVER_REMOTE_PROTOCOL_VERSION,
  authRequired: false,
  workspaces: [],
  capabilities: { desktopContinuous: true, websocketRpc: true },
};

// 真实本地 server：connectServerRemote 在 v3.15.1 后直接构造 ws 客户端（不再暴露
// webSocket 注入），用 127.0.0.1 上的真 HTTP+WS 端点锁定同一组 wire 事实。
async function startMockServer({ onHostUpgrade } = {}) {
  const observedUpgrades = [];
  const serverClosed = [];
  const httpServer = createServer((req, res) => {
    if (req.url?.includes("/api/server-info")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(SERVER_INFO_PAYLOAD));
      return;
    }
    if (req.url?.includes("/api/rpc-host-capability")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ capability: "cap-1", expiresAt: 1 }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket, request) => {
    observedUpgrades.push({
      authorization: request.headers.authorization,
      capability: request.headers[DRORA_RPC_HOST_CAPABILITY_HEADER],
    });
    socket.on("close", (code, reason) => serverClosed.push({ code, reason: reason?.toString() }));
    onHostUpgrade?.(socket);
  });
  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url?.includes("/ws/host")) {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
      return;
    }
    socket.destroy();
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address();
  return {
    url: `http://127.0.0.1:${port}`,
    observedUpgrades,
    serverClosed,
    async stop() {
      wss.close();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

test("connectServerRemote: open 后组装 RPC 代理并透传 serverInfo，upgrade 携带官方 capability header", async () => {
  const mock = await startMockServer();
  try {
    const connection = await connectServerRemote(
      { kind: "server", url: mock.url, token: "tok-1" },
      {},
    );
    try {
      assert.equal(connection.serverInfo.serverId, "srv-host-1");
      // YD(services 代理集合)：RemoteServiceAccess 在 open 后即可取得各 channel 代理。
      assert.equal(typeof connection.services.fileService, "object");
      assert.equal(typeof connection.services.droraAgentService, "object");
      // wire 事实：/ws/host upgrade 必须带 Bearer 与单源常量 capability header。
      assert.deepEqual(mock.observedUpgrades, [
        { authorization: "Bearer tok-1", capability: "cap-1" },
      ]);
    } finally {
      connection.dispose();
    }
  } finally {
    await mock.stop();
  }
});

test("windowRemoteConnectionRegistry: server handle 的 serverInfo 随 descriptor 透出并通过协议校验", async () => {
  const serverInfo = {
    ...SERVER_INFO_PAYLOAD,
    workspaces: [{ path: "/srv/project", label: "project" }],
  };
  const registry = createWindowRemoteConnectionRegistry({
    connect: async () => ({
      services: {},
      serverInfo,
      dispose() {},
    }),
    createId: () => "remote-session-1",
  });
  const descriptor = await registry.connect({
    requestId: "req-server-info",
    target: { kind: "server", url: "https://studio.example.com:3030" },
    remoteAssets: {},
    signal: new AbortController().signal,
  });
  assert.equal(descriptor.serverInfo, serverInfo, "descriptor 应原样携带 handle.serverInfo");
  // descriptor 会走 hostRemoteWorkspaceConnectedResponseSchema 的 strict 校验：
  // 带 serverInfo 的形态必须整体通过，否则 main 会把连接成功当协议错误丢弃。
  const parsed = windowHostRemoteWorkspaceDescriptorSchema.safeParse(descriptor);
  assert.ok(parsed.success, `descriptor 应通过协议校验: ${parsed.error?.message}`);

  // 非 server 形态（无 serverInfo）同样保持兼容。
  const plainRegistry = createWindowRemoteConnectionRegistry({
    connect: async () => ({ services: {}, dispose() {} }),
    createId: () => "remote-session-2",
  });
  const plainDescriptor = await plainRegistry.connect({
    requestId: "req-plain",
    target: { kind: "docker", container: "drora-demo" },
    remoteAssets: {},
    signal: new AbortController().signal,
  });
  assert.equal("serverInfo" in plainDescriptor, false, "非 server 形态不应携带 serverInfo");
  assert.ok(windowHostRemoteWorkspaceDescriptorSchema.safeParse(plainDescriptor).success);
});

test("connectServerRemote: ws close 按官方映射上报且只上报一次", async () => {
  const closeEvents = [];
  const mock = await startMockServer({
    // 连接建立后由服务端主动 close：官方 yAe 分支映射 exitCode=close code、error=reason。
    // 延迟到握手完成之后，否则 connectServerRemote 会按 close-before-ready 拒绝。
    onHostUpgrade: (socket) =>
      setTimeout(() => socket.close(1008, Buffer.from("token expired", "utf8")), 50),
  });
  try {
    const connection = await connectServerRemote(
      { kind: "server", url: mock.url },
      { onClose: (event) => closeEvents.push(event) },
    );
    // 等待服务端 close 帧到达；ws 客户端的 close 事件只派发一次，映射层不得重复上报
    // （不提前 dispose——客户端自发 close 会与服务端 close 竞态出 1005）。
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(closeEvents, [{ code: 1008, reason: "token expired" }]);
    connection.dispose();
  } finally {
    await mock.stop();
  }
});

test("connectServerRemote: dispose 回收底层 socket 且幂等", async () => {
  const mock = await startMockServer();
  try {
    const connection = await connectServerRemote({ kind: "server", url: mock.url }, {});
    connection.dispose();
    connection.dispose();
    // 服务端必须观察到 socket 关闭（rpc.dispose + socket.close 的可观察结果）。
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(mock.serverClosed.length, 1, "服务端应观察到一次底层 socket close");
  } finally {
    await mock.stop();
  }
});

test("createServerRemoteWorkspaceServiceCollection: 官方注册清单逐项落到远端代理，clientConfig 用本地实例", async () => {
  // 单一出处：清单与描述符对直接迭代 REMOTE_WORKSPACE_RPC_REGISTRATIONS，
  // 避免测试手抄清单再次随重构脱配（本文件旧版即因此失执行）。
  const connectionServices = Object.fromEntries(
    REMOTE_WORKSPACE_RPC_REGISTRATIONS.map(([channelName]) => [channelName, { channelName }]),
  );
  const clientConfigService = { channelName: "clientConfigService:local" };
  const services = createServerRemoteWorkspaceServiceCollection({
    clientConfigService,
    connectionServices,
    targetKind: "server",
  });

  for (const [channelName, descriptor] of REMOTE_WORKSPACE_RPC_REGISTRATIONS) {
    // conversationShare 是刻意的例外：server 形态固定注册禁用门禁（见下方专断言），
    // 不随清单注册远端代理。
    if (channelName === "conversationShareService") continue;
    assert.deepEqual(
      services.get(descriptor),
      connectionServices[channelName],
      `${channelName} 应注册远端代理`,
    );
  }
  // 第四十九轮对齐官方 cRe 定案：conversationShare 不再注册远端代理，
  // 而是固定禁用门禁（feature_disabled），只读查询返回 null。
  const conversationShareService = services.get(IConversationShareService);
  assert.notEqual(
    conversationShareService,
    connectionServices.conversationShareService,
    "conversationShareService 不应注册远端代理",
  );
  assert.equal(
    await conversationShareService.getImportedConversation({}),
    null,
    "只读查询在禁用门禁下返回 null",
  );
  await assert.rejects(
    () => conversationShareService.publish({}),
    (error) => error?.kind === "feature_disabled",
    "写操作应按 feature_disabled 拒绝",
  );
  // 官方"本地 t"：clientConfig 保留宿主实例，不来自 connectionServices。
  assert.equal(services.get(IClientConfigService), clientConfigService);
});

test("createServerRemoteWorkspaceServiceCollection: contract channel 缺失时 fail-fast", () => {
  assert.throws(
    () =>
      createServerRemoteWorkspaceServiceCollection({
        clientConfigService: {},
        connectionServices: { fileService: {} },
        targetKind: "server",
      }),
    /Remote workspace RPC v1 channel 不完整/,
  );
});
