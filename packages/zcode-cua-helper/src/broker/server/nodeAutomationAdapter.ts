/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import {
  WindowsScreenCaptureError,
  createWindowsScreenCaptureBridge,
} from "../../native/windowsScreenCapture.js";
import {
  instrumentWindowsOperationNative,
  readWindowsMenuContent,
  readWindowsOperationScene,
} from "../../native/windows-operation-request.js";
import { BrokerError, launchFailed, permissionDenied } from "../types.js";
import { withIbusBypassAsync, withIbusBypassSync } from "./linuxIbusBypass.js";

function wrapOptionalNativeMethod(method) {
  return typeof method === "function" ? (...args) => method(...args) : void 0;
}
function clipboardError(operation, error51) {
  if (error51 === "busy") {
    return new BrokerError(
      "timeout",
      `${operation}: native clipboard was busy before mutation admission; no clipboard mutation occurred`,
    );
  }
  if (error51 === "too_large") {
    return new BrokerError(
      "invalid_request",
      `${operation}: clipboard text exceeds 8388608 UTF-16 code units`,
    );
  }
  if (error51 === "write_failed") {
    return new BrokerError(
      "internal",
      `${operation}: native clipboard write failed after admission; the action is possibly-sent and must not be retried automatically`,
    );
  }
  if (error51 === "invalid_data") {
    return new BrokerError("internal", `${operation}: native clipboard text was invalid`);
  }
  if (error51 === "unavailable") {
    return new BrokerError(
      "internal",
      `${operation}: native Windows clipboard is unavailable in this interactive session`,
    );
  }
  return new BrokerError(
    "internal",
    operation === "write_clipboard"
      ? `${operation}: native clipboard returned an invalid outcome; the action is possibly-sent and must not be retried automatically`
      : `${operation}: native clipboard returned an invalid outcome`,
  );
}
function windowsScreenCaptureBrokerError(operation, code) {
  if (code === "busy" || code === "timeout") {
    return new BrokerError(
      "timeout",
      `${operation}: native Windows screen capture did not complete (${code})`,
    );
  }
  if (code === "too_large") {
    return new BrokerError(
      "invalid_request",
      `${operation}: native Windows screen capture exceeds the fixed size limit`,
    );
  }
  if (code === "unsupported") {
    return new BrokerError(
      "not_authorized",
      `${operation}: native Windows screen capture is unsupported`,
    );
  }
  if (code === "invalid_target" || code === "target_changed") {
    return new BrokerError(
      "element_unavailable",
      `${operation}: native Windows capture target is unavailable (${code})`,
    );
  }
  return new BrokerError(
    "internal",
    `${operation}: native Windows screen capture failed (${code})`,
  );
}
async function readNativeClipboardText(read) {
  let outcome;
  try {
    outcome = await read();
  } catch {
    throw clipboardError("read_clipboard", "malformed");
  }
  if (
    outcome &&
    typeof outcome === "object" &&
    "ok" in outcome &&
    outcome.ok === true &&
    "text" in outcome &&
    typeof outcome.text === "string"
  ) {
    return outcome.text;
  }
  if (
    outcome &&
    typeof outcome === "object" &&
    "ok" in outcome &&
    outcome.ok === false &&
    "error" in outcome &&
    typeof outcome.error === "string"
  ) {
    throw clipboardError("read_clipboard", outcome.error);
  }
  throw clipboardError("read_clipboard", "malformed");
}
async function writeNativeClipboardText(write, text) {
  let outcome;
  try {
    outcome = await write(text);
  } catch {
    throw clipboardError("write_clipboard", "malformed");
  }
  if (outcome && typeof outcome === "object" && "ok" in outcome && outcome.ok === true) {
    return;
  }
  if (
    outcome &&
    typeof outcome === "object" &&
    "ok" in outcome &&
    outcome.ok === false &&
    "error" in outcome &&
    typeof outcome.error === "string"
  ) {
    throw clipboardError("write_clipboard", outcome.error);
  }
  throw clipboardError("write_clipboard", "malformed");
}
export function createNodeAutomationAdapter(options) {
  const { system } = options;
  // 还原自发行 bundle（官方 0.6.5 win32 entry :31279-31280）：win32 平台在 adapter
  // 入口即对 native addon 做操作请求 instrument（mutations 集方法进 Proxy——操作
  // 关联守卫 + evidence 采集；WeakMap 幂等，与 win.ts createAxWinReadOnlySource 的
  // 二次 instrument 共享同一包装）。非 win32 原样传递（mac 官方形态无此链）。
  const native =
    (options.platform ?? process.platform) === "win32"
      ? instrumentWindowsOperationNative(options.native)
      : options.native;
  const backgroundNative = native;
  const probeAccessibility = wrapOptionalNativeMethod(native.probeAccessibility);
  const probeAccessibilityStatus = wrapOptionalNativeMethod(native.probeAccessibilityStatus);
  const requestScreenCaptureAccess = wrapOptionalNativeMethod(native.requestScreenCaptureAccess);
  const screenCaptureProbeWindows = wrapOptionalNativeMethod(native.screenCaptureProbeWindows);
  const inspectPngContent = wrapOptionalNativeMethod(native.inspectPngContent);
  const processExecutablePath = wrapOptionalNativeMethod(native.processExecutablePath);
  const openApplicationInBackgroundAsync = wrapOptionalNativeMethod(
    native.openApplicationInBackgroundAsync,
  );
  const clickAtPoint = wrapOptionalNativeMethod(native.clickAtPoint);
  const clickElementAtPoint = wrapOptionalNativeMethod(native.clickElementAtPoint);
  // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:31305-31316）：
  // R8 守卫链依赖的三个 additive ABI——hitTestInvokeAtPointAsync（32034）、
  // classifyPostMessageDelivery（32036）、postMessageClickAsync（32037）。
  // 旧 addon 缺导出时 wrapOptionalNativeMethod 返回 undefined，electronInputHandlers
  // 的守卫/降级分支按能力缺失 fail-closed（与官方同款）。
  const hitTestInvokeAtPointAsync = wrapOptionalNativeMethod(
    native.hitTestInvokeAtPointAsync,
  );
  // 还原自官方 31308-31310：UIA 模式梯原语（elementPatternCallAsync）。
  const elementPatternCallAsync = wrapOptionalNativeMethod(native.elementPatternCallAsync);
  const classifyPostMessageDelivery = wrapOptionalNativeMethod(
    native.classifyPostMessageDelivery,
  );
  const postMessageClickAsync = wrapOptionalNativeMethod(native.postMessageClickAsync);
  // 还原自发行 bundle（官方 0.6.5 win32 entry :31305-31340）：postMessage 后台投递
  // 族与 UIA 读回族 additive ABI——char/key/scroll/drag 后台投递、XAML 加速器、
  // 元素值读回与写后读回。旧 addon 缺导出时为 undefined，electronInputHandlers 的
  // 后台投递族（dispatchWindowsElementInsertion/BackgroundKeyed/BackgroundScroll/
  // BackgroundDrag）与 axReadOnly 的读回链按能力缺失走官方同款降级
  //（回退前台派发 / 裸写路径）。
  const postMessageCharAsync = wrapOptionalNativeMethod(native.postMessageCharAsync);
  const postMessageKeyAsync = wrapOptionalNativeMethod(native.postMessageKeyAsync);
  const postMessageScrollAsync = wrapOptionalNativeMethod(native.postMessageScrollAsync);
  const postMessageDragAsync = wrapOptionalNativeMethod(native.postMessageDragAsync);
  const invokeAcceleratorAsync = wrapOptionalNativeMethod(native.invokeAcceleratorAsync);
  const elementValueReadAsync = wrapOptionalNativeMethod(native.elementValueReadAsync);
  const setValueReadbackAsync = wrapOptionalNativeMethod(native.setValueReadbackAsync);
  const preventActivation = wrapOptionalNativeMethod(native.preventActivation);
  const reenableActivation = wrapOptionalNativeMethod(native.reenableActivation);
  const isFocusStealPrevented = wrapOptionalNativeMethod(native.isFocusStealPrevented);
  const activateApplication = wrapOptionalNativeMethod(native.activateApplication);
  // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:31346-31351）：
  // hasActiveInputHolds（32051）/ getForegroundRootWindowId（32053）/
  // frameWindowContext（32054）/ restoreForegroundWindow（32058）四个守卫域 ABI。
  // 消费方：electronInputHandlers.ts 的 key-hold 防误路由、foregroundRestoreScope、
  // windowsForegroundWindowGate 菜单宿主门（均已还原，此前因 adapter 缺字段恒 no-op）。
  const hasActiveInputHolds = wrapOptionalNativeMethod(native.hasActiveInputHolds);
  const activateWindow = wrapOptionalNativeMethod(native.activateWindow);
  const getForegroundRootWindowId = wrapOptionalNativeMethod(
    native.getForegroundRootWindowId,
  );
  const frameWindowContext = wrapOptionalNativeMethod(native.frameWindowContext);
  const enumerateSurfacesForFrame = wrapOptionalNativeMethod(native.enumerateSurfacesForFrame);
  const restoreForegroundWindow = wrapOptionalNativeMethod(native.restoreForegroundWindow);
  const activateAppFrameSurface = wrapOptionalNativeMethod(native.activateAppFrameSurface);
  const terminateApplication = wrapOptionalNativeMethod(native.terminateApplicationVerified);
  const platform2 = options.platform ?? process.platform;
  const windowsScreenCapture =
    platform2 === "win32" ? createWindowsScreenCaptureBridge(native) : null;
  const pasteboardBeginProvidedPaste = wrapOptionalNativeMethod(
    native.pasteboardBeginProvidedPaste,
  );
  const pasteboardAwaitProvidedRead = wrapOptionalNativeMethod(native.pasteboardAwaitProvidedRead);
  const pasteboardMarkProvidedPasteDispatched = wrapOptionalNativeMethod(
    native.pasteboardMarkProvidedPasteDispatched,
  );
  const pasteboardFinishProvidedPaste = wrapOptionalNativeMethod(
    native.pasteboardFinishProvidedPaste,
  );
  const readClipboardTextAsync = wrapOptionalNativeMethod(native.readClipboardTextAsync);
  const dpiAwarenessInfo = wrapOptionalNativeMethod(native.dpiAwarenessInfo);
  const writeClipboardTextAsync = wrapOptionalNativeMethod(native.writeClipboardTextAsync);
  let nativeClipboardSessionReady = false;
  if (platform2 === "win32" && typeof native.isInteractiveSession === "function") {
    try {
      nativeClipboardSessionReady = native.isInteractiveSession() === true;
    } catch {
      nativeClipboardSessionReady = false;
    }
  }
  // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:31381-31383）：
  // providedPaste 能力门是平台条件式——darwin 只看三件套导出；win32 是硬门，
  // 要求 isInteractiveSession()===true（nativeClipboardSessionReady，31374-31381
  // 同源已在上方计算）+ 三件套 + markDispatched 存在。此前还原稿把 darwin 分支
  // 写成整条 && 链，win32 永远 false——官方 0.6.5 win addon 四导出齐全时
  // provided-paste 路径（paste handler）整条死路，本批对齐官方条件式。
  const hasProvidedPasteExports =
    typeof pasteboardBeginProvidedPaste === "function" &&
    typeof pasteboardAwaitProvidedRead === "function" &&
    typeof pasteboardFinishProvidedPaste === "function";
  const hasProvidedPaste =
    platform2 === "darwin"
      ? hasProvidedPasteExports
      : platform2 === "win32" &&
        nativeClipboardSessionReady &&
        hasProvidedPasteExports &&
        typeof pasteboardMarkProvidedPasteDispatched === "function";
  const hasNativeClipboard =
    platform2 === "win32" &&
    nativeClipboardSessionReady &&
    typeof readClipboardTextAsync === "function" &&
    typeof writeClipboardTextAsync === "function";
  const linuxNoFocusGate =
    platform2 === "linux" && typeof isFocusStealPrevented !== "function"
      ? {
          preventActivation: () => true,
          reenableActivation: () => false,
          isFocusStealPrevented: () => false,
        }
      : null;
  const pipStart = wrapOptionalNativeMethod(native.pipStart);
  const pipStartVerified = wrapOptionalNativeMethod(native.pipStartVerifiedAsync);
  const pipStartVerifiedComposite = wrapOptionalNativeMethod(native.pipStartVerifiedCompositeAsync);
  const pipStop = wrapOptionalNativeMethod(native.pipStop);
  const pipStopTarget = wrapOptionalNativeMethod(native.pipStopTarget);
  const pipGetLeadTarget = wrapOptionalNativeMethod(native.pipGetLeadTarget);
  const pipSetActiveGroup = wrapOptionalNativeMethod(native.pipSetActiveGroup);
  const pipBeginTurn = wrapOptionalNativeMethod(native.pipBeginTurn);
  const pipTaskCompleted = wrapOptionalNativeMethod(native.pipTaskCompleted);
  const pipFreezeGroup = wrapOptionalNativeMethod(native.pipFreezeGroup);
  const pipDismiss = wrapOptionalNativeMethod(native.pipDismiss);
  const pipIsRunning = wrapOptionalNativeMethod(native.pipIsRunning);
  const pipIsInteractionReady = wrapOptionalNativeMethod(native.pipIsInteractionReady);
  const pipIsDismissed = wrapOptionalNativeMethod(native.pipIsDismissed);
  const pipClearDismissed = wrapOptionalNativeMethod(native.pipClearDismissed);
  const moveTo = wrapOptionalNativeMethod(native.moveTo);
  const scrollAt = wrapOptionalNativeMethod(native.scrollAt);
  const drag = native.dragAsync
    ? wrapOptionalNativeMethod(native.dragAsync)
    : wrapOptionalNativeMethod(native.drag);
  const mouseDown = wrapOptionalNativeMethod(native.mouseDown);
  const mouseUp = wrapOptionalNativeMethod(native.mouseUp);
  const beginBackgroundWindowInputDetailed = wrapOptionalNativeMethod(
    backgroundNative.beginBackgroundWindowInputDetailedAsync,
  );
  const beginBackgroundWindowInputLegacy = wrapOptionalNativeMethod(
    backgroundNative.beginBackgroundWindowInput,
  );
  const endBackgroundWindowInputLegacy = wrapOptionalNativeMethod(
    backgroundNative.endBackgroundWindowInput,
  );
  const clickToWindowLegacy = wrapOptionalNativeMethod(backgroundNative.clickToWindow);
  const moveToWindowLegacy = wrapOptionalNativeMethod(backgroundNative.moveToWindow);
  const scrollToWindowLegacy = wrapOptionalNativeMethod(backgroundNative.scrollToWindow);
  const dragToWindowLegacy = wrapOptionalNativeMethod(backgroundNative.dragToWindow);
  const mouseDownToWindowLegacy = wrapOptionalNativeMethod(backgroundNative.mouseDownToWindow);
  const mouseUpToWindowLegacy = wrapOptionalNativeMethod(backgroundNative.mouseUpToWindow);
  const hasLegacyBackgroundActions =
    beginBackgroundWindowInputLegacy !== void 0 &&
    endBackgroundWindowInputLegacy !== void 0 &&
    clickToWindowLegacy !== void 0 &&
    moveToWindowLegacy !== void 0 &&
    scrollToWindowLegacy !== void 0 &&
    dragToWindowLegacy !== void 0 &&
    mouseDownToWindowLegacy !== void 0 &&
    mouseUpToWindowLegacy !== void 0;
  const endBackgroundWindowInput = wrapOptionalNativeMethod(
    backgroundNative.endBackgroundWindowInputAsync,
  );
  const endBackgroundWindowInputDetailed = wrapOptionalNativeMethod(
    backgroundNative.endBackgroundWindowInputDetailedAsync,
  );
  const clickToWindow = wrapOptionalNativeMethod(backgroundNative.clickToWindowAsync);
  const moveToWindow = wrapOptionalNativeMethod(backgroundNative.moveToWindowAsync);
  const scrollToWindow = wrapOptionalNativeMethod(backgroundNative.scrollToWindowAsync);
  const dragToWindow = wrapOptionalNativeMethod(backgroundNative.dragToWindowAsync);
  const mouseDownToWindow = wrapOptionalNativeMethod(
    backgroundNative.mouseDownToWindowDetailedAsync,
  );
  const mouseUpToWindow = wrapOptionalNativeMethod(backgroundNative.mouseUpToWindowAsync);
  const mouseUpToPid = wrapOptionalNativeMethod(native.mouseUpToPid);
  const typeTextGlobalRaw = wrapOptionalNativeMethod(native.typeTextGlobal);
  const typeTextGlobal = typeTextGlobalRaw
    ? (text) => withIbusBypassSync(() => typeTextGlobalRaw(text))
    : void 0;
  // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:31478 / surface 32087）：
  // type_text 截断双语义依赖的异步原语；缺失时 handler 回退同步 typeTextGlobal。
  const typeTextGlobalAsync = wrapOptionalNativeMethod(native.typeTextGlobalAsync);
  const pressKeyGlobal = wrapOptionalNativeMethod(native.pressKeyGlobal);
  const typeTextToPidVerified = wrapOptionalNativeMethod(native.typeTextToPidVerified);
  const pressKeyToPidVerified = wrapOptionalNativeMethod(native.pressKeyToPidVerified);
  const typeTextToPid = wrapOptionalNativeMethod(native.typeTextToPid);
  const pressKeyToPid = wrapOptionalNativeMethod(native.pressKeyToPid);
  const holdKeyToPidVerified = wrapOptionalNativeMethod(native.holdKeyToPidVerified);
  const hasVerifiedAppInput =
    typeTextToPidVerified !== void 0 &&
    pressKeyToPidVerified !== void 0 &&
    holdKeyToPidVerified !== void 0;
  const hasAsyncBackgroundActions =
    beginBackgroundWindowInputDetailed !== void 0 &&
    endBackgroundWindowInput !== void 0 &&
    clickToWindow !== void 0 &&
    moveToWindow !== void 0 &&
    scrollToWindow !== void 0 &&
    dragToWindow !== void 0 &&
    mouseDownToWindow !== void 0 &&
    mouseUpToWindow !== void 0;
  const hasMacBackgroundInput =
    platform2 === "darwin" &&
    (hasAsyncBackgroundActions || hasLegacyBackgroundActions) &&
    hasVerifiedAppInput;
  let macBackgroundSequenceInFlight = false;
  const withMacBackgroundSequence = async (method, action) => {
    if (macBackgroundSequenceInFlight) {
      throw permissionDenied(
        `${method}: another macOS background input sequence is active. action_sent=false.`,
        { action_sent: false, reason: "background_input_busy" },
      );
    }
    macBackgroundSequenceInFlight = true;
    try {
      return await action();
    } finally {
      macBackgroundSequenceInFlight = false;
    }
  };
  const withMacBackgroundKeyboard = async (
    label,
    pid,
    expectedBundleId,
    windowId,
    bounds,
    allowProvenAttachedSurface,
    action,
  ) =>
    withMacBackgroundSequence("macOS background keyboard", async () => {
      let beginOutcome = null;
      let attachedSurfaceAbiUnavailable = false;
      let beginOk = false;
      if (hasMacBackgroundInput && beginBackgroundWindowInputDetailed) {
        beginOutcome = await beginBackgroundWindowInputDetailed(
          pid,
          expectedBundleId,
          windowId,
          bounds,
          ...(allowProvenAttachedSurface ? [true] : []),
        );
        beginOk = beginOutcome?.ok === true;
      } else if (allowProvenAttachedSurface) {
        attachedSurfaceAbiUnavailable = true;
      } else if (hasMacBackgroundInput && beginBackgroundWindowInputLegacy) {
        beginOk = beginBackgroundWindowInputLegacy(pid, expectedBundleId, windowId, bounds);
      }
      if (!beginOk) {
        const reason =
          beginOutcome?.reason ??
          (attachedSurfaceAbiUnavailable
            ? "attached_surface_native_abi_unavailable"
            : beginBackgroundWindowInputDetailed
              ? "async_unclassified"
              : "legacy_unclassified");
        const details: any = {
          keyboard_action: label,
          action_sent: false,
          reason,
          pid,
          window_id: windowId,
          expected_bounds: bounds,
        };
        if (beginOutcome) {
          details.native_status = beginOutcome.native_status;
          details.live_owner_pid = beginOutcome.live_owner_pid;
          details.live_on_screen = beginOutcome.live_on_screen;
          details.live_on_screen_list = beginOutcome.live_on_screen_list ?? null;
          details.live_bounds = beginOutcome.live_bounds;
          details.missing_symbols = beginOutcome.missing_symbols;
        }
        options.logger?.warn(void 0, "macOS background keyboard begin rejected", details);
        throw permissionDenied(
          `macOS background keyboard begin rejected: reason=${reason}. action_sent=false.`,
          details,
        );
      }
      let actionError = null;
      let result;
      try {
        result = await action();
      } catch (error51) {
        actionError = error51;
      }
      let endOutcome = null;
      let ended = false;
      if (endBackgroundWindowInputDetailed) {
        endOutcome = await endBackgroundWindowInputDetailed(
          pid,
          expectedBundleId,
          windowId,
          bounds,
          ...(allowProvenAttachedSurface ? [true] : []),
        );
        ended = endOutcome?.ok === true;
      } else if (endBackgroundWindowInput) {
        ended =
          (await endBackgroundWindowInput(
            pid,
            expectedBundleId,
            windowId,
            bounds,
            ...(allowProvenAttachedSurface ? [true] : []),
          )) === true;
      } else {
        ended =
          (await endBackgroundWindowInputLegacy(pid, expectedBundleId, windowId, bounds)) === true;
      }
      if (actionError !== null) throw actionError;
      if (ended) {
        options.logger?.info(void 0, "macOS background keyboard delivered", {
          keyboard_action: label,
          action_sent: true,
          pid,
          window_id: windowId,
          // 实验开关下 CPS 成对激活记录的投递结果（-1 未尝试 / 0 失败 / 1 成功）。
          // 走返回值而不是 native stderr —— 后者到不了 Helper 的 jsonl。
          cps_activation_pair: beginOutcome?.cps_activation_pair ?? null,
          ...(endOutcome
            ? {
                original_frontmost_pid: endOutcome.original_frontmost_pid,
                live_frontmost_pid: endOutcome.live_frontmost_pid,
              }
            : {}),
        });
      }
      if (!ended) {
        const reason =
          endOutcome?.reason ??
          (endBackgroundWindowInputDetailed ? "async_unclassified" : "legacy_unclassified");
        const details: any = {
          keyboard_action: label,
          action_sent: true,
          request_delivery_state: "possibly_sent",
          reason,
          pid,
          window_id: windowId,
        };
        if (endOutcome) {
          details.native_status = endOutcome.native_status;
          details.original_frontmost_pid = endOutcome.original_frontmost_pid;
          details.live_frontmost_pid = endOutcome.live_frontmost_pid;
          details.original_cursor = endOutcome.original_cursor;
          details.live_cursor = endOutcome.live_cursor;
        }
        if (reason === "frontmost_changed" || reason === "cursor_moved") {
          options.logger?.warn(void 0, "macOS background keyboard end invariant drifted", details);
          return result;
        }
        options.logger?.warn(void 0, "macOS background keyboard end rejected", details);
        throw permissionDenied(
          `macOS background keyboard end rejected: reason=${reason}. The key was already dispatched; do not retry blindly.`,
          details,
        );
      }
      return result;
    });
  const holdKeyGlobal =
    typeof native.holdKeyGlobalAsync === "function"
      ? (text, durationMs, sessionKey) => native.holdKeyGlobalAsync(text, durationMs, sessionKey)
      : void 0;
  const cancelInputHoldsForSession = wrapOptionalNativeMethod(native.cancelInputHoldsForSession);
  const hideVirtualPointer = wrapOptionalNativeMethod(native.ghostHide);
  const keyDownGlobal = wrapOptionalNativeMethod(native.keyDownGlobal);
  const keyUpGlobal = wrapOptionalNativeMethod(native.keyUpGlobal);
  const toDisplayInfo = (display) => ({
    id: display.id,
    bounds: {
      x: display.bounds[0],
      y: display.bounds[1],
      width: display.bounds[2],
      height: display.bounds[3],
    },
    // bounds follow the native pointer unit; scale_factor binds them to the
    // physical screenshot raster and is therefore part of stale-frame proof.
    size: { width: display.bounds[2], height: display.bounds[3] },
    scaleFactor: display.scale_factor ?? 1,
  });
  const emptyDisplay = {
    id: 0,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    size: { width: 0, height: 0 },
    scaleFactor: 1,
  };
  let fallbackDisplay = null;
  const primeFallbackDisplay = (png) => {
    if (fallbackDisplay) return;
    let width = 0;
    let height = 0;
    if (typeof native.inspectPngContent === "function") {
      const summary = native.inspectPngContent(png);
      if (summary) {
        width = summary.width;
        height = summary.height;
      }
    }
    if (!width || !height) {
      if (png.length >= 24) {
        width = png[16] * 16777216 + png[17] * 65536 + png[18] * 256 + png[19];
        height = png[20] * 16777216 + png[21] * 65536 + png[22] * 256 + png[23];
      }
    }
    if (width > 0 && height > 0) {
      fallbackDisplay = {
        id: 1,
        bounds: { x: 0, y: 0, width, height },
        size: { width, height },
        scaleFactor: 1,
        // Bug root cause: these dimensions came from PNG pixels, not native
        // logical pointer geometry. On Retina, signing them as points creates
        // an actionable transform that lands 2x off. Keep the readiness/list
        // fallback, but mark it ineligible for frame-pixel authority.
        framePixelVerified: false,
      };
    }
  };
  const requireVerifiedInput = (outcome, method, pid) => {
    if (outcome?.ok === true) return;
    if (outcome?.error === "input_busy" || outcome?.error === "input_expired") {
      throw new BrokerError(
        "timeout",
        `${method}: ${outcome.error}; native input was not admitted before its safe deadline and no events were sent`,
      );
    }
    if (outcome?.error === "text_too_long") {
      throw new BrokerError("invalid_request", `${method}: native text length limit exceeded`);
    }
    if (outcome?.error === "cancelled") {
      throw new BrokerError(
        "timeout",
        `${method}: input hold was cancelled; any pressed keys were released`,
      );
    }
    throw new Error(
      `${method}: verified pid-scoped input to ${pid} failed (${outcome?.error ?? "invalid native outcome"})`,
    );
  };
  const screenStatusFn = (() => {
    if (platform2 === "win32") {
      return () => {
        if (windowsScreenCapture?.available) return "granted";
        try {
          return native.screenCaptureStatus?.() === "denied" ? "denied" : "unknown";
        } catch {
          return "unknown";
        }
      };
    }
    if (typeof native.screenCaptureStatus === "function") {
      return native.screenCaptureStatus;
    }
    if (platform2 === "linux") {
      return () => "granted";
    }
    return () => "unknown";
  })();
  return {
    macBackgroundInputRequired: platform2 === "darwin",
    withBackgroundWindowContext: hasMacBackgroundInput
      ? (pid, expectedBundleId, windowId, bounds, action) =>
          withMacBackgroundKeyboard(
            // 通用出口，不是那三个键盘动作之一 —— 如实标注，别硬套成 press_key。
            "window_context",
            pid,
            expectedBundleId,
            windowId,
            bounds,
            false,
            action,
          )
      : void 0,
    supportsScreenCapture:
      platform2 === "win32"
        ? windowsScreenCapture?.available === true
        : system.supportsScreenCapture !== false,
    providedPaste: hasProvidedPaste
      ? {
          // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:31762）：
          // begin 桥签名带第三参 expectedReaderPid（paste handler 侧的读者钉扎）。
          // 我方 paste 消费侧仍按已记档分歧（specs/cua-gap-remediation-2026-11-09.md
          // R3.5 注）两参调用——桥此处对齐官方签名，undefined 透传与缺参等价，无行为变化。
          begin: (text, format, expectedReaderPid) =>
            pasteboardBeginProvidedPaste(text, format, expectedReaderPid),
          awaitRead: (token, timeoutMs, graceMs, minHoldMs) =>
            pasteboardAwaitProvidedRead(token, timeoutMs, graceMs, minHoldMs),
          // 旧 addon 没有这个导出：缺失时 awaitRead 退化成旧语义（任何读取都算），
          // 行为与升级前一致，不会因为缺少它而拒绝粘贴。
          ...(typeof pasteboardMarkProvidedPasteDispatched === "function"
            ? { markDispatched: (token) => pasteboardMarkProvidedPasteDispatched(token) }
            : {}),
          finish: (token) => pasteboardFinishProvidedPaste(token),
        }
      : void 0,
    supportsClipboard: hasNativeClipboard
      ? true
      : platform2 === "win32"
        ? false
        : system.supportsClipboard !== false,
    isTrustedAccessibilityClient: (prompt) => (prompt ? native.promptTrust() : native.isTrusted()),
    probeAccessibility,
    probeAccessibilityStatus,
    getScreenMediaAccessStatus: () => screenStatusFn(),
    getNativeDpiAwareness: dpiAwarenessInfo,
    requestScreenCaptureAccess,
    getPrimaryDisplay: () => {
      const all = native.displays();
      if (all.length > 0) {
        const primary = all.find((display) => display.main) ?? all[0];
        return primary ? toDisplayInfo(primary) : emptyDisplay;
      }
      return fallbackDisplay ?? emptyDisplay;
    },
    getAllDisplays: () => {
      const all = native.displays().map(toDisplayInfo);
      if (all.length > 0) return all;
      return fallbackDisplay ? [fallbackDisplay] : [];
    },
    getCursorScreenPoint: () => native.cursorPoint(),
    captureScreenPng: async (area) => {
      let png;
      if (platform2 === "win32") {
        if (!windowsScreenCapture?.available) return null;
        const selectedArea = (() => {
          if (area) {
            return [area.x, area.y, area.width, area.height];
          }
          const displays = native.displays();
          const primary = displays.find((display) => display.main) ?? displays[0];
          return primary?.bounds;
        })();
        if (!selectedArea) {
          throw windowsScreenCaptureBrokerError("screenshot", "invalid_target");
        }
        try {
          png = (await windowsScreenCapture.captureMonitor(selectedArea)).data;
        } catch (error51) {
          throw windowsScreenCaptureBrokerError(
            "screenshot",
            error51 instanceof WindowsScreenCaptureError ? error51.code : "capture_failed",
          );
        }
      } else {
        png = await system.captureScreenPng(area);
      }
      if (png && png.length > 0 && area === void 0) {
        primeFallbackDisplay(png);
      }
      return png;
    },
    // 新 addon 直接从 WindowServer 给出 on-screen CGWindowID；旧 addon 缺失时两条能力都不暴露，
    // 让 readiness 明确 fail-closed，绝不偷偷退回 wallpaper/display capture。
    listScreenCaptureProbeWindows: screenCaptureProbeWindows,
    // 根因：这两条能力原本被绑成同一个「addon 世代」开关，这在 macOS 成立，在 Windows 不成立。
    // Windows 的窗口抓图走 captureWindowPngVerifiedAsync，契约需要
    // {windowId, pid, expectedCanonicalBundleId} 的完整身份，windowId-only 的
    // system.captureWindowPng 在 windowsSystemSurface 里是恒 null 的桩。补上探针后若继续
    // 连带暴露它，readiness 的失败原因会从 foreign_window_probe_unavailable（能力不存在）
    // 退化成 captured_window_empty（能力存在但抓不到），等于把「没实现」谎报成「实现了但坏了」。
    captureWindowPng:
      screenCaptureProbeWindows && platform2 !== "win32"
        ? (windowId, timeoutMs) =>
            timeoutMs === void 0
              ? system.captureWindowPng(windowId)
              : system.captureWindowPng(windowId, timeoutMs)
        : void 0,
    inspectPngContent,
    readClipboardText: hasNativeClipboard
      ? () => readNativeClipboardText(readClipboardTextAsync)
      : () => system.readClipboardText(),
    writeClipboardText: hasNativeClipboard
      ? (text) => writeNativeClipboardText(writeClipboardTextAsync, text)
      : (text) => system.writeClipboardText(text),
    resolveApplicationBundleId:
      platform2 === "darwin" && system.resolveApplicationBundleId
        ? (name) => system.resolveApplicationBundleId(name)
        : void 0,
    processExecutablePath,
    // 唯一调用方是 macOS 的 reopenWindowlessApp（capture_app 读到 cg-only-no-ax-window
    // 时把真窗口重新开出来）。系统面不实现启动能力时这里也不暴露 —— Windows 的启动走
    // 原生 launchApplicationAsync，整条路在 src/native/win.ts 的 captureApp 里。
    openApplication: system.openApplication
      ? async (params) => {
          if (
            platform2 === "darwin" &&
            params.activate === false &&
            params.newInstance !== true &&
            !params.urls?.length
          ) {
            if (!openApplicationInBackgroundAsync) {
              throw launchFailed(
                "open_application: native macOS completion-backed background launch is unavailable. Update the Helper to a build that ships the completion-backed launch ABI.",
              );
            }
            console.error(
              `[cua-openapp-diag] adapter native launch begin bundle=${JSON.stringify(params.bundleId)} name=${JSON.stringify(params.name)} activate=${JSON.stringify(params.activate)} urls=${JSON.stringify(params.urls?.length ?? 0)} newInstance=${JSON.stringify(params.newInstance)}`,
            );
            const completed = await openApplicationInBackgroundAsync(
              params.bundleId ?? null,
              params.name ?? null,
            );
            console.error(
              `[cua-openapp-diag] adapter native launch completed=${JSON.stringify(completed)}`,
            );
            if (!completed) {
              throw launchFailed(
                "open_application: native macOS background launch completion failed \u2014 LaunchServices refused or could not find the app (verify the exact name/bundle_id with list_apps before retrying)",
              );
            }
            return {
              // 新 ABI resolve 为 completion 的 NSRunningApplication pid：枚举源
              // （NSWorkspace KVO / OnScreenOnly CGWindow）对刚启动的 app 都可能滞后，
              // pid 直查 applicationInfo(pid) 才是即时身份。旧 addon 返回 boolean true
              // （无 pid）时保持旧枚举解析路径。
              ...(typeof completed === "number" ? { pid: completed } : {}),
              bundleId: params.bundleId ?? null,
              name: params.name ?? null,
              active: false,
            };
          }
          return system.openApplication(params);
        }
      : void 0,
    terminateApplication,
    // app-scoped 能力只在三个 verified export 齐全时暴露。expected bundle 在 worker 获得
    // 键序列锁后、第一个事件前复核；旧 addon 不能回退到只传 pid 的空窗口。
    typeTextToApp: hasVerifiedAppInput
      ? async (pid, expectedBundleId, text) => {
          await withIbusBypassAsync(async () => {
            if (expectedBundleId) {
              requireVerifiedInput(
                await typeTextToPidVerified(pid, expectedBundleId, text),
                "type_text_to_app",
                pid,
              );
              return;
            }
            const ok = await typeTextToPid(pid, text);
            if (!ok) {
              throw permissionDenied(
                `type_text_to_app: native typeTextToPid failed for pid ${pid} (unverified fallback)`,
              );
            }
          });
        }
      : void 0,
    pressKeyToApp: hasVerifiedAppInput
      ? async (pid, expectedBundleId, text) => {
          if (expectedBundleId) {
            return requireVerifiedInput(
              await pressKeyToPidVerified(pid, expectedBundleId, text),
              "press_key_to_app",
              pid,
            );
          }
          const ok = await pressKeyToPid(pid, text);
          if (!ok) {
            throw permissionDenied(
              `press_key_to_app: native pressKeyToPid failed for pid ${pid} (unverified fallback)`,
            );
          }
        }
      : void 0,
    holdKeyToApp: hasVerifiedAppInput
      ? async (pid, expectedBundleId, text, duration3, sessionKey) =>
          requireVerifiedInput(
            await holdKeyToPidVerified(pid, expectedBundleId, text, duration3, sessionKey),
            "hold_key_to_app",
            pid,
          )
      : void 0,
    clickToWindow: hasMacBackgroundInput
      ? (...args) =>
          withMacBackgroundSequence("click_to_window", async () => {
            const dispatch = clickToWindow ?? clickToWindowLegacy;
            const sent = await dispatch(...args);
            options.logger?.info(void 0, "macOS window pointer dispatched", {
              pointer_action: "click_to_window",
              action_sent: sent !== false,
              native_args: JSON.stringify(args).slice(0, 400),
            });
            return sent;
          })
      : void 0,
    moveToWindow: hasMacBackgroundInput
      ? (...args) =>
          withMacBackgroundSequence("move_to_window", () => {
            const dispatch = moveToWindow ?? moveToWindowLegacy;
            return dispatch(...args);
          })
      : void 0,
    scrollToWindow: hasMacBackgroundInput
      ? (...args) =>
          withMacBackgroundSequence("scroll_to_window", () => {
            const dispatch = scrollToWindow ?? scrollToWindowLegacy;
            return dispatch(...args);
          })
      : void 0,
    dragToWindow: hasMacBackgroundInput
      ? (...args) =>
          withMacBackgroundSequence("drag_to_window", () => {
            const dispatch = dragToWindow ?? dragToWindowLegacy;
            return dispatch(...args);
          })
      : void 0,
    mouseDownToWindow: hasMacBackgroundInput
      ? (...args) =>
          withMacBackgroundSequence("mouse_down_to_window", () => {
            const dispatch = mouseDownToWindow ?? mouseDownToWindowLegacy;
            return dispatch(...args);
          })
      : void 0,
    mouseUpToWindow: hasMacBackgroundInput
      ? (...args) =>
          withMacBackgroundSequence("mouse_up_to_window", () => {
            const dispatch = mouseUpToWindow ?? mouseUpToWindowLegacy;
            return dispatch(...args);
          })
      : void 0,
    typeTextToWindow: hasMacBackgroundInput
      ? (pid, expectedBundleId, windowId, bounds, text, allowProvenAttachedSurface = false) =>
          withMacBackgroundKeyboard(
            "type_text",
            pid,
            expectedBundleId,
            windowId,
            bounds,
            allowProvenAttachedSurface,
            async () => {
              requireVerifiedInput(
                await typeTextToPidVerified(
                  pid,
                  expectedBundleId,
                  text,
                  ...(allowProvenAttachedSurface ? [windowId] : []),
                ),
                "type_text_to_app",
                pid,
              );
            },
          )
      : void 0,
    pressKeyToWindow: hasMacBackgroundInput
      ? (pid, expectedBundleId, windowId, bounds, text, allowProvenAttachedSurface = false) =>
          withMacBackgroundKeyboard(
            "press_key",
            pid,
            expectedBundleId,
            windowId,
            bounds,
            allowProvenAttachedSurface,
            async () => {
              requireVerifiedInput(
                await pressKeyToPidVerified(
                  pid,
                  expectedBundleId,
                  text,
                  ...(allowProvenAttachedSurface ? [windowId] : []),
                ),
                "press_key_to_app",
                pid,
              );
            },
          )
      : void 0,
    holdKeyToWindow: hasMacBackgroundInput
      ? (
          pid,
          expectedBundleId,
          windowId,
          bounds,
          text,
          duration3,
          sessionKey,
          allowProvenAttachedSurface = false,
        ) =>
          withMacBackgroundKeyboard(
            "hold_key",
            pid,
            expectedBundleId,
            windowId,
            bounds,
            allowProvenAttachedSurface,
            async () => {
              requireVerifiedInput(
                await holdKeyToPidVerified(
                  pid,
                  expectedBundleId,
                  text,
                  duration3,
                  sessionKey,
                  ...(allowProvenAttachedSurface ? [windowId] : []),
                ),
                "hold_key_to_app",
                pid,
              );
            },
          )
      : void 0,
    // 全局坐标鼠标/键盘与 PiP 都是 additive ABI；旧 addon 缺任一 export 时逐项不暴露，
    // 由 handler 返回 not_authorized，而不是把调用拖到运行时 TypeError。
    clickAtPoint,
    // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:32032）：inline wrap。
    clickAtPointAsync: wrapOptionalNativeMethod(native.clickAtPointAsync),
    clickElementAtPoint,
    // 还原自官方 32034-32037：R8 守卫链三件 + UIA 模式梯（32035）。
    hitTestInvokeAtPointAsync,
    elementPatternCallAsync,
    classifyPostMessageDelivery,
    postMessageClickAsync,
    // 还原自官方 32038-32044：postMessage 后台投递族 + 加速器 + 读回（W3 机械域）。
    postMessageCharAsync,
    postMessageKeyAsync,
    postMessageScrollAsync,
    postMessageDragAsync,
    invokeAcceleratorAsync,
    elementValueReadAsync,
    setValueReadbackAsync,
    // Linux synthetic gate (no-op) takes effect only when the native addon
    // doesn't expose the real macOS primitives; on macOS the real exports win.
    preventActivation: preventActivation ?? linuxNoFocusGate?.preventActivation,
    reenableActivation: reenableActivation ?? linuxNoFocusGate?.reenableActivation,
    isFocusStealPrevented: isFocusStealPrevented ?? linuxNoFocusGate?.isFocusStealPrevented,
    activateApplication,
    // 还原自官方 32051-32058（顺序同官方）：守卫域四件 + W3 机械域三件——
    // windowsOperationScene/windowsMenuContent（操作场景读回，官方 :32056-32057，
    // 经 readWindowsOperationScene/readWindowsMenuContent 包一层：两段读 + decorative
    // 标记/菜单形状校验）与 enumerateSurfacesForFrame（:32058）。native 缺
    // windowsOperationScene 导出时前两者 undefined（mac 官方形态，菜单观察整链休眠）。
    hasActiveInputHolds,
    activateWindow,
    getForegroundRootWindowId,
    frameWindowContext,
    windowsOperationScene: native.windowsOperationScene
      ? (root, host) => readWindowsOperationScene(native, root, host)
      : void 0,
    windowsMenuContent: native.windowsOperationScene
      ? (pid, id) => readWindowsMenuContent(native, pid, id)
      : void 0,
    enumerateSurfacesForFrame,
    restoreForegroundWindow,
    activateAppFrameSurface,
    pipStart,
    pipStartVerified,
    pipStartVerifiedComposite,
    pipStop,
    pipStopTarget,
    pipGetLeadTarget,
    pipSetActiveGroup,
    pipBeginTurn,
    pipTaskCompleted,
    pipFreezeGroup,
    pipDismiss,
    pipIsRunning,
    pipIsInteractionReady,
    pipIsDismissed,
    pipClearDismissed,
    moveTo,
    scrollAt,
    drag,
    mouseDown,
    mouseUp,
    // pid-scoped pointer primitives intentionally NOT surfaced (P0-2): see
    // electronNativeBackendTypes.ts — global-tap dispatch with pre-verified
    // owner identity replaced them; native exports remain as legacy ABI.
    // mouseUpToPid is surfaced ONLY as the bounded cleanup release for a
    // held background/split button (never a dispatch path).
    mouseUpToPid,
    typeTextGlobal,
    // 还原自官方 32087：截断双语义异步原语（wrap 见 31478 注释）。
    typeTextGlobalAsync,
    pressKeyGlobal,
    holdKeyGlobal,
    cancelInputHoldsForSession,
    isVirtualPointerEnabled: () =>
      options.virtualPointerEnabled === true || native.ghostState?.().enabled === true,
    getVirtualPointerScreenPoint: () => {
      const state = native.ghostState?.();
      return state?.shown === true && Number.isFinite(state.x) && Number.isFinite(state.y)
        ? { x: state.x, y: state.y }
        : null;
    },
    hideVirtualPointer,
    keyDownGlobal,
    keyUpGlobal,
  };
}
