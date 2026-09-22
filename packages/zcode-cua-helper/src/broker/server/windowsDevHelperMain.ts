import { z } from "zod";
import { isWindowsNamedPipePath } from "../socketPath.js";
import { BROKER_TOKEN_ENV } from "../brokerAuth.js";
import { loadRealNativeAddon } from "./helperAddonLoader.js";
import { startLauncherLivenessWatchdog } from "./helperLifecycle.js";
import { runHelper } from "./helperMain.js";
import { createNodeSystemSurface } from "./nodeSystemSurface.js";

var WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";
var configSchema = z.object({
  platform: z.literal("win32"),
  socketPath: z
    .string()
    .refine((path) => isWindowsNamedPipePath(path) && path.length > "\\\\.\\pipe\\".length),
  parentPid: z.coerce.number().int().positive(),
  token: z.string().trim().min(1),
});
function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? void 0 : argv[index + 1];
}
function parseWindowsDevHelperConfig(input) {
  const args = input.argv.slice(2);
  // token 只从环境变量（BROKER_TOKEN_ENV）读取；命令行出现 --token 视为配置错误，
  // 避免鉴权凭据进入进程参数列表（与原版发行物一致）。
  if (args.includes("--token") || args.length !== 4 || !args.includes("--socket") || !args.includes("--parent-pid")) {
    throw new Error("Invalid Windows Computer Use Helper configuration");
  }
  const parsed = configSchema.safeParse({
    platform: input.platform,
    socketPath: argumentValue(input.argv, "--socket"),
    parentPid: argumentValue(input.argv, "--parent-pid"),
    token: input.env[BROKER_TOKEN_ENV],
  });
  if (!parsed.success) {
    throw new Error("Invalid Windows Computer Use Helper configuration");
  }
  return {
    socketPath: parsed.data.socketPath,
    parentPid: parsed.data.parentPid,
    token: parsed.data.token,
  };
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
  let running;
  let boundSocketPath;
  try {
    const native = loadNativeAddon({ platform: "win32" });
    const system = createSystemSurface({
      platform: "win32",
      // 根因：源码 Windows Helper 走独立组合根，不经过 helperMain 的产品入口；
      // 仅在那里注入 AUMID activator 会让 dev Helper 继续按“能力缺失”拒绝。
      // 这里从同一个已加载 addon 显式注入，旧 addon 缺导出时保持 fail closed。
      ...(typeof native.activateApplicationByAumid === "function"
        ? {
            windowsActivateApplicationByAumid: (aumid) =>
              native.activateApplicationByAumid?.(aumid),
          }
        : {}),
    });
    running = await startBroker({
      native,
      system,
      socketPath: config2.socketPath,
      authToken: config2.token,
      onReady: ({ socketPath }) => {
        boundSocketPath = socketPath;
      },
    });
  } catch {
    await writeErrorAndExit(runtime, "Windows Computer Use Helper failed to start.", 1);
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
