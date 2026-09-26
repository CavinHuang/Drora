// 第 47 轮：Server 型远程工作区在窗口 Host 内的连接与服务组装。
// 对齐官方 host/index.js：
//   - connectServerRemote(JJ) 成功后 ERe open → _Re(ws wrap 成 ISocket) → $O(帧协议
//     连接) → YD(services 代理集合)，本文件对应 wrapServerRemoteNodeWebSocket +
//     SocketProtocol/ChannelClient/RemoteServiceAccess；
//   - yAe 的 server 分支不走 remoteAssets/部署链，onClose 映射
//     exitCode=ws close code、error=reason；
//   - MJ(createServerRemoteWorkspaceServiceCollection)：无 backend、无
//     promptAttachment 物化/janitor/transfer 桥，connectionServices 逐个 register，
//     仅 clientConfig 保留本地实例（官方"本地 t"）。
import { ChannelClient, Emitter, SocketProtocol, VSBuffer, type ISocket } from "@drora/rpc";
import { RemoteServiceAccess } from "@drora/client";
import {
  ServiceCollection,
  IFileService,
  IMediaPreviewService,
  IGitService,
  IGitCheckpointService,
  ISystemService,
  ITerminalService,
  ISettingService,
  ICredentialService,
  IBroadcastService,
  IDroraTaskService,
  IDroraAgentService,
  IDroraSessionService,
  IConversationShareService,
  IBotsService,
  IFileWatcherService,
  IOAuthService,
  IModelSelectionService,
  IProviderSettingsService,
  IUsageStatsService,
  ICodingPlanSubscriptionService,
  IClientConfigService,
  IClientScenesService,
  ISkillsService,
  ISkillSyncService,
  IMcpSyncService,
  IPluginSyncService,
  IPluginsService,
  IPluginManagementService,
  ISubagentsService,
  ICommandsService,
  IHooksService,
  IMemoryService,
  ISettingsSyncService,
  IPromptAttachmentTransferService,
  type IServiceAccessor,
} from "@drora/services";
import {
  connectServerRemoteTarget,
  type ServerRemoteFetchLike,
  type ServerRemoteNodeWebSocket,
  type ServerRemoteWebSocketConstructor,
} from "@drora/services/server-remote";
import type { RemoteTarget, ServerRemoteInfo } from "@drora/shared";
import { assertLegacyRemoteWorkspaceRpcContract } from "./legacyRemoteWorkspaceRpcContract.js";

export interface ServerRemoteHostConnectionCloseEvent {
  /** ws close code；官方 yAe 直接映射为 WindowRemoteConnectionCloseEvent.exitCode。 */
  code: number;
  /** ws close reason；非空时作为 close 事件的 error 上报。 */
  reason: string;
}

export interface ServerRemoteHostConnection {
  serverInfo: ServerRemoteInfo;
  services: RemoteServiceAccess;
  dispose(): void;
  disposeAndWait(options?: { timeoutMs?: number }): Promise<void>;
}

/** 对齐官方 _Re：open 后的 node ws wrap 成 RPC 帧协议需要的 ISocket。 */
function wrapServerRemoteNodeWebSocket(socket: ServerRemoteNodeWebSocket): ISocket {
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();

  socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    onData.fire(VSBuffer.wrap(new Uint8Array(buf)));
  });
  socket.on("close", () => {
    onClose.fire();
    onEnd.fire();
  });
  socket.on("error", () => {
    onClose.fire();
    onEnd.fire();
  });

  return {
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write(buffer: VSBuffer) {
      if (socket.readyState === socket.OPEN) {
        socket.send(buffer.buffer);
      }
    },
    end() {
      socket.close();
    },
    drain() {
      return Promise.resolve();
    },
    dispose() {
      socket.close();
    },
  };
}

/**
 * Server 型远程目标在窗口 Host 内的连接建立（对齐官方 yAe 的 server 分支）。
 * 只做 endpoints → server-info → capability → /ws/host → RPC 组装；abort 由调用方
 * 在连接返回后按官方语义 `disposeAndWait({timeoutMs:5000})` 收口。
 */
export async function connectServerRemoteHostConnection(
  target: Extract<RemoteTarget, { kind: "server" }>,
  options: {
    fetchImpl?: ServerRemoteFetchLike;
    /** 测试注入 mock socket 工厂；生产走默认 node ws。 */
    webSocket?: ServerRemoteWebSocketConstructor;
    onDidClose?: (event: ServerRemoteHostConnectionCloseEvent) => void;
  } = {},
): Promise<ServerRemoteHostConnection> {
  const connection = await connectServerRemoteTarget(
    { url: target.url, ...(target.token ? { token: target.token } : {}) },
    {
      fetchImpl: options.fetchImpl,
      ...(options.webSocket ? { webSocket: options.webSocket } : {}),
    },
  );

  let hasReportedClose = false;
  let hasClosed = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  // 官方 onClose 只取 ws close 事件的 code/reason；error 事件后 node ws 必然补发 close。
  connection.socket.on("close", (code, reason) => {
    hasClosed = true;
    resolveClosed();
    if (!hasReportedClose) {
      hasReportedClose = true;
      options.onDidClose?.({ code, reason: reason.toString("utf8") });
    }
  });

  const socket = wrapServerRemoteNodeWebSocket(connection.socket);
  const protocol = new SocketProtocol(socket);
  const client = new ChannelClient(protocol);
  const services = new RemoteServiceAccess(client);

  let disposalStarted = false;
  let disposeAndWaitInFlight: Promise<void> | null = null;
  const beginDisposal = () => {
    if (disposalStarted) {
      return;
    }
    disposalStarted = true;
    client.dispose();
    protocol.dispose();
    // close 必须在任何 await 之前同步触发，让对端 server 立即收到 ws close。
    connection.dispose();
  };

  return {
    serverInfo: connection.serverInfo,
    services,
    dispose() {
      beginDisposal();
    },
    disposeAndWait(disposeOptions) {
      if (disposeAndWaitInFlight) {
        return disposeAndWaitInFlight;
      }
      beginDisposal();
      if (hasClosed) {
        return Promise.resolve();
      }
      const timeoutMs = Math.max(disposeOptions?.timeoutMs ?? 5_000, 0);
      disposeAndWaitInFlight = (async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<"timed-out">((resolve) => {
          timeout = setTimeout(() => resolve("timed-out"), timeoutMs);
        });
        await Promise.race([closed, deadline]);
        if (timeout) {
          clearTimeout(timeout);
        }
        // 超时后 socket 已在 beginDisposal 中 close()，不再追加终止；
        // 迟到的 close 事件仍会兑现 closed Promise，供后续等待复用。
      })();
      return disposeAndWaitInFlight;
    },
  };
}

/**
 * Server 型远程 workspace 的服务容器（对齐官方 MJ）。
 *
 * 与 ssh/wsl/docker 的 createRemoteWorkspaceServiceCollection（官方 TJ）差别：
 * - 无部署 backend，无 promptAttachment 物化/janitor/transfer 桥；
 * - 设置、凭据、OAuth、订阅、bots、memory、settings-sync 等直接使用目标 Server
 *   上的服务（server workspace 的权威配置在 Server 本机，不在桌面）；
 * - clientConfigService 保留本地实例（官方"本地 t"），conversationShare 走远端
 *   channel（官方此处是本地 cRe()；Drora 的 server 端已暴露该 channel，复用远端
 *   实现可避免在 Host 侧再建一套本地 API/凭据桥）；
 * - 官方清单中的 outputStyleService 在 Drora 无对应 token，未注册。
 */
export function createServerRemoteWorkspaceServiceCollection(params: {
  clientConfigService: IClientConfigService;
  connectionServices: IServiceAccessor;
}): ServiceCollection {
  assertLegacyRemoteWorkspaceRpcContract(params.connectionServices);
  const remote = params.connectionServices;
  return new ServiceCollection()
    .register(IFileService, remote.fileService)
    .register(IMediaPreviewService, remote.mediaPreviewService)
    .register(IGitService, remote.gitService)
    .register(IGitCheckpointService, remote.gitCheckpointService)
    .register(ISystemService, remote.systemService)
    .register(ITerminalService, remote.terminalService)
    .register(ISettingService, remote.settingService)
    .register(ICredentialService, remote.credentialService)
    .register(IBroadcastService, remote.broadcastService)
    .register(IDroraTaskService, remote.droraTaskService)
    .register(IDroraAgentService, remote.droraAgentService)
    .register(IDroraSessionService, remote.droraSessionService)
    .register(IConversationShareService, remote.conversationShareService)
    .register(IBotsService, remote.botsService)
    .register(IFileWatcherService, remote.fileWatcherService)
    .register(IOAuthService, remote.oauthService)
    .register(IModelSelectionService, remote.modelSelectionService)
    .register(IProviderSettingsService, remote.providerSettingsService)
    .register(IUsageStatsService, remote.usageStatsService)
    .register(ICodingPlanSubscriptionService, remote.codingPlanSubscriptionService)
    .register(IClientConfigService, params.clientConfigService)
    .register(IClientScenesService, remote.clientScenesService)
    .register(ISkillsService, remote.skillsService)
    .register(ISkillSyncService, remote.skillSyncService)
    .register(IMcpSyncService, remote.mcpSyncService)
    .register(IPluginSyncService, remote.pluginSyncService)
    .register(IPluginsService, remote.pluginsService)
    .register(IPluginManagementService, remote.pluginManagementService)
    .register(ISubagentsService, remote.subagentsService)
    .register(ICommandsService, remote.commandsService)
    .register(IHooksService, remote.hooksService)
    .register(IMemoryService, remote.memoryService)
    .register(ISettingsSyncService, remote.settingsSyncService)
    .register(IPromptAttachmentTransferService, remote.promptAttachmentTransferService);
}
