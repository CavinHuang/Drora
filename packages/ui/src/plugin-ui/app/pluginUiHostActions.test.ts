import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@modelcontextprotocol/client";
import {
  MCP_APPS_NAVIGATE_METHOD,
  MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
  MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
  MCP_APPS_OPEN_WITH_METHOD,
  type McpAppsNavigateParams,
  type PluginSandboxHandle,
  type PluginSandboxPlatformPort,
  type PluginSandboxTransportPort,
} from "@drora/shared/mcp-apps";
import type { PluginUiHostBridge } from "./pluginUiHostBridge.js";
import {
  createPluginUiHostController,
  type PluginUiHostControllerDeps,
} from "./pluginUiHostController.js";
import type { PluginUiRequestContext } from "./pluginUiHostBridge.js";
import { wirePluginUiInteractions } from "./pluginUiInteractionPorts.js";

// g9 宿主动作桥（specs/obsidian-vault-phase2-true-extraction.md §6/§8/§10-P2）：
// renderer 侧白名单 handler、宿主→面板 openWith 暂存/补发、页面管理器定向投递。

class FakeBridge implements PluginUiHostBridge {
  requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
  notifications: Array<{ method: string; params?: Record<string, unknown> }> = [];
  hostContexts: unknown[] = [];
  oninitialized: (() => void) | undefined;
  oncreatesamplingmessage = undefined;
  oncalltool = undefined;
  onreadresource = undefined;
  onlistresources = undefined;
  onlistresourcetemplates = undefined;
  onopenlink = undefined;
  onrequestdisplaymode = undefined;
  onupdatemodelcontext = undefined;
  ondownloadfile = undefined;
  onrequestteardown = undefined;
  onsizechange = undefined;
  onloggingmessage = undefined;
  connect(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  setHostContext(hostContext: never): void {
    this.hostContexts.push(hostContext);
  }
  sendToolInput(): Promise<void> {
    return Promise.resolve();
  }
  sendToolResult(): Promise<void> {
    return Promise.resolve();
  }
  sendToolCancelled(): Promise<void> {
    return Promise.resolve();
  }
  teardownResource(): Promise<unknown> {
    return Promise.resolve({});
  }
  getAppCapabilities() {
    return {} as never;
  }
  notification(input: { method: string; params?: Record<string, unknown> }): Promise<void> {
    this.notifications.push(input);
    return Promise.resolve();
  }
  listTools(): Promise<never> {
    throw new Error("not needed");
  }
  callTool(): Promise<never> {
    throw new Error("not needed");
  }
  setNotificationHandler(): void {}
  setRequestHandler(
    method: "resources/subscribe" | "resources/unsubscribe",
    handler: (
      request: { params: { uri: string } },
      ctx: PluginUiRequestContext,
    ) => Promise<Record<string, never>>,
  ): void;
  setRequestHandler(
    method: string,
    schemas: { params: unknown; result?: unknown },
    handler: (params: unknown, ctx: PluginUiRequestContext) => Promise<unknown>,
  ): void;
  setRequestHandler(method: string, schemasOrHandler: unknown, maybeHandler?: unknown): void {
    const handler =
      typeof schemasOrHandler === "function"
        ? (schemasOrHandler as (params: unknown) => Promise<unknown>)
        : (maybeHandler as (params: unknown) => Promise<unknown>);
    this.requestHandlers.set(method, handler);
  }
}

const fakeHandle = () => ({ sandboxId: "sbx-1", initId: 1, shellUrl: "about:blank", partition: "p" });
const fakePort: PluginSandboxTransportPort = {
  postMessage() {},
  onmessage: null,
  close() {},
  start() {},
};

function createHarness() {
  const deps = {
    bridge: {
      prepareSandbox: vi.fn(async () => fakeHandle()),
      validateInstance: vi.fn(async () => undefined),
      closeInstance: vi.fn(async () => undefined),
      recycleInstance: vi.fn(async () => false),
      callTool: vi.fn(async () => ({})),
      cancelToolCall: vi.fn(async () => undefined),
      readResource: vi.fn(async () => ({} as never)),
      listResources: vi.fn(async () => ({} as never)),
      listResourceTemplates: vi.fn(async () => ({} as never)),
      subscribeResource: vi.fn(async () => undefined),
      unsubscribeResource: vi.fn(async () => undefined),
    } as unknown as PluginUiHostControllerDeps["bridge"],
    platform: {
      getOwnerWebContentsId: async () => 1,
      onPorts: (handler: (event: { sandboxId: string; initId: number; port: PluginSandboxTransportPort }) => void) => {
        portsHandlers.push(handler);
        return () => {};
      },
      disposeSandbox: async () => undefined,
      consumeUserGesture: async () => false,
    } as unknown as PluginSandboxPlatformPort,
    onPhase: () => {},
    onHeight: () => {},
    onDisplayModeRequest: (mode: never) => mode,
    onOpenExternal: () => {},
  } satisfies Partial<PluginUiHostControllerDeps>;
  const portsHandlers: Array<(event: { sandboxId: string; initId: number; port: PluginSandboxTransportPort }) => void> = [];
  const created: FakeBridge[] = [];
  const controller = createPluginUiHostController({
    ...(deps as unknown as PluginUiHostControllerDeps),
    // transport.close() 必须回 Promise（teardown 的 release 链直接 .catch）。
    createTransport: (() => ({
      postMessage() {},
      close: () => Promise.resolve(),
      start() {},
    })) as unknown as () => Transport,
    createAppBridge: () => {
      const next = new FakeBridge();
      created.push(next);
      return next as unknown as PluginUiHostBridge;
    },
    setTimer: () => () => {},
    scope: {
      workspacePath: "/ws",
      sessionId: "session-1",
      scope: { kind: "surface", surfaceId: "vault" },
    },
    presentation: { serverName: "plugin:x:knowledge", pluginId: "x@drora-plugins-official", resourceUri: "ui://vault/panel.html" },
    getToolFeed: () => ({}),
    getWidgetState: () => undefined,
    getHostCapabilities: () => ({}) as never,
    initialHostContext: {
      theme: "dark",
      locale: "zh-CN",
      displayMode: "fullscreen",
      containerDimensions: { width: 400, maxHeight: 1200 },
    } as never,
    hostVersion: "test",
  });
  return { controller, portsHandlers, created };
}

describe("g9 wirePluginUiInteractions 白名单 handler", () => {
  it("注册三个白名单方法并分发到回调", async () => {
    const bridge = new FakeBridge();
    const handoff = vi.fn(async () => undefined);
    const picker = vi.fn(async () => ({ path: "/vault/root" }));
    const navigate = vi.fn(async () => undefined);
    wirePluginUiInteractions(
      bridge,
      {
        onOpenConversationHandoff: handoff,
        onSelectDirectory: picker,
        onNavigate: navigate,
      },
      { consumeUserGesture: async () => false },
      () => fakeHandle() as unknown as PluginSandboxHandle,
    );
    expect(bridge.requestHandlers.has(MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD)).toBe(true);
    expect(bridge.requestHandlers.has(MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD)).toBe(true);
    expect(bridge.requestHandlers.has(MCP_APPS_NAVIGATE_METHOD)).toBe(true);
    await bridge.requestHandlers.get(MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD)!(
      { content: [{ type: "text", text: "h" }], structuredContent: { k: 1 } },
    );
    expect(handoff).toHaveBeenCalledWith({ content: [{ type: "text", text: "h" }], structuredContent: { k: 1 } });
    await expect(
      bridge.requestHandlers.get(MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD)!({}),
    ).resolves.toEqual({ path: "/vault/root" });
    expect(picker).toHaveBeenCalledWith({});
    await bridge.requestHandlers.get(MCP_APPS_NAVIGATE_METHOD)!({
      kind: "surface",
      surfaceId: "vault",
    });
    expect(navigate).toHaveBeenCalledWith({ kind: "surface", surfaceId: "vault" } satisfies McpAppsNavigateParams);
  });

  it("未注入回调的动作回 -32601（不对页面谎报能力）", async () => {
    const bridge = new FakeBridge();
    wirePluginUiInteractions(
      bridge,
      {},
      { consumeUserGesture: async () => false },
      () => fakeHandle() as unknown as PluginSandboxHandle,
    );
    for (const method of [
      MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
      MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
      MCP_APPS_NAVIGATE_METHOD,
    ]) {
      const handler = bridge.requestHandlers.get(method)!;
      const rejection = await handler({}).then(
        () => null,
        (error: { code?: number }) => error,
      );
      expect(rejection?.code).toBe(-32601);
    }
  });
});

describe("g9 controller notifyOpenWith（宿主→面板）", () => {
  it("握手前暂存、initialized 后补发一次；attached 后即时通知", async () => {
    const { controller, portsHandlers, created } = createHarness();
    controller.start();
    await vi.waitFor(() => expect(portsHandlers.length).toBe(1));
    // 握手前投递：暂存，不产生通知。
    controller.notifyOpenWith({ receiptId: "pending-1" });
    portsHandlers[0]!({ sandboxId: "sbx-1", initId: 1, port: fakePort });
    await vi.waitFor(() => expect(created.length).toBe(1));
    expect(created[0]!.notifications).toEqual([]);
    created[0]!.oninitialized?.();
    // initialized 后补发一次，命令语义（发完即清）。
    expect(created[0]!.notifications).toEqual([
      { method: MCP_APPS_OPEN_WITH_METHOD, params: { payload: { receiptId: "pending-1" } } },
    ]);
    controller.notifyOpenWith({ receiptId: "live-2" });
    expect(created[0]!.notifications).toEqual([
      { method: MCP_APPS_OPEN_WITH_METHOD, params: { payload: { receiptId: "pending-1" } } },
      { method: MCP_APPS_OPEN_WITH_METHOD, params: { payload: { receiptId: "live-2" } } },
    ]);
    await controller.dispose();
  });
});
