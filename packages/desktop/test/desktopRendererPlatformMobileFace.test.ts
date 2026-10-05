import assert from "node:assert/strict";
import { mock, test } from "node:test";

// 守护 renderer 平台适配层的移动远控方法面（spec: mobile-web-remote.md
// 「Renderer 集成面」）：IPlatformService 的 relay 5 项 + 重连委托必须在
// createDesktopPlatform 逐一转发到 window.zcode。
//
// 背景：renderer 子项目不在根 pnpm typecheck 覆盖内，且 window.zcode 的全局
// 类型声明不在 renderer 工程里——缺失转发不会被类型检查拦截；relay 5 项缺失曾让
// “云中继”tab 永久停在“正在准备二维码”（状态兜底 idle、自动开启条件永不成立、
// 无推送、无手动开启入口）。旧 LAN 直连 5 项（startMobilePairing 等）已随配对栈
// 删除（specs/mobile-relay-server.md §12.4），不再属于方法面。
//
// 运行：cd packages/desktop &&
//   node --import tsx/esm --experimental-test-module-mocks --test \
//     test/desktopRendererPlatformMobileFace.test.ts
// （@zcode/ui 源入口含 vite 路径别名，node 下无法加载，这里 mock 掉
// desktopPlatform 顶层唯一的 ui 依赖；desktopBrowserPlatformBridge 在模块求值期
// 只读 window.zcode 的可选能力，空 stub 下可安全加载。）

mock.module("@zcode/ui", {
  namedExports: { recordArmsCustomEventForE2E: () => {} },
});

const MOBILE_FACE_METHODS = [
  "startMobileRelayControl",
  "stopMobileRelayControl",
  "refreshMobileRelayControl",
  "getMobileRelayControlState",
  "onMobileRelayStateChanged",
  "onWebRemoteControlReconnectWorkspace",
] as const;

function installWindowZCodeStub() {
  const invocations: Array<{ method: string; args: unknown[] }> = [];
  const listeners = new Map<string, (state: unknown) => void>();
  const stub: Record<string, unknown> = {};
  for (const method of MOBILE_FACE_METHODS) {
    stub[method] = (...args: unknown[]) => {
      invocations.push({ method, args });
      if (
        method === "onMobileRelayStateChanged" ||
        method === "onWebRemoteControlReconnectWorkspace"
      ) {
        listeners.set(method, args[0] as (state: unknown) => void);
        return () => {};
      }
      if (method === "getMobileRelayControlState") {
        return { running: false, status: "idle" };
      }
      if (method === "startMobileRelayControl" || method === "refreshMobileRelayControl") {
        return { url: `stub://${method}`, sessionId: "stub-session" };
      }
      return undefined;
    };
  }
  // desktopBrowserPlatformBridge 在模块求值期就读取 window.zcode 的可选能力，
  // stub 必须先于 desktopPlatform 的首次 import 安装。
  (globalThis as { window?: unknown }).window = { zcode: stub };
  return { invocations, listeners };
}

test("createDesktopPlatform 转发移动远控全方法面（relay 5 + 重连委托）", async () => {
  const { invocations, listeners } = installWindowZCodeStub();
  const { createDesktopPlatform } = await import("../src/renderer/src/desktopPlatform.js");
  const platform = createDesktopPlatform({ isLocalDevelopmentRuntime: false });

  // 全部方法必须存在——缺失任意一项，对应传输在弹层内就没有可用链路。
  for (const method of MOBILE_FACE_METHODS) {
    assert.equal(
      typeof platform[method],
      "function",
      `platform.${method} 未转发到 window.zcode（云中继/局域网弹层将无法工作）`,
    );
  }

  await platform.startMobileRelayControl?.({ workspacePath: "D:/w" });
  assert.deepEqual(invocations.at(-1), {
    method: "startMobileRelayControl",
    args: [{ workspacePath: "D:/w" }],
  });

  // transport 维度（specs/mobile-relay-server.md §12）必须原样透传：弹层 LAN tab
  // 传 lan（内嵌 relay），云中继 tab 传 cloud——转发层丢参会让两条传输同化。
  await platform.startMobileRelayControl?.({ workspacePath: "D:/w", transport: "lan" });
  assert.deepEqual(invocations.at(-1), {
    method: "startMobileRelayControl",
    args: [{ workspacePath: "D:/w", transport: "lan" }],
  });
  await platform.startMobileRelayControl?.({ workspacePath: "D:/w", transport: "cloud" });
  assert.deepEqual(invocations.at(-1), {
    method: "startMobileRelayControl",
    args: [{ workspacePath: "D:/w", transport: "cloud" }],
  });

  await platform.getMobileRelayControlState?.();
  assert.equal(invocations.at(-1)?.method, "getMobileRelayControlState");

  await platform.refreshMobileRelayControl?.();
  assert.equal(invocations.at(-1)?.method, "refreshMobileRelayControl");

  await platform.stopMobileRelayControl?.();
  assert.equal(invocations.at(-1)?.method, "stopMobileRelayControl");

  // 订阅面：回调必须接到 window.zcode 的同名订阅上，否则弹层收不到状态推送。
  const relayListener = (state: unknown) => state;
  platform.onMobileRelayStateChanged?.(relayListener);
  assert.equal(listeners.get("onMobileRelayStateChanged"), relayListener);

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
