import assert from "node:assert/strict";
import { it as test, vi } from "vitest";

// 官方 Relay V2 平台入口与重连委托；自研配对轮换随旧 Relay 栈移除。

vi.mock("@drora/ui", () => ({ recordArmsCustomEventForE2E: () => {} }));

const MOBILE_FACE_METHODS = [
  "startWebRemoteControl",
  "stopWebRemoteControl",
  "getWebRemoteControlStatus",
  "onWebRemoteControlStatusChanged",
  "onWebRemoteControlReconnectWorkspace",
] as const;

function installWindowDroraStub() {
  const invocations: Array<{ method: string; args: unknown[] }> = [];
  const listeners = new Map<string, (state: unknown) => void>();
  const stub: Record<string, unknown> = {};
  for (const method of MOBILE_FACE_METHODS) {
    stub[method] = (...args: unknown[]) => {
      invocations.push({ method, args });
      if (
        method === "onWebRemoteControlStatusChanged" ||
        method === "onWebRemoteControlReconnectWorkspace"
      ) {
        listeners.set(method, args[0] as (state: unknown) => void);
        return () => {};
      }
      if (method === "getWebRemoteControlStatus") {
        return { running: false, status: "idle" };
      }
      if (method === "startWebRemoteControl") {
        return { url: `stub://${method}`, sessionId: "stub-session" };
      }
      return undefined;
    };
  }
  // desktopBrowserPlatformBridge 在模块求值期就读取 window.drora 的可选能力，
  // stub 必须先于 desktopPlatform 的首次 import 安装。
  (globalThis as { window?: unknown }).window = { drora: stub };
  return { invocations, listeners };
}

test("createDesktopPlatform 转发移动远控全方法面（官方 5 项 + 重连委托）", async () => {
  const { invocations, listeners } = installWindowDroraStub();
  const { createDesktopPlatform } = await import("../src/renderer/src/desktopPlatform.js");
  const platform = createDesktopPlatform({ isLocalDevelopmentRuntime: false });

  // 全部方法必须存在——缺失任意一项，对应传输在弹层内就没有可用链路。
  for (const method of MOBILE_FACE_METHODS) {
    assert.equal(
      typeof platform[method],
      "function",
      `platform.${method} 未转发到 window.drora（官方远控弹层将无法工作）`,
    );
  }

  await platform.startWebRemoteControl?.({ workspacePath: "D:/w" });
  assert.deepEqual(invocations.at(-1), {
    method: "startWebRemoteControl",
    args: [{ workspacePath: "D:/w" }],
  });

  await platform.getWebRemoteControlStatus?.();
  assert.equal(invocations.at(-1)?.method, "getWebRemoteControlStatus");

  assert.equal(
    "refreshWebRemoteControlPairing" in platform,
    false,
    "旧配对轮换入口不能继续暴露，避免调用已经删除的自建 Relay IPC",
  );

  await platform.stopWebRemoteControl?.();
  assert.equal(invocations.at(-1)?.method, "stopWebRemoteControl");

  // 订阅面：回调必须接到 window.drora 的同名订阅上，否则弹层收不到状态推送。
  const relayListener = (state: unknown) => state;
  platform.onWebRemoteControlStatusChanged?.(relayListener);
  assert.equal(listeners.get("onWebRemoteControlStatusChanged"), relayListener);

  // 手机 workspace-reconnect-request 的窗口重连委托（M4c）：缺失转发会让手机端
  // 重连请求在 main 侧 120s 超时（回复永远到不了 main）。
  const reconnectHandler = async (request: { requestId: string }) => ({
    requestId: request.requestId,
    workspaceKey: "k",
    success: true,
  });
  platform.onWebRemoteControlReconnectWorkspace?.(reconnectHandler);
  assert.equal(listeners.get("onWebRemoteControlReconnectWorkspace"), reconnectHandler);
});
