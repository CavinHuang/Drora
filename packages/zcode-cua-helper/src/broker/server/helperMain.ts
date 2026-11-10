// oxlint-disable-file
// 还原自原版 helper SEA payload（dist/broker/server/helperMain.js 完整区）。
// runHelper + main(argv) 驱动 + 权限请求模式 + launcher 验证 + controller 接线。
import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { timingSafeEqual, createHash } from "node:crypto";
// R3.3（specs/cua-gap-remediation-2026-11-09.md）：主入口 socket 解析的第三兜底
// resolveBrokerSocketPath + env 键常量（BROKER_SOCKET_ENV 单一出处，消费方即本文件
// main() 的 socket 三段解析），还原自官方 SEA（官方 helperMain 字面量直写，我方按
// 契约键单一出处改为引用常量，先例=同文件 BROKER_TOKEN_ENV 的既有还原形态）。
import { BROKER_SOCKET_ENV, resolveBrokerSocketPath } from "../socketPath.js";
import { createDefaultHelperPidEvidenceProvider } from "./helperReaper.js";
import { withGhostCursorSessionLifecycle } from "./ghostCursorTurnLifecycle.js";
import { withGhostRequestSessionScope } from "./nativeAxSource.js";
import {
  CUA_HELPER_INSTALL_VARIANTS,
  HELPER_ALLOW_EXTERNAL_BROKER_CLIENT_LOCAL_DEV_ARG,
  HELPER_BUNDLE_ID,
  HELPER_CONTROLLER_VARIANT_ARG,
  HELPER_DISPLAY_NAME,
  HELPER_DISABLE_CPS_ACTIVATION_ARG,
  HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG,
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
import {
  createPeerVerifier,
  isLauncherTrustedZCode,
  resolveCuaPresentationPeerIdentifiers,
  isPresentationPeerEligible,
} from "./peerVerifier.js";
import { createCuaControllerLease } from "./controllerLease.js";
import { createCuaControllerCoordinator } from "./controllerCoordinator.js";
import { shouldCancelCuaHelperBrokerLaunch } from "./helperLaunchGuard.js";
import {
  resolveZCodeLauncherCodeRequirement,
  resolveCuaPeerTeamRequirement,
} from "./helperVerifier.js";
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
// 清退（2026-11-10 R10 后续）：createPipLiveProbeDragPanelHandler 已随六个
// pip_live_probe_* broker 方法整体删除——官方 v3.1 协议瘦身（49→43）删表，
// 上游 0.6.5 host index :44503-44505 墓碑注明「探针脚本与其校验器一并删除」；
// win entry / mac SEA 对这六个方法名均为零命中。
// 还原自发行 bundle（官方 0.6.5 win32 entry dist/windows-helper.js:33584-33612，字节
// 偏移 1326608；官方 0.6.3 vendored runtime 同文）：延迟 backend 占位。setTarget 前
// 除 broker_info（返回 brokerInfo）外任何方法抛 broker_unavailable "warming up"。
// 此前还原稿误判"原版无 defer 路径"——win 0.6.3/0.6.5 官方 entry 的 helperMain 段
// 均有 createDeferredBackend/deferBackendInitialization/onTransportReady（0.6.5
// :33625/:33789-33854），本次按官方补齐。
function createDeferredBackend(brokerInfo) {
  let target = null;
  const backend = new Proxy(
    {},
    {
      get(_value, property) {
        if (typeof property !== "string") return void 0;
        if (target) {
          const member = Reflect.get(target, property);
          if (member !== void 0) return member;
        }
        if (property === "broker_info") return () => brokerInfo;
        return () => {
          throw new BrokerError("broker_unavailable", "Windows CUA broker backend is warming up", {
            ready_state: "warming_up",
            request_delivery_state: "not_sent",
          });
        };
      },
      has(_value, property) {
        return typeof property === "string";
      },
    },
  );
  return {
    backend,
    setTarget(next) {
      target = next;
    },
  };
}
export async function runHelper(options: any) {
  // 还原自发行 bundle（官方 3.17.2 / 0.6.5）：native 先过 ghost 会话域守卫再下传
  // （withGhostRequestSessionScope；官方 helperMain 组装 `const native =
  // withGhostRequestSessionScope(native)`）。配 0.6.3 addon 时透传原对象。
  const native = withGhostRequestSessionScope(options.native);
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
  // 还原自发行 bundle（官方 0.6.5 win32 entry :33625，字节偏移 1327858）：严格
  // === true 才延迟 backend 初始化（win entry 延迟分支传 true，立即分支不传）。
  const deferBackendInitialization = options.deferBackendInitialization === true;
  const pipSessionEnabled =
    // 官方 SEA @ 86537195 逐字：pip 会话资格=peerIdentityAuth 门（presentation
    // token 判据为 3.11.2 幻影字段，官方 3.14.3 起 presentation 走 peer 角色）。
    options.peerIdentityAuth === true && options.enablePipSession !== false;
  let adapter;
  let pipPresentationScheduler = null;
  let pipSessionCoordinator = null;
  let activeBackend = null;
  const initializeBackend = () => {
    const { axSource, roleToKind: roleToKind3 } = selectPlatformAxSource({
      native: native,
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
      native: native,
      system: options.system,
      virtualPointerEnabled: options.virtualPointerEnabled,
      logger: options.logger,
    });
    if (pipSessionEnabled) {
      native.pipSetEnabled?.(true);
    }
    // 还原自发行 bundle（官方 3.17.2 / 0.6.5）：PiP 诊断去重键（消息:会话:轮次:presentation 窗口）。
    const pipWarnKey = (message, details) => {
      const pick = (name) => {
        const value = details?.[name];
        return typeof value === "string" || typeof value === "number" ? String(value) : "";
      };
      const turn = pick("turnId") || pick("bindingTurnId") || pick("schedulerTurnId");
      return [
        message,
        pick("sessionId") || "unknown",
        turn || "no-turn",
        pick("presentationWindowId") || "0",
      ].join(":");
    };
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
    // 还原自发行 bundle（官方 3.17.2 / 0.6.5，SEA offset 86540514 区）：coordinator
    // effects 过 ghost 会话生命周期包装——turn-ended/session-closed 在 finally 里按
    // session 粒度隐藏/移除光标组（per-session 化，A 结束不藏 B）。配 0.6.3 addon 时
    // ghostSessionTurnEnd/ghostRemoveSession 经可选链安全 no-op。
    const nextPipSessionCoordinator = createPipSessionCoordinator({
      effects: withGhostCursorSessionLifecycle(
        options.pipSessionEffects ?? nextPipPresentationScheduler,
        {
          hideSessionCursor: (sessionId) => {
            native.ghostSessionTurnEnd?.(sessionId);
          },
          removeSessionCursor: (sessionId) => {
            native.ghostRemoveSession?.(sessionId);
          },
        },
      ),
      // 还原自发行 bundle（官方 3.17.2 / 0.6.5，SEA offset 86540514 区）：协调器侧
      // capture 丢弃诊断走同一个 warn 通道（去重键=消息+会话+轮次+presentation 窗口）。
      warn(message, details) {
        warnPipOnce(pipWarnKey(message, details), message, details ?? {});
      },
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
    // 清退（2026-11-10 R10 后续）：六个 pip_live_probe_* broker handler 注册块已删。
    // 官方 v3.1 协议瘦身（49→43，上游 0.6.5 host index :44502-44508 墓碑）删除：
    // 「它们纯粹为真机 PiP GUI 验收探针服务，消费者只有 scripts/pip_live_* 与
    // test/pip-live-*，产品代码一个都不调，却活在生产协议表里」。win entry 与
    // mac SEA 对 pip_live_probe_* 方法名均为零命中（strings 实证 2026-11-10）。
    // 注意 --pip-live-probe argv 门保留（见 mainRun 里 ZCODE_CUA_LIVE_NATIVE=1 置位）
    // ——上游墓碑明确「argv 本身保留：它还负责置位 ZCODE_CUA_LIVE_NATIVE=1，
    // 那是原生 live 测试钩子的能力门，与本协议表无关」。
    adapter = nextAdapter;
    pipPresentationScheduler = nextPipPresentationScheduler;
    pipSessionCoordinator = nextPipSessionCoordinator;
    activeBackend = nextBackend;
    return nextBackend;
  };
  // 还原自发行 bundle（官方 0.6.5 win32 entry :33789-33792；0.6.3 vendored 同文）：
  // 立即分支（缺省）在构造 server 前同步初始化 backend；延迟分支先建占位 backend，
  // transport 就绪后再接管。此前注释"原版无 defer 路径"为误判，予以更正。
  if (!deferBackendInitialization) {
    initializeBackend();
  }
  const deferredBackend = deferBackendInitialization ? createDeferredBackend(brokerInfo) : null;
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
      return native.cancelPendingInputHolds?.() !== false;
    } catch (error51) {
      options.logger?.error(
        void 0,
        "Drora Computer Use could not cancel pending native input holds during shutdown",
        error51 instanceof Error ? error51.name : "UnknownError",
      );
      return false;
    }
  };
  const server = new CuaPermissionBrokerServer({
    socketPath: options.socketPath,
    // 还原自发行 bundle（官方 0.6.5 win32 entry :33816）：延迟分支喂占位 backend
    // （broker_info 可应答、其余 warming_up），立即分支用已初始化真 backend。
    backend: deferredBackend?.backend ?? activeBackend,
    logger: options.logger,
    verifyPeer: options.verifyPeer,
    peerPresentationEligible: options.peerPresentationEligible,
    // 第五十八轮：接线闲置自眠（官方 3.14.3 形态，strings 实证
    // `idleExit: { timeoutMs: 3e5, reason: "idle_timeout_reached" }`；3.11.2 无此
    // 机制）。brokerServer 的 idleExit 机制此前无人传参=死代码，standalone
    // Helper 永不自眠（实测 14 分钟存活直至手杀，且占全局租约堵住其它 broker）。
    // 判定=无连接 && 无 in-flight 持续 300s；managed 场景由 host 按需重拉。
    idleExit: { timeoutMs: 3e5, reason: "idle_timeout_reached" },
    // 官方 3.14.3 同款显式退出处理器（strings 实证 `onIdleExit: (reason) => {`）：
    // broker 优雅 stop 后原生句柄（AX 观察者/CG watcher）仍撑住事件循环，自然
    // drain 不会发生——必须像 startup-claim-timeout 一样显式 process.exit(0)。
    onIdleExit: (reason) => {
      process.stderr.write(
        `[helper-exit] trigger=${reason} → process.exit(0) at ${new Date().toISOString()} launcherPid=${options.launcherPid ?? null}
`,
      );
      process.exit(0);
    },
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
  // 还原自发行 bundle（官方 0.6.5 win32 entry :33845-33854；0.6.3 vendored 同文）：
  // server.listen 成功后、真实 backend 初始化前回调 onTransportReady；回调成功返回后
  // 才建真 backend 并接管 deferred 占位；回调抛错则先停 server 再向上抛。
  try {
    await options.onTransportReady?.({ socketPath: options.socketPath });
    if (deferBackendInitialization) {
      const initializedBackend = initializeBackend();
      deferredBackend.setTarget(initializedBackend);
    }
  } catch (error51) {
    await server.stopEventually().catch(() => void 0);
    throw error51;
  }
  const startupTtlMs = options.startupClaimTtlMs ?? DEFAULT_STARTUP_CLAIM_TTL_MS;
  if (startupTtlMs > 0) {
    startupTimer = setTimeout(() => {
      startupTimer = void 0;
      if (claimed) return;
      options.logger?.warn(
        void 0,
        `Drora Computer Use was not claimed within ${startupTtlMs}ms; self-terminating to avoid an orphaned permission subject`,
      );
      void server
        .stopEventually("startup-claim-timeout", (error51) => {
          options.logger?.warn(
            void 0,
            "Drora Computer Use startup-timeout shutdown did not drain safely",
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
            "Drora Computer Use startup-timeout shutdown failed",
            error51,
          );
          // 第五十八轮：最后手段退出。认领超时的 Helper 是孤儿授权主体（上方告警
          // 原文），优雅停机在原生清理失败时抛错——此前只记日志不退出，进程被原生
          // 句柄撑住事件循环成为僵尸（实测 14/47 分钟存活直至手杀，且占全局租约
          // 堵死其它 broker）。与官方 startup-claim-timeout 语义一致：无条件退。
          options.onStartupClaimTimeout?.();
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
      if (pipSessionEnabled && activeBackend) native.pipSetEnabled?.(false);
    },
  };
}
// 还原自发行 bundle（官方 3.17.2 / 0.6.5 SEA）：--exit-log 落盘管道（R3.6，
// specs/cua-gap-remediation-2026-11-09.md）。此前我方只做原始字节透写；官方是
// 逐行 JSON 重写（helperLogLines：timestamp/level/module/pid 补齐）+ 落盘目录
// mkdirSync + 启动期 pruneHelperLogs（zcode-cua-helper-YYYY-MM-DD.jsonl 保留
// HELPER_LOG_RETENTION_DAYS 天）。逐字锚定官方字节偏移：
//   IIFE（mkdir+prune+重写）@ 86548983、function helperLogLines @ 86549645、
//   function pruneHelperLogs @ 86550881（方案 SEA 锚 86549645/86550881）。
(() => {
  const idx = process.argv.indexOf("--exit-log");
  const logPath = idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
  if (!logPath) return;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch {}
  pruneHelperLogs(dirname(logPath));
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    try {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      appendFileSync(logPath, helperLogLines(text));
    } catch {}
    return originalWrite(chunk, ...rest);
  };
})();
// 还原自发行 bundle（官方 SEA offset 86549645 区）。stderr 文本逐行转 JSONL 记录：
// 已是 helperRuntimeLogger 形态（{scope,level,event,evidence}）的行改写为
// {timestamp,level,event,module=scope,pid,context=evidence}并保留其余字段；
// 纯文本行按 [tag] 前缀归类（event=tag，无 tag 则 event="helper stderr"）。
// export 供回归测试钉扎（官方 bundle 内为模块私有，值形态不变，仅增加测试面）。
export function helperLogLines(text) {
  const stamp = new Date().toISOString();
  let out = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let record;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const source = parsed;
      const { scope, level, event, evidence, ...rest } = source;
      record = {
        timestamp: stamp,
        level: typeof level === "string" ? level : "info",
        event: typeof event === "string" ? event : "helper runtime event",
        module: typeof scope === "string" ? scope : "zcode-cua-helper",
        pid: process.pid,
        ...(evidence === void 0 ? {} : { context: evidence }),
        ...rest,
      };
    } else {
      const tag = /^\[([a-z0-9-]+)\]/iu.exec(line);
      record = {
        timestamp: stamp,
        level: "info",
        event: tag ? tag[1] : "helper stderr",
        module: "zcode-cua-helper",
        pid: process.pid,
        message: tag ? line.slice(tag[0].length).trim() : line,
      };
    }
    out += `${JSON.stringify(record)}\n`;
  }
  return out;
}
// 还原自发行 bundle（官方 SEA offset 86550881 区）：删除超出保留天数的
// zcode-cua-helper-YYYY-MM-DD.jsonl（文件名降序=新→旧，slice(保留天数) 之后全删）。
// 任何读目录/删文件失败均静默（清淤尽力而为，不阻断启动）。export 供回归测试钉扎。
export function pruneHelperLogs(dir) {
  try {
    const kept = readdirSync(dir)
      .filter((name) => /^zcode-cua-helper-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))
      .sort()
      .reverse()
      .slice(HELPER_LOG_RETENTION_DAYS);
    for (const name of kept) {
      try {
        unlinkSync(join(dir, name));
      } catch {}
    }
  } catch {}
}


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
// 还原自发行 bundle（官方 3.17.2 / 0.6.5 SEA，function @ 86551418，方案解析器锚
// 402099）：cps 旋钮取值解析——trim+lowercase 后仅 1/true/on/yes 视为禁用，
// 其余（0/off/false/缺失值/缺 flag）一律不禁用。export 供回归测试钉扎真值表
//（官方 bundle 内为模块私有，值形态不变，仅增加测试面）。
export function resolveDisableCpsActivationFromArgv(argv) {
  const raw = argOf(argv, HELPER_DISABLE_CPS_ACTIVATION_ARG)?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}
function resolveControllerVariantFromArgv(argv) {
  const requested = argOf(argv, HELPER_CONTROLLER_VARIANT_ARG)?.trim();
  return CUA_HELPER_INSTALL_VARIANTS.includes(requested) ? requested : "standalone";
}
// 还原自发行 bundle（官方 SEA var @ 86551839）：exit-log 保留天数阈值 7。
// 官方原序即在此处（函数区之后）——启动期 IIFE 先于本赋值执行，pruneHelperLogs
// 拿到 undefined 时 slice(undefined)=全量，即官方发行物每次启动会清空全部历史
// jsonl（含当日旧文件）；逐字还原不修正该求值序，仅在此记档说明。
// export 供回归测试钉扎（值 7 不变，仅增加测试面）。
export var HELPER_LOG_RETENTION_DAYS = 7;
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
  // 还原自发行 bundle（官方 SEA @ 86554300：`argOf(argv, "--socket") ??
  // process.env.ZCODE_CUA_PERMISSION_BROKER_SOCKET ?? resolveBrokerSocketPath()`）。
  // R3.3：补第三兜底——裸启动（无 --socket 无 env）不再 exit(2)，落到
  // resolveBrokerSocketPath 的 runtime 默认路径。env 键改引 BROKER_SOCKET_ENV
  // 常量（契约键单一出处；官方此处为字面量直写，值相同）。
  const socketPath =
    argOf(argv, "--socket") ?? process.env[BROKER_SOCKET_ENV] ?? resolveBrokerSocketPath();
  if (!socketPath) {
    process.stderr.write(
      "Drora Computer Use requires --socket <path> (or ZCODE_CUA_PERMISSION_BROKER_SOCKET)\n",
    );
    process.exit(2);
    return;
  }
  const brokerLaunchAllowed = () => !shouldCancelCuaHelperBrokerLaunch(argv, socketPath);

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
  // R10 认证模型换代（2026-11-10）：官方 0.6.5/3.17.2 无 token 门（SEA
  // token-file/launcher-minted/resolveAuthToken 零出现）——3.11.2 血统的
  // --token-file 强制门与双 token 解析整体退役，鉴权改由下方 peerIdentityAuthCapable
  // 门 + 连接层 verifyPeer + authenticate 身份模型承载。
  if (!brokerLaunchAllowed()) return;
  // 保留边界（上游 0.6.5 host index :44507-44508 墓碑原文）：--pip-live-probe argv
  // 本身保留——它负责置位 ZCODE_CUA_LIVE_NATIVE=1，那是原生 live 测试钩子的能力门，
  // 与已删除的 pip_live_probe_* 协议表无关。六个 broker 方法已随 R10 后续清退。
  if (argv.includes(HELPER_PIP_LIVE_PROBE_ARG)) process.env.ZCODE_CUA_LIVE_NATIVE = "1";
  const native = loadRealNativeAddon();
  // 还原自发行 bundle（官方 SEA @ 86555928-86556224 逐字）：peer 身份能力门——
  // darwin 且原生四原语齐备才可在产品态起 broker；dev 逃生（unauthenticatedLocalDev）除外。
  const peerIdentityAuthCapable =
    process.platform === "darwin" &&
    typeof native.getPeerCredentials === "function" &&
    typeof native.verifyProcessCodeSignatureWithAuditToken === "function" &&
    typeof native.verifyProcessCodeSignature === "function" &&
    typeof native.parentProcessPid === "function";
  if (!peerIdentityAuthCapable && !unauthenticatedLocalDev) {
    process.stderr.write(
      "Drora Computer Use broker requires a native build with peer-identity primitives (getPeerCredentials / code-signature / parentProcessPid); refusing to start an unauthenticated broker for an already-authorized Helper.\n",
    );
    process.exit(2);
    return;
  }
  if (!brokerLaunchAllowed()) return;
  const wantsGhostCursor = argv.includes(HELPER_GHOST_CURSOR_OVERLAY_ARG);
  const wantsPip = argv.includes(HELPER_PIP_MODE_ARG);
  const wantsGhostCapture = argv.includes(HELPER_GHOST_CURSOR_CAPTURE_ARG);
  if (argv.includes(HELPER_BACKGROUND_MODE_ARG) && typeof native.preventActivation === "function") {
    native.preventActivation();
  }
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
  // 官方 SEA @ 86558800 逐字：launcherPid === null 时整体跳过 launcher 门
  // （裸启动/standalone 场景 peer 门独立承担鉴权；R10 补齐旧稿缺失的第三条件）。
  if (!unauthenticatedLocalDev && !unsignedLauncherLocalDev && launcherPid !== null) {
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
        "Drora Computer Use broker: --launcher-pid did not verify as a code-signed ZCode process (needs a native verifyProcessCodeSignature build and a launcher matching the ZCode signing requirement); refusing to start.\n",
      );
      process.exit(2);
      return;
    }
  }
  // —— peer 验证器（官方 SEA @ 86559140-86560100 逐字，R10 换代）——
  // 与旧血统差异：①不依赖 launcherPid 在场（peer 门=team 签名双门，launcher 归责
  // 只留在 presentation 资格）；②父进程归责走原生 responsibleProcessPid→parentProcessPid
  // 链（旧稿用 ps -o ppid）；③verdict 对象回传（供 presentation 角色门复核）；
  // ④新增父进程签名门与 describePeer 摘要（peerCodeSigningSummary 原生缺失时可选）。
  const nativeGetPeerCredentials = native.getPeerCredentials;
  const nativeVerifyCodeSigWithAudit = native.verifyProcessCodeSignatureWithAuditToken;
  const nativeParentPid = native.parentProcessPid;
  const nativeResponsiblePid = native.responsibleProcessPid;
  const nativeSigningSummary = native.peerCodeSigningSummary;
  const peerTeamRequirement = resolveCuaPeerTeamRequirement(process.env);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  const resolveResponsibleOrParentPid = (pid: number): number | null => {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      if (typeof nativeResponsiblePid === "function") {
        const responsible = nativeResponsiblePid.call(native, pid);
        if (Number.isInteger(responsible) && responsible > 1 && responsible !== pid) {
          return responsible;
        }
      }
      if (typeof nativeParentPid !== "function") return null;
      const ppid = nativeParentPid.call(native, pid);
      return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
    } catch {
      return null;
    }
  };
  let verifyPeer;
  if (
    typeof nativeGetPeerCredentials === "function" &&
    typeof nativeVerifyCodeSigWithAudit === "function" &&
    typeof nativeVerifyCodeSig === "function" &&
    typeof nativeParentPid === "function" &&
    currentUid !== null
  ) {
    verifyPeer = createPeerVerifier({
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
      // 责任进程优先（LaunchServices 归责链，与 TCC 一致），API 缺失 / 自指时退父 pid。
      resolveResponsibleOrParentPid,
      verifyPeerCodeSignature: (auditToken) =>
        nativeVerifyCodeSigWithAudit.call(native, auditToken, peerTeamRequirement),
      verifyProcessCodeSignature: (pid) =>
        nativeVerifyCodeSig.call(native, pid, peerTeamRequirement),
      ...(typeof nativeSigningSummary === "function"
        ? { describePeer: (auditToken) => nativeSigningSummary.call(native, auditToken) }
        : {}),
    });
  } else if (!unauthenticatedLocalDev) {
    process.stderr.write(
      "Drora Computer Use broker requires peer verification in product mode (needs a native build with getPeerCredentials, code-signature verification and parentProcessPid); refusing to start.\n",
    );
    process.exit(2);
    return;
  }
  // —— presentation 角色资格（官方 SEA @ 86560100-86560140 逐字）——
  const presentationPeerIdentifiers = resolveCuaPresentationPeerIdentifiers(process.env);
  const peerPresentationEligible = (verdict) =>
    isPresentationPeerEligible({
      verdict,
      allowedIdentifiers: presentationPeerIdentifiers,
      unsignedLauncherLocalDev,
      sameUidExternalPeerLocalDev: externalBrokerClientLocalDev,
      launcherPid,
      resolveResponsibleOrParentPid,
    });
  if (!brokerLaunchAllowed()) return;
  const controllerLease = createCuaControllerLease({ env: process.env });
  const controllerVariant = resolveControllerVariantFromArgv(argv);
  // 还原自发行 bundle（官方 SEA @ 86562506-86562780，方案下推锚 402327-402330）：
  // cps 旋钮下推——解析值透传 native.setCpsActivationDisabled（原生缺失时静默跳过），
  // 禁用时打 "[cua-cps-activation] disabled via argv"（官方原文，console.error 走
  // stderr → --exit-log 落盘）。此前我方缺接收侧，launcher 的禁用开关被静默忽略。
  const disableCpsActivation = resolveDisableCpsActivationFromArgv(argv);
  native.setCpsActivationDisabled?.(disableCpsActivation);
  if (disableCpsActivation) {
    console.error("[cua-cps-activation] disabled via argv");
  }
  // 还原自发行 bundle（官方 SEA @ 86562734，方案锚 strings 492471-492472）：
  // 多光标旋钮下推——ghostSetMultiCursorEnabled(启用=!禁用)。我方 native 面尚未
  // 实现该方法（3.17.2 官方 napi 有 ghostSetMultiCursorEnabled），?.() 可选调用
  // 保持官方"原生缺失时跳过"形态，待 native 面补齐即生效。
  const disableMultiCursorOverlay = argv.includes(HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG);
  native.ghostSetMultiCursorEnabled?.(!disableMultiCursorOverlay);
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
    // Windows system surface 不再需要注入 AUMID 激活器：启动能力随 open_application
    // 于 2026-09-15 一起移除，Windows 的拉起全部走 src/native/win.ts 的 captureApp
    // （AppsFolder 身份 + 原生 launchApplicationAsync）。（官方 SEA @ 86563839 原文；
    // R10 移除 3.11.2 血统的 AUMID 注入残留。）
    system: createNodeSystemSurface(),
    socketPath,
    // 官方 SEA @ 86563839：peerIdentityAuth 由 verifyPeer 在场决定（presentation
    // 会话资格判据），useSocketLock 显式 true（M2 单实例租约）。
    peerIdentityAuth: verifyPeer !== void 0,
    peerPresentationEligible,
    useSocketLock: true,
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
    launcherPid,
    startupAllowed: brokerLaunchAllowed,
    admitControllerAction: controller.admitAction,
    getControllerStatus: controller.status,
    takeoverController: controller.takeover,
    stopController: controller.stop,
    releaseController: controller.release,
    isController: controller.ownsLease,
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
// R10 认证模型换代（2026-11-10）：3.11.2 血统的 --token-file/--token/
// --presentation-token-file 解析与一次性 token 文件读取整体退役（官方 0.6.5
// SEA 零出现）；mac-launch-contract 测试面随批改写为 peer 身份契约。
// 注意：不要在此模块追加入口副作用。Windows 入口是 windows-helper.ts →
// runWindowsDevHelper()；macOS SEA 入口在 src/helper-sea-entry.ts。此前 SEA 入口
// 代码曾被整段内联到本文件尾部，导致 Windows Helper 启动时两条入口同时执行、
// ZCODE_CUA_HELPER_ADDON 被指向 .app Resources 路径，入口行为偏离原版发行物。
