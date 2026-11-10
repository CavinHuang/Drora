/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { parseAppFrameSurfaceSet } from "../../lib/app-frame-surfaces.js";
import { displayTopologyFingerprint } from "../../lib/display-topology.js";
import {
  BrokerError,
  elementUnavailable,
  notAuthorized,
} from "../types.js";
import { AxTokenRegistry, createAxReadOnlyMethods } from "./axReadOnly.js";
import { cuaBundleIdsEqual } from "./cuaAppIdentity.js";
import { createElectronDisplayTopology } from "./electronDisplayTopology.js";
import {
  createElectronInputHandlers,
  replaceTextValueWithVerifiedInput,
} from "./electronInputHandlers.js";
import {
  FAIL_CLOSED_REASON,
  capabilityList2,
  hasAppScopedKeyboard,
  hasRawMouseKeyboard,
  hasTokenScopedElementActions,
  mapScreenStatus,
  readAccessibilityProbe,
  wantsCapability,
} from "./electronNativeBackendTypes.js";
import {
  accessibilityActionRequired,
  authorizationSubject,
  authorizationSubjectHint,
  automationActionRequired,
  permissionGuideMessage,
  screenRecordingActionRequired,
} from "./electronPermissionHints.js";
import { authorizationSubjectKind, createUnavailableNativeBackend } from "./nativeBackend.js";
import { createPipAutoStarter } from "./pipAutoStart.js";
import { createForeignWindowScreenCaptureProbe } from "./screenCaptureProbe.js";
import { snapshotWindowServerWindows } from "./windowServerSnapshot.js";

// 还原自发行 bundle（官方 3.17.2 / 0.6.5 SEA：var pasteSerialTail @ 85520859、
// function runPasteSerial @ 85520900，方案锚 SEA offset 85520900 + strings
// 468185-468186）。R3.4（specs/cua-gap-remediation-2026-11-09.md）：paste 全局
// 串行化——providedPaste 分支整体经此链排队，前一次 paste（含其收尾 finish）
// 完成前下一次 paste 不 begin，消除两次并发 paste 交叉占用系统粘贴板的窗口。
// tail 链吞掉前序结果（then(run, run) 成败都续跑；tail 重置为已消化错误），
// 返回值仍是本次 body 的原始结果/拒绝。
var pasteSerialTail = Promise.resolve();
function runPasteSerial(body) {
  const run = async () => body();
  const result = pasteSerialTail.then(run, run);
  pasteSerialTail = result.then(() => void 0, () => void 0);
  return result;
}

function captureScreenshotWindows(adapter, displayBounds) {
  if (!adapter.listScreenCaptureProbeWindows) return null;
  return snapshotWindowServerWindows(
    adapter.listScreenCaptureProbeWindows(),
    displayBounds,
    process.pid,
  );
}
function topologyDesktopBounds(entries) {
  const left = Math.min(...entries.map((entry) => entry.bounds[0]));
  const top = Math.min(...entries.map((entry) => entry.bounds[1]));
  const right = Math.max(...entries.map((entry) => entry.bounds[0] + entry.bounds[2]));
  const bottom = Math.max(...entries.map((entry) => entry.bounds[1] + entry.bounds[3]));
  return [left, top, right - left, bottom - top];
}
function sameSurfaceBounds(left, right) {
  return (
    left.length === 4 &&
    right.length === 4 &&
    left.every((part, index) => Math.abs(part - right[index]) <= 1)
  );
}
function buildStableAppFrameSurfaceSet(snapshot, before, after) {
  const actualWindowId = snapshot.window.window_id;
  const presentationWindowId = snapshot.window.presentation_window_id ?? actualWindowId;
  const candidates = snapshot.surfaces;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {};
  }
  const hasAttachedSurface = candidates.some(
    (candidate) =>
      candidate.relation === "ax_descendant" ||
      candidate.actual_window_id !== candidate.presentation_window_id,
  );
  if (!before || !after) {
    return hasAttachedSurface ? { capture_surfaces_status: "capture_surfaces_unavailable" } : {};
  }
  if (
    typeof actualWindowId !== "number" ||
    typeof presentationWindowId !== "number" ||
    candidates.length > 64
  ) {
    return { capture_surfaces_status: "capture_surfaces_unavailable" };
  }
  const stable = [];
  for (const candidate of candidates) {
    const beforeWindow = before.windows.find(
      (window) => window.window_id === candidate.actual_window_id,
    );
    const afterWindow = after.windows.find(
      (window) => window.window_id === candidate.actual_window_id,
    );
    if (
      !beforeWindow ||
      !afterWindow ||
      beforeWindow.owner_bundle_id === null ||
      afterWindow.owner_bundle_id === null ||
      beforeWindow.owner_pid !== candidate.owner_pid ||
      beforeWindow.owner_pid !== afterWindow.owner_pid ||
      !cuaBundleIdsEqual(beforeWindow.owner_bundle_id, afterWindow.owner_bundle_id) ||
      beforeWindow.layer !== afterWindow.layer ||
      !sameSurfaceBounds(beforeWindow.bounds, candidate.bounds) ||
      !sameSurfaceBounds(beforeWindow.bounds, afterWindow.bounds)
    ) {
      return { capture_surfaces_status: "capture_surfaces_changed" };
    }
    stable.push({
      actual_window_id: candidate.actual_window_id,
      presentation_window_id: candidate.presentation_window_id,
      surface_kind: candidate.surface_kind,
      relation: candidate.relation,
      owner_pid: beforeWindow.owner_pid,
      owner_bundle_id: beforeWindow.owner_bundle_id,
      layer: beforeWindow.layer,
      bounds: beforeWindow.bounds,
    });
  }
  const byId = new Map(stable.map((surface) => [surface.actual_window_id, surface]));
  const orderSurfaces = (windowSnapshot) =>
    windowSnapshot.windows.flatMap((window) => {
      const surface = byId.get(window.window_id);
      return surface ? [surface] : [];
    });
  const orderedBefore = orderSurfaces(before);
  const orderedAfter = orderSurfaces(after);
  if (
    orderedBefore.length !== stable.length ||
    orderedAfter.length !== stable.length ||
    !orderedBefore.some((surface) => surface.actual_window_id === actualWindowId)
  ) {
    return { capture_surfaces_status: "capture_surfaces_unavailable" };
  }
  const fingerprint2 = (ordered) =>
    JSON.stringify(
      ordered.map((surface) => [
        surface.actual_window_id,
        surface.presentation_window_id,
        surface.owner_pid,
        surface.owner_bundle_id,
        surface.layer,
        ...surface.bounds,
      ]),
    );
  const beforeFingerprint = fingerprint2(orderedBefore);
  const afterFingerprint = fingerprint2(orderedAfter);
  if (beforeFingerprint !== afterFingerprint) {
    return { capture_surfaces_status: "capture_surfaces_changed" };
  }
  return {
    capture_surfaces: {
      presentation_window_id: presentationWindowId,
      before_fingerprint: beforeFingerprint,
      after_fingerprint: afterFingerprint,
      order: "front_to_back",
      surfaces: orderedBefore,
    },
  };
}
// 还原自发行 bundle（官方 0.6.5 win32 entry :28206-28264）：win32 capture_surfaces
// 组装。两源：①无 composition 但有 windows_capture_root（单窗 verified 抓图回执）→
// 单 surface 集（before/after 同指纹）；②screenshot_composition.method===
// root_wgc_plus_popup_wgc_premultiplied_composite → root+popups 逐条校验后按
// layer 排序组集，并回填快照 surface 域的身份增强（tid/start_time/generation/
// producer/operation_association）。两者皆无（mac 或无截图）返回 {}，surface 事实
// 不虚构。
function buildWindowsAppFrameSurfaceSet(snapshot) {
  const composition = snapshot.screenshot_composition;
  if (!composition && snapshot.windows_capture_root) {
    const root = snapshot.windows_capture_root;
    const fingerprint3 = JSON.stringify(root);
    const set2 = {
      presentation_window_id: root.presentation_window_id,
      before_fingerprint: fingerprint3,
      after_fingerprint: fingerprint3,
      order: "front_to_back",
      surfaces: [root],
    };
    return parseAppFrameSurfaceSet(set2)
      ? { capture_surfaces: set2 }
      : { capture_surfaces_status: "capture_surfaces_unavailable" };
  }
  if (!composition || typeof composition !== "object" || composition.method !== "root_wgc_plus_popup_wgc_premultiplied_composite") {
    return {};
  }
  const entries = [composition.root, ...composition.popups];
  const malformed = entries.some(
    (entry) =>
      !Number.isSafeInteger(entry.window_id) ||
      entry.window_id <= 0 ||
      !Number.isSafeInteger(entry.pid) ||
      entry.pid <= 0 ||
      typeof entry.owner_bundle_id !== "string" ||
      entry.owner_bundle_id.length === 0 ||
      !Number.isSafeInteger(entry.layer) ||
      !Array.isArray(entry.bounds) ||
      entry.bounds.length !== 4 ||
      !entry.bounds.every((part) => typeof part === "number" && Number.isFinite(part)),
  );
  if (malformed) {
    return { capture_surfaces_status: "capture_surfaces_unavailable" };
  }
  const surfaces = entries
    .map((entry) => ({
      actual_window_id: entry.window_id,
      presentation_window_id: snapshot.window.presentation_window_id ?? composition.root.window_id,
      surface_kind: entry.surface_kind,
      relation: entry.relation,
      owner_pid: entry.pid,
      owner_bundle_id: entry.owner_bundle_id,
      layer: entry.layer,
      bounds: entry.bounds,
    }))
    .map((surface) => {
      const facts = snapshot.surfaces?.find((s) => s.actual_window_id === surface.actual_window_id);
      return {
        ...surface,
        // 截图 root 表示像素原点；面板与逻辑主窗的归属不能被重置成 presentation_root。
        ...facts ? { surface_kind: facts.surface_kind, relation: facts.relation } : {},
        ...facts?.owner_tid ? { owner_tid: facts.owner_tid } : {},
        ...facts?.process_start_time ? { process_start_time: facts.process_start_time } : {},
        ...facts?.window_generation ? { window_generation: facts.window_generation } : {},
        ...facts?.producer_id ? { producer_id: facts.producer_id } : {},
        ...facts?.operation_association ? { operation_association: facts.operation_association } : {},
      };
    })
    .sort((a, b) => a.layer - b.layer);
  const fingerprint2 = JSON.stringify(
    surfaces.map((surface) => [
      surface.actual_window_id,
      surface.presentation_window_id,
      surface.owner_pid,
      surface.owner_bundle_id,
      surface.owner_tid,
      surface.process_start_time,
      surface.window_generation,
      surface.producer_id,
      surface.layer,
      ...surface.bounds,
    ]),
  );
  return {
    capture_surfaces: {
      presentation_window_id: snapshot.window.presentation_window_id ?? composition.root.window_id,
      before_fingerprint: fingerprint2,
      after_fingerprint: fingerprint2,
      order: "front_to_back",
      surfaces,
    },
  };
}
var MAC_BACKGROUND_WINDOW_SETTLE_ATTEMPTS = 30;
function hasOnscreenWindow(windows) {
  return Array.isArray(windows) && windows.some((window) => window?.onscreen !== false);
}
async function settleApplicationWindow(axSource, appRef) {
  if (!axSource.listWindows) return false;
  for (let attempt = 0; attempt < MAC_BACKGROUND_WINDOW_SETTLE_ATTEMPTS; attempt += 1) {
    const windows = await axSource.listWindows(appRef);
    if (hasOnscreenWindow(windows)) return true;
    if (attempt + 1 < MAC_BACKGROUND_WINDOW_SETTLE_ATTEMPTS) {
      await new Promise((resolve2) => setTimeout(resolve2, 100));
    }
  }
  return false;
}

// 清退（2026-11-10 R10 后续）：open_application helper 家族（textParam/urlListParam/
// launchHintPayload/appPayload/positiveWindowId/resolveOpenedApp/resolveAppByPid/
// rollbackFreshApplication/discoverFreshApplicationForRollback/settleActivatedAppByPid/
// activateMacFilePanelSurface/captureFileUrlWindowBaseline/verifyFileUrlWindowEffect/
// isWindowsAppUserModelId/resolveWindowsPackagedAppAlias/canonicalWindowsExecutable/
// settleLiveActive* 等）已随 open_application broker 方法整体删除。证据：该家族
// 全部特征串（"open_application requires bundle_id, name, or pid"、"Fresh-process
// rollback"、"file URL window verification cannot distinguish duplicate filename"、
// "open_application direct PID lookup conflict" 等）在官方 0.6.5 win entry 与官方
// mac SEA（3.17.2）双双零命中——官方 v3.1 协议瘦身（49→43，win entry :19750 墓碑）
// 删除 open_application；启动/拉起能力由 capture_app 的内部链保留（见下方
// reopenWindowlessApp 与 nodeAutomationAdapter.openApplication，官方
// win entry :33636 注释「启动能力随 open_application 移除、拉起走 captureApp」）。
// 保留边界：上方 hasOnscreenWindow/settleApplicationWindow 为 capture_app 的
// windowless-app 重开链服务（官方在用），不在清退之列。

export function createElectronNativeBackend(options) {
  const { adapter, brokerInfo, axSource } = options;
  const diagnostic = options.onDiagnostic;
  const supportsScreenCapture = adapter.supportsScreenCapture !== false;
  const supportsClipboard = adapter.supportsClipboard !== false;
  const screenCaptureUnavailableMessage =
    brokerInfo.platform === "win32"
      ? "Screen capture is unavailable in this Windows Computer Use Helper build until Windows Graphics Capture is implemented."
      : "Screen capture is unavailable in this Drora Computer Use build because no capture adapter is installed.";
  const hasAxSource = Boolean(axSource);
  const hasAutomationBridge = Boolean(axSource?.warmAutomationPermission);
  const hasElementActions = hasTokenScopedElementActions(axSource);
  const hasCoordinateHitTest = Boolean(axSource?.elementAtPoint);
  const hasAppScopedInput = hasAppScopedKeyboard(adapter);
  const automationPermissionStatus = hasAutomationBridge ? "unknown" : "not_required";
  const displayTopology = createElectronDisplayTopology(adapter);
  // 清退（2026-11-10 R10 后续）：createElectronDisplaySelection（screen_size/
  // cursor_position/list_displays/set_display/screenshot 的显示器选择状态机）已随
  // 这五个被裁方法整体删除——官方 0.6.5 win entry 与 mac SEA 对
  // createElectronDisplaySelection/selectedDisplayId/"set_display index must be"
  // 均零命中；electronDisplaySelection.ts 整文件删除。下方 captureTopology
  // （displayTopology）是 capture_app 帧指纹与输入处理器的共享拓扑，保留。
  const captureTopology = () => {
    const { displays, primaryId } = displayTopology.topology();
    const entries = displays.map((display, index) => ({
      index: index + 1,
      id: display.id,
      bounds: [display.bounds.x, display.bounds.y, display.bounds.width, display.bounds.height],
      main: display.id === primaryId,
      scale_factor: display.scaleFactor,
    }));
    return {
      entries,
      fingerprint: displayTopologyFingerprint(entries),
    };
  };
  const screenCaptureStatus = () => mapScreenStatus(adapter.getScreenMediaAccessStatus());
  const requireVerifiedWindowsFramePixels = (method) => {
    if (brokerInfo.platform !== "win32") return;
    const dpi = adapter.getNativeDpiAwareness?.();
    if (dpi?.awareness === 2 && dpi.per_monitor_v2 === true) return;
    throw elementUnavailable(
      `${method}: the Helper is not effectively per-monitor-v2 DPI aware; capture and input coordinates cannot safely mint actionable frame pixels.`,
      { action_sent: false, reason: "dpi_awareness_unverified" },
    );
  };
  // 还原自发行 bundle（官方 0.6.5 win32 entry :28327-28334）：同一 AxTokenRegistry
  // 同时喂输入处理器（windowsElementReadback——element_native 后台插入/前台焦点
  // 预检的 token→ref 解析）与 axReadOnly 方法族（元素 token 交易）。此前还原稿
  // registry 只挂在 axReadOnly，官方两处共享同一 registry 使 element_native 的
  // token 与元素动作 token 同源。
  const axRegistry = new AxTokenRegistry();
  const inputHandlers = createElectronInputHandlers({
    adapter,
    axSource,
    // AX hit-test 始终可用。
    allowAxHitTestClick: true,
    platform: brokerInfo.platform,
    getDisplayTopology: () => captureTopology().entries,
    windowsElementReadback: { registry: axRegistry },
  });
  const implemented = {
    // app-scoped + global synthetic-input handlers live in electronInputHandlers.ts
    // (click/scroll/drag/type_text*/press_key/hold_key and *_to_app).
    ...inputHandlers,
    broker_info: () => ({
      ...brokerInfo,
      backend: "electron",
      // Phase 4 wire handshake:broker 协议版本(非破坏)。客户端握手后比对,版本不匹配时升级/降级提示。
      // 当前帧格式仍是 NDJSON(换行分隔);未来切 4 字节长度前缀时此版本号 +1,客户端据此协商。
      api_version: "ZCodeComputerUseIPC-1",
      framing: "ndjson",
      // 承载 broker 的进程 pid：standalone helper 时即 helper 自己的 pid，让 ZCode 主进程能
      // terminate/relaunch；in-process 时是 ZCode 主进程 pid。
      pid: process.pid,
      authorization_subject: authorizationSubject(brokerInfo),
      tcc_grant_owner: brokerInfo.bundle_id,
      one_time_grant_supported: true,
      accessibility_bridge: hasAutomationBridge
        ? "system_events_bridge"
        : hasAxSource
          ? "native_ax"
          : "none",
      automation_permission_required: hasAutomationBridge,
      automation_permission_status: automationPermissionStatus,
      automation_permission_grant_owner: hasAutomationBridge ? brokerInfo.bundle_id : null,
      automation_permission_target: hasAutomationBridge ? "com.apple.systemevents" : null,
      native_dpi_awareness:
        brokerInfo.platform === "win32" ? (adapter.getNativeDpiAwareness?.() ?? null) : null,
      capabilities: {
        screen: supportsScreenCapture,
        screenshot: supportsScreenCapture,
        app_scoped_capture: hasAxSource,
        clipboard: supportsClipboard,
        // 清退（2026-11-10 R10 后续）：capabilities.open_application 键随方法删除——
        // 官方 0.6.5 win entry :28355-28370 的 capabilities 块无此键（逐字对照）。
        ax_observation: hasAxSource,
        token_scoped_element_actions: hasElementActions,
        coordinate_hit_test: hasCoordinateHitTest,
        app_scoped_text_input: hasAppScopedInput,
        app_scoped_key_input: hasAppScopedInput,
        synthetic_input: false,
        raw_mouse_keyboard: hasRawMouseKeyboard(adapter),
      },
    }),
    request_access: (params) => {
      const requested = capabilityList2(params.capabilities);
      const wantsAccessibility = wantsCapability(requested, [
        "accessibility",
        "input",
        "keyboard",
        "mouse",
        "a11y",
      ]);
      const wantsScreen = wantsCapability(requested, [
        "screen",
        "screen_recording",
        "screenshot",
        "capture",
      ]);
      const accessibilityBefore = adapter.isTrustedAccessibilityClient(false)
        ? "granted"
        : "denied";
      const accessibilityAfter = accessibilityBefore;
      const automationBefore = automationPermissionStatus;
      const automationAfter = automationBefore;
      const automationWarmupAttempted = false;
      const automationWarmupError = null;
      const screenBefore = screenCaptureStatus();
      const screenAfter = screenBefore;
      const screenWarmupAttempted = false;
      const screenPrompted = false;
      const screenImageCaptured = false;
      const screenWarmupError = null;
      const screenCaptureImplementationUnavailable = wantsScreen && !supportsScreenCapture;
      const missingPanes = [];
      if (wantsAccessibility && accessibilityAfter !== "granted") {
        missingPanes.push("accessibility");
      }
      if (wantsScreen && supportsScreenCapture && screenAfter !== "granted") {
        missingPanes.push("screen_recording");
      }
      const permissionMessage = permissionGuideMessage({
        brokerInfo,
        accessibility: wantsAccessibility ? accessibilityAfter : "not_required",
        screenRecording: wantsScreen && supportsScreenCapture ? screenAfter : "not_required",
      });
      return {
        grant_owner: brokerInfo.bundle_id,
        owner: authorizationSubject(brokerInfo),
        requested_capabilities: requested,
        accessibility: {
          status_before: accessibilityBefore,
          prompted: false,
          status_after: accessibilityAfter,
          action_required:
            wantsAccessibility && accessibilityAfter !== "granted"
              ? accessibilityActionRequired(brokerInfo)
              : null,
        },
        automation_permission: hasAutomationBridge
          ? {
              status_before: automationBefore,
              warmup_attempted: automationWarmupAttempted,
              status_after: automationAfter,
              grant_owner: brokerInfo.bundle_id,
              target: "com.apple.systemevents",
              action_required: wantsAccessibility
                ? automationActionRequired(
                    automationAfter === "not_required" ? "unknown" : automationAfter,
                    brokerInfo,
                  )
                : null,
              error: automationWarmupError,
            }
          : {
              status_before: "not_required",
              warmup_attempted: false,
              status_after: "not_required",
              grant_owner: null,
              target: null,
              action_required: null,
              error: null,
            },
        screen_recording: {
          status_before: screenBefore,
          prompted: screenPrompted,
          warmup_attempted: screenWarmupAttempted,
          image_captured: screenImageCaptured,
          status_after: screenAfter,
          action_required: screenCaptureImplementationUnavailable
            ? screenCaptureUnavailableMessage
            : wantsScreen
              ? screenAfter === "granted"
                ? null
                : screenRecordingActionRequired(brokerInfo)
              : null,
          error: screenWarmupError,
        },
        // 友好的权限汇总：给 agent / 用户一条可直接读的提示，点名 app、两项用途与各自状态。
        // （只列 Accessibility + Screen Recording——Computer Use Helper 实际只需这两项；Input Monitoring 是
        // 给监听输入用的，本 Helper 合成输入归 Accessibility 管，不需要。）
        permission_guide: {
          all_required_granted:
            missingPanes.length === 0 && !screenCaptureImplementationUnavailable,
          missing: missingPanes,
          message: screenCaptureImplementationUnavailable
            ? `${screenCaptureUnavailableMessage} ${permissionMessage}`
            : permissionMessage,
        },
        note:
          authorizationSubjectKind(brokerInfo) === "zcode_helper"
            ? "Authorization status belongs to Drora Computer Use.app. This report is read-only; request missing grants through the trusted ZCode host UI."
            : "Authorization status belongs to ZCode.app. This report is read-only; request missing grants through the trusted ZCode host UI.",
      };
    },
    // 诊断：AX 信任度做 supports_accessibility / input 权限的诊断代理（prompt=false 不弹窗）。
    supports_accessibility: () => hasAxSource && adapter.isTrustedAccessibilityClient(false),
    input_permission_status: () =>
      adapter.isTrustedAccessibilityClient(false) ? "granted" : "denied",
    screen_capture_status: () => screenCaptureStatus(),
    // 只读权限快照（不弹窗）：供 UI 权限面板实时展示 Accessibility + Screen Recording 两项。
    // AX 用 prompt=false（AXIsProcessTrusted）、Screen 用 CGPreflightScreenCaptureAccess，均无副作用。
    // 注意：这是 preflight 快照，仅用于 UI 展示，不做 effective-readiness 探测、也不触发任何弹窗/二次确认。
    // 弹窗是纯引导：不自动 requestPermissions、不做任务恢复；request_access 仅由按钮显式触发。
    // TCC.db 的 service+bundle-id 行仅作诊断：它没有证明当前 binary 的 csreq/CDHash 获授权，不能
    // 参与 granted/stale 判定。用户从系统设置回来后由 UI 精确重启一次 Helper，再以新进程的 runtime
    // preflight + 功能探针收敛；无 Full Disk Access 时 persisted=false 也不改变状态语义。
    permission_status: () => {
      const client = brokerInfo.bundle_id;
      const axRuntime = adapter.isTrustedAccessibilityClient(false);
      const axProbe = readAccessibilityProbe(adapter);
      const effectiveGranted =
        axProbe.classification === "functional" ||
        (axProbe.classification !== "disabled" && axRuntime);
      const accessibility = effectiveGranted ? "granted" : "denied";
      const screenRuntime = screenCaptureStatus();
      return {
        grant_owner: client,
        owner: authorizationSubject(brokerInfo),
        accessibility,
        accessibility_probe: {
          source: axProbe.source,
          ok: axProbe.ok,
          ax_error: axProbe.axError,
          classification: axProbe.classification,
          runtime: axRuntime,
          // Hot readiness poll 不再同步查询 user/system TCC SQLite：历史 row 不参与任何决策，且无 FDA
          // 时结果也无诊断价值。显式诊断面后续可按需采样；null 明确表示本快照未采样。
          persisted: null,
        },
        screen_recording: screenRuntime,
        screen_recording_probe: {
          runtime: screenRuntime,
          persisted: null,
        },
      };
    },
    // 非破坏性 screen-capture 探针（readiness 用）：TCC 预检可能报 granted 而 WindowServer 尚未放行本
    // 进程截屏，只有真抓到像素才算 screen 端到端可用。
    //
    // 修复原因（review !1460 Critical / Filesystem-Privacy）：之前只在 status==="denied" 时跳过抓取，
    // 但 mapScreenStatus 会把 Electron 的 not-determined 归一成 "unknown"，此时仍会调 captureScreenPng()
    // ——而首次截屏正是 macOS 触发/预热系统录屏授权流程的动作。后台 readiness 探针绝不能在用户尚未主动
    // 授权时改变权限交互状态、弹出授权对话框。因此收紧成：只有 status==="granted" 才真截屏；denied 与
    // unknown/not-determined 一律 probed:false 直接返回（未知权限 != 已授权，read-only 分类才成立）。
    screen_capture_probe: createForeignWindowScreenCaptureProbe(adapter, screenCaptureStatus),
    /**
     * 原生粘贴。整个「保存剪贴板 → 写入 → 发粘贴键 → 还原」在 Helper 内部一次完成。
     *
     * 为什么不在 host 侧用 read_clipboard/write_clipboard 拼四步：
     *   1. 那需要保留两个 broker 剪贴板原语，而它们已经没有别的消费者（协议瘦身 63 → 49）；
     *   2. 四步之间用户或另一个进程改写剪贴板，还原会把对方的新内容覆盖掉 —— 原子化消掉这个竞态。
     * 与 Codex 同构：它的 paste 也是 performAction 的一个 native variant，而非 host 侧组合。
     *
     * 粘贴键按平台选择：macOS command+v（官方字面量，offset 85542433；cmd+v 经
     * 别名表归一后等价），Linux / Windows ctrl+v。
     */
    // 清退（2026-11-10 R10 后续）：以下八个 3.11.2 血统 broker 方法 handler 整体删除
    // ——screen_size/cursor_position/list_displays/set_display/screenshot/
    // read_clipboard/write_clipboard/open_application。证据：方法名在官方 0.6.5
    // win entry 与官方 mac SEA（3.17.2）双零命中（screenshot/mouse_down 等仅以
    // capture 字段名、内部 reason 串、*_to_window ABI 名存活，见各保留处注释）；
    // 官方 v3.1 协议瘦身 49→43（win entry :19750 墓碑）。保留边界：
    //   - paste（官方 43 表成员）与下方 fallback 链使用 adapter.readClipboardText/
    //     writeClipboardText（官方在用内部链，win entry :28517 注释同款）；
    //   - screen_capture_probe/capture_app 的抓屏走 adapter.captureScreenPng
    //     （内部 error 标签 "screenshot" 为官方字面量，win entry :31808-31819）；
    //   - adapter.openApplication 仅供 capture_app 的 reopenWindowlessApp（mac）
    //     与 win.ts captureApp 原生拉起链使用。
    paste: async (params) => {
      if (!supportsClipboard) {
        throw notAuthorized("paste is unavailable in this Drora Computer Use build.");
      }
      const text = typeof params.text === "string" ? params.text : "";
      const format = typeof params.format === "string" ? params.format : "text";
      const pressKeyToApp = inputHandlers.press_key_to_app;
      if (typeof pressKeyToApp !== "function") {
        throw notAuthorized("paste requires app-scoped keyboard dispatch in this build.");
      }
      // 修复（R4.7，方案 specs/cua-gap-remediation-2026-11-09.md）：官方 SEA 字面量为
      // "command+v"（offset 85542433），此前还原稿写成 "cmd+v"。二者经
      // electronInputHandlers.ts KEY_CHORD_ALIASES（cmd→command）归一后等价，
      // 本修复仅对齐官方字面量，不改行为。
      const chord = brokerInfo.platform === "darwin" ? "command+v" : "ctrl+v";
      const providedPaste = adapter.providedPaste;
      if (format !== "text" && !providedPaste) {
        throw new BrokerError(
          "unimplemented",
          `paste format "${format}" requires the provided-paste path, which is unavailable in this build; use format "text".`,
        );
      }
      if (providedPaste) {
        // 还原自发行 bundle（官方 SEA paste handler @ 85541866 区）：R3.4 整体经
        // runPasteSerial 串行；R3.5 收尾协议——失败不再原地 rethrow，先记 failure、
        // finally 里 `restored = await finish(token)`；finish 未恢复粘贴板 →
        // paste_provided_cleanup_failed warn + 抛"勿重发 paste"错误（备份仍占位，
        // clipboard_restore_pending=true，附 paste_error）；恢复成功且有 failure →
        // 原错误在 finish 之后 rethrow。方案锚 SEA offset 85546274/85546427/
        // 85546470/85546575。注：官方 begin 的第三参（reader pid 钉扎）与
        // paste_provided 诊断的 reader_* 字段按方案记档不在本批（paste reader 钉扎
        // 待官方语义生效证据再随线）。
        return await runPasteSerial(async () => {
          const begun = await providedPaste.begin(text, format);
          if (!begun.ok) {
            throw new BrokerError(
              "internal",
              "paste could not take over the system pasteboard, so nothing was sent. action_sent=false.",
              { action_sent: false, reason: begun.error ?? "pasteboard_write_failed" },
            );
          }
          let dispatchResult;
          let failure;
          let restored = false;
          try {
            const marked = providedPaste.markDispatched?.(begun.token) ?? null;
            const dispatchedAt = Date.now();
            dispatchResult = await pressKeyToApp({
              ...params,
              text: chord,
            });
            const keyPostedAt = Date.now();
            const read = await providedPaste.awaitRead(begun.token);
            diagnostic?.(
              "paste_provided",
              {
                ok: read.ok,
                reason: read.error ?? null,
                reads: read.reads,
                reads_before_dispatch: read.readsBeforeDispatch ?? null,
                hold_ms: read.holdMs ?? null,
                dispatch_marked: marked,
                format,
                text_utf16_units: text.length,
                key_post_ms: keyPostedAt - dispatchedAt,
                await_ms: Date.now() - keyPostedAt,
              },
              read.ok ? "info" : "warn",
            );
            if (!read.ok) {
              if (read.error === "pasteboard_changed_during_paste") {
                throw new BrokerError(
                  "internal",
                  "paste was interrupted: something else took over the system pasteboard while the app was reading it. Check the app's state to make sure the user's clipboard content was not pasted instead of your text before continuing. action_sent=true.",
                  {
                    action_sent: true,
                    reason: read.error,
                    reads: read.reads,
                    reads_before_dispatch: read.readsBeforeDispatch ?? null,
                  },
                );
              }
              throw new BrokerError(
                "internal",
                "paste timed out waiting for the app to read the pasteboard; the app never consumed the paste shortcut. Nothing was inserted. Use set_value on a settable element, or activate the app and focus the field, then retry. action_sent=true.",
                {
                  action_sent: true,
                  reason: read.error ?? "pasteboard_read_timed_out",
                  reads: read.reads,
                  reads_before_dispatch: read.readsBeforeDispatch ?? null,
                },
              );
            }
          } catch (error51) {
            failure = { error: error51 };
            diagnostic?.(
              "paste_provided_failed",
              {
                stage: "dispatch_or_await",
                format,
                text_utf16_units: text.length,
                message: error51 instanceof Error ? error51.message : String(error51),
                ...(error51 instanceof BrokerError ? { code: error51.code } : {}),
              },
              "warn",
            );
          } finally {
            try {
              restored = await providedPaste.finish(begun.token);
            } catch {}
          }
          if (!restored) {
            diagnostic?.(
              "paste_provided_cleanup_failed",
              { reason: "pasteboard_restore_failed", action_sent: true },
              "warn",
            );
            throw new BrokerError(
              "internal",
              "paste cleanup could not restore the clipboard; its backup is retained for cleanup. The paste shortcut may already have been sent. Do not repeat the paste; check the app state. action_sent=true.",
              {
                action_sent: true,
                reason: "pasteboard_restore_failed",
                clipboard_restore_pending: true,
                ...(failure?.error instanceof BrokerError ? { paste_error: failure.error.details } : {}),
              },
            );
          }
          if (failure) throw failure.error;
          return dispatchResult;
        });
      }
      diagnostic?.(
        "paste_legacy_path",
        { platform: brokerInfo.platform, format, text_utf16_units: text.length },
        brokerInfo.platform === "darwin" ? "warn" : "info",
      );
      let previous = null;
      try {
        previous = await adapter.readClipboardText();
      } catch {
        previous = null;
      }
      await adapter.writeClipboardText(text);
      try {
        return await pressKeyToApp({
          ...params,
          text: chord,
        });
      } finally {
        if (previous !== null) {
          await Promise.resolve(adapter.writeClipboardText(previous)).catch(() => void 0);
        }
      }
    },
  };
  const pipAutoStart = createPipAutoStarter(adapter);
  const axMethods = axSource
    ? createAxReadOnlyMethods(axSource, axRegistry, {
        permissionDeniedHint: authorizationSubjectHint(brokerInfo, "Accessibility"),
        // 与 paste 的 provided-paste 诊断同一通道（helperMain 已接到 helperRuntimeLogger）。
        onDiagnostic: diagnostic,
        beginCaptureGeometry: () => {
          requireVerifiedWindowsFramePixels("capture_app");
          const topology = captureTopology();
          return {
            topology,
            windows:
              brokerInfo.platform === "darwin"
                ? captureScreenshotWindows(adapter, topologyDesktopBounds(topology.entries))
                : null,
          };
        },
        completeCaptureGeometry: (guard, snapshot) => {
          const captured = guard;
          const before = captured.topology;
          const after = captureTopology();
          if (before.fingerprint !== after.fingerprint) {
            throw elementUnavailable(
              "capture_app: display topology or scale factor changed while the image was captured; capture again before using pixels.",
              { action_sent: false, reason: "display_topology_changed" },
            );
          }
          const pointer = snapshot.screenshot_bounds;
          if (
            !pointer ||
            pointer.length !== 4 ||
            !pointer.every(Number.isFinite) ||
            pointer[2] <= 0 ||
            pointer[3] <= 0
          ) {
            throw elementUnavailable(
              "capture_app: native capture returned no usable pixel-to-pointer rectangle.",
              { action_sent: false, reason: "capture_geometry_unavailable" },
            );
          }
          const [x, y, width, height] = pointer;
          const containing = before.entries.filter(({ bounds }) => {
            const [dx, dy, dw, dh] = bounds;
            return x >= dx && y >= dy && x + width <= dx + dw && y + height <= dy + dh;
          });
          const display = containing.length === 1 ? containing[0] : null;
          const captureSurfaceEvidence =
            brokerInfo.platform === "darwin"
              ? buildStableAppFrameSurfaceSet(
                  snapshot,
                  captured.windows,
                  captureScreenshotWindows(adapter, topologyDesktopBounds(after.entries)),
                )
              : brokerInfo.platform === "win32"
                ? // 还原自官方 :28729-28731：win32 走 buildWindowsAppFrameSurfaceSet
                  //（windows_capture_root / screenshot_composition 两源，见函数头）。
                  buildWindowsAppFrameSurfaceSet(snapshot)
                : {};
          return {
            coordinate_contract: "frame_pixel_projection_v1",
            pointer: {
              x,
              y,
              width,
              height,
              unit:
                brokerInfo.platform === "darwin"
                  ? "point"
                  : brokerInfo.platform === "win32"
                    ? "physical_pixel"
                    : "x11_root_pixel",
            },
            display: {
              id: display?.id ?? null,
              index: display?.index ?? null,
              topology_fingerprint: before.fingerprint,
            },
            display_topology: before.entries,
            ...captureSurfaceEvidence,
          };
        },
        // role→kind 注入：缺省（darwin 不传 roleToKind）= macOS ROLE_TO_KIND，行为不变。
        // Windows/Linux 调用方通过 CreateElectronNativeBackendOptions.roleToKind 传入各自 map。
        ...(options.roleToKind ? { roleToKind: options.roleToKind } : {}),
        onCaptureWindow: (target, context) => {
          if (options.onPipCaptureWindow) {
            options.onPipCaptureWindow(target, context);
            return;
          }
          if (options.allowControllerVisuals?.() === false) return;
          pipAutoStart.onCaptureWindow(target);
        },
        // macOS windowless app：capture_app 读到 cg-only-no-ax-window 时由这里把真窗口开出来，
        // 让它重读一次再返回完整树（对齐 Codex get_app_state：它一次到位，我们过去要模型自己
        // 绕 open_application→wait→再读，窗口反复上屏才是用户报的「打断」）。
        // activate:false 是硬要求——窗口会上屏但键盘焦点不动（Codex 同样不隐藏窗口）。
        // 用 settleApplicationWindow 确认「真窗口出现了」：它按 onscreen 标记计数，不会被
        // WindowServer 残留的 offscreen 窗口骗过（见 hasOnscreenWindow）。
        ...(brokerInfo.platform === "darwin" && adapter.openApplication
          ? {
              reopenWindowlessApp: async (target) => {
                if (typeof target.pid !== "number" || target.pid <= 0) {
                  return false;
                }
                if (!target.bundle_id && !target.name) return false;
                try {
                  await adapter.openApplication({
                    ...(target.bundle_id ? { bundleId: target.bundle_id } : {}),
                    ...(target.name ? { name: target.name } : {}),
                    activate: false,
                    newInstance: false,
                  });
                } catch {
                  return false;
                }
                return settleApplicationWindow(axSource, {
                  pid: target.pid,
                  bundle_id: target.bundle_id,
                  name: target.name,
                });
              },
            }
          : {}),
        ...(hasAppScopedInput && axSource.elementFocus
          ? {
              replaceTextValueWithInput: async ({
                ref,
                value,
                pid,
                bundleId,
                bounds,
                windowId,
              }) => {
                return replaceTextValueWithVerifiedInput({
                  adapter,
                  axSource,
                  ref,
                  value,
                  pid,
                  bundleId,
                  bounds,
                  windowId,
                });
              },
            }
          : {}),
        // 还原自发行 bundle（官方 0.6.5 win32 entry :28811-28822）：Windows 读回
        // 裁决的宿主探针——复用分类器的 host 归因判 Chromium 直接宿主（AX-echo
        // 降级，applyAxEchoSurfaceTrust 消费）。仅 win32 且 classify ABI 在场时注入。
        ...(brokerInfo.platform === "win32" && adapter.classifyPostMessageDelivery
          ? {
              isChromiumHostWindow: (windowId) => {
                const probe = adapter.classifyPostMessageDelivery(windowId, "mouse_click");
                return typeof probe === "object" && probe !== null && probe.host === "chromium";
              },
            }
          : {}),
      })
    : {};
  const backend = {
    ...createUnavailableNativeBackend({
      brokerInfo,
      reason: FAIL_CLOSED_REASON,
    }),
    ...axMethods,
    ...implemented,
  };
  return backend;
}
