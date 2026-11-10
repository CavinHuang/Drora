var ERROR_CODES = /* @__PURE__ */ new Set([
  "unsupported",
  "unavailable",
  "busy",
  "timeout",
  "invalid_target",
  "target_changed",
  "too_large",
  "device_lost",
  "capture_failed",
  "encode_failed",
]);
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
var MAX_DIMENSION = 16384;
var MAX_PIXELS = 33554432;
var MAX_PNG_BYTES = 128 * 1024 * 1024;
export var WindowsScreenCaptureError = class extends Error {
  code;
  operation;
  constructor(code, operation) {
    super(`Windows ${operation} capture failed (${code})`);
    this.name = "WindowsScreenCaptureError";
    this.code = code;
    this.operation = operation;
  }
};
function copyBounds(value) {
  return [value[0], value[1], value[2], value[3]];
}
function isValidBounds(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry)) &&
    value[2] > 0 &&
    value[3] > 0
  );
}
function hasPngSignature(data) {
  return (
    data.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => data[index] === byte)
  );
}
function isValidSuccess(value) {
  if (!value || typeof value !== "object") return false;
  const outcome = value;
  if (
    outcome.ok !== true ||
    outcome.format !== "png" ||
    !(outcome.data instanceof Uint8Array) ||
    !hasPngSignature(outcome.data) ||
    outcome.data.length > MAX_PNG_BYTES ||
    !Number.isSafeInteger(outcome.width) ||
    !Number.isSafeInteger(outcome.height) ||
    (outcome.width ?? 0) <= 0 ||
    (outcome.height ?? 0) <= 0 ||
    (outcome.width ?? 0) > MAX_DIMENSION ||
    (outcome.height ?? 0) > MAX_DIMENSION ||
    (outcome.width ?? 0) * (outcome.height ?? 0) > MAX_PIXELS ||
    !isValidBounds(outcome.bounds)
  ) {
    return false;
  }
  return true;
}
function fixedFailureCode(value) {
  if (!value || typeof value !== "object") return null;
  const outcome = value;
  return outcome.ok === false && typeof outcome.error === "string" && ERROR_CODES.has(outcome.error)
    ? outcome.error
    : null;
}
function normalizeOutcome(value, operation) {
  if (isValidSuccess(value)) {
    return {
      format: "png",
      data: value.data,
      width: value.width,
      height: value.height,
      bounds: copyBounds(value.bounds),
    };
  }
  throw new WindowsScreenCaptureError(fixedFailureCode(value) ?? "capture_failed", operation);
}
// 还原自发行 bundle（官方 0.6.5 win32 entry :29994-30030）：复合截图回执校验——
// 成功回执在单窗形状之上还带 captured（逐窗 {window_id,pid,owner_bundle_id,bounds}）
// 与 gaps（{window_id,reason}，如 outside_root_bounds）；任一条目畸形按
// capture_failed 拒绝，不让半张合成图进入像素契约。
function isValidCapturedEntry(value) {
  if (!value || typeof value !== "object") return false;
  const entry = value;
  return (
    Number.isSafeInteger(entry.window_id) &&
    entry.window_id > 0 &&
    Number.isSafeInteger(entry.pid) &&
    entry.pid > 0 &&
    typeof entry.owner_bundle_id === "string" &&
    entry.owner_bundle_id.length > 0 &&
    isValidBounds(entry.bounds)
  );
}
function isValidGapEntry(value) {
  if (!value || typeof value !== "object") return false;
  const entry = value;
  return (
    Number.isSafeInteger(entry.window_id) &&
    entry.window_id > 0 &&
    typeof entry.reason === "string" &&
    entry.reason.length > 0
  );
}
function normalizeCompositeOutcome(value) {
  if (isValidSuccess(value)) {
    const composite = value;
    const captured = Array.isArray(composite.captured) ? composite.captured : [];
    const gaps = Array.isArray(composite.gaps) ? composite.gaps : [];
    if (!captured.every(isValidCapturedEntry) || !gaps.every(isValidGapEntry)) {
      throw new WindowsScreenCaptureError("capture_failed", "window");
    }
    return {
      format: "png",
      data: composite.data,
      width: composite.width,
      height: composite.height,
      bounds: copyBounds(composite.bounds),
      captured,
      gaps,
    };
  }
  throw new WindowsScreenCaptureError(fixedFailureCode(value) ?? "capture_failed", "window");
}
function supported(native) {
  try {
    return native.isScreenCaptureSupported?.() === true;
  } catch {
    return false;
  }
}
function validateWindowParams(params) {
  if (
    !Number.isSafeInteger(params.windowId) ||
    params.windowId <= 0 ||
    !Number.isSafeInteger(params.pid) ||
    params.pid <= 0 ||
    typeof params.expectedCanonicalBundleId !== "string" ||
    params.expectedCanonicalBundleId.trim().length === 0 ||
    (params.expectedBounds !== void 0 && !isValidBounds(params.expectedBounds))
  ) {
    throw new WindowsScreenCaptureError("invalid_target", "window");
  }
}
export function createWindowsScreenCaptureBridge(native) {
  const hasCompleteAbi =
    typeof native.isScreenCaptureSupported === "function" &&
    typeof native.captureMonitorPngAsync === "function" &&
    typeof native.captureWindowPngVerifiedAsync === "function";
  const available = hasCompleteAbi && supported(native);
  // 还原自发行 bundle（官方 0.6.5 win32 entry :30035）：composite 能力独立探测——
  // captureWindowPngCompositeAsync 缺导出时 compositeAvailable=false，captureWindowComposite
  // 按官方同款 unsupported 拒绝（win.ts 消费侧据此回退单窗 verified 抓图）。
  const compositeAvailable = available && typeof native.captureWindowPngCompositeAsync === "function";
  return {
    available,
    compositeAvailable,
    async captureMonitor(bounds) {
      if (!available) {
        throw new WindowsScreenCaptureError("unsupported", "monitor");
      }
      if (!isValidBounds(bounds)) {
        throw new WindowsScreenCaptureError("invalid_target", "monitor");
      }
      try {
        return normalizeOutcome(await native.captureMonitorPngAsync(copyBounds(bounds)), "monitor");
      } catch (error51) {
        if (error51 instanceof WindowsScreenCaptureError) throw error51;
        throw new WindowsScreenCaptureError("capture_failed", "monitor");
      }
    },
    async captureWindow(params) {
      if (!available) {
        throw new WindowsScreenCaptureError("unsupported", "window");
      }
      validateWindowParams(params);
      try {
        return normalizeOutcome(
          await native.captureWindowPngVerifiedAsync(
            params.windowId,
            params.pid,
            params.expectedCanonicalBundleId,
            params.expectedBounds ? copyBounds(params.expectedBounds) : void 0,
          ),
          "window",
        );
      } catch (error51) {
        if (error51 instanceof WindowsScreenCaptureError) throw error51;
        throw new WindowsScreenCaptureError("capture_failed", "window");
      }
    },
    // 还原自发行 bundle（官方 0.6.5 win32 entry :30076-30122）：root+popups 复合
    // 抓图。popups 1..64、逐窗 bounds 校验；native 抛非 WindowsScreenCaptureError
    // 统一收敛 capture_failed。
    async captureWindowComposite(params) {
      if (!compositeAvailable) {
        throw new WindowsScreenCaptureError("unsupported", "window");
      }
      const rootParams = {
        windowId: params.root.windowId,
        pid: params.root.pid,
        expectedCanonicalBundleId: params.root.expectedCanonicalBundleId,
        ...(params.root.expectedBounds !== void 0 ? { expectedBounds: params.root.expectedBounds } : {}),
      };
      const rootInvalid = (() => {
        try {
          validateWindowParams(rootParams);
          return null;
        } catch (error51) {
          return error51;
        }
      })();
      if (rootInvalid) throw rootInvalid;
      if (
        !Array.isArray(params.popups) ||
        params.popups.length === 0 ||
        params.popups.length > 64 ||
        params.popups.some(
          (popup) =>
            !Number.isSafeInteger(popup.windowId) ||
            popup.windowId <= 0 ||
            !Number.isSafeInteger(popup.pid) ||
            popup.pid <= 0 ||
            !isValidBounds(popup.expectedBounds),
        )
      ) {
        throw new WindowsScreenCaptureError("invalid_target", "window");
      }
      try {
        return normalizeCompositeOutcome(
          await native.captureWindowPngCompositeAsync({
            root: {
              windowId: rootParams.windowId,
              pid: rootParams.pid,
              expectedCanonicalBundleId: rootParams.expectedCanonicalBundleId,
              ...(rootParams.expectedBounds !== void 0
                ? { expectedBounds: copyBounds(rootParams.expectedBounds) }
                : {}),
            },
            popups: params.popups.map((popup) => ({
              windowId: popup.windowId,
              pid: popup.pid,
              expectedBounds: copyBounds(popup.expectedBounds),
            })),
          }),
        );
      } catch (error51) {
        if (error51 instanceof WindowsScreenCaptureError) throw error51;
        throw new WindowsScreenCaptureError("capture_failed", "window");
      }
    },
  };
}

