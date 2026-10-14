import assert from "node:assert/strict";
import { it as test, vi } from "vitest";

// 守护 renderer 平台适配层的移动远控方法面（spec: mobile-web-remote.md
// 「Renderer 集成面」）：IPlatformService 的 relay 5 项 + 重连委托必须在
// createDesktopPlatform 逐一转发到 window.drora。
//
// 背景：renderer 子项目不在根 pnpm typecheck 覆盖内，且 window.drora 的全局
// 类型声明不在 renderer 工程里——缺失转发不会被类型检查拦截；relay 5 项缺失曾让
// “云中继”tab 永久停在“正在准备二维码”（状态兜底 idle、自动开启条件永不成立、
// 无推送、无手动开启入口）。旧 LAN 直连 5 项（startMobilePairing 等）已随配对栈
// 删除（specs/mobile-relay-server.md §12.4），不再属于方法面。
//
// 运行：cd packages/desktop &&
//   pnpm exec vitest run packages/desktop/test/desktopRendererPlatformMobileFace.test.ts
// （@drora/ui 源入口含 vite 路径别名，node 下无法加载，这里 mock 掉
// desktopPlatform 顶层唯一的 ui 依赖；desktopBrowserPlatformBridge 在模块求值期
// 只读 window.drora 的可选能力，空 stub 下可安全加载。）

vi.mock("@drora/ui", () => ({ recordArmsCustomEventForE2E: () => {} }));

const MOBILE_FACE_METHODS = [
  "startWebRemoteControl",
  "stopWebRemoteControl",
  "refreshWebRemoteControlPairing",
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
      if (method === "startWebRemoteControl" || method === "refreshWebRemoteControlPairing") {
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

  await platform.refreshWebRemoteControlPairing?.();
  assert.equal(invocations.at(-1)?.method, "refreshWebRemoteControlPairing");

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
