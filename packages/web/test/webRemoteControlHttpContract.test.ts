import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { WEB_REMOTE_CONTROL_MOBILE_CONNECTION_ID_HEADER } from "@drora/shared";

const render = vi.hoisted(() => vi.fn());
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }));
vi.mock("@drora/ui", () => ({
  AppErrorBoundary: () => null,
  Root: () => null,
  DroraIntlProvider: () => null,
  generateMobileDeviceFingerprint: () => "http-contract-test",
  installDocumentHiddenMotionPause: vi.fn(),
  playTaskNotificationSound: vi.fn(),
  setStreamClientId: vi.fn(),
  setWebRemoteControlTerminalTransportState: vi.fn(),
}));
vi.mock("@drora/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@drora/client")>()),
  connectViaWebSocket: vi.fn(async (_url, options) => {
    options?.onOpenSocket?.({ close: vi.fn() });
    return { settingService: {}, broadcastService: {} };
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  render.mockClear();
});

describe("official HTTP mobile connection contract", () => {
  it("routes real workspace/view requests by the window connection and rejects a stale connection", async () => {
    let activeConnection = "mobile-one";
    const calls: Array<{
      path: string;
      header: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const workspaces = ["/first", "/second"].map((workspacePath) => ({
      kind: "local",
      workspacePath,
      workspaceKey: workspacePath,
      label: workspacePath,
    }));
    const server = createServer(async (req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.method === "GET") {
        res.end(
          JSON.stringify({
            workspaces,
            tasks: [],
            initialViewState: { activeWorkspaceKey: "/first" },
          }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const header = req.headers[WEB_REMOTE_CONTROL_MOBILE_CONNECTION_ID_HEADER.toLowerCase()] as
        | string
        | undefined;
      calls.push({ path: req.url!, header, body });
      if (header !== activeConnection) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: "invalid-mobile-connection" }));
        return;
      }
      res.end(
        JSON.stringify(
          req.url?.endsWith("workspace-bridge")
            ? {
                wsUrl: `ws://127.0.0.1:${(server.address() as { port: number }).port}/bridge`,
                bridgeSessionId: `bridge-${body.workspaceKey}`,
                kind: "local",
                workspaceKey: body.workspaceKey,
                workspacePath: body.workspaceKey,
              }
            : { ok: true },
        ),
      );
    });
    const sockets = new WebSocketServer({ server });
    sockets.on("connection", (socket) =>
      socket.send(
        JSON.stringify({
          type: "window-control-ready",
          windowControlSessionId: "control-one",
          mobileConnectionId: activeConnection,
        }),
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("WebSocket", WebSocket);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal("document", {
      title: "",
      documentElement: { classList: { toggle: vi.fn() } },
      getElementById: () => ({}),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: vi.fn(),
      matchMedia: () => ({ matches: false }),
      location: {
        origin,
        pathname: "/",
        search: `?remoteControlToken=token&relayOrigin=${encodeURIComponent(origin)}`,
      },
    });
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US"],
      userAgent: "HTTP contract test",
      onLine: true,
    });
    vi.stubGlobal("screen", { width: 390, height: 844, colorDepth: 24 });
    try {
      await import("../src/main.js");
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      await vi.waitFor(() => expect(render).toHaveBeenCalled());
      // Root 的真实入口装配；调用它提供给页面的导航，而非单独重造请求实现。
      const props = render.mock.calls.at(-1)![0].props.children.props.children.props;
      const navigation = props.webRemoteControlWorkspaceSwitcher;
      await navigation.switchWorkspace("/second");
      expect(calls.map((call) => call.header)).toEqual([
        "mobile-one",
        "mobile-one",
        "mobile-one",
        "mobile-one",
      ]);
      expect(calls[2]?.body.workspaceKey).toBe("/second");
      expect(calls[3]?.body.activeWorkspaceKey).toBe("/second");
      await navigation.updateMobileViewState("/second", "task-two");
      expect(calls.at(-1)?.body.activeTaskId).toBe("task-two");
      activeConnection = "mobile-reconnected";
      await expect(navigation.updateMobileViewState("/first", "stale-task")).rejects.toThrow();
      expect(calls.at(-1)?.header).toBe("mobile-one");
    } finally {
      listeners.get("beforeunload")?.();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
