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
function supported(native) {
  try {
    return native.isScreenCaptureSupported?.() === true;
  } catch {
    return false;
  }
}
export function createWindowsScreenCaptureBridge(native) {
  const hasCompleteAbi =
    typeof native.isScreenCaptureSupported === "function" &&
    typeof native.captureMonitorPngAsync === "function" &&
    typeof native.captureWindowPngVerifiedAsync === "function";
  const available = hasCompleteAbi && supported(native);
  return {
    available,
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
  };
}
