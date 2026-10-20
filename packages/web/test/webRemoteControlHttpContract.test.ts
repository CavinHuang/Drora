import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createFakeRelayV2 } from "@drora/shared/testing/fake-relay-v2";

const render = vi.hoisted(() => vi.fn());
const transportStates = vi.hoisted(() => [] as string[]);

vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }));
vi.mock("@drora/ui", () => ({
  AppErrorBoundary: () => null,
  Root: () => null,
  DroraIntlProvider: () => null,
  generateMobileDeviceFingerprint: vi.fn(() => "http-contract-test"),
  installDocumentHiddenMotionPause: vi.fn(),
  playTaskNotificationSound: vi.fn(),
  setStreamClientId: vi.fn(),
  setWebRemoteControlTerminalTransportState: vi.fn((state: string) => {
    transportStates.push(state);
  }),
}));
// S5 合并后手机远控走上游 V2 契约：workspace/bootstrap/mobile-view-state 全部经
// terminal transport 的 zcode_type 帧送达配对窗口；旧的 remoteControlToken HTTP
// 直连客户端已随 v3.16.1 对齐移除。bridge 建立后的 workspace RPC 由协议客户端
// 承载，测试只替换其装配点，保留 transport/relay/token 的真实线级路径。
vi.mock("@drora/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@drora/client")>()),
  connectViaProtocol: vi.fn(() => ({ settingService: {}, broadcastService: {} })),
  connectViaWebSocket: vi.fn(async () => ({ settingService: {}, broadcastService: {} })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  render.mockClear();
  transportStates.length = 0;
});

interface ContractViewState {
  activeWorkspaceKey?: string;
  activeTaskId?: string;
}

interface ElementLike {
  props: { children?: ElementLike } & Record<string, unknown>;
}

describe("official HTTP mobile connection contract", () => {
  it("routes real workspace/view requests by the paired window connection and rejects a stale connection", async () => {
    // 旧连接（terminal）被顶替后，relay 必须拒绝其续用 token：模拟会话失效（原 409 语义）。
    let rejectTerminalTokens = false;
    const relay = await createFakeRelayV2({
      users: { "test-jwt": "user-1" },
      onHttp: (call) =>
        call.path === "/api/v1/remote/token" &&
        (call.body as { role?: string }).role === "terminal" &&
        rejectTerminalTokens
          ? { status: 401 }
          : undefined,
    });
    const relayRequest = async (path: string, body: unknown) => {
      const response = await fetch(`${relay.httpUrl}/api/v1/remote/${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer test-jwt", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return ((await response.json()) as { data: never }).data;
    };
    const { device_sid: deviceSid } = (await relayRequest("device", {
      device_mid: "mid-1",
    })) as { device_sid: string };
    const { token: deviceToken } = (await relayRequest("token", { role: "device" })) as {
      token: string;
    };

    const workspaces = ["/first", "/second"].map((workspacePath) => ({
      kind: "local" as const,
      workspacePath,
      label: workspacePath,
    }));
    const viewStates: ContractViewState[] = [];
    const bridgeOpens: string[] = [];

    // 桌面窗口侧：应答 bootstrap/workspace-list/bridge-open，并记录手机发来的视图状态。
    const device = new WebSocket(`${relay.wsUrl}?token=${deviceToken}`);
    const sendData = (payload: unknown) =>
      device.readyState === WebSocket.OPEN &&
      device.send(JSON.stringify({ type: "data", payload, client_ts: 1 }));
    device.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; payload?: never };
      if (message.type !== "data") return;
      const payload = message.payload as {
        zcode_type?: string;
        requestId?: string;
        bridgeSessionId?: string;
        bridgeGeneration?: number;
        workspaceKey?: string;
        viewState?: ContractViewState;
      };
      if (payload.zcode_type === "bootstrap-request") {
        sendData({
          zcode_type: "bootstrap-response",
          requestId: payload.requestId,
          success: true,
          result: {
            windowControlSessionId: "window-1",
            workspaces,
            initialViewState: { activeWorkspaceKey: "/first", updatedAt: 1 },
          },
        });
      } else if (payload.zcode_type === "workspace-list-request") {
        sendData({
          zcode_type: "workspace-list-response",
          requestId: payload.requestId,
          success: true,
          result: { workspaces, activeWorkspaceKey: "/first" },
        });
      } else if (payload.zcode_type === "workspace-bridge-open") {
        bridgeOpens.push(payload.workspaceKey ?? "");
        sendData({
          zcode_type: "workspace-bridge-ready",
          requestId: payload.requestId,
          bridgeSessionId: payload.bridgeSessionId,
          bridgeGeneration: payload.bridgeGeneration,
          bridge: {
            bridgeSessionId: payload.bridgeSessionId,
            bridgeGeneration: payload.bridgeGeneration,
            kind: "local",
            workspaceKey: payload.workspaceKey,
            workspacePath: payload.workspaceKey,
          },
        });
      } else if (payload.zcode_type === "mobile-view-state-update") {
        viewStates.push({ ...payload.viewState });
      }
    });
    await new Promise<void>((resolve) => device.addEventListener("open", () => resolve()));
    device.send(JSON.stringify({ type: "auth_init", device_sid: deviceSid, client_ts: 1 }));

    const listeners = new Map<string, Array<() => void>>();
    const addListener = (type: string, listener: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    };
    const removeListener = (type: string, listener: () => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    };
    const credentials = new Map([
      ["drorajwttoken", "test-jwt"],
      ["oauth:active_provider", "zai"],
      ["oauth:zai:access_token", "access"],
      ["oauth:zai:user_info", JSON.stringify({ user_id: "user", name: "Test" })],
    ]);
    const storage = {
      getItem: (key: string) => credentials.get(key) ?? null,
      setItem: (key: string, value: string) => {
        credentials.set(key, value);
      },
      removeItem: (key: string) => {
        credentials.delete(key);
      },
    };
    const routeSearch = `?sid=${deviceSid}&mid=mid-1`;
    vi.stubGlobal("WebSocket", WebSocket);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("document", {
      title: "",
      visibilityState: "visible",
      documentElement: { classList: { toggle: vi.fn() } },
      getElementById: () => ({ nodeType: 1 }),
      addEventListener: vi.fn(addListener),
      removeEventListener: vi.fn(removeListener),
    });
    vi.stubGlobal("window", {
      localStorage: storage,
      sessionStorage: storage,
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(addListener),
      removeEventListener: vi.fn(removeListener),
      matchMedia: () => ({ matches: false }),
      location: {
        origin: relay.httpUrl,
        protocol: "http:",
        host: new URL(relay.httpUrl).host,
        pathname: "/remote-contract",
        search: routeSearch,
        href: `${relay.httpUrl}/remote-contract${routeSearch}`,
        replace: vi.fn(),
        reload: vi.fn(),
      },
    });
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US"],
      onLine: true,
      userAgent: "HTTP contract test",
    });
    vi.stubGlobal("screen", { width: 390, height: 844, colorDepth: 24 });
    // 自定义路由避开 /remote/v4 的托管 relay ws 适配（Drora 部署分歧），
    // 让 transport 按端点解析连到本测试的 V2 relay。
    vi.stubEnv("BASE_URL", "/remote-contract/");
    vi.stubEnv("VITE_DRORA_ENDPOINT_ORIGIN", relay.httpUrl);

    const terminalTokenCalls = () =>
      relay.httpCalls.filter(
        (call) =>
          call.path === "/api/v1/remote/token" &&
          (call.body as { role?: string }).role === "terminal",
      ).length;

    try {
      await import("../src/main.js");
      // 真实入口装配：导航来自 Root 收到的 props，而非单独重造请求实现。
      const rootProps = () => {
        const tree = render.mock.calls.at(-1)![0] as ElementLike;
        return tree.props.children?.props.children?.props as {
          webRemoteControlWorkspaceSwitcher?: {
            switchWorkspace(workspaceKey: string): Promise<void>;
            updateMobileViewState(workspaceKey: string, taskId?: string): Promise<void>;
          };
        };
      };
      await vi.waitFor(() => expect(bridgeOpens).toContain("/first"));
      await vi.waitFor(() => expect(rootProps().webRemoteControlWorkspaceSwitcher).toBeDefined());
      await vi.waitFor(() => expect(viewStates.at(-1)?.activeWorkspaceKey).toBe("/first"));

      const navigation = rootProps().webRemoteControlWorkspaceSwitcher;
      await navigation.switchWorkspace("/second");
      expect(bridgeOpens.at(-1)).toBe("/second");
      await vi.waitFor(() => expect(viewStates.at(-1)?.activeWorkspaceKey).toBe("/second"));
      await navigation.updateMobileViewState("/second", "task-two");
      await vi.waitFor(() => expect(viewStates.at(-1)?.activeTaskId).toBe("task-two"));

      // 连接失效：relay 拒绝旧 terminal 续用（token 401），视图流量只走当前有效连接。
      rejectTerminalTokens = true;
      relay.disconnect({ role: "terminal" });
      await vi.waitFor(() => expect(transportStates).toContain("reconnecting"));
      // V2 语义：视图更新是配对门禁内的 fire-and-forget，失效连接上不投递、
      // 也不以异常面暴露；连接被拒的终态（session-conflict 等）由
      // webRemoteControlTransportV2.test.ts 在线级锁定。
      await navigation.updateMobileViewState("/first", "stale-task");
      expect(viewStates.some((view) => view.activeTaskId === "stale-task")).toBe(false);
      expect(viewStates.at(-1)?.activeTaskId).toBe("task-two");
      // 旧连接的重连被 relay 401 拒绝后进入终态（auth-required → error）。
      await vi.waitFor(() => expect(terminalTokenCalls()).toBeGreaterThanOrEqual(2), {
        timeout: 4_000,
      });
      await vi.waitFor(() => expect(transportStates).toContain("error"), { timeout: 4_000 });
    } finally {
      for (const listener of listeners.get("beforeunload") ?? []) listener();
      device.close();
      await relay.close();
    }
  });
});
