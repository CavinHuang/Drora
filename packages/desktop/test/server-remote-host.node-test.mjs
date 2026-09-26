// 第 47 轮：Server 型远程工作区在窗口 Host 内的连接与服务组装回归测试。
// 覆盖官方 yAe server 分支的 onClose 映射（exitCode=ws close code、error=reason、
// 去重）、m4 的 disposeAndWait 超时语义，以及官方 MJ 注册清单（远端代理逐项
// register、clientConfig 保留本地实例、legacy channel 缺失时 fail-fast）。
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  IBroadcastService,
  IClientConfigService,
  ICodingPlanSubscriptionService,
  ICommandsService,
  IConversationShareService,
  ICredentialService,
  IDroraAgentService,
  IDroraSessionService,
  IDroraTaskService,
  IFileService,
  IFileWatcherService,
  IGitCheckpointService,
  IGitService,
  IHooksService,
  IMcpSyncService,
  IMediaPreviewService,
  IMemoryService,
  IModelSelectionService,
  IOAuthService,
  IPluginManagementService,
  IPluginSyncService,
  IPluginsService,
  IPromptAttachmentTransferService,
  IProviderSettingsService,
  ISettingService,
  ISettingsSyncService,
  ISkillSyncService,
  ISkillsService,
  ISubagentsService,
  ISystemService,
  ITerminalService,
  IUsageStatsService,
} from "@drora/services";
import {
  connectServerRemoteHostConnection,
  createServerRemoteWorkspaceServiceCollection,
} from "../src/host/serverRemoteConnection.ts";

const SERVER_INFO_PAYLOAD = {
  serverId: "srv-host-1",
  version: "1.2.3",
  protocolVersion: 1,
  authRequired: false,
  workspaces: [],
  capabilities: { desktopContinuous: true, websocketRpc: true },
};

function createFetchMock() {
  return async (input) => {
    const url = String(input);
    if (url.includes("/api/server-info")) {
      return { ok: true, status: 200, json: async () => SERVER_INFO_PAYLOAD };
    }
    if (url.includes("/api/rpc-host-capability")) {
      return { ok: true, status: 200, json: async () => ({ capability: "cap-1", expiresAt: 1 }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

class MockServerWebSocket {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.onceListeners = new Map();
    this.onListeners = new Map();
    this.closeCount = 0;
    this.readyState = 0;
    this.OPEN = 1;
    MockServerWebSocket.instances.push(this);
  }

  once(event, listener) {
    this.onceListeners.set(event, listener);
  }

  on(event, listener) {
    const list = this.onListeners.get(event) ?? [];
    list.push(listener);
    this.onListeners.set(event, list);
  }

  emitOnce(event, ...args) {
    const listener = this.onceListeners.get(event);
    if (listener) {
      this.onceListeners.delete(event);
      listener(...args);
    }
  }

  emitOn(event, ...args) {
    for (const listener of this.onListeners.get(event) ?? []) {
      listener(...args);
    }
  }

  open() {
    this.readyState = this.OPEN;
    this.emitOnce("open");
  }

  close() {
    this.closeCount += 1;
    this.readyState = 3;
  }

  send() {
    // ISocket.write 在协议有出站帧时调用；本测试不驱动完整请求回合，记录为空实现。
  }
}

async function connectMockServer(options = {}) {
  const instanceCountBefore = MockServerWebSocket.instances.length;
  const connectPromise = connectServerRemoteHostConnection(
    { kind: "server", url: "https://studio.example.com:3030" },
    {
      fetchImpl: createFetchMock(),
      webSocket: MockServerWebSocket,
      ...(options.onDidClose ? { onDidClose: options.onDidClose } : {}),
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const socket = MockServerWebSocket.instances[instanceCountBefore];
  assert.ok(socket, "mock server websocket 应已被构造");
  socket.open();
  const connection = await connectPromise;
  return { connection, socket };
}

test("connectServerRemoteHostConnection: open 后组装 RPC 代理并透传 serverInfo", async () => {
  const { connection } = await connectMockServer();
  try {
    assert.equal(connection.serverInfo.serverId, "srv-host-1");
    // YD(services 代理集合)：RemoteServiceAccess 在 open 后即可取得各 channel 代理。
    assert.equal(typeof connection.services.fileService, "object");
    assert.equal(typeof connection.services.droraAgentService, "object");
  } finally {
    connection.dispose();
  }
});

test("connectServerRemoteHostConnection: ws close 按官方映射上报且只上报一次", async () => {
  const closeEvents = [];
  const { connection, socket } = await connectMockServer({
    onDidClose: (event) => closeEvents.push(event),
  });
  try {
    socket.emitOn("close", 1008, Buffer.from("token expired", "utf8"));
    // 重复 close（例如 error 后补发）不能再次触发 notifyClose。
    socket.emitOn("close", 1006, Buffer.from("", "utf8"));
    assert.deepEqual(closeEvents, [{ code: 1008, reason: "token expired" }]);
    // close 已发生时 disposeAndWait 立即收口。
    await connection.disposeAndWait({ timeoutMs: 50 });
  } finally {
    connection.dispose();
  }
});

test("connectServerRemoteHostConnection: disposeAndWait 无 close 事件时按超时返回且 socket 已 close", async () => {
  const { connection, socket } = await connectMockServer();
  const startedAt = Date.now();
  await connection.disposeAndWait({ timeoutMs: 30 });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 25, `disposeAndWait 应等待超时窗口，实际 ${elapsed}ms`);
  assert.ok(socket.closeCount >= 1, "beginDisposal 应同步触发 socket.close()");
});

test("createServerRemoteWorkspaceServiceCollection: 官方 MJ 注册清单逐项落到远端代理，clientConfig 用本地实例", () => {
  const remoteChannelNames = [
    "fileService",
    "mediaPreviewService",
    "gitService",
    "gitCheckpointService",
    "systemService",
    "terminalService",
    "settingService",
    "credentialService",
    "broadcastService",
    "droraTaskService",
    "droraAgentService",
    "droraSessionService",
    "conversationShareService",
    "botsService",
    "fileWatcherService",
    "oauthService",
    "modelSelectionService",
    "providerSettingsService",
    "usageStatsService",
    "codingPlanSubscriptionService",
    "clientScenesService",
    "skillsService",
    "skillSyncService",
    "mcpSyncService",
    "pluginSyncService",
    "pluginsService",
    "pluginManagementService",
    "subagentsService",
    "commandsService",
    "hooksService",
    "memoryService",
    "settingsSyncService",
    "promptAttachmentTransferService",
  ];
  const connectionServices = Object.fromEntries(
    remoteChannelNames.map((channelName) => [channelName, { channelName }]),
  );
  const clientConfigService = { channelName: "clientConfigService:local" };
  const services = createServerRemoteWorkspaceServiceCollection({
    clientConfigService,
    connectionServices,
  });

  const descriptorByChannel = new Map(
    Object.entries({
      fileService: IFileService,
      mediaPreviewService: IMediaPreviewService,
      gitService: IGitService,
      gitCheckpointService: IGitCheckpointService,
      systemService: ISystemService,
      terminalService: ITerminalService,
      settingService: ISettingService,
      credentialService: ICredentialService,
      broadcastService: IBroadcastService,
      droraTaskService: IDroraTaskService,
      droraAgentService: IDroraAgentService,
      droraSessionService: IDroraSessionService,
      conversationShareService: IConversationShareService,
      fileWatcherService: IFileWatcherService,
      oauthService: IOAuthService,
      modelSelectionService: IModelSelectionService,
      providerSettingsService: IProviderSettingsService,
      usageStatsService: IUsageStatsService,
      codingPlanSubscriptionService: ICodingPlanSubscriptionService,
      skillsService: ISkillsService,
      skillSyncService: ISkillSyncService,
      mcpSyncService: IMcpSyncService,
      pluginSyncService: IPluginSyncService,
      pluginsService: IPluginsService,
      pluginManagementService: IPluginManagementService,
      subagentsService: ISubagentsService,
      commandsService: ICommandsService,
      hooksService: IHooksService,
      memoryService: IMemoryService,
      settingsSyncService: ISettingsSyncService,
      promptAttachmentTransferService: IPromptAttachmentTransferService,
    }),
  );
  for (const [channelName, descriptor] of descriptorByChannel) {
    assert.deepEqual(
      services.get(descriptor),
      connectionServices[channelName],
      `${channelName} 应注册远端代理`,
    );
  }
  // 官方"本地 t"：clientConfig 保留宿主实例，不来自 connectionServices。
  assert.equal(services.get(IClientConfigService), clientConfigService);
});

test("createServerRemoteWorkspaceServiceCollection: legacy channel 缺失时 fail-fast", () => {
  assert.throws(
    () =>
      createServerRemoteWorkspaceServiceCollection({
        clientConfigService: {},
        connectionServices: { fileService: {} },
      }),
    /Legacy remote workspace RPC channel 不完整/,
  );
});
