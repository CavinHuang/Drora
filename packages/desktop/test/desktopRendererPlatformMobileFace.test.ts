import assert from "node:assert/strict";
import { mock, test } from "node:test";

// 守护 renderer 平台适配层的移动远控方法面（spec: mobile-web-remote.md
// 「Renderer 集成面」）：IPlatformService 的 LAN 5 项 + relay 5 项必须在
// createDesktopPlatform 逐一转发到 window.drora。
//
// 背景：renderer 子项目不在根 pnpm typecheck 覆盖内，且 window.drora 的全局
// 类型声明不在 renderer 工程里——缺失转发不会被类型检查拦截；relay 5 项缺失曾让
// “云中继”tab 永久停在“正在准备二维码”（状态兜底 idle、自动开启条件永不成立、
// 无推送、无手动开启入口）。
//
// 运行：cd packages/desktop &&
//   node --import tsx/esm --experimental-test-module-mocks --test \
//     test/desktopRendererPlatformMobileFace.test.ts
// （@drora/ui 源入口含 vite 路径别名，node 下无法加载，这里 mock 掉
// desktopPlatform 顶层唯一的 ui 依赖；desktopBrowserPlatformBridge 在模块求值期
// 只读 window.drora 的可选能力，空 stub 下可安全加载。）

mock.module("@drora/ui", {
  namedExports: { recordArmsCustomEventForE2E: () => {} },
});

const MOBILE_FACE_METHODS = [
  "startMobilePairing",
  "stopMobilePairing",
  "refreshMobilePairing",
  "getMobilePairingState",
  "onMobilePairingStateChanged",
  "startMobileRelayControl",
  "stopMobileRelayControl",
  "refreshMobileRelayControl",
  "getMobileRelayControlState",
  "onMobileRelayStateChanged",
] as const;

type MobileFaceMethod = (typeof MOBILE_FACE_METHODS)[number];

function installWindowDroraStub() {
  const invocations: Array<{ method: string; args: unknown[] }> = [];
  const listeners = new Map<string, (state: unknown) => void>();
  const stub: Record<string, unknown> = {};
  for (const method of MOBILE_FACE_METHODS) {
    stub[method] = (...args: unknown[]) => {
      invocations.push({ method, args });
      if (method === "onMobilePairingStateChanged" || method === "onMobileRelayStateChanged") {
        listeners.set(method, args[0] as (state: unknown) => void);
        return () => {};
      }
      if (method === "getMobilePairingState" || method === "getMobileRelayControlState") {
        return { running: false, status: "idle" };
      }
      if (method === "startMobilePairing" || method === "refreshMobilePairing") {
        return { url: `stub://${method}`, port: 12345 };
      }
      if (method === "startMobileRelayControl" || method === "refreshMobileRelayControl") {
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

test("createDesktopPlatform 转发移动远控全方法面（LAN 5 + relay 5）", async () => {
  const { invocations, listeners } = installWindowDroraStub();
  const { createDesktopPlatform } = await import("../src/renderer/src/desktopPlatform.js");
  const platform = createDesktopPlatform({ isLocalDevelopmentRuntime: false });

  // 全部 10 个方法必须存在——缺失任意一项，对应传输在弹层内就没有可用链路。
  for (const method of MOBILE_FACE_METHODS) {
    assert.equal(
      typeof platform[method],
      "function",
      `platform.${method} 未转发到 window.drora（云中继/局域网弹层将无法工作）`,
    );
  }

  await platform.startMobileRelayControl?.({ workspacePath: "D:/w" });
  assert.deepEqual(invocations.at(-1), {
    method: "startMobileRelayControl",
    args: [{ workspacePath: "D:/w" }],
  });

  await platform.getMobileRelayControlState?.();
  assert.equal(invocations.at(-1)?.method, "getMobileRelayControlState");

  await platform.refreshMobileRelayControl?.();
  assert.equal(invocations.at(-1)?.method, "refreshMobileRelayControl");

  await platform.stopMobileRelayControl?.();
  assert.equal(invocations.at(-1)?.method, "stopMobileRelayControl");

  // 订阅面：回调必须接到 window.drora 的同名订阅上，否则弹层收不到状态推送。
  const relayListener = (state: unknown) => state;
  platform.onMobileRelayStateChanged?.(relayListener);
  assert.equal(listeners.get("onMobileRelayStateChanged"), relayListener);

  const lanListener = (state: unknown) => state;
  platform.onMobilePairingStateChanged?.(lanListener);
  assert.equal(listeners.get("onMobilePairingStateChanged"), lanListener);

  await platform.refreshMobilePairing?.();
  assert.equal(invocations.at(-1)?.method, "refreshMobilePairing");
});
