// 还原自发行 bundle（官方 @zcode/zcode-cua 0.6.5 win32 entry，cua-helper.zip 解包
// dist/windows-helper.js；逐字锚=解包文件行号 + 字节偏移，参照副本
// native/reverse/data/win32-0.6.5-js-contract.md）：
//   WINDOWS_DEV_CONTROL_PROTOCOL @34003（字节 1342880 区）
//   createDeferredSurface @34004-34047（字节 1343453）
//   configSchema @34048-34052（字节 1344726，0.6.5 无 token 字段）
//   parseWindowsDevHelperConfig @34053-34090（字节 1345013）
//   PeerIdentityAuthGateError @34091-34092 / assertPeerIdentityAuthCapable
//   @34093-34099（字节 1346643/1346700）
//   enableGhostCursorOnNative @34162-34166（字节 1348932）
//   runWindowsDevHelper @34167-34334（字节 1349140；transport_ready 消息
//   @34199-34204 字节 1350913）
// 0.6.3→0.6.5 增量（本文件全部差异面）：argv allowedFlags 过滤 + ghost 双旗返回
// （@34055-34058/@34064-34065/@34087-34088）+ enableGhostCursorOnNative 双分支接线
// （@34208/@34222）。0.6.3 面的 defer/gate/transport_ready/gateDetail 在官方 0.6.3
// entry（runtime/cua-helper/dist/windows-helper.js:25645-25860 区）与 0.6.5 完全同文。
// 品牌豁免（specs/drora-rename.md）：用户可见文案 ZCode→Drora；env 契约键
// ZCODE_CUA_DEV_MODE / ZCODE_CUA_HELPER_ALLOW_UNAUTHENTICATED_LOCAL 保持原名。
import { z } from "zod";
import { isWindowsNamedPipePath } from "../socketPath.js";
import { BrokerError } from "../types.js";
import {
  HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG,
  HELPER_GHOST_CURSOR_OVERLAY_ARG,
} from "../helperConstants.js";
import {
  WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN,
  isUnauthenticatedLocalDevRequested,
} from "./helperLocalDevAuthorization.js";
import { loadRealNativeAddon } from "./helperAddonLoader.js";
import { startLauncherLivenessWatchdog } from "./helperLifecycle.js";
import { runHelper } from "./helperMain.js";
import { createNodeSystemSurface } from "./nodeSystemSurface.js";

var WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";
// 官方 @34004-34047（字节 1343453）：延迟原生初始化的占位 surface。setTarget 前任何
// 方法调用抛 broker_unavailable "warming up"；setTarget 后缺导出抛 unimplemented。
function createDeferredSurface(name) {
  let target = null;
  const invoke = (property, args) => {
    const member = target ? Reflect.get(target, property) : void 0;
    if (typeof member === "function") return member.apply(target, args);
    if (target && member !== void 0) return member;
    if (target) {
      throw new BrokerError("unimplemented", `${name} does not implement ${String(property)}`, {
        ready_state: "ready",
        request_delivery_state: "not_sent",
      });
    }
    throw new BrokerError("broker_unavailable", `${name} is warming up`, {
      ready_state: "warming_up",
      request_delivery_state: "not_sent",
    });
  };
  const surface = new Proxy(
    {},
    {
      get(_value, property) {
        if (target) {
          const member = Reflect.get(target, property);
          if (member === void 0) return void 0;
          if (typeof member === "function") {
            return (...args) => member.apply(target, args);
          }
          return member;
        }
        return (...args) => invoke(property, args);
      },
      has(_value, property) {
        return target ? Reflect.has(target, property) : false;
      },
    },
  );
  return {
    surface,
    setTarget(next) {
      target = next;
    },
  };
}
// 官方 @34048-34052（字节 1344726）：0.6.5 schema 无 token 字段（0.6.3 官方同样无；
// 本仓 0.6.3 还原稿误加的 token/BROKER_TOKEN_ENV 门按 token 退场口径移除——官方
// entry 全文 authToken 零出现，win 0.6.5 鉴权=版本门+管道命名空间）。
var configSchema = z.object({
  platform: z.literal("win32"),
  socketPath: z
    .string()
    .refine((path) => isWindowsNamedPipePath(path) && path.length > "\\\\.\\pipe\\".length),
  parentPid: z.coerce.number().int().positive(),
});
// 官方 @34053-34090（字节 1345013）逐字：allowedFlags={--ghost-cursor-overlay,
// --disable-multi-cursor-overlay} 先滤出、positional 恰 4、extras 拒绝、返回条件展开
// 的 ghostCursorOverlay/disableMultiCursorOverlay。--token 不在 allowedFlags，出现在
// argv 即按 extras/positional 计数拒绝（鉴权凭据不进进程参数表）。
function parseWindowsDevHelperConfig(input) {
  const args = input.argv.slice(2);
  const allowedFlags = new Set([HELPER_GHOST_CURSOR_OVERLAY_ARG, HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG]);
  const positional = [];
  for (const token of args) {
    if (allowedFlags.has(token)) continue;
    positional.push(token);
  }
  const ghostCursorOverlay = args.includes(HELPER_GHOST_CURSOR_OVERLAY_ARG);
  const disableMultiCursorOverlay = args.includes(HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG);
  const socketIndex = positional.indexOf("--socket");
  const pidIndex = positional.indexOf("--parent-pid");
  const socketValue = socketIndex >= 0 ? positional[socketIndex + 1] : void 0;
  const pidValue = pidIndex >= 0 ? positional[pidIndex + 1] : void 0;
  const extras = positional.filter(
    (token, index) =>
      token !== "--socket" &&
      token !== "--parent-pid" &&
      index !== socketIndex + 1 &&
      index !== pidIndex + 1,
  );
  if (
    positional.length !== 4 ||
    socketIndex < 0 ||
    pidIndex < 0 ||
    socketValue === void 0 ||
    pidValue === void 0 ||
    extras.length > 0
  ) {
    throw new Error("Invalid Windows Computer Use Helper configuration");
  }
  const parsed = configSchema.safeParse({
    platform: input.platform,
    socketPath: socketValue,
    parentPid: pidValue,
  });
  if (!parsed.success) {
    throw new Error("Invalid Windows Computer Use Helper configuration");
  }
  return {
    socketPath: parsed.data.socketPath,
    parentPid: parsed.data.parentPid,
    ...ghostCursorOverlay ? { ghostCursorOverlay: true } : {},
    ...disableMultiCursorOverlay ? { disableMultiCursorOverlay: true } : {},
  };
}
// 官方 @34091-34092（字节 1346643）：门失败异常类型（catch 侧按 instanceof 拼 gateDetail）。
var PeerIdentityAuthGateError = class extends Error {};
// 官方 @34093-34099（字节 1346700）逐字；文案品牌词 ZCode→Drora（specs/drora-rename.md
// 豁免），env 契约键 ZCODE_CUA_DEV_MODE 原名保留。
function assertPeerIdentityAuthCapable(native, allowUnauthenticatedLocalDev) {
  const capable =
    typeof native.getPeerCredentials === "function" &&
    typeof native.verifyProcessCodeSignatureWithAuditToken === "function" &&
    typeof native.verifyProcessCodeSignature === "function" &&
    typeof native.parentProcessPid === "function";
  if (capable || allowUnauthenticatedLocalDev) return;
  throw new PeerIdentityAuthGateError(
    "Drora Computer Use broker requires native peer-identity primitives (getPeerCredentials / code-signature / parentProcessPid); refusing to start an unauthenticated broker. Windows peer verification lands separately; for local development set ZCODE_CUA_DEV_MODE=1.",
  );
}
function processRuntime() {
  return {
    argv: process.argv,
    env: process.env,
    platform: process.platform,
    pid: process.pid,
    // process.send 依赖 ChildProcess 内部 this，不能直接作为裸函数透传。
    send: process.send ? (message, callback) => process.send?.(message, callback) : void 0,
    exit: (code) => process.exit(code),
    on: (event, listener) => process.on(event, listener),
    off: (event, listener) => process.off(event, listener),
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  };
}
function sendControl(runtime, message) {
  const send = runtime.send;
  if (send) {
    return new Promise((resolve2) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve2(ok);
      };
      try {
        send(message, (error51) => finish(!error51));
      } catch {
        finish(false);
      }
    });
  }
  try {
    runtime.writeStdout?.(`${JSON.stringify(message)}
`);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}
function safeExit(runtime, code) {
  try {
    runtime.exit(code);
  } catch {}
}
async function writeErrorAndExit(runtime, message, code) {
  try {
    await sendControl(runtime, {
      protocol: WINDOWS_DEV_CONTROL_PROTOCOL,
      type: "error",
      message,
    });
    try {
      runtime.writeStderr?.(`${message}
`);
    } catch {}
  } finally {
    safeExit(runtime, code);
  }
}
// 官方 @34162-34166（字节 1348932）逐字：argv 未带 --ghost-cursor-overlay 整函数
// no-op；两个调用全可选链——旧 addon 缺导出时 no-op 降级不炸。
function enableGhostCursorOnNative(native, config2) {
  if (!config2.ghostCursorOverlay) return;
  native.ghostSetEnabled?.(true);
  native.ghostSetMultiCursorEnabled?.(!config2.disableMultiCursorOverlay);
}
export async function runWindowsDevHelper(options: any = {}) {
  const runtime: any = options.runtime ?? processRuntime();
  let config2;
  try {
    config2 = parseWindowsDevHelperConfig(runtime);
  } catch {
    await writeErrorAndExit(runtime, "Windows Computer Use Helper failed to start.", 2);
    return void 0;
  }
  const loadNativeAddon: any = options.loadNativeAddon ?? loadRealNativeAddon;
  const createSystemSurface: any = options.createSystemSurface ?? createNodeSystemSurface;
  const startBroker: any = options.startBroker ?? runHelper;
  const startWatchdog: any = options.startLivenessWatchdog ?? startLauncherLivenessWatchdog;
  // 官方 @34180：未注入 startBroker（生产路径）恒走延迟分支——transport 就绪后再加载
  // 真原生面，冷启动时 broker 先应答 broker_info。
  const deferNativeInitialization = options.deferNativeInitialization ?? options.startBroker === void 0;
  // 官方 @34181-34186：常量 true 恒开门；非显式 local dev 请求时打 stderr 告警
  // （原文无品牌词，逐字保留）。
  const allowUnauthenticatedLocalDev =
    isUnauthenticatedLocalDevRequested(runtime.env) || WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN;
  if (WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN && !isUnauthenticatedLocalDevRequested(runtime.env)) {
    runtime.writeStderr?.(
      "cua windows helper: peer identity verification temporarily disabled (WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN); any local process can drive Computer Use\n",
    );
  }
  let running;
  let boundSocketPath;
  try {
    if (deferNativeInitialization) {
      // 官方 @34190-34218：延迟分支只传 6 字段（native/system=占位 surface、
      // deferBackendInitialization:true、onTransportReady、onReady），无 authToken。
      const deferredNative = createDeferredSurface("Windows CUA native backend");
      const deferredSystem = createDeferredSurface("Windows CUA system surface");
      running = await startBroker({
        native: deferredNative.surface,
        system: deferredSystem.surface,
        socketPath: config2.socketPath,
        deferBackendInitialization: true,
        // 官方 @34198-34214 顺序：transport_ready 控制消息（失败即抛）→loadNativeAddon→
        // 门校验→enableGhostCursorOnNative→createSystemSurface→setTarget 接管。
        onTransportReady: async ({ socketPath }) => {
          const sent = await sendControl(runtime, {
            protocol: WINDOWS_DEV_CONTROL_PROTOCOL,
            type: "transport_ready",
            socketPath,
            pid: runtime.pid,
          });
          if (!sent) throw new Error("transport-ready IPC channel closed");
          const native = loadNativeAddon({ platform: "win32" });
          assertPeerIdentityAuthCapable(native, allowUnauthenticatedLocalDev);
          enableGhostCursorOnNative(native, config2);
          const system = createSystemSurface({
            platform: "win32",
          });
          deferredNative.setTarget(native);
          deferredSystem.setTarget(system);
        },
        onReady: ({ socketPath }) => {
          boundSocketPath = socketPath;
        },
      });
    } else {
      // 官方 @34219-34234：立即分支只传 4 字段（native/system/socketPath/onReady），
      // 不传 deferBackendInitialization（runHelper 严格 === true 才延迟）。
      const native = loadNativeAddon({ platform: "win32" });
      assertPeerIdentityAuthCapable(native, allowUnauthenticatedLocalDev);
      enableGhostCursorOnNative(native, config2);
      const system = createSystemSurface({
        platform: "win32",
      });
      running = await startBroker({
        native,
        system,
        socketPath: config2.socketPath,
        onReady: ({ socketPath }) => {
          boundSocketPath = socketPath;
        },
      });
    }
  } catch (error51) {
    // 官方 @34235-34242：仅 PeerIdentityAuthGateError 拼接 `: ${message}` 后缀，
    // 其余异常（含 transport-ready IPC channel closed）固定文案；退出码 1。
    const gateDetail = error51 instanceof PeerIdentityAuthGateError ? `: ${error51.message}` : "";
    await writeErrorAndExit(runtime, `Windows Computer Use Helper failed to start.${gateDetail}`, 1);
    return void 0;
  }
  let stopPromise;
  let cancelWatchdog = () => {};
  const listeners = [];
  const removeListeners = () => {
    for (const [event, listener] of listeners) {
      try {
        runtime.off(event, listener);
      } catch {}
    }
    listeners.length = 0;
  };
  const cancelLifecycle = () => {
    try {
      cancelWatchdog();
    } catch {}
    removeListeners();
  };
  const shutdown = (startupFailure) => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      cancelLifecycle();
      let failed = startupFailure;
      try {
        await running.stop();
      } catch {
        failed = true;
      }
      if (failed) {
        try {
          await sendControl(runtime, {
            protocol: WINDOWS_DEV_CONTROL_PROTOCOL,
            type: "error",
            message: startupFailure
              ? "Windows Computer Use Helper failed to start."
              : "Windows Computer Use Helper failed to stop safely.",
          });
        } finally {
          safeExit(runtime, 1);
        }
      } else {
        safeExit(runtime, 0);
      }
    })().catch(() => {
      safeExit(runtime, 1);
    });
    return stopPromise;
  };
  const stop = () => shutdown(false);
  const requestStop = () => {
    void stop().catch(() => {});
  };
  const shutdownMessage = (message) => {
    if (
      message &&
      typeof message === "object" &&
      message.protocol === WINDOWS_DEV_CONTROL_PROTOCOL &&
      message.type === "shutdown"
    )
      requestStop();
  };
  const addListener = (event, listener) => {
    runtime.on(event, listener);
    listeners.push([event, listener]);
  };
  try {
    addListener("message", shutdownMessage);
    addListener("disconnect", requestStop);
    addListener("SIGINT", requestStop);
    addListener("SIGTERM", requestStop);
    const watchdog = startWatchdog(config2.parentPid, requestStop);
    if (stopPromise) {
      try {
        watchdog();
      } catch {}
      return void 0;
    }
    cancelWatchdog = watchdog;
    if (!boundSocketPath) throw new Error("broker did not report a bound socket");
    const readySent = await sendControl(runtime, {
      protocol: WINDOWS_DEV_CONTROL_PROTOCOL,
      type: "ready",
      socketPath: boundSocketPath,
      pid: runtime.pid,
    });
    if (!readySent) {
      await shutdown(true);
      return void 0;
    }
  } catch {
    await shutdown(true);
    return void 0;
  }
  return { stop };
}
