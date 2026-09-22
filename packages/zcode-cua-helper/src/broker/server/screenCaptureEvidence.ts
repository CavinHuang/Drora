import {
  MAX_PROBE_WINDOW_DIMENSION,
  isDecodedNonPlaceholderPng,
  pngDimensionsMatchWindow,
  readPngDimensions,
} from "./screenCapturePngContent.js";

var MIN_PROBE_WINDOW_WIDTH = 96;
var MIN_PROBE_WINDOW_HEIGHT = 64;
var MAX_PROBE_CANDIDATES = 3;
var SCREEN_CAPTURE_PROBE_CANDIDATE_TIMEOUT_MS = 1500;
function validFiniteDimension(value, minimum) {
  return Number.isFinite(value) && value >= minimum && value <= MAX_PROBE_WINDOW_DIMENSION;
}
function validProbeWindow(window, probePid) {
  return (
    Number.isSafeInteger(window.windowId) &&
    window.windowId > 0 &&
    Number.isSafeInteger(window.ownerPid) &&
    window.ownerPid > 0 &&
    window.ownerPid !== probePid &&
    window.onScreen === true &&
    (window.layer === void 0 || window.layer === 0) &&
    Number.isFinite(window.bounds.x) &&
    Number.isFinite(window.bounds.y) &&
    validFiniteDimension(window.bounds.width, MIN_PROBE_WINDOW_WIDTH) &&
    validFiniteDimension(window.bounds.height, MIN_PROBE_WINDOW_HEIGHT)
  );
}
function preferredOwnerScore(window) {
  const bundleId = window.ownerBundleId?.trim().toLowerCase() ?? "";
  const ownerName = window.ownerName?.trim().toLowerCase() ?? "";
  if (bundleId === "dev.zcode.app" || bundleId.startsWith("dev.zcode.app.")) return 3;
  if (ownerName === "zcode" || ownerName.startsWith("zcode ")) return 3;
  if (bundleId === "com.apple.systempreferences") return 2;
  return window.ownerActive ? 1 : 0;
}
function rankForeignScreenCaptureProbeWindows(windows, probePid) {
  const unique = /* @__PURE__ */ new Map();
  for (const window of windows) {
    if (validProbeWindow(window, probePid) && !unique.has(window.windowId)) {
      unique.set(window.windowId, window);
    }
  }
  return [...unique.values()].sort((left, right) => {
    const priority = preferredOwnerScore(right) - preferredOwnerScore(left);
    if (priority !== 0) return priority;
    return right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height;
  });
}
function failedEvidence(reason, details = {}) {
  return {
    ok: false,
    reason,
    window: null,
    png: null,
    dimensions: null,
    content: null,
    candidateCount: 0,
    attemptedWindowCount: 0,
    error: null,
    ...details,
  };
}
export async function captureForeignWindowProbeEvidence(adapter, probePid) {
  if (
    !adapter.listScreenCaptureProbeWindows ||
    !adapter.captureWindowPng ||
    !adapter.inspectPngContent
  ) {
    return failedEvidence("unsupported");
  }
  let candidates;
  try {
    candidates = rankForeignScreenCaptureProbeWindows(
      adapter.listScreenCaptureProbeWindows(),
      probePid,
    );
  } catch (error51) {
    return failedEvidence("enumeration_error", {
      error: error51 instanceof Error ? error51.message : String(error51),
    });
  }
  const candidateCount = candidates.length;
  if (candidateCount === 0) return failedEvidence("no_window");
  let lastFailure = failedEvidence("content_indeterminate", { candidateCount });
  for (const [index, window] of candidates.slice(0, MAX_PROBE_CANDIDATES).entries()) {
    const attemptedWindowCount = index + 1;
    let png;
    try {
      png = await adapter.captureWindowPng(
        window.windowId,
        SCREEN_CAPTURE_PROBE_CANDIDATE_TIMEOUT_MS,
      );
    } catch (error51) {
      lastFailure = failedEvidence("capture_error", {
        window,
        candidateCount,
        attemptedWindowCount,
        error: error51 instanceof Error ? error51.message : String(error51),
      });
      continue;
    }
    if (!png?.length) {
      lastFailure = failedEvidence("empty", {
        window,
        png,
        candidateCount,
        attemptedWindowCount,
      });
      continue;
    }
    const dimensions = readPngDimensions(png);
    if (!dimensions || !pngDimensionsMatchWindow(dimensions, window)) {
      lastFailure = failedEvidence(dimensions ? "mismatch" : "invalid", {
        window,
        png,
        dimensions,
        candidateCount,
        attemptedWindowCount,
      });
      continue;
    }
    let content;
    try {
      content = adapter.inspectPngContent(png);
    } catch (error51) {
      lastFailure = failedEvidence("inspection_error", {
        window,
        png,
        dimensions,
        candidateCount,
        attemptedWindowCount,
        error: error51 instanceof Error ? error51.message : String(error51),
      });
      continue;
    }
    if (!content || content.width !== dimensions.width || content.height !== dimensions.height) {
      lastFailure = failedEvidence("content_invalid", {
        window,
        png,
        dimensions,
        content,
        candidateCount,
        attemptedWindowCount,
      });
      continue;
    }
    if (!isDecodedNonPlaceholderPng(content, dimensions)) {
      lastFailure = failedEvidence("content_indeterminate", {
        window,
        png,
        dimensions,
        content,
        candidateCount,
        attemptedWindowCount,
      });
      continue;
    }
    return {
      ok: true,
      window,
      png,
      dimensions,
      content,
      candidateCount,
      attemptedWindowCount,
    };
  }
  return lastFailure;
}
