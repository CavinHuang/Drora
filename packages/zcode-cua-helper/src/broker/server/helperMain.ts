// oxlint-disable-file
// 还原自原版 helper SEA payload（dist/broker/server/helperMain.js 完整区）。
// runHelper + main(argv) 驱动 + 权限请求模式 + launcher 验证 + controller 接线。
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { timingSafeEqual, createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { BROKER_TOKEN_ENV, tokensMatch } from "../brokerAuth.js";
import { createDefaultHelperPidEvidenceProvider } from "./helperReaper.js";
import {
  CUA_HELPER_INSTALL_VARIANTS,
  HELPER_ALLOW_EXTERNAL_BROKER_CLIENT_LOCAL_DEV_ARG,
  HELPER_BUNDLE_ID,
  HELPER_CONTROLLER_VARIANT_ARG,
  HELPER_DISPLAY_NAME,
  HELPER_PIP_LIVE_PROBE_ARG,
  HELPER_PERMISSION_PREFLIGHT_ARG,
  HELPER_PERMISSION_PREFLIGHT_RESULT_FILE_ARG,
  HELPER_PERMISSION_REQUEST_CANCEL_FILE_ARG,
  HELPER_PERMISSION_REQUEST_DEADLINE_ARG,
  HELPER_GHOST_CURSOR_OVERLAY_ARG,
  HELPER_PIP_MODE_ARG,
  HELPER_GHOST_CURSOR_CAPTURE_ARG,
  HELPER_BACKGROUND_MODE_ARG,
} from "../helperConstants.js";
import { BrokerError, controllerBusy } from "../types.js";
import { createPipSessionBrokerHandlers } from "../../pip-session/broker-handlers.js";
import { createPipSessionCoordinator } from "../../pip-session/coordinator.js";
import { createPipPresentationScheduler } from "../../pip-session/presentation-scheduler.js";
import { CuaPermissionBrokerServer } from "./brokerServer.js";
import { loadRealNativeAddon } from "./helperAddonLoader.js";
import { startLauncherLivenessWatchdog } from "./helperLifecycle.js";
import {
  isUnauthenticatedLocalDevAllowed,
  isUnsignedLauncherLocalDevAllowed,
} from "./helperLocalDevAuthorization.js";
import { parseLauncherPid, parseStartupTtlMs } from "./helperLifecycle.js";
import { createNodeSystemSurface } from "./nodeSystemSurface.js";
import { createNodeAutomationAdapter } from "./nodeAutomationAdapter.js";
import { createBrokerInfo, createRuntimeAuthorizationSubjectDiagnostics } from "./nativeBackend.js";
import { createPeerVerifier, isLauncherTrustedZCode } from "./peerVerifier.js";
import { createCuaControllerLease } from "./controllerLease.js";
import { createCuaControllerCoordinator } from "./controllerCoordinator.js";
import { shouldCancelCuaHelperBrokerLaunch } from "./helperLaunchGuard.js";
import { resolveZCodeLauncherCodeRequirement } from "./helperVerifier.js";
import { MACOS_SYSTEM_COMMANDS } from "./macosSystemCommands.js";
import { releaseElectronPointerHoldForShutdown } from "./electronInputHandlers.js";
import { createElectronNativeBackend } from "./electronNativeBackend.js";
import { selectPlatformAxSource } from "./platformAxSource.js";
import { cropLinuxWindowFromScreen } from "./linuxWindowCapture.js";
function safeGetPgid() {
  try {
    const fn = (process as any).getpgid;
    return typeof fn === "function" ? fn.call(process) : "n/a";
  } catch {
    return "err";
  }
}
function helperInstalledPathPrefix(env = process.env) {
  const zcodeHome =
    env.ZCODE_HOME?.trim() || (env.HOME?.trim() ? join(env.HOME.trim(), ".zcode") : null);
  return zcodeHome ? `${join(zcodeHome, "computer-use")}/` : void 0;
}
function isAccessibilityPermissionRequestMode(argv) {
  const requestIndex = argv.indexOf("--permission-request");
  return (
    requestIndex >= 0 &&
    (argv[requestIndex + 1] === "accessibility" || argv[requestIndex + 1] === void 0)
  );
}
function runAccessibilityPermissionRequest(native) {
  return { permission: "accessibility", trusted: native.promptTrust() };
}
function isScreenRecordingPermissionRequestMode(argv) {
  const requestIndex = argv.indexOf("--permission-request");
  return requestIndex >= 0 && argv[requestIndex + 1] === "screen_recording";
}
function runScreenRecordingPermissionRequest(native) {
  return {
    permission: "screen_recording",
    trusted: native.requestScreenCaptureAccess?.() ?? false,
  };
}
function loadAndRunAccessibilityPermissionRequest(argv, loadNative = loadRealNativeAddon) {
  if (shouldCancelHelperPermissionRequest(argv)) return null;
  const native = loadNative();
  if (shouldCancelHelperPermissionRequest(argv)) return null;
  return runAccessibilityPermissionRequest(native);
}
function loadAndRunScreenRecordingPermissionRequest(argv, loadNative = loadRealNativeAddon) {
  if (shouldCancelHelperPermissionRequest(argv)) return null;
  const native = loadNative();
  if (shouldCancelHelperPermissionRequest(argv)) return null;
  return runScreenRecordingPermissionRequest(native);
}
function isScreenRecordingPreflightMode(argv) {
  const index = argv.indexOf(HELPER_PERMISSION_PREFLIGHT_ARG);
  return index >= 0 && argv[index + 1] === "screen_recording";
}
function runScreenRecordingPreflight(native, argv) {
  const result = {
    permission: "screen_recording",
    state: native.screenCaptureStatus(),
  };
  const fileIndex = argv.indexOf(HELPER_PERMISSION_PREFLIGHT_RESULT_FILE_ARG);
  const resultFile = fileIndex >= 0 ? argv[fileIndex + 1] : void 0;
  if (resultFile) writeFileSync(resultFile, JSON.stringify(result), "utf8");
  return result;
}
function loadAndRunScreenRecordingPreflight(argv, loadNative = loadRealNativeAddon) {
  return runScreenRecordingPreflight(loadNative(), argv);
}
function shouldCancelHelperPermissionRequest(argv, options: any = {}) {
  const deadlineIndex = argv.indexOf(HELPER_PERMISSION_REQUEST_DEADLINE_ARG);
  if (deadlineIndex >= 0) {
    const rawDeadline = argv[deadlineIndex + 1];
    const deadline = rawDeadline ? Number(rawDeadline) : Number.NaN;
    if (
      !Number.isSafeInteger(deadline) ||
      deadline <= 0 ||
      (options.now ?? Date.now()) >= deadline
    ) {
      return true;
    }
  }
  const cancelIndex = argv.indexOf(HELPER_PERMISSION_REQUEST_CANCEL_FILE_ARG);
  if (cancelIndex >= 0) {
    const cancelFile = argv[cancelIndex + 1];
    if (!cancelFile || !isAbsolute(cancelFile)) return true;
    if ((options.cancelFileExists ?? existsSync)(cancelFile)) return true;
  }
  return false;
}
function createPipLiveProbeDragPanelHandler(native) {
  return async (params) => {
    const start = params.start;
    const end = params.end;
    if (
      !start ||
      !end ||
      typeof start.x !== "number" ||
      typeof start.y !== "number" ||
      typeof end.x !== "number" ||
      typeof end.y !== "number" ||
      typeof native.dragAsync !== "function"
    ) {
      return { ok: false, reason: "invalid_or_unavailable_drag" };
    }
    try {
      const posted = await native.dragAsync(start.x, start.y, end.x, end.y, "left", "");
      return posted === true
        ? { ok: true }
        : // Distinguish a resolved-false native verdict (admission exhausted,
          // point outside the panel, invariant changed) from a thrown rejection.
          { ok: false, reason: "drag_async_returned_false" };
    } catch {
      return { ok: false, reason: "drag_async_rejected" };
    }
  };
}
export async function runHelper(options: any) {
  const brokerInfo =
    options.brokerInfo ??
    createBrokerInfo({
      bundleId: HELPER_BUNDLE_ID,
      displayName: HELPER_DISPLAY_NAME,
      version: options.version ?? "0.0.0",
      authorizationSubject: createRuntimeAuthorizationSubjectDiagnostics({
        bundleId: HELPER_BUNDLE_ID,
        displayName: HELPER_DISPLAY_NAME,
        version: options.version ?? "0.0.0",
        installedAppPathPrefix: helperInstalledPathPrefix(),
      }),
    });
  const pipSessionEnabled =
    Boolean(options.presentationAuthToken) && options.enablePipSession !== false;
  let adapter;
  let pipPresentationScheduler = null;
  let pipSessionCoordinator = null;
  let activeBackend = null;
  const initializeBackend = () => {
    const { axSource, roleToKind: roleToKind3 } = selectPlatformAxSource({
      native: options.native,
      captureWindowPng: (windowId) => options.system.captureWindowPng(windowId),
      // Linux capture_app 的 per-window screenshot：抓一张全屏帧（gnome-screenshot/
      // scrot/import 都支持，与 binary 无关），再由 sharp 按 AX window bounds 裁剪。
      // gnome-screenshot 不支持区域 crop、import 只能抓 root，所以在 TS 层用 sharp
      // 统一裁剪，避免依赖具体 binary 的区域 flag。失败回退 screenshot:null（不降级 AX 树）。
      captureWindowRegionPng:
        process.platform === "linux"
          ? async (bounds) => {
              const fullPng = await options.system.captureScreenPng(void 0);
              if (!fullPng) return null;
              return cropLinuxWindowFromScreen(fullPng, bounds);
            }
          : void 0,
    });
    const nextAdapter = createNodeAutomationAdapter({
      native: options.native,
      system: options.system,
      virtualPointerEnabled: options.virtualPointerEnabled,
      logger: options.logger,
    });
    if (pipSessionEnabled) {
      options.native.pipSetEnabled?.(true);
    }
    const reportedPipDiagnostics = /* @__PURE__ */ new Set();
    const warnPipOnce = (key, message, evidence?) => {
      if (reportedPipDiagnostics.has(key)) return;
      reportedPipDiagnostics.add(key);
      options.logger?.warn(void 0, message, evidence);
    };
    const nextPipPresentationScheduler = options.pipSessionEffects
      ? null
      : createPipPresentationScheduler({
          native: {
            setActiveGroup(group) {
              nextAdapter.pipSetActiveGroup?.(group);
            },
            beginTurn(group) {
              nextAdapter.pipBeginTurn?.(group);
            },
            taskCompleted(group, success2) {
              nextAdapter.pipTaskCompleted?.(group, success2);
            },
            freezeGroup(group) {
              nextAdapter.pipFreezeGroup?.(group);
            },
            startComposite(target) {
              if (!nextAdapter.pipStartVerifiedComposite) return false;
              return nextAdapter.pipStartVerifiedComposite(
                target.presentationWindowId,
                target.windowId,
                target.pid,
                target.bundleId,
                0,
                0,
                target.sessionId,
              );
            },
          },
          debug(message, details) {
            options.logger?.debug(void 0, message, details);
          },
          info(message, details) {
            options.logger?.info(void 0, message, details);
          },
          warn(message, details) {
            const sessionId =
              typeof details?.sessionId === "string" ? details.sessionId : "unknown";
            const presentationWindowId =
              typeof details?.presentationWindowId === "number" ? details.presentationWindowId : 0;
            warnPipOnce(
              `${message}:${sessionId}:${presentationWindowId}`,
              message,
              JSON.stringify(details ?? {}),
            );
          },
        });
    const nextPipSessionCoordinator = createPipSessionCoordinator({
      effects: options.pipSessionEffects ?? nextPipPresentationScheduler,
    });
    const nextBackend = createElectronNativeBackend({
      adapter: nextAdapter,
      // linux/win32 adapter 可能 fail-closed 返回 null（非 X11 / Session 0）。null → undefined：
      // backend 把"无 axSource"视为纯 Electron 路径，AX 观测方法保持 fail-closed 基线，绝不伪造空树。
      axSource: axSource ?? void 0,
      brokerInfo,
      onPipCaptureWindow: (target, context) => {
        if (!target) return;
        if (!context || !target.bundleId) {
          warnPipOnce(
            !context ? "missing-request-context" : "missing-bundle-id",
            `PiP session capture binding skipped (${!context ? "missing request context" : "missing bundle id"})`,
          );
          return;
        }
        const binding = pipCaptureBindingFromWindow(target, context);
        if (binding) nextPipSessionCoordinator.bindCapture(binding);
      },
      // roleToKind 仅 linux/win32 非 undefined 时透传（darwin 留 undefined → 默认 macOS ROLE_TO_KIND）。
      ...(roleToKind3 ? { roleToKind: roleToKind3 } : {}),
    });
    if (options.getControllerStatus) {
      const brokerInfoHandler = nextBackend.broker_info;
      nextBackend.broker_info = async (params) => ({
        ...(await brokerInfoHandler(params)),
        controller: await options.getControllerStatus?.(),
      });
    }
    nextBackend.controller_status = async () =>
      options.getControllerStatus?.() ?? { state: "unavailable" };
    nextBackend.controller_takeover = async () => options.takeoverController?.() ?? { ok: false };
    nextBackend.controller_stop = async () => options.stopController?.() ?? { ok: false };
    Object.assign(
      nextBackend,
      createPipSessionBrokerHandlers({
        coordinator: nextPipSessionCoordinator,
        runtimeReady:
          pipSessionEnabled &&
          typeof nextAdapter.pipStartVerified === "function" &&
          typeof nextAdapter.pipStartVerifiedComposite === "function" &&
          typeof nextAdapter.pipSetActiveGroup === "function" &&
          typeof nextAdapter.pipBeginTurn === "function" &&
          typeof nextAdapter.pipTaskCompleted === "function" &&
          typeof nextAdapter.pipFreezeGroup === "function" &&
          typeof nextAdapter.pipStopTarget === "function" &&
          typeof nextAdapter.pipGetLeadTarget === "function",
      }),
    );
    if (options.enablePipLiveProbe === true) {
      nextBackend.pip_live_probe_start_test_panel = () => {
        if (typeof options.native.pipStartInteractionTestPanel !== "function") {
          return { ok: false, reason: "native_pip_live_probe_unavailable" };
        }
        return { ok: options.native.pipStartInteractionTestPanel() === true };
      };
      nextBackend.pip_live_probe_window_bounds = () =>
        options.native.pipGetWindowBounds?.() ?? null;
      nextBackend.pip_live_probe_drag_panel = createPipLiveProbeDragPanelHandler(options.native);
      nextBackend.pip_live_probe_move_test_panel = (params) => {
        if (
          typeof params.x !== "number" ||
          typeof params.y !== "number" ||
          typeof options.native.pipMoveInteractionTestPanelToPoint !== "function"
        ) {
          return { ok: false, reason: "invalid_or_unavailable_move" };
        }
        return {
          ok: options.native.pipMoveInteractionTestPanelToPoint(params.x, params.y) === true,
        };
      };
      nextBackend.pip_live_probe_sample_ownership = (params) => {
        if (
          typeof params.x !== "number" ||
          typeof params.y !== "number" ||
          typeof options.native.pipSampleInteractionOwnershipAtPoint !== "function"
        ) {
          return { ok: false, reason: "invalid_or_unavailable_sample" };
        }
        return {
          ok:
            options.native.pipSampleInteractionOwnershipAtPoint(
              params.x,
              params.y,
              params.requires_no_underlay === true,
            ) === true,
        };
      };
      nextBackend.pip_live_probe_initial_hit_surface = () => {
        if (typeof options.native.pipVerifyInitialHitSurface !== "function") {
          return { ok: false, reason: "native_initial_hit_surface_unavailable" };
        }
        const eventTapReady = options.native.pipIsInteractionReady?.() === true;
        const surface = options.native.pipVerifyInitialHitSurface();
        const panelHitTestable = surface.panel_hit_testable === true;
        const windowserverFrontmost = surface.windowserver_frontmost === true;
        return {
          ok: eventTapReady && panelHitTestable && windowserverFrontmost,
          event_tap_ready: eventTapReady,
          panel_hit_testable: panelHitTestable,
          windowserver_frontmost: windowserverFrontmost,
          synthetic_event_used: false,
        };
      };
    }
    adapter = nextAdapter;
    pipPresentationScheduler = nextPipPresentationScheduler;
    pipSessionCoordinator = nextPipSessionCoordinator;
    activeBackend = nextBackend;
    return nextBackend;
  };
  // 与原版一致：backend 在 server 监听前同步初始化完成，不做延迟预热
  // （原版发行物中不存在 deferBackendInitialization/onTransportReady 路径）。
  initializeBackend();
  let claimed = false;
  let startupTimer;
  const cancelStartupWatchdog = () => {
    if (startupTimer) {
      clearTimeout(startupTimer);
      startupTimer = void 0;
    }
  };
  const beginTerminalInputShutdown = () => {
    if (!activeBackend) return true;
    try {
      return options.native.cancelPendingInputHolds?.() !== false;
    } catch (error51) {
      options.logger?.error(
        void 0,
        "ZCode Computer Use could not cancel pending native input holds during shutdown",
        error51 instanceof Error ? error51.name : "UnknownError",
      );
      return false;
    }
  };
  const server = new CuaPermissionBrokerServer({
    socketPath: options.socketPath,
    backend: activeBackend,
    authToken: options.authToken ?? null,
    presentationAuthToken: options.presentationAuthToken ?? null,
    logger: options.logger,
    verifyPeer: options.verifyPeer,
    // 认领完成 = 客户端成功拿到 broker_info（health probe 收尾），此时主进程已接管并拿到 pid。只在此刻
    // 取消启动看门狗：若 authenticate 成功但 broker_info 超时/断开，claimed 仍为 false，看门狗照常自杀，
    // 不会留下已认证但无人接管的孤儿 Helper。
    onClientClaim: () => {
      claimed = true;
      cancelStartupWatchdog();
    },
    // startup timeout 与 freeze 前已 reserve 的 broker_info flush 先在 Broker 内仲裁；只有 timeout
    // epoch 真正获胜、准备 terminal drain 时才置位不可逆的 native hold cancellation latch。
    onTerminalStopCommitted: beginTerminalInputShutdown,
    // Pointer ownership is established by broker handlers, including actions
    // that were already admitted when the terminal fence closed. Release only
    // after those actions drain, and fail the clean stop if native up is not
    // confirmed so the same Helper can retry instead of exiting ownerless.
    onTerminalWorkDrained: () => (adapter ? releaseElectronPointerHoldForShutdown(adapter) : true),
    beforeListen: options.startupAllowed,
    admitControllerAction: options.admitControllerAction,
    gracefulStopTimeoutMs: options.gracefulStopTimeoutMs,
  });
  await server.start();
  const startupTtlMs = options.startupClaimTtlMs ?? DEFAULT_STARTUP_CLAIM_TTL_MS;
  if (startupTtlMs > 0) {
    startupTimer = setTimeout(() => {
      startupTimer = void 0;
      if (claimed) return;
      options.logger?.warn(
        void 0,
        `ZCode Computer Use was not claimed within ${startupTtlMs}ms; self-terminating to avoid an orphaned permission subject`,
      );
      void server
        .stopEventually("startup-claim-timeout", (error51) => {
          options.logger?.warn(
            void 0,
            "ZCode Computer Use startup-timeout shutdown did not drain safely",
            error51,
          );
        })
        .then(async () => {
          await options.releaseController?.();
          if (!claimed) options.onStartupClaimTimeout?.();
        })
        .catch((error51) => {
          options.logger?.error(
            void 0,
            "ZCode Computer Use startup-timeout shutdown failed",
            error51,
          );
        });
    }, startupTtlMs);
    startupTimer.unref?.();
  }
  options.onReady?.({ socketPath: options.socketPath });
  return {
    socketPath: options.socketPath,
    stop: async () => {
      cancelStartupWatchdog();
      await server.stopEventually();
      await options.releaseController?.();
      pipPresentationScheduler?.dispose();
      pipSessionCoordinator?.dispose();
      if (pipSessionEnabled && activeBackend) options.native.pipSetEnabled?.(false);
    },
  };
}
(() => {
  const idx = process.argv.indexOf("--exit-log");
  const logPath = idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
  if (!logPath) return;
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    try {
      appendFileSync(logPath, typeof chunk === "string" ? chunk : String(chunk));
    } catch {}
    return originalWrite(chunk, ...rest);
  };
})();

// PiP 会话捕获绑定：从 AX window 元数据解析 bundle id 绑定（payload 25877 区）。
function pipCaptureBindingFromWindow(target, context) {
  if (!target || !context) return null;
  const bundleId = target.bundle_id ?? target.bundleId ?? context.bundleId ?? null;
  if (!bundleId) return null;
  return { bundleId, windowId: target.window_id ?? target.windowId ?? null };
}

function argOf(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : void 0;
}
function resolveControllerVariantFromArgv(argv) {
  const requested = argOf(argv, HELPER_CONTROLLER_VARIANT_ARG)?.trim();
  return CUA_HELPER_INSTALL_VARIANTS.includes(requested) ? requested : "standalone";
}
var DEFAULT_STARTUP_CLAIM_TTL_MS = 9e4;
function helperRuntimeLogger() {
  const write = (level, args) => {
    const event = typeof args[0] === "string" ? args[0] : "helper runtime event";
    const evidence = args.length > 1 && args[1] && typeof args[1] === "object" ? args[1] : void 0;
    process.stderr.write(`${JSON.stringify({ scope: "zcode-cua-helper", level, event, evidence })}
`);
  };
  return {
    // RPC 逐条 trace 属于高频协议日志，Helper 本地文件不记录。
    debug: () => {},
    info: (_traceId, ...args) => write("info", args),
    warn: (_traceId, ...args) => write("warn", args),
    error: (_traceId, ...args) => write("error", args),
  };
}
function isExternalBrokerClientLocalDevAllowed(
  argv,
  embeddedAllowsUnsignedLauncherLocalDev = false,
) {
  return (
    embeddedAllowsUnsignedLauncherLocalDev &&
    argv.includes(HELPER_ALLOW_EXTERNAL_BROKER_CLIENT_LOCAL_DEV_ARG)
  );
}
function resolveHelperRuntimeVersion(argv, runtimePolicy: any = {}) {
  return runtimePolicy.version ?? argOf(argv, "--version") ?? "0.0.0";
}
function resolveHelperRuntimeBundleId(runtimePolicy: any = {}) {
  return runtimePolicy.bundleId ?? HELPER_BUNDLE_ID;
}
function resolveHelperRuntimeDisplayName(runtimePolicy: any = {}) {
  return runtimePolicy.displayName?.trim() || HELPER_DISPLAY_NAME;
}
export async function main(argv, runtimePolicy: any = {}) {
  if (isAccessibilityPermissionRequestMode(argv)) {
    const result = loadAndRunAccessibilityPermissionRequest(argv);
    if (!result) return;
    process.stdout.write(`${JSON.stringify(result)}
`);
    return;
  }
  if (isScreenRecordingPermissionRequestMode(argv)) {
    const result = loadAndRunScreenRecordingPermissionRequest(argv);
    if (!result) return;
    process.stdout.write(`${JSON.stringify(result)}
`);
    return;
  }
  if (isScreenRecordingPreflightMode(argv)) {
    const result = loadAndRunScreenRecordingPreflight(argv);
    process.stdout.write(`${JSON.stringify(result)}
`);
    return;
  }
  const socketPath = argOf(argv, "--socket") ?? process.env.ZCODE_CUA_PERMISSION_BROKER_SOCKET;
  if (!socketPath) {
    process.stderr.write(
      "ZCode Computer Use requires --socket <path> (or ZCODE_CUA_PERMISSION_BROKER_SOCKET)\n",
    );
    process.exit(2);
    return;
  }
  const brokerLaunchAllowed = () => !shouldCancelCuaHelperBrokerLaunch(argv, socketPath);
  if (!brokerLaunchAllowed()) return;
  const version2 = resolveHelperRuntimeVersion(argv, runtimePolicy);
  const bundleId = resolveHelperRuntimeBundleId(runtimePolicy);
  const displayName = resolveHelperRuntimeDisplayName(runtimePolicy);
  const expectedAppBundlePath = argOf(argv, "--expected-app-bundle-path")?.trim() || void 0;
  const authorizationSubject2 = createRuntimeAuthorizationSubjectDiagnostics({
    bundleId,
    displayName,
    version: version2,
    // Bugfix：产品 Host 明确传入刚发现并验签的 bundle 路径。Helper launch env 故意不继承
    // ZCODE_HOME，不能再用隔离 HOME 反推期望安装根；exact path 会在 diagnostics 内 realpath 后比较，
    // 同时消除 macOS /var 与 /private/var 的同路径别名误警告。
    installedAppPath: expectedAppBundlePath,
    installedAppPathPrefix: expectedAppBundlePath ? void 0 : helperInstalledPathPrefix(),
  });
  const unauthenticatedLocalDev = isUnauthenticatedLocalDevAllowed(
    process.env,
    authorizationSubject2,
    runtimePolicy.allowUnsignedLauncherLocalDev === true,
  );
  if (!argOf(argv, "--token-file") && !unauthenticatedLocalDev) {
    process.stderr.write(
      "ZCode Computer Use broker requires a launcher-minted --token-file; refusing to start an unauthenticated (or attacker-supplied --token/env) broker for an already-authorized Helper.\n",
    );
    process.exit(2);
    return;
  }
  const token = await resolveAuthToken(argv);
  const presentationToken = await resolvePresentationAuthToken(argv);
  if (!brokerLaunchAllowed()) return;
  const enablePipLiveProbe = argv.includes(HELPER_PIP_LIVE_PROBE_ARG);
  if (enablePipLiveProbe) process.env.ZCODE_CUA_LIVE_NATIVE = "1";
  const native = loadRealNativeAddon();
  if (!brokerLaunchAllowed()) return;
  const wantsGhostCursor = argv.includes(HELPER_GHOST_CURSOR_OVERLAY_ARG);
  const wantsPip = argv.includes(HELPER_PIP_MODE_ARG);
  const wantsGhostCapture = argv.includes(HELPER_GHOST_CURSOR_CAPTURE_ARG);
  if (argv.includes(HELPER_BACKGROUND_MODE_ARG) && typeof native.preventActivation === "function") {
    native.preventActivation();
  }
  if (!brokerLaunchAllowed()) return;
  if (!brokerLaunchAllowed()) return;
  const launcherPid = parseLauncherPid(argOf(argv, "--launcher-pid"));
  const unsignedLauncherLocalDev = isUnsignedLauncherLocalDevAllowed(
    argv,
    authorizationSubject2,
    runtimePolicy.allowUnsignedLauncherLocalDev === true,
  );
  const externalBrokerClientLocalDev = isExternalBrokerClientLocalDevAllowed(
    argv,
    runtimePolicy.allowUnsignedLauncherLocalDev === true,
  );
  const nativeVerifyCodeSig = native.verifyProcessCodeSignature;
  const launcherRequirement = resolveZCodeLauncherCodeRequirement(process.env);
  if (!unauthenticatedLocalDev && !unsignedLauncherLocalDev) {
    const launcherTrusted = isLauncherTrustedZCode({
      launcherPid,
      verifyProcessCodeSignature:
        typeof nativeVerifyCodeSig === "function"
          ? (pid, requirement) => nativeVerifyCodeSig.call(native, pid, requirement)
          : void 0,
      requirement: launcherRequirement,
    });
    if (!launcherTrusted) {
      process.stderr.write(
        "ZCode Computer Use broker: --launcher-pid did not verify as a code-signed ZCode process (needs a native verifyProcessCodeSignature build and a launcher matching the ZCode signing requirement); refusing to start.\n",
      );
      process.exit(2);
      return;
    }
  }
  const nativeGetPeerCredentials = native.getPeerCredentials;
  const nativeVerifyCodeSigWithAudit = native.verifyProcessCodeSignatureWithAuditToken;
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  let verifyPeer;
  if (
    typeof nativeGetPeerCredentials === "function" &&
    launcherPid !== null &&
    currentUid !== null
  ) {
    verifyPeer = createPeerVerifier({
      launcherPid,
      currentUid,
      allowSameUidExternalPeerLocalDev: externalBrokerClientLocalDev,
      // 从 Node socket._handle.fd 取底层 fd，调原生 getPeerCredentials 取对端凭据（audit_token 派生的
      // uid/pid）。fd 不可用 / 原生失败或抛错 / 凭据形状非法一律 fail-closed（返回 null）。
      resolvePeerCredentials: (socket) => {
        const handle = socket?._handle;
        const rawFd = handle?.fd;
        const fd =
          typeof rawFd === "number" && Number.isInteger(rawFd) && rawFd >= 0 ? rawFd : null;
        if (fd === null) return null;
        try {
          const cred = nativeGetPeerCredentials.call(native, fd);
          if (
            !cred ||
            !Number.isInteger(cred.uid) ||
            cred.uid < 0 ||
            !Number.isInteger(cred.pid) ||
            cred.pid <= 0
          ) {
            return null;
          }
          return { uid: cred.uid, pid: cred.pid, auditToken: cred.auditToken };
        } catch {
          return null;
        }
      },
      // 用 `ps -o ppid= -p <pid>` 解析父 pid。非法 pid / ps 失败或抛错 / 非数字一律 fail-closed（null）。
      resolveParentPid: (pid) => {
        if (!Number.isInteger(pid) || pid <= 0) return null;
        try {
          const ppid = Number.parseInt(
            execFileSync(MACOS_SYSTEM_COMMANDS.ps, ["-o", "ppid=", "-p", String(pid)], {
              encoding: "utf8",
              timeout: 2e3,
            }).trim(),
            10,
          );
          return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
        } catch {
          return null;
        }
      },
      // per-connection audit_token 代码签名快路径（kSecGuestAttributeAudit，reuse-resistant）。命中 → 直接
      // 采纳（强路径）；未命中/抛错 → createPeerVerifier 内部回退 ancestry。仅当原生提供该变体时配置。
      ...(typeof nativeVerifyCodeSigWithAudit === "function"
        ? {
            verifyPeerCodeSignature: (auditToken) =>
              nativeVerifyCodeSigWithAudit.call(native, auditToken, launcherRequirement),
          }
        : {}),
    });
  } else if (!unauthenticatedLocalDev) {
    process.stderr.write(
      "ZCode Computer Use broker requires peer verification in product mode (needs --launcher-pid and a native getPeerCredentials build); refusing to start.\n",
    );
    process.exit(2);
    return;
  }
  if (!brokerLaunchAllowed()) return;
  const controllerLease = createCuaControllerLease({ env: process.env });
  const controllerVariant = resolveControllerVariantFromArgv(argv);
  const controllerOwner = {
    pid: process.pid,
    appIdentity: {
      bundleId,
      name: displayName,
      teamId: null,
    },
    variant: controllerVariant,
    version: version2,
    socketPath,
    helperPath: expectedAppBundlePath ?? process.execPath,
  };
  const helperPidEvidence = createDefaultHelperPidEvidenceProvider({ env: process.env });
  const controller = createCuaControllerCoordinator({
    lease: controllerLease,
    owner: controllerOwner,
    visuals: native,
    wantsGhostCursor,
    wantsPip,
    wantsGhostCapture,
    helperPidEvidence,
  });
  const running = await runHelper({
    native,
    system: createNodeSystemSurface({
      // 根因：packaged app 的 HWND 可能属于 ApplicationFrameHost.exe，不能用
      // spawn PID/executable 换绑。只把当前 Helper 已加载的原生 AUMID 激活 ABI 注入
      // Windows system surface；旧 addon 缺失时保持 fail closed。
      windowsActivateApplicationByAumid:
        typeof native.activateApplicationByAumid === "function"
          ? (aumid) => native.activateApplicationByAumid?.(aumid)
          : void 0,
    }),
    socketPath,
    authToken: token,
    presentationAuthToken: presentationToken,
    enablePipSession: wantsPip,
    virtualPointerEnabled: argv.includes(HELPER_GHOST_CURSOR_OVERLAY_ARG),
    version: version2,
    logger: helperRuntimeLogger(),
    brokerInfo: createBrokerInfo({
      bundleId,
      displayName,
      version: version2,
      authorizationSubject: authorizationSubject2,
    }),
    verifyPeer,
    startupAllowed: brokerLaunchAllowed,
    admitControllerAction: controller.admitAction,
    getControllerStatus: controller.status,
    takeoverController: controller.takeover,
    stopController: controller.stop,
    releaseController: controller.release,
    isController: controller.ownsLease,
    enablePipLiveProbe,
    onReady: ({ socketPath: resolved }) =>
      process.stdout.write(`${JSON.stringify({ ready: true, socket: resolved })}
`),
    // 可选覆盖启动认领 TTL（不传则用 runHelper 内置默认）；超时未被认领则自行退出。
    startupClaimTtlMs: parseStartupTtlMs(argOf(argv, "--startup-ttl-ms")),
    onStartupClaimTimeout: () => {
      process.stderr
        .write(`[helper-exit] trigger=startup-claim-timeout \u2192 process.exit(0) at ${/* @__PURE__ */ new Date().toISOString()} launcherPid=${launcherPid}
`);
      process.exit(0);
    },
  });
  process.on("beforeExit", (code) => {
    process.stderr
      .write(`[helper-exit] beforeExit code=${code} \u2014 event loop drained naturally (no process.exit called); broker socket likely closed underneath at ${/* @__PURE__ */ new Date().toISOString()}
`);
  });
  process.on("exit", (code) => {
    process.stderr
      .write(`[helper-exit] exit code=${code} at ${/* @__PURE__ */ new Date().toISOString()}
`);
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[helper-exit] uncaughtException: ${err.stack ?? String(err)}
`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr
      .write(`[helper-exit] unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}
`);
  });
  let shutdownInFlight;
  let shutdownReason = "unknown";
  const shutdown = (reason) => {
    if (shutdownInFlight) {
      process.stderr
        .write(`[helper-exit] shutdown re-entered (new reason=${reason}, in-flight reason=${shutdownReason}) \u2014 ignored
`);
      return;
    }
    shutdownReason = reason;
    process.stderr
      .write(`[helper-exit] shutdown triggered by ${reason} at ${/* @__PURE__ */ new Date().toISOString()} launcherPid=${launcherPid}
`);
    shutdownInFlight = running.stop().then(
      () => {
        process.stderr.write(`[helper-exit] drain complete \u2192 process.exit(0) (reason=${reason})
`);
        process.exit(0);
      },
      (error51) => {
        shutdownInFlight = void 0;
        process.stderr
          .write(`[helper-exit] refused unsafe shutdown (reason=${reason}): ${error51 instanceof Error ? error51.message : String(error51)}
`);
      },
    );
  };
  const dumpSignalContext = (sig) => {
    process.stderr
      .write(`[helper-exit] ${sig} received: pid=${process.pid} ppid=${process.ppid} pgid=${safeGetPgid()} launcherPid=${launcherPid} at ${/* @__PURE__ */ new Date().toISOString()}
`);
  };
  process.on("SIGTERM", () => {
    dumpSignalContext("SIGTERM");
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    dumpSignalContext("SIGINT");
    shutdown("SIGINT");
  });
  if (launcherPid !== null) {
    startLauncherLivenessWatchdog(launcherPid, () => {
      let aliveAtFire = "unknown";
      try {
        process.kill(launcherPid, 0);
        aliveAtFire = "alive";
      } catch (e) {
        aliveAtFire = e.code ?? "error";
      }
      process.stderr
        .write(`[helper-exit] launcher-liveness-watchdog FIRED at ${/* @__PURE__ */ new Date().toISOString()} launcherPid=${launcherPid} aliveAtFire=${aliveAtFire}
`);
      shutdown(
        `launcher-liveness-watchdog (launcherPid=${launcherPid} aliveAtFire=${aliveAtFire})`,
      );
    });
  }
}
async function resolveAuthToken(argv, env = process.env) {
  const tokenFilePath = argOf(argv, "--token-file");
  if (tokenFilePath) {
    return readOneShotTokenFile(tokenFilePath);
  }
  return argOf(argv, "--token") ?? env[BROKER_TOKEN_ENV] ?? null;
}
async function resolvePresentationAuthToken(argv) {
  const tokenFilePath = argOf(argv, "--presentation-token-file");
  return tokenFilePath ? readOneShotTokenFile(tokenFilePath) : null;
}
async function readOneShotTokenFile(tokenFilePath) {
  try {
    const token = (await readFile(tokenFilePath, "utf8")).trim();
    if (!token) {
      throw new Error("token file is empty");
    }
    return token;
  } finally {
    await rm(tokenFilePath, { force: true }).catch(() => {});
  }
}
// 注意：不要在此模块追加入口副作用。Windows 入口是 windows-helper.ts →
// runWindowsDevHelper()；macOS SEA 入口在 src/helper-sea-entry.ts。此前 SEA 入口
// 代码曾被整段内联到本文件尾部，导致 Windows Helper 启动时两条入口同时执行、
// ZCODE_CUA_HELPER_ADDON 被指向 .app Resources 路径，入口行为偏离原版发行物。
