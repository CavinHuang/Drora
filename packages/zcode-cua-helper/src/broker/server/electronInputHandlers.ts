/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { parseAppFrameSurfaceSet } from "../../lib/app-frame-surfaces.js";
import { displayTopologyFingerprint } from "../../lib/display-topology.js";
import {
  BrokerError,
  elementUnavailable,
  foregroundRequired,
  notAuthorized,
  permissionDenied,
} from "../types.js";
import { flattenAxTree } from "./axReadOnly.js";
import { cuaBundleIdsEqual, resolveAppRefIdentity, resolvePidIdentity } from "./cuaAppIdentity.js";
import { appRefParam, resolveAppInputTarget, runAppScopedInput } from "./electronAppHelpers.js";
import {
  normalizeWindowServerRecords,
  snapshotWindowServerWindows,
  windowServerOwnerAtPointDetailed,
} from "./windowServerSnapshot.js";

var MAX_SYNTHETIC_TEXT_UTF16_UNITS = 1024;
var MAX_CLICK_COUNT = 3;
var MAX_SCROLL_AMOUNT = 100;
var MAX_KEY_CHORD_UTF8_BYTES = 128;
var MAX_KEY_CHORD_KEYS = 8;
var FRONTMOST_EMPTY_SNAPSHOT_ATTEMPTS = 4;
var FRONTMOST_EMPTY_SNAPSHOT_RETRY_MS = 25;
var terminalPointerCleanupByAdapter = /* @__PURE__ */ new WeakMap();
var pointerSequenceGateByAdapter = /* @__PURE__ */ new WeakMap();
export async function releaseElectronPointerHoldForShutdown(adapter) {
  return (await terminalPointerCleanupByAdapter.get(adapter)?.()) ?? true;
}
var KEY_CHORD_ALIASES = {
  return: "enter",
  escape: "esc",
  cmd: "command",
  "\u2318": "command",
  option: "alt",
  control: "ctrl",
};
var KEY_CHORD_KEYS = /* @__PURE__ */ new Set([
  ..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
  "=",
  "*",
  "-",
  "]",
  "[",
  "'",
  ";",
  "\\",
  ",",
  "/",
  ".",
  "`",
  "enter",
  "tab",
  "space",
  "backspace",
  "delete",
  "esc",
  "command",
  "meta",
  "super",
  "win",
  "shift",
  "capslock",
  "alt",
  "ctrl",
  "help",
  "home",
  "pageup",
  "forwarddelete",
  "end",
  "pagedown",
  "left",
  "right",
  "down",
  "up",
  ...Array.from({ length: 16 }, (_, index) => `f${index + 1}`),
]);
function syntheticTextParam(value, method) {
  const text = typeof value === "string" ? value : "";
  if (text.length > MAX_SYNTHETIC_TEXT_UTF16_UNITS) {
    throw new BrokerError(
      "invalid_request",
      `${method} text exceeds ${MAX_SYNTHETIC_TEXT_UTF16_UNITS} UTF-16 code units; use an accessibility value-set or clipboard path for longer content.`,
    );
  }
  return text;
}
function keyChordParam(value, method, field = "text") {
  const chord = typeof value === "string" ? value : "";
  if (!chord || chord.length > MAX_KEY_CHORD_UTF8_BYTES) {
    throw permissionDenied(
      `${method} ${field} must contain 1..${MAX_KEY_CHORD_KEYS} keys and at most ${MAX_KEY_CHORD_UTF8_BYTES} UTF-8 bytes. action_sent=false.`,
      { action_sent: false, reason: "invalid_key_chord" },
    );
  }
  const utf8Length = new TextEncoder().encode(chord).length;
  const keys = chord
    .split("+")
    .map((key) => key.trim())
    .filter((key) => key && key.toLowerCase() !== "none");
  if (
    utf8Length > MAX_KEY_CHORD_UTF8_BYTES ||
    keys.length < 1 ||
    keys.length > MAX_KEY_CHORD_KEYS
  ) {
    throw permissionDenied(
      `${method} ${field} must contain 1..${MAX_KEY_CHORD_KEYS} keys and at most ${MAX_KEY_CHORD_UTF8_BYTES} UTF-8 bytes. action_sent=false.`,
      { action_sent: false, reason: "invalid_key_chord" },
    );
  }
  const normalized = keys.map((key) => {
    const lowered = key.toLowerCase();
    return KEY_CHORD_ALIASES[lowered] ?? lowered;
  });
  const unknown2 = normalized.find((key) => !KEY_CHORD_KEYS.has(key));
  if (unknown2) {
    throw permissionDenied(
      `${method} ${field} contains unsupported key token '${unknown2}'. action_sent=false.`,
      {
        action_sent: false,
        reason: "unsupported_key_token",
        token: unknown2,
      },
    );
  }
  return chord;
}
function extractPoint(value) {
  if (
    value &&
    typeof value === "object" &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  ) {
    const point = value;
    return { x: point.x, y: point.y };
  }
  return null;
}
function windowContainsPoint2(bounds, point) {
  const [x, y, width, height] = bounds;
  return (
    width > 0 &&
    height > 0 &&
    point.x >= x &&
    point.x < x + width &&
    point.y >= y &&
    point.y < y + height
  );
}
function parseCaptureWindows(value) {
  if (value === void 0 || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record2 = value;
  const windows = record2.windows;
  if (
    typeof record2.fingerprint !== "string" ||
    record2.fingerprint.length === 0 ||
    record2.order !== "front_to_back" ||
    !Array.isArray(windows)
  ) {
    return void 0;
  }
  const parsed = windows.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const window = entry;
    const bounds = window.bounds;
    if (
      !Number.isSafeInteger(window.window_id) ||
      window.window_id <= 0 ||
      !Number.isSafeInteger(window.owner_pid) ||
      window.owner_pid <= 0 ||
      !Number.isSafeInteger(window.layer) ||
      !(window.owner_bundle_id === null || typeof window.owner_bundle_id === "string") ||
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      !bounds.every(Number.isFinite) || // additive 字段：缺失/null 视为未知；出现了却不是 boolean 说明上游契约不一致，fail-closed。
      !(
        window.accepts_left_mouse_down === void 0 ||
        window.accepts_left_mouse_down === null ||
        typeof window.accepts_left_mouse_down === "boolean"
      )
    ) {
      return null;
    }
    return {
      window_id: window.window_id,
      owner_pid: window.owner_pid,
      owner_bundle_id: window.owner_bundle_id,
      layer: window.layer,
      bounds,
      ...(typeof window.accepts_left_mouse_down === "boolean"
        ? { accepts_left_mouse_down: window.accepts_left_mouse_down }
        : {}),
    };
  });
  if (!parsed.every((entry) => entry !== null)) {
    return void 0;
  }
  return {
    fingerprint: record2.fingerprint,
    order: "front_to_back",
    windows: parsed,
  };
}
function parseFrameProvenance(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw permissionDenied(
      "frame_provenance must contain one record per coordinate endpoint. action_sent=false.",
      { action_sent: false, reason: "invalid_frame_provenance" },
    );
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw permissionDenied("frame_provenance record is malformed. action_sent=false.", {
        action_sent: false,
        reason: "invalid_frame_provenance",
      });
    }
    const record2 = entry;
    const point = extractPoint(record2.projected_point);
    const pixel = extractPoint(record2.pixel);
    const captureWindows = parseCaptureWindows(record2.capture_windows);
    const captureSurfaces = parseAppFrameSurfaceSet(record2.capture_surfaces);
    const sourceCrop = record2.source?.crop;
    const numericProjectionParts = [
      record2.delivered?.width,
      record2.delivered?.height,
      record2.source?.width,
      record2.source?.height,
      sourceCrop?.left,
      sourceCrop?.top,
      sourceCrop?.right,
      sourceCrop?.bottom,
      record2.pointer?.x,
      record2.pointer?.y,
      record2.pointer?.width,
      record2.pointer?.height,
    ];
    if (
      record2.contract !== "frame_pixel_projection_v1" ||
      typeof record2.frame_id !== "string" ||
      !record2.frame_id ||
      typeof record2.expires_at_ms !== "number" ||
      !Number.isFinite(record2.expires_at_ms) ||
      !point ||
      !pixel ||
      !Number.isSafeInteger(pixel.x) ||
      !Number.isSafeInteger(pixel.y) ||
      !numericProjectionParts.every((part) => typeof part === "number" && Number.isFinite(part)) ||
      record2.delivered.width <= 0 ||
      record2.delivered.height <= 0 ||
      record2.source.width <= 0 ||
      record2.source.height <= 0 ||
      record2.pointer.width <= 0 ||
      record2.pointer.height <= 0 ||
      sourceCrop.right <= sourceCrop.left ||
      sourceCrop.bottom <= sourceCrop.top ||
      pixel.x < 0 ||
      pixel.y < 0 ||
      pixel.x >= record2.delivered.width ||
      pixel.y >= record2.delivered.height ||
      !Number.isSafeInteger(record2.endpoint_index) ||
      record2.endpoint_index < 0 ||
      record2.endpoint_index > 1 ||
      !record2.app ||
      !record2.window ||
      !record2.display ||
      !Array.isArray(record2.window.bounds) ||
      record2.window.bounds.length !== 4 ||
      !record2.window.bounds.every(Number.isFinite) ||
      typeof record2.display.topology_fingerprint !== "string"
    ) {
      throw permissionDenied("frame_provenance record is incomplete. action_sent=false.", {
        action_sent: false,
        reason: "invalid_frame_provenance",
      });
    }
    if (captureWindows === void 0) {
      throw permissionDenied(
        "frame_provenance record has invalid capture window snapshot. action_sent=false.",
        { action_sent: false, reason: "invalid_frame_provenance" },
      );
    }
    if (captureSurfaces === void 0) {
      throw permissionDenied(
        "frame_provenance record has invalid app surface snapshot. action_sent=false.",
        { action_sent: false, reason: "invalid_frame_provenance" },
      );
    }
    return {
      ...record2,
      capture_windows: captureWindows,
      capture_surfaces: captureSurfaces,
      pixel,
      projected_point: point,
    };
  });
}
function independentlyProjectFramePixel(record2) {
  const { crop } = record2.source;
  const sourceX =
    crop.left + ((record2.pixel.x + 0.5) / record2.delivered.width) * (crop.right - crop.left);
  const sourceY =
    crop.top + ((record2.pixel.y + 0.5) / record2.delivered.height) * (crop.bottom - crop.top);
  return {
    x: record2.pointer.x + sourceX * (record2.pointer.width / record2.source.width),
    y: record2.pointer.y + sourceY * (record2.pointer.height / record2.source.height),
  };
}
function sameCoordinate(left, right) {
  return Math.abs(left.x - right.x) <= 1e-7 && Math.abs(left.y - right.y) <= 1e-7;
}
function sameFrameBounds(left, right) {
  return (
    left.length === 4 &&
    right.length === 4 &&
    left.every((part, index) => Math.abs(part - right[index]) <= 0.5)
  );
}
function sameFrameOwner(owner, captured) {
  return (
    owner.pid === captured.owner_pid &&
    captured.owner_bundle_id !== null &&
    cuaBundleIdsEqual(owner.bundleId, captured.owner_bundle_id) &&
    owner.windowId === captured.window_id &&
    sameFrameBounds(owner.bounds, captured.bounds)
  );
}
function capturedOwnerAtPoint(record2, displayBounds) {
  const windows = record2.capture_windows?.windows;
  if (!windows) return { owner: null, skipped: [] };
  return windowServerOwnerAtPointDetailed(
    normalizeWindowServerRecords(windows, displayBounds, process.pid),
    record2.projected_point,
  );
}
function describeSkippedPixelOwners(skipped) {
  if (skipped.length === 0) return "";
  const described = skipped
    .map(
      (window) =>
        `${window.owner_bundle_id ?? "unknown-bundle"} (pid ${window.owner_pid}, window ${window.window_id}, layer ${window.layer}, bounds [${window.bounds.join(",")}])`,
    )
    .join("; ");
  return ` ${skipped.length} window(s) covering that pixel were skipped because they declined left mouse down and therefore do not render it: ${described}.`;
}
function appendResolvedAppRef(result, params, dispatchTarget?) {
  let supplied = null;
  try {
    supplied = appRefParam(params.presentation_app_ref ?? params.app_ref);
  } catch {
    supplied = null;
  }
  const resolved =
    supplied?.pid !== void 0 && typeof supplied.bundle_id === "string"
      ? {
          pid: supplied.pid,
          bundle_id: supplied.bundle_id,
          ...(supplied.window_id !== void 0 && supplied.window_id !== null
            ? { window_id: supplied.window_id }
            : {}),
        }
      : null;
  const actual =
    dispatchTarget ??
    (() => {
      try {
        const dispatch = appRefParam(params.app_ref);
        return dispatch?.pid && dispatch.bundle_id
          ? {
              pid: dispatch.pid,
              bundleId: dispatch.bundle_id,
              windowId: dispatch.window_id ?? 0,
              bounds: [0, 0, 0, 0],
            }
          : null;
      } catch {
        return null;
      }
    })();
  if (!resolved && !actual) return result;
  return {
    ...(result && typeof result === "object" ? result : {}),
    ...(resolved ? { resolved_app_ref: resolved } : {}),
    ...(actual
      ? {
          dispatch_surface: {
            owner_pid: actual.pid,
            owner_bundle_id: actual.bundleId,
            ...(actual.windowId > 0 ? { actual_window_id: actual.windowId } : {}),
            ...(actual.presentationWindowId !== void 0
              ? { presentation_window_id: actual.presentationWindowId }
              : {}),
            ...(actual.surfaceKind !== void 0 ? { surface_kind: actual.surfaceKind } : {}),
          },
        }
      : {}),
  };
}
function clickCountParam(value, method) {
  const clicks = value === void 0 ? 1 : value;
  if (
    typeof clicks !== "number" ||
    !Number.isSafeInteger(clicks) ||
    clicks < 1 ||
    clicks > MAX_CLICK_COUNT
  ) {
    throw permissionDenied(`${method} clicks must be an integer from 1 to ${MAX_CLICK_COUNT}.`);
  }
  return clicks;
}
async function assertExpectedPidIsFrontmost(axSource, expectedPid, point, method) {
  const location = point ? ` at (${point.x},${point.y})` : "";
  if (!axSource) {
    throw elementUnavailable(
      `${method}: raw foreground event for app_ref pid ${expectedPid} was refused because no live application source is available${location}. action_sent=false.`,
      {
        action_sent: false,
        expected_pid: expectedPid,
        method,
        reason: "application_source_unavailable",
      },
    );
  }
  try {
    let active = [];
    for (let attempt = 0; attempt < FRONTMOST_EMPTY_SNAPSHOT_ATTEMPTS; attempt += 1) {
      const applications2 = await axSource.listApplications();
      active = applications2.filter((app) => app.active === true);
      if (active.length === 1 && active[0]?.pid === expectedPid) return;
      if (active.length > 0 || attempt === FRONTMOST_EMPTY_SNAPSHOT_ATTEMPTS - 1) {
        break;
      }
      await new Promise((resolve2) => setTimeout(resolve2, FRONTMOST_EMPTY_SNAPSHOT_RETRY_MS));
    }
    const observed = active.length === 1 ? `pid ${active[0].pid}` : `${active.length} active apps`;
    throw elementUnavailable(
      `${method}: raw foreground event for app_ref pid ${expectedPid} was refused because the live frontmost application is ${observed}. action_sent=false. Target an element instead so the action goes through accessibility on a background app, or retry once the intended window is in front.`,
      {
        action_sent: false,
        expected_pid: expectedPid,
        active_pids: active.map((app) => app.pid),
        method,
        reason: "frontmost_pid_mismatch",
      },
    );
  } catch (error51) {
    if (error51 instanceof BrokerError) throw error51;
    throw elementUnavailable(
      `${method}: raw foreground event for app_ref pid ${expectedPid} was refused because live frontmost identity could not be verified${location}. action_sent=false. Refresh list_apps/get_app_state and retry.`,
      {
        action_sent: false,
        expected_pid: expectedPid,
        method,
        reason: "frontmost_identity_unverified",
      },
    );
  }
}
async function waitForCursorToSettle(adapter, point, method) {
  const virtual = adapter.getVirtualPointerScreenPoint?.();
  if (virtual && Math.abs(virtual.x - point.x) <= 1 && Math.abs(virtual.y - point.y) <= 1) {
    return;
  }
  if (adapter.isVirtualPointerEnabled?.()) return;
  const deadline = Date.now() + 150;
  let observed = null;
  do {
    observed = adapter.getCursorScreenPoint();
    if (
      Number.isFinite(observed.x) &&
      Number.isFinite(observed.y) &&
      Math.abs(observed.x - point.x) <= 1 &&
      Math.abs(observed.y - point.y) <= 1
    ) {
      return;
    }
    await new Promise((resolve2) => setTimeout(resolve2, 10));
  } while (Date.now() < deadline);
  throw elementUnavailable(
    `${method}: the raw move was posted but the global cursor did not settle at (${point.x},${point.y}) within 150ms; last observed (${observed?.x ?? "unknown"},${observed?.y ?? "unknown"}).`,
  );
}
function scrollAmountParam(value) {
  const amount = value === void 0 ? 3 : value;
  if (
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > MAX_SCROLL_AMOUNT
  ) {
    throw permissionDenied(`scroll amount must be an integer from 0 to ${MAX_SCROLL_AMOUNT}.`);
  }
  return amount;
}
function clampDurationSeconds(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(value, 30)) : 0;
}
var MODIFIER_ALIASES = {
  cmd: "cmd",
  command: "cmd",
  super: "cmd",
  meta: "cmd",
  shift: "shift",
  opt: "opt",
  option: "opt",
  alt: "opt",
  ctrl: "ctrl",
  control: "ctrl",
};
function modifiersChordParam(value, method) {
  if (value === void 0 || value === null) return "";
  const raw = typeof value === "string" ? value : "";
  const parts = raw
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0 && p !== "none");
  if (parts.length === 0) return "";
  const normalized = [];
  const seen = /* @__PURE__ */ new Set();
  for (const part of parts) {
    const canonical = MODIFIER_ALIASES[part];
    if (!canonical) {
      throw permissionDenied(
        `${method} modifiers must be a '+'-separated chord of cmd/shift/opt/ctrl (got '${part}'). action_sent=false.`,
        {
          action_sent: false,
          reason: "unsupported_modifier_token",
          token: part,
        },
      );
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
    }
  }
  const chord = normalized.join("+");
  if (chord.length > MAX_KEY_CHORD_UTF8_BYTES || normalized.length > MAX_KEY_CHORD_KEYS) {
    throw permissionDenied(
      `${method} modifiers must contain 1..${MAX_KEY_CHORD_KEYS} keys and at most ${MAX_KEY_CHORD_UTF8_BYTES} UTF-8 bytes. action_sent=false.`,
      { action_sent: false, reason: "invalid_modifier_chord" },
    );
  }
  return chord;
}
async function withSyntheticModifiers(adapter, modifiers, method, core) {
  if (!modifiers) {
    await core();
    return;
  }
  if (typeof adapter.keyDownGlobal !== "function" || typeof adapter.keyUpGlobal !== "function") {
    throw notAuthorized(
      `${method}: modifiers require the key_down/key_up native primitives, which are unavailable in this ZCode build.`,
    );
  }
  assertNativeInputSucceeded(adapter.keyDownGlobal(modifiers), `${method}:modifiers_down`);
  let coreError = null;
  try {
    await core();
  } catch (e) {
    coreError = e;
  }
  try {
    assertNativeInputSucceeded(adapter.keyUpGlobal(modifiers), `${method}:modifiers_up`);
  } catch (releaseErr) {
    if (coreError === null) throw releaseErr;
  }
  if (coreError !== null) throw coreError;
}
function assertGlobalInputAllowed(adapter, method) {
  if (typeof adapter.isFocusStealPrevented !== "function") {
    throw notAuthorized(
      `${method}: the native no-focus policy gate is unavailable in this ZCode build.`,
    );
  }
  if (adapter.isFocusStealPrevented()) {
    throw permissionDenied(
      `${method}: global synthetic input is blocked by the no-focus policy (prevent_activation).`,
    );
  }
}
async function tryResolvePointerAppPid(axSource, appRefValue, method) {
  if (!axSource) return null;
  if (!appRefValue) return null;
  let appRef;
  if (typeof appRefValue === "string") {
    const trimmed = appRefValue.trim();
    if (!trimmed) return null;
    appRef = { bundle_id: trimmed };
  } else if (appRefValue && typeof appRefValue === "object" && !Array.isArray(appRefValue)) {
    const record2 = appRefValue;
    const pid =
      typeof record2.pid === "number" && Number.isInteger(record2.pid) && record2.pid > 0
        ? record2.pid
        : void 0;
    const bundleId: any =
      typeof record2.bundle_id === "string" && record2.bundle_id.trim()
        ? record2.bundle_id.trim()
        : null;
    const name =
      typeof record2.name === "string" && record2.name.trim() ? record2.name.trim() : null;
    if (!pid && !bundleId && !name) return null;
    appRef = { pid, bundle_id: bundleId, name };
  } else {
    return null;
  }
  try {
    const identity: any = await resolveAppRefIdentity(axSource, appRef, method);
    if (!identity) return null;
    const rawWindowId =
      typeof appRefValue === "object" && appRefValue !== null ? appRefValue.window_id : null;
    const windowId =
      typeof rawWindowId === "number" && Number.isSafeInteger(rawWindowId) && rawWindowId > 0
        ? rawWindowId
        : null;
    return { pid: identity.pid, bundleId: identity.bundle_id, windowId };
  } catch {
    return null;
  }
}
async function requirePointerAppPid(axSource, appRefValue, method) {
  const identity = await tryResolvePointerAppPid(axSource, appRefValue, method);
  if (!identity) {
    throw permissionDenied(
      `${method}: app_ref could not be bound to one verified live application; scoped raw pointer input was refused instead of falling back to a global event.`,
    );
  }
  return identity;
}
function activateConcreteWindow(adapter, pid, bundleId, windowId, method) {
  if (windowId === void 0 || windowId === null) return;
  if (typeof windowId !== "number" || !Number.isSafeInteger(windowId) || windowId <= 0) {
    throw permissionDenied(`${method}: invalid window_id; action_sent=false.`, {
      action_sent: false,
    });
  }
  if (typeof adapter.activateWindow !== "function") {
    throw notAuthorized(
      `${method}: window-scoped raw input requires native activateWindow support. action_sent=false.`,
    );
  }
  if (!adapter.activateWindow(pid, bundleId, windowId)) {
    throw permissionDenied(
      `${method}: target window ${windowId} could not be atomically raised, focused, activated, and verified. action_sent=false.`,
      { action_sent: false },
    );
  }
}
function provenAttachedSurfaceArgs(target) {
  return target.allowProvenAttachedSurface === true ? [true] : [];
}
function isFilePanelWindowTarget(target) {
  return (
    target?.surfaceKind === "open_panel" ||
    target?.surfaceKind === "save_panel" ||
    target?.surfaceKind === "attached_dialog"
  );
}
function assertExactFilePanelAppRef(method, appTarget, surfaceTarget) {
  if (isFilePanelWindowTarget(surfaceTarget) && appTarget.windowId !== surfaceTarget.windowId) {
    throw foregroundRequired(
      `${method}: strategy=event on a file panel requires the fresh actual window_id from get_app_state. action_sent=false.`,
      {
        action_sent: false,
        reason: "foreground_required",
        actual_window_id: surfaceTarget.windowId,
      },
    );
  }
}
async function requireMacBackgroundWindowTarget(axSource, appRefValue, method) {
  if (!axSource) {
    throw elementUnavailable(
      `${method}: macOS background input requires a live AX window source. action_sent=false.`,
      { action_sent: false, reason: "background_window_unavailable" },
    );
  }
  const identity = await requirePointerAppPid(axSource, appRefValue, method);
  const record2 =
    appRefValue && typeof appRefValue === "object" && !Array.isArray(appRefValue)
      ? appRefValue
      : {};
  const requestedWindowId =
    typeof record2.window_id === "number" &&
    Number.isSafeInteger(record2.window_id) &&
    record2.window_id > 0
      ? record2.window_id
      : null;
  let snapshot;
  try {
    snapshot = await axSource.captureApp({
      pid: identity.pid,
      bundle_id: identity.bundleId,
      ...(requestedWindowId === null ? {} : { window_id: requestedWindowId }),
    });
  } catch {
    snapshot = null;
  }
  try {
    const windowId = snapshot?.window.window_id;
    const bounds = snapshot?.window.bounds;
    if (
      !snapshot ||
      snapshot.app.pid !== identity.pid ||
      !cuaBundleIdsEqual(snapshot.app.bundle_id ?? "", identity.bundleId) ||
      snapshot.window.window_id_fallback === true ||
      typeof windowId !== "number" ||
      !Number.isSafeInteger(windowId) ||
      windowId <= 0 ||
      (requestedWindowId !== null && windowId !== requestedWindowId) ||
      !Array.isArray(bounds) ||
      bounds.length !== 4 ||
      bounds.some((part) => typeof part !== "number" || !Number.isFinite(part)) ||
      bounds[2] <= 0 ||
      bounds[3] <= 0
    ) {
      const surfaceReplaced =
        requestedWindowId !== null &&
        (snapshot?.window.window_id_fallback === true ||
          (typeof windowId === "number" && windowId !== requestedWindowId));
      throw elementUnavailable(
        `${method}: target surface is stale, off-screen, or no longer related to the app. Refresh get_app_state and retry. action_sent=false.`,
        {
          action_sent: false,
          reason: surfaceReplaced ? "surface_replaced" : "background_window_unavailable",
          expected_pid: identity.pid,
          expected_window_id: requestedWindowId,
        },
      );
    }
    const actualOwnerPid =
      typeof snapshot.window.actual_owner_pid === "number" &&
      Number.isSafeInteger(snapshot.window.actual_owner_pid) &&
      snapshot.window.actual_owner_pid > 0
        ? snapshot.window.actual_owner_pid
        : identity.pid;
    const actualIdentity: any =
      actualOwnerPid === identity.pid
        ? { pid: identity.pid, bundle_id: identity.bundleId }
        : await resolvePidIdentity(axSource, actualOwnerPid, `${method}:surface_owner`);
    if (!actualIdentity?.bundle_id) {
      throw elementUnavailable(
        `${method}: the attached surface owner has no stable application identity. action_sent=false.`,
        {
          action_sent: false,
          reason: "background_window_unavailable",
          actual_window_id: windowId,
          actual_owner_pid: actualOwnerPid,
        },
      );
    }
    return {
      pid: actualOwnerPid,
      bundleId: actualIdentity.bundle_id,
      windowId,
      bounds,
      ...(typeof snapshot.window.presentation_window_id === "number"
        ? { presentationWindowId: snapshot.window.presentation_window_id }
        : {}),
      ...(snapshot.window.surface_kind ? { surfaceKind: snapshot.window.surface_kind } : {}),
      ...(snapshot.window.surface_kind &&
      snapshot.window.surface_kind !== "window" &&
      typeof snapshot.window.presentation_window_id === "number" &&
      snapshot.window.presentation_window_id !== windowId
        ? { allowProvenAttachedSurface: true }
        : {}),
    };
  } finally {
    snapshot?.captureLease?.release();
  }
}
function assertMacBackgroundInputSucceeded(result, method) {
  if (result === false) {
    throw elementUnavailable(
      `${method}: macOS background window input was rejected. The window may be stale/off-screen, Accessibility/SkyLight may be unavailable, or the user changed real focus/cursor during dispatch. The action may already have been sent; do not retry blindly.`,
      {
        action_sent: true,
        request_delivery_state: "possibly_sent",
        reason: "background_dispatch_rejected_or_invariant_changed",
      },
    );
  }
}
function refuseTargetlessMacGlobalInput(method) {
  throw permissionDenied(
    `${method}: macOS background mode requires an app_ref/window target; targetless global input is disabled. action_sent=false.`,
    { action_sent: false, reason: "background_target_required" },
  );
}
async function resolveWindowsPointerIdentity(axSource, appRefValue, point, method) {
  const identity = await requirePointerAppPid(axSource, appRefValue, method);
  await assertExpectedPidIsFrontmost(axSource, identity.pid, point, method);
  return identity;
}
function assertNativeInputSucceeded(result, method) {
  if (result === false) {
    throw permissionDenied(
      `${method}: the native Helper rejected global synthetic input (Accessibility or no-focus policy).`,
    );
  }
}
function assertClickElementOwnerPid(result, expectedPid, method, point) {
  if (expectedPid <= 0) return;
  if (result === null || result === void 0) {
    throw elementUnavailable(
      `${method}: the AX hit-test click at (${point.x},${point.y}) returned no target ownership evidence for app_ref pid ${expectedPid}. The target may be occluded, minimized, stale, or this Helper may be too old to report verified owner pid evidence. Re-resolve from a fresh get_app_state, or bring the target app to the foreground.`,
    );
  }
  if (!result.ok) {
    const actualPid =
      typeof result.pid === "number" && Number.isSafeInteger(result.pid)
        ? String(result.pid)
        : "missing";
    const axMethod = typeof result.method === "string" && result.method ? result.method : "missing";
    throw elementUnavailable(
      `${method}: the AX hit-test click at (${point.x},${point.y}) did not prove target ownership for app_ref pid ${expectedPid} (method=${axMethod}, pid=${actualPid}). The target may be occluded, minimized, stale, or inaccessible. Re-resolve from a fresh get_app_state, or bring the target app to the foreground.`,
    );
  }
  if (
    typeof result.pid !== "number" ||
    !Number.isSafeInteger(result.pid) ||
    result.pid <= 0 ||
    result.pid !== expectedPid
  ) {
    const actualPid =
      typeof result.pid === "number" && Number.isSafeInteger(result.pid)
        ? String(result.pid)
        : "missing";
    throw elementUnavailable(
      `${method}: the AX element at (${point.x},${point.y}) returned a successful click for pid ${actualPid}, not the target app_ref (pid ${expectedPid}). The target may be occluded, minimized, stale, or this Helper may be too old to report verified owner pid evidence. Re-resolve from a fresh get_app_state, or bring the target app to the foreground.`,
    );
  }
}
function isEnterChord(chord) {
  const trimmed = chord.trim().toLowerCase();
  return trimmed === "enter" || trimmed === "return";
}
async function assertSemanticShortcutIdentity(axSource, target, method) {
  if (!target.bundleId) return false;
  try {
    const info = await axSource.applicationInfo?.({ pid: target.pid });
    if (info?.pid === target.pid && info.bundle_id) {
      if (!cuaBundleIdsEqual(info.bundle_id, target.bundleId, { loose: true })) {
        throw permissionDenied(
          `${method}: app_ref pid ${target.pid} does not match bundle_id ${target.bundleId}; the semantic AX shortcut was refused before any action.`,
        );
      }
      return true;
    }
    const live = (await axSource.listApplications()).find((app) => app.pid === target.pid);
    if (live?.bundle_id) {
      if (!cuaBundleIdsEqual(live.bundle_id, target.bundleId, { loose: true })) {
        throw permissionDenied(
          `${method}: app_ref pid ${target.pid} does not match bundle_id ${target.bundleId}; the semantic AX shortcut was refused before any action.`,
        );
      }
      return true;
    }
  } catch (error51) {
    if (error51 instanceof BrokerError) throw error51;
  }
  return false;
}
async function assertFocusedFilePanelSurface(axSource, method, target) {
  const snapshot = await axSource.captureApp({
    pid: target.pid,
    bundle_id: target.bundleId,
    window_id: target.windowId,
  });
  const actualWindowId = snapshot?.window.window_id;
  const surfaceKind = snapshot?.window.surface_kind;
  const focused = snapshot?.window.focused === true;
  snapshot?.captureLease?.release();
  if (!snapshot || typeof actualWindowId !== "number" || actualWindowId !== target.windowId) {
    throw elementUnavailable(
      `${method}: focused file-panel surface was replaced before foreground raw input. action_sent=false.`,
      {
        action_sent: false,
        reason: "surface_replaced",
        expected_window_id: target.windowId,
        actual_window_id: typeof actualWindowId === "number" ? actualWindowId : null,
      },
    );
  }
  if (
    surfaceKind === "attached_dialog" &&
    snapshot.surfaces?.some(
      (surface) =>
        surface.presentation_window_id === snapshot.window.presentation_window_id &&
        (surface.surface_kind === "open_panel" || surface.surface_kind === "save_panel"),
    ) !== true
  ) {
    throw foregroundRequired(
      `${method}: attached dialog is not AX-proven to belong to an open/save panel. action_sent=false.`,
      {
        action_sent: false,
        reason: "surface_lineage_unverified",
        actual_window_id: actualWindowId,
      },
    );
  }
  const isFilePanel =
    surfaceKind === "open_panel" ||
    surfaceKind === "save_panel" ||
    surfaceKind === "attached_dialog";
  if (isFilePanel && !focused) {
    throw foregroundRequired(
      `${method}: strategy=event target file-panel surface is not focused. action_sent=false.`,
      {
        action_sent: false,
        reason: "foreground_required",
        actual_window_id: actualWindowId,
      },
    );
  }
}
async function dispatchForegroundKeyed(adapter, axSource, method, target, dispatch) {
  const pid = typeof target === "number" ? target : target.pid;
  if (adapter.isFocusStealPrevented?.() === true) {
    throw foregroundRequired(
      `${method}: global synthetic input is blocked by the no-focus policy (prevent_activation).`,
      { action_sent: false, reason: "foreground_required" },
    );
  }
  if (!axSource) {
    throw foregroundRequired(
      `${method}: strategy=event sends global input but no live application source is available to verify the foreground owner. action_sent=false.`,
      { action_sent: false, reason: "foreground_required" },
    );
  }
  if (typeof target !== "number" && target.windowId !== null && target.windowId !== void 0) {
    await assertFocusedFilePanelSurface(axSource, method, target);
  }
  const assertStillFrontmost = async (actionSent = false) => {
    const apps = await axSource.listApplications();
    const frontmost = apps.some((app) => app.pid === pid && app.active === true);
    if (!frontmost) {
      throw foregroundRequired(
        `${method}: strategy=event sends global input and pid ${pid} is not frontmost; ${actionSent ? "an earlier step may already have been sent" : "no input was sent"} and the app was not activated. Target an element instead so the action goes through accessibility on a background app; strategy=event only lands while the target is already frontmost. action_sent=${String(actionSent)}.`,
        {
          action_sent: actionSent,
          request_delivery_state: actionSent ? "possibly_sent" : "not_sent",
          reason: "foreground_required",
        },
      );
    }
  };
  await assertStillFrontmost();
  await dispatch(assertStillFrontmost);
}
var PHYSICAL_EXPRESSION_RE = /^[0-9+\-*/=%.() ]+$/u;
function printableKeyChord(character) {
  const shifted = {
    "+": "shift+=",
    "*": "shift+8",
    "%": "shift+5",
    "(": "shift+9",
    ")": "shift+0",
  };
  if (shifted[character]) return shifted[character];
  if (/^[0-9=\-/.]$/u.test(character)) return character;
  if (character === " " || character === "	") return character === " " ? "space" : "tab";
  if (character === "\n" || character === "\r") return "enter";
  return null;
}
function dispatchPhysicalExpression(adapter, text, method) {
  if (!PHYSICAL_EXPRESSION_RE.test(text) || typeof adapter.pressKeyGlobal !== "function") {
    return false;
  }
  const normalizedText = text.replace(/\r\n/gu, "\n");
  const chords = [];
  for (const character of normalizedText) {
    const chord = printableKeyChord(character);
    if (chord === null) return false;
    chords.push(chord);
  }
  assertGlobalInputAllowed(adapter, method);
  for (const chord of chords) {
    assertNativeInputSucceeded(adapter.pressKeyGlobal(chord), method);
  }
  return true;
}
async function findFocusedSubmitButtonRef(axSource, pid) {
  let snapshot;
  try {
    snapshot = await axSource.captureApp({ pid });
  } catch {
    return null;
  }
  if (!snapshot) return null;
  for (const el of flattenAxTree(snapshot.elements)) {
    if (
      el.focused === true &&
      el.role === "AXButton" &&
      Array.isArray(el.actions) &&
      el.actions.includes("AXPress")
    ) {
      return el.ref;
    }
  }
  return null;
}
async function targetIsFrontmost(axSource, pid) {
  if (!axSource) return false;
  const apps = await axSource.listApplications();
  return apps.some((app) => app.pid === pid && app.active === true);
}
export async function replaceTextValueWithVerifiedInput(options) {
  const { adapter, axSource, ref, value, pid, bundleId, windowId } = options;
  if (!axSource.elementFocus) return { ok: false, axError: "action_unsupported" };
  const focused = await axSource.elementFocus(ref);
  if (focused === false || focused === null) {
    return { ok: false, axError: null };
  }
  if (typeof focused === "object" && focused !== null && "ok" in focused && !focused.ok) {
    return focused;
  }
  const foregroundTarget =
    typeof windowId === "number" && windowId > 0 ? { pid, bundleId, windowId } : pid;
  if (
    typeof adapter.pressKeyGlobal !== "function" ||
    typeof adapter.typeTextGlobal !== "function"
  ) {
    return { ok: false, axError: "action_unsupported" };
  }
  await dispatchForegroundKeyed(
    adapter,
    axSource,
    "element_set_value:event",
    foregroundTarget,
    async (assertStillFrontmost) => {
      assertGlobalInputAllowed(adapter, "element_set_value:event");
      assertNativeInputSucceeded(
        adapter.pressKeyGlobal("cmd+a"),
        "element_set_value:event:select_all",
      );
      await new Promise((resolve2) => setTimeout(resolve2, 75));
      await assertStillFrontmost(true);
      if (value.length > 0) {
        assertNativeInputSucceeded(adapter.typeTextGlobal(value), "element_set_value:event:type");
      } else {
        assertNativeInputSucceeded(
          adapter.pressKeyGlobal("backspace"),
          "element_set_value:event:clear",
        );
      }
    },
  );
  return { ok: true, axError: null };
}
async function dispatchWindowsForegroundKeyed(axSource, adapter, method, pid, dispatch) {
  await assertExpectedPidIsFrontmost(axSource, pid, null, method);
  assertGlobalInputAllowed(adapter, method);
  await dispatch();
}
function assertAxOutcomeSucceeded(outcome, method) {
  if (outcome === void 0 || outcome === true) return;
  if (outcome !== null && typeof outcome === "object" && "ok" in outcome) {
    const result = outcome;
    if (result.ok) return;
    const axError = result.axError ?? null;
    if (axError === "api_disabled") {
      throw permissionDenied(
        `${method}: Accessibility API is disabled \u2014 grant Accessibility to ZCode.`,
      );
    }
    throw elementUnavailable(
      `${method}: ZCode could not set the value on the focused element (gone, stale, or the owning app did not respond${axError ? `; axError=${axError}` : ""}).`,
    );
  }
  throw elementUnavailable(`${method}: ZCode could not set the value on the focused element.`);
}
function sessionKeyParam(value) {
  return typeof value === "string" && value ? value : "default";
}
export function createElectronInputHandlers(options) {
  const { adapter, axSource } = options;
  const platform2 = options.platform ?? process.platform;
  const macBackgroundMode = platform2 === "darwin" && adapter.macBackgroundInputRequired === true;
  let combinedDragInFlight = false;
  const validatedFrameTargetByParams = /* @__PURE__ */ new WeakMap();
  const readLiveWindowServerSnapshot = (displayBounds, method) => {
    if (!adapter.listScreenCaptureProbeWindows) {
      throw elementUnavailable(
        `${method}: live WindowServer ownership verification is unavailable. action_sent=false.`,
        { action_sent: false, reason: "frame_live_owner_unavailable" },
      );
    }
    try {
      return snapshotWindowServerWindows(
        adapter.listScreenCaptureProbeWindows(),
        displayBounds,
        process.pid,
      );
    } catch {
      throw elementUnavailable(
        `${method}: live WindowServer ownership verification failed. action_sent=false.`,
        { action_sent: false, reason: "frame_live_owner_unavailable" },
      );
    }
  };
  const requireStableWindowServerOwner = (window, method, skipped = []) => {
    if (!window || window.owner_bundle_id === null) {
      throw elementUnavailable(
        `${method}: the live pixel owner has no stable WindowServer app/window identity. action_sent=false.` +
          describeSkippedPixelOwners(skipped),
        {
          action_sent: false,
          reason: "frame_live_owner_unavailable",
          ...(skipped.length > 0
            ? {
                recovery:
                  "retry once the intended window is in front and a new screenshot was taken \u2014 do not move the skipped overlay windows, they belong to the user's environment",
              }
            : {}),
        },
      );
    }
    return {
      pid: window.owner_pid,
      bundleId: window.owner_bundle_id,
      windowId: window.window_id,
      bounds: window.bounds,
    };
  };
  const resolveDisplayFrameLiveOwner = (record2, method, displayBounds) => {
    const snapshot = readLiveWindowServerSnapshot(displayBounds, method);
    const resolution = windowServerOwnerAtPointDetailed(snapshot, record2.projected_point);
    return requireStableWindowServerOwner(resolution.owner, method, resolution.skipped);
  };
  const resolveAppFrameLiveOwner = (record2, method, displayBounds) => {
    const snapshot = readLiveWindowServerSnapshot(displayBounds, method);
    const capturedSurfaces = record2.capture_surfaces;
    if (capturedSurfaces) {
      if (capturedSurfaces.before_fingerprint !== capturedSurfaces.after_fingerprint) {
        throw elementUnavailable(
          `${method}: app surfaces changed while frame ${record2.frame_id} was captured. action_sent=false.`,
          { action_sent: false, reason: "capture_surfaces_changed" },
        );
      }
      const captured = capturedSurfaces.surfaces.find((surface) =>
        windowContainsPoint2(surface.bounds, record2.projected_point),
      );
      if (!captured) {
        throw elementUnavailable(
          `${method}: frame ${record2.frame_id} has no AX-proven app surface for the selected pixel. action_sent=false.`,
          { action_sent: false, reason: "frame_capture_surface_unavailable" },
        );
      }
      const live2 = snapshot.windows.find(
        (window) => window.window_id === captured.actual_window_id,
      );
      if (
        !live2 ||
        live2.owner_pid !== captured.owner_pid ||
        live2.owner_bundle_id === null ||
        !cuaBundleIdsEqual(live2.owner_bundle_id, captured.owner_bundle_id) ||
        !sameFrameBounds(live2.bounds, captured.bounds)
      ) {
        throw elementUnavailable(
          `${method}: captured ${captured.surface_kind} window ${captured.actual_window_id} closed, moved, or changed owner before dispatch. action_sent=false.`,
          {
            action_sent: false,
            reason: "surface_replaced",
            presentation_window_id: captured.presentation_window_id,
            actual_window_id: captured.actual_window_id,
            surface_kind: captured.surface_kind,
            recovery: "observe the application again and act on the new surface generation",
          },
        );
      }
      return {
        pid: captured.owner_pid,
        bundleId: captured.owner_bundle_id,
        windowId: captured.actual_window_id,
        bounds: captured.bounds,
        presentationWindowId: captured.presentation_window_id,
        surfaceKind: captured.surface_kind,
        ...(captured.surface_kind !== "window" &&
        captured.presentation_window_id !== captured.actual_window_id
          ? { allowProvenAttachedSurface: true }
          : {}),
      };
    }
    const live = snapshot.windows.find((window) => window.window_id === record2.window.window_id);
    const owner = requireStableWindowServerOwner(live ?? null, method);
    if (
      (record2.app.pid !== null && owner.pid !== record2.app.pid) ||
      (record2.app.bundle_id !== null &&
        !cuaBundleIdsEqual(owner.bundleId, record2.app.bundle_id)) ||
      !sameFrameBounds(owner.bounds, record2.window.bounds)
    ) {
      throw elementUnavailable(
        `${method}: app/window geometry changed after frame ${record2.frame_id}. action_sent=false.`,
        { action_sent: false, reason: "window_geometry_changed" },
      );
    }
    return owner;
  };
  const validateFrameProvenance = async (inputParams, method, points) => {
    const params = { ...inputParams };
    const frameLiveOwners = /* @__PURE__ */ new Map();
    const records = parseFrameProvenance(params.frame_provenance);
    if (records.length === 0) return params;
    if (
      records.some(
        (record2) =>
          !points[record2.endpoint_index] ||
          !sameCoordinate(record2.projected_point, points[record2.endpoint_index]) ||
          !sameCoordinate(independentlyProjectFramePixel(record2), record2.projected_point),
      )
    ) {
      throw elementUnavailable(
        `${method}: projected point does not match its frame provenance. action_sent=false.`,
        { action_sent: false, reason: "frame_projection_mismatch" },
      );
    }
    if (!options.getDisplayTopology) {
      throw elementUnavailable(
        `${method}: native display topology verification is unavailable. action_sent=false.`,
        { action_sent: false, reason: "display_topology_unavailable" },
      );
    }
    const topology = options.getDisplayTopology();
    const fingerprint2 = displayTopologyFingerprint(topology);
    for (const record2 of records) {
      if (record2.expires_at_ms < Date.now()) {
        throw elementUnavailable(
          `${method}: frame_id ${record2.frame_id} expired before native dispatch. action_sent=false.`,
          { action_sent: false, reason: "expired_frame" },
        );
      }
      if (record2.display.topology_fingerprint !== fingerprint2) {
        throw elementUnavailable(
          `${method}: display topology or DPI changed after frame ${record2.frame_id}. action_sent=false.`,
          { action_sent: false, reason: "display_topology_changed" },
        );
      }
      if (
        record2.display.display_id !== null &&
        !topology.some((display) => display.id === record2.display.display_id)
      ) {
        throw elementUnavailable(
          `${method}: display owning frame ${record2.frame_id} is no longer present. action_sent=false.`,
          { action_sent: false, reason: "display_removed" },
        );
      }
      const owningDisplay =
        (record2.display.display_id === null
          ? null
          : topology.find((display) => display.id === record2.display.display_id)) ??
        topology.find((display) => windowContainsPoint2(display.bounds, record2.projected_point));
      if (!owningDisplay) {
        throw elementUnavailable(
          `${method}: frame ${record2.frame_id} no longer maps to a live display. action_sent=false.`,
          { action_sent: false, reason: "display_removed" },
        );
      }
      const displayBounds = owningDisplay.bounds;
      if (record2.app.pid === null && record2.app.bundle_id === null) {
        const capture = capturedOwnerAtPoint(record2, displayBounds);
        const captureOwner = capture.owner;
        if (!captureOwner) {
          throw elementUnavailable(
            `${method}: full-display frame ${record2.frame_id} has no capture-time owner for the selected pixel. action_sent=false.` +
              describeSkippedPixelOwners(capture.skipped),
            { action_sent: false, reason: "frame_capture_owner_unavailable" },
          );
        }
        if (captureOwner.owner_bundle_id === null) {
          throw elementUnavailable(
            `${method}: full-display frame ${record2.frame_id} selected a capture-time window without a stable bundle identity. action_sent=false.`,
            { action_sent: false, reason: "frame_capture_owner_unavailable" },
          );
        }
        const liveOwner = resolveDisplayFrameLiveOwner(record2, method, displayBounds);
        if (!sameFrameOwner(liveOwner, captureOwner)) {
          throw elementUnavailable(
            `${method}: full-display frame ${record2.frame_id} is stale; the live pixel owner changed before dispatch. action_sent=false.`,
            {
              action_sent: false,
              reason: "frame_live_owner_changed",
              // owner 变化后只能重拍并从新图选点；不要把已失效 authority 自动
              // 降级到另一帧或重放动作。
              recovery:
                "take a new screenshot and resubmit x/y chosen from the new raster; frame binding is internal",
            },
          );
        }
        frameLiveOwners.set(record2.endpoint_index, liveOwner);
        continue;
      }
      const dispatchRef = appRefParam(params.app_ref);
      if (
        (record2.app.pid !== null && dispatchRef.pid !== record2.app.pid) ||
        (record2.app.bundle_id !== null &&
          !cuaBundleIdsEqual(dispatchRef.bundle_id, record2.app.bundle_id)) ||
        (record2.window.window_id !== null && dispatchRef.window_id !== record2.window.window_id)
      ) {
        throw elementUnavailable(
          `${method}: dispatch app/window identity does not match frame ${record2.frame_id}. action_sent=false.`,
          { action_sent: false, reason: "frame_dispatch_identity_mismatch" },
        );
      }
      if (adapter.listScreenCaptureProbeWindows) {
        const liveOwner = resolveAppFrameLiveOwner(record2, method, displayBounds);
        frameLiveOwners.set(record2.endpoint_index, liveOwner);
        continue;
      }
      if (platform2 === "darwin") {
        throw elementUnavailable(
          `${method}: live WindowServer app/window verification is unavailable. action_sent=false.`,
          { action_sent: false, reason: "frame_live_owner_unavailable" },
        );
      }
      if (!axSource) {
        throw elementUnavailable(
          `${method}: live app/window verification is unavailable. action_sent=false.`,
          { action_sent: false, reason: "application_source_unavailable" },
        );
      }
      const snapshot = await axSource.captureApp(
        {
          ...(record2.app.pid !== null ? { pid: record2.app.pid } : {}),
          ...(record2.app.bundle_id !== null ? { bundle_id: record2.app.bundle_id } : {}),
          ...(record2.window.window_id !== null ? { window_id: record2.window.window_id } : {}),
        },
        { includeScreenshot: false },
      );
      try {
        if (
          !snapshot ||
          (record2.app.pid !== null && snapshot.app.pid !== record2.app.pid) ||
          (record2.app.bundle_id !== null &&
            !cuaBundleIdsEqual(snapshot.app.bundle_id ?? "", record2.app.bundle_id)) ||
          (record2.window.window_id !== null &&
            snapshot.window.window_id !== record2.window.window_id) ||
          snapshot.window.window_id_fallback === true ||
          !sameFrameBounds(snapshot.window.bounds, record2.window.bounds)
        ) {
          throw elementUnavailable(
            `${method}: app/window geometry changed after frame ${record2.frame_id}. action_sent=false.`,
            { action_sent: false, reason: "window_geometry_changed" },
          );
        }
      } finally {
        snapshot?.captureLease?.release();
      }
    }
    if (frameLiveOwners.size > 0) {
      const owners = [...frameLiveOwners.values()];
      const owner = owners[0];
      if (
        owners.some(
          (candidate) =>
            candidate.pid !== owner.pid ||
            candidate.windowId !== owner.windowId ||
            !cuaBundleIdsEqual(candidate.bundleId, owner.bundleId) ||
            !sameFrameBounds(candidate.bounds, owner.bounds),
        )
      ) {
        throw elementUnavailable(
          `${method}: coordinate endpoints resolve to different live windows. action_sent=false.`,
          { action_sent: false, reason: "frame_live_owner_mismatch" },
        );
      }
      const presentationFrame = records.find(
        (record2) =>
          record2.capture_surfaces !== null &&
          record2.capture_surfaces !== void 0 &&
          record2.app.pid !== null &&
          record2.app.bundle_id !== null,
      );
      const supplied = params.app_ref === void 0 ? null : appRefParam(params.app_ref);
      if (
        supplied &&
        ((supplied.pid !== void 0 && supplied.pid !== owner.pid) ||
          (supplied.bundle_id !== void 0 &&
            supplied.bundle_id !== null &&
            !cuaBundleIdsEqual(supplied.bundle_id, owner.bundleId)) ||
          (owner.windowId !== null &&
            supplied.window_id !== void 0 &&
            supplied.window_id !== null &&
            supplied.window_id !== owner.windowId))
      ) {
        const matchesLogicalAppFrame = records.some(
          (record2) =>
            record2.capture_surfaces !== null &&
            record2.capture_surfaces !== void 0 &&
            (record2.app.pid === null || supplied.pid === record2.app.pid) &&
            (record2.app.bundle_id === null ||
              (supplied.bundle_id !== void 0 &&
                supplied.bundle_id !== null &&
                cuaBundleIdsEqual(supplied.bundle_id, record2.app.bundle_id))) &&
            (record2.window.window_id === null ||
              supplied.window_id === void 0 ||
              supplied.window_id === null ||
              supplied.window_id === record2.window.window_id),
        );
        if (matchesLogicalAppFrame) {
          params.presentation_app_ref = supplied;
          params.app_ref = {
            pid: owner.pid,
            bundle_id: owner.bundleId,
            ...(owner.windowId !== null ? { window_id: owner.windowId } : {}),
          };
          params.expected_pid = owner.pid;
          if (owner.windowId !== null) {
            validatedFrameTargetByParams.set(params, {
              pid: owner.pid,
              bundleId: owner.bundleId,
              windowId: owner.windowId,
              bounds: owner.bounds,
              ...(owner.presentationWindowId !== void 0
                ? { presentationWindowId: owner.presentationWindowId }
                : {}),
              ...(owner.surfaceKind !== void 0 ? { surfaceKind: owner.surfaceKind } : {}),
              ...(owner.surfaceKind !== void 0 &&
              owner.surfaceKind !== "window" &&
              owner.presentationWindowId !== void 0 &&
              owner.presentationWindowId !== owner.windowId
                ? { allowProvenAttachedSurface: true }
                : {}),
            });
          }
          return params;
        }
        throw elementUnavailable(
          `${method}: supplied app_ref does not own the live frame pixel. That pixel is owned by ${owner.bundleId} (pid ${owner.pid}${owner.windowId !== null ? `, window ${owner.windowId}` : ""}, bounds [${owner.bounds.join(",")}]). action_sent=false.`,
          {
            action_sent: false,
            reason: "frame_dispatch_identity_mismatch",
            recovery:
              "either drop app_ref and let the coordinate resolve its own owner, or retry once the intended window is in front and a new screenshot was taken",
          },
        );
      }
      if (params.presentation_app_ref === void 0 && presentationFrame) {
        params.presentation_app_ref = {
          pid: presentationFrame.app.pid,
          bundle_id: presentationFrame.app.bundle_id,
          window_id: presentationFrame.capture_surfaces.presentation_window_id,
        };
      }
      params.app_ref = {
        pid: owner.pid,
        bundle_id: owner.bundleId,
        ...(owner.windowId !== null ? { window_id: owner.windowId } : {}),
      };
      params.expected_pid = owner.pid;
      if (owner.windowId !== null) {
        validatedFrameTargetByParams.set(params, {
          pid: owner.pid,
          bundleId: owner.bundleId,
          windowId: owner.windowId,
          bounds: owner.bounds,
          ...(owner.presentationWindowId !== void 0
            ? { presentationWindowId: owner.presentationWindowId }
            : {}),
          ...(owner.surfaceKind !== void 0 ? { surfaceKind: owner.surfaceKind } : {}),
          ...(owner.surfaceKind !== void 0 &&
          owner.surfaceKind !== "window" &&
          owner.presentationWindowId !== void 0 &&
          owner.presentationWindowId !== owner.windowId
            ? { allowProvenAttachedSurface: true }
            : {}),
        });
      }
    }
    return params;
  };
  const resolveMacBackgroundTarget = (params, method) => {
    const validated = validatedFrameTargetByParams.get(params);
    return validated
      ? Promise.resolve(validated)
      : requireMacBackgroundWindowTarget(axSource, params.app_ref, method);
  };
  pointerSequenceGateByAdapter.set(adapter, (action) => refusePointerSequenceIfBusy(action));
  terminalPointerCleanupByAdapter.set(adapter, async () => {
    return !combinedDragInFlight;
  });
  const refusePointerSequenceIfBusy = (action) => {
    if (!combinedDragInFlight) return;
    throw permissionDenied(
      `${action} refused: another left-button sequence is still active. Wait for drag completion or stop_computer_control. action_sent=false.`,
      { action_sent: false, reason: "drag_in_flight" },
    );
  };
  return {
    type_text_to_app: async (params) => {
      if (platform2 !== "win32" && typeof adapter.typeTextToApp !== "function") {
        throw notAuthorized("type_text_to_app is unavailable in this ZCode build.");
      }
      const text = syntheticTextParam(params.text, "type_text_to_app");
      if (!text) return null;
      const target = await resolveAppInputTarget(
        axSource,
        appRefParam(params.app_ref),
        "type_text_to_app",
      );
      if (
        params.strategy === "event" &&
        !(platform2 === "win32" && typeof adapter.typeTextToApp !== "function")
      ) {
        const foregroundWindowTarget = macBackgroundMode
          ? await requireMacBackgroundWindowTarget(axSource, params.app_ref, "type_text_to_app")
          : void 0;
        assertExactFilePanelAppRef("type_text_to_app", target, foregroundWindowTarget);
        await dispatchForegroundKeyed(
          adapter,
          axSource,
          "type_text_to_app",
          target,
          async (assertStillFrontmost) => {
            await new Promise((resolve2) => setTimeout(resolve2, 75));
            await assertStillFrontmost();
            if (dispatchPhysicalExpression(adapter, text, "type_text_to_app")) {
              return;
            }
            if (typeof adapter.typeTextGlobal !== "function") {
              throw notAuthorized(
                "type_text_to_app: the global keystroke primitive is unavailable in this ZCode build.",
              );
            }
            assertGlobalInputAllowed(adapter, "type_text_to_app");
            assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text_to_app");
          },
        );
        return appendResolvedAppRef({ method: "foreground_event" }, params, foregroundWindowTarget);
      }
      if (macBackgroundMode) {
        if (typeof adapter.typeTextToWindow !== "function") {
          throw notAuthorized(
            "type_text_to_app: macOS background keyboard ABI is unavailable; global fallback is disabled.",
          );
        }
        const windowTarget = await requireMacBackgroundWindowTarget(
          axSource,
          params.app_ref,
          "type_text_to_app",
        );
        if (PHYSICAL_EXPRESSION_RE.test(text)) {
          await runAppScopedInput("type_text_to_app", () =>
            adapter.typeTextToWindow(
              windowTarget.pid,
              windowTarget.bundleId,
              windowTarget.windowId,
              windowTarget.bounds,
              text,
              ...provenAttachedSurfaceArgs(windowTarget),
            ),
          );
          return appendResolvedAppRef({ method: "window_event" }, params, windowTarget);
        }
        if (await targetIsFrontmost(axSource, target.pid)) {
          await dispatchForegroundKeyed(adapter, axSource, "type_text_to_app", target, () => {
            if (typeof adapter.typeTextGlobal !== "function") {
              throw notAuthorized(
                "type_text_to_app: the global keystroke primitive is unavailable in this ZCode build.",
              );
            }
            assertGlobalInputAllowed(adapter, "type_text_to_app");
            assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text_to_app");
          });
          return appendResolvedAppRef({ method: "foreground_event" }, params, windowTarget);
        }
        await runAppScopedInput("type_text_to_app", () =>
          adapter.typeTextToWindow(
            windowTarget.pid,
            windowTarget.bundleId,
            windowTarget.windowId,
            windowTarget.bounds,
            text,
            ...provenAttachedSurfaceArgs(windowTarget),
          ),
        );
        return appendResolvedAppRef({ method: "window_event" }, params, windowTarget);
      }
      if (platform2 === "win32" && typeof adapter.typeTextToApp !== "function") {
        await dispatchWindowsForegroundKeyed(
          axSource,
          adapter,
          "type_text_to_app",
          target.pid,
          () => {
            if (typeof adapter.typeTextGlobal !== "function") {
              throw notAuthorized(
                "type_text_to_app: the global keystroke primitive is unavailable in this ZCode build.",
              );
            }
            assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text_to_app");
          },
        );
        return null;
      }
      if (platform2 === "darwin" && PHYSICAL_EXPRESSION_RE.test(text)) {
        await runAppScopedInput("type_text_to_app", () =>
          adapter.typeTextToApp(target.pid, target.bundleId, text),
        );
        return null;
      }
      if (
        typeof adapter.typeTextGlobal === "function" &&
        (await targetIsFrontmost(axSource, target.pid))
      ) {
        await dispatchForegroundKeyed(
          adapter,
          axSource,
          "type_text_to_app",
          target,
          async (assertStillFrontmost) => {
            await new Promise((resolve2) => setTimeout(resolve2, 75));
            await assertStillFrontmost();
            if (
              PHYSICAL_EXPRESSION_RE.test(text) &&
              dispatchPhysicalExpression(adapter, text, "type_text_to_app")
            ) {
              return;
            }
            assertGlobalInputAllowed(adapter, "type_text_to_app");
            assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text_to_app");
          },
        );
        return null;
      }
      await runAppScopedInput("type_text_to_app", () =>
        adapter.typeTextToApp(target.pid, target.bundleId, text),
      );
      return null;
    },
    press_key_to_app: async (params) => {
      if (platform2 !== "win32" && typeof adapter.pressKeyToApp !== "function") {
        throw notAuthorized("press_key_to_app is unavailable in this ZCode build.");
      }
      const text = keyChordParam(params.text, "press_key_to_app");
      const target = await resolveAppInputTarget(
        axSource,
        appRefParam(params.app_ref),
        "press_key_to_app",
      );
      if (
        params.strategy === "event" &&
        !(platform2 === "win32" && typeof adapter.pressKeyToApp !== "function")
      ) {
        const foregroundWindowTarget = macBackgroundMode
          ? await requireMacBackgroundWindowTarget(axSource, params.app_ref, "press_key_to_app")
          : void 0;
        assertExactFilePanelAppRef("press_key_to_app", target, foregroundWindowTarget);
        await dispatchForegroundKeyed(adapter, axSource, "press_key_to_app", target, async () => {
          if (
            [...text].length === 1 &&
            dispatchPhysicalExpression(adapter, text, "press_key_to_app")
          ) {
            return;
          }
          if (typeof adapter.pressKeyGlobal !== "function") {
            throw notAuthorized(
              "press_key_to_app: the global keystroke primitive is unavailable in this ZCode build.",
            );
          }
          assertGlobalInputAllowed(adapter, "press_key_to_app");
          assertNativeInputSucceeded(adapter.pressKeyGlobal(text), "press_key_to_app");
        });
        return appendResolvedAppRef({ method: "foreground_event" }, params, foregroundWindowTarget);
      }
      if (macBackgroundMode) {
        if (typeof adapter.pressKeyToWindow !== "function") {
          throw notAuthorized(
            "press_key_to_app: macOS background keyboard ABI is unavailable; global fallback is disabled.",
          );
        }
        const windowTarget = await requireMacBackgroundWindowTarget(
          axSource,
          params.app_ref,
          "press_key_to_app",
        );
        if (await targetIsFrontmost(axSource, target.pid)) {
          await dispatchForegroundKeyed(adapter, axSource, "press_key_to_app", target, () => {
            if (typeof adapter.pressKeyGlobal !== "function") {
              throw notAuthorized(
                "press_key_to_app: the global keystroke primitive is unavailable in this ZCode build.",
              );
            }
            assertGlobalInputAllowed(adapter, "press_key_to_app");
            assertNativeInputSucceeded(adapter.pressKeyGlobal(text), "press_key_to_app");
          });
          return appendResolvedAppRef({ method: "foreground_event" }, params, windowTarget);
        }
        await runAppScopedInput("press_key_to_app", () =>
          adapter.pressKeyToWindow(
            windowTarget.pid,
            windowTarget.bundleId,
            windowTarget.windowId,
            windowTarget.bounds,
            text,
            ...provenAttachedSurfaceArgs(windowTarget),
          ),
        );
        return appendResolvedAppRef({ method: "window_event" }, params, windowTarget);
      }
      const isEnter = isEnterChord(text);
      if (isEnter && axSource?.elementPerformAction) {
        const identityVerified = await assertSemanticShortcutIdentity(
          axSource,
          target,
          "press_key_to_app",
        );
        if (identityVerified) {
          const ref = await findFocusedSubmitButtonRef(axSource, target.pid);
          if (ref) {
            const outcome = await axSource.elementPerformAction(ref, "AXPress");
            assertAxOutcomeSucceeded(outcome, "press_key_to_app:ax_press_submit");
            return { method: "ax_press_submit" };
          }
        }
      }
      if (platform2 === "win32" && typeof adapter.pressKeyToApp !== "function") {
        await dispatchWindowsForegroundKeyed(
          axSource,
          adapter,
          "press_key_to_app",
          target.pid,
          () => {
            if (typeof adapter.pressKeyGlobal !== "function") {
              throw notAuthorized(
                "press_key_to_app: the global keystroke primitive is unavailable in this ZCode build.",
              );
            }
            assertNativeInputSucceeded(adapter.pressKeyGlobal(text), "press_key_to_app");
          },
        );
        return null;
      }
      if (await targetIsFrontmost(axSource, target.pid)) {
        await dispatchForegroundKeyed(adapter, axSource, "press_key_to_app", target, () => {
          if (typeof adapter.pressKeyGlobal !== "function") {
            throw notAuthorized(
              "press_key_to_app: the global keystroke primitive is unavailable in this ZCode build.",
            );
          }
          assertGlobalInputAllowed(adapter, "press_key_to_app");
          assertNativeInputSucceeded(adapter.pressKeyGlobal(text), "press_key_to_app");
        });
        return null;
      }
      await runAppScopedInput("press_key_to_app", () =>
        adapter.pressKeyToApp(target.pid, target.bundleId, text),
      );
      return null;
    },
    hold_key_to_app: async (params) => {
      if (platform2 !== "win32" && typeof adapter.holdKeyToApp !== "function") {
        throw notAuthorized("hold_key_to_app is unavailable in this ZCode build.");
      }
      const text = keyChordParam(params.text, "hold_key_to_app");
      const duration3 = clampDurationSeconds(params.duration);
      const sessionKey = sessionKeyParam(params.session_key);
      const target = await resolveAppInputTarget(
        axSource,
        appRefParam(params.app_ref),
        "hold_key_to_app",
      );
      if (
        params.strategy === "event" &&
        !(platform2 === "win32" && typeof adapter.holdKeyToApp !== "function")
      ) {
        await dispatchForegroundKeyed(adapter, axSource, "hold_key_to_app", target, async () => {
          if (typeof adapter.holdKeyGlobal !== "function") {
            throw notAuthorized(
              "hold_key_to_app: the global hold primitive is unavailable in this ZCode build.",
            );
          }
          assertGlobalInputAllowed(adapter, "hold_key_to_app");
          assertNativeInputSucceeded(
            await adapter.holdKeyGlobal(text, duration3 * 1e3, sessionKey),
            "hold_key_to_app",
          );
        });
        return null;
      }
      if (macBackgroundMode) {
        if (typeof adapter.holdKeyToWindow !== "function") {
          throw notAuthorized(
            "hold_key_to_app: macOS background keyboard ABI is unavailable; global fallback is disabled.",
          );
        }
        const windowTarget = await requireMacBackgroundWindowTarget(
          axSource,
          params.app_ref,
          "hold_key_to_app",
        );
        if (await targetIsFrontmost(axSource, target.pid)) {
          await dispatchForegroundKeyed(adapter, axSource, "hold_key_to_app", target, async () => {
            if (typeof adapter.holdKeyGlobal !== "function") {
              throw notAuthorized(
                "hold_key_to_app: the global hold primitive is unavailable in this ZCode build.",
              );
            }
            assertGlobalInputAllowed(adapter, "hold_key_to_app");
            assertNativeInputSucceeded(
              await adapter.holdKeyGlobal(text, duration3 * 1e3, sessionKey),
              "hold_key_to_app",
            );
          });
          return appendResolvedAppRef({ method: "foreground_event" }, params, windowTarget);
        }
        await runAppScopedInput("hold_key_to_app", () =>
          adapter.holdKeyToWindow(
            windowTarget.pid,
            windowTarget.bundleId,
            windowTarget.windowId,
            windowTarget.bounds,
            text,
            duration3,
            sessionKey,
            ...provenAttachedSurfaceArgs(windowTarget),
          ),
        );
        return appendResolvedAppRef({ method: "window_event" }, params, windowTarget);
      }
      if (platform2 === "win32" && typeof adapter.holdKeyToApp !== "function") {
        await dispatchWindowsForegroundKeyed(
          axSource,
          adapter,
          "hold_key_to_app",
          target.pid,
          async () => {
            if (typeof adapter.holdKeyGlobal !== "function") {
              throw notAuthorized(
                "hold_key_to_app: the global hold primitive is unavailable in this ZCode build.",
              );
            }
            assertNativeInputSucceeded(
              await adapter.holdKeyGlobal(text, duration3 * 1e3, sessionKey),
              "hold_key_to_app",
            );
          },
        );
        return null;
      }
      await runAppScopedInput("hold_key_to_app", () =>
        adapter.holdKeyToApp(target.pid, target.bundleId, text, duration3, sessionKey),
      );
      return null;
    },
    // 全局坐标鼠标/键盘合成（CGEvent + CGEventPost，不限定 pid）。仅签名 Helper 的 native addon 提供
    // （adapter.clickAtPoint 等）；Electron 主进程未注入 → not_authorized（fail-closed，绝不静默回退）。
    click: async (params) => {
      refusePointerSequenceIfBusy("click");
      if (
        typeof adapter.clickAtPoint !== "function" &&
        typeof adapter.clickElementAtPoint !== "function"
      ) {
        throw notAuthorized("click is unavailable in this ZCode build.");
      }
      const point = extractPoint(params.point);
      if (!point) {
        throw permissionDenied("click requires point {x, y} as numbers.");
      }
      params = await validateFrameProvenance(params, "click", [point]);
      const button = typeof params.button === "string" ? params.button : "left";
      const clicks = clickCountParam(params.clicks, "click");
      const normalizedModifiers = modifiersChordParam(params.modifiers, "click");
      const modifiers = normalizedModifiers || null;
      const strategy = typeof params.strategy === "string" ? params.strategy : "auto";
      const forceRawEvent = strategy === "event";
      const expectedPid =
        typeof params.expected_pid === "number" &&
        Number.isInteger(params.expected_pid) &&
        params.expected_pid > 0
          ? params.expected_pid
          : 0;
      const expectedWindowId =
        typeof params.expected_window_id === "number" &&
        Number.isSafeInteger(params.expected_window_id) &&
        params.expected_window_id > 0
          ? params.expected_window_id
          : 0;
      if (macBackgroundMode) {
        if (typeof adapter.clickToWindow !== "function") {
          throw notAuthorized(
            "click: macOS background pointer ABI is unavailable; global fallback is disabled.",
          );
        }
        const target = await resolveMacBackgroundTarget(params, "click");
        if (expectedPid > 0 && target.pid !== expectedPid) {
          throw elementUnavailable(
            "click: expected_pid and app_ref resolve to different applications. action_sent=false.",
            { action_sent: false, reason: "background_target_pid_mismatch" },
          );
        }
        let presentationPid = null;
        try {
          presentationPid =
            params.presentation_app_ref === void 0
              ? null
              : (appRefParam(params.presentation_app_ref).pid ?? null);
        } catch {
          presentationPid = null;
        }
        let exactForegroundSurface = false;
        if (
          forceRawEvent &&
          presentationPid !== null &&
          options.getDisplayTopology &&
          adapter.isFocusStealPrevented?.() !== true
        ) {
          try {
            const display = options
              .getDisplayTopology()
              .find((candidate) => windowContainsPoint2(candidate.bounds, point));
            if (display && (await targetIsFrontmost(axSource, presentationPid))) {
              const owner = windowServerOwnerAtPointDetailed(
                readLiveWindowServerSnapshot(display.bounds, "click"),
                point,
              ).owner;
              exactForegroundSurface =
                owner !== null &&
                owner.owner_pid === target.pid &&
                owner.window_id === target.windowId &&
                owner.owner_bundle_id !== null &&
                cuaBundleIdsEqual(owner.owner_bundle_id, target.bundleId) &&
                sameFrameBounds(owner.bounds, target.bounds);
            }
          } catch {
            exactForegroundSurface = false;
          }
        }
        refusePointerSequenceIfBusy("click");
        if (exactForegroundSurface) {
          if (typeof adapter.clickAtPoint !== "function") {
            throw notAuthorized(
              "click: exact-owner foreground pointer ABI is unavailable. action_sent=false.",
            );
          }
          assertGlobalInputAllowed(adapter, "click");
          assertNativeInputSucceeded(
            adapter.clickAtPoint(
              point.x,
              point.y,
              button,
              clicks,
              modifiers,
              target.pid,
              target.windowId,
            ),
            "click",
          );
          return appendResolvedAppRef(
            {
              method: "foreground_event",
              pid: target.pid,
              window_id: target.windowId,
            },
            params,
            target,
          );
        }
        assertMacBackgroundInputSucceeded(
          await adapter.clickToWindow(
            target.pid,
            target.bundleId,
            target.windowId,
            target.bounds,
            point.x,
            point.y,
            button,
            clicks,
            modifiers,
            ...provenAttachedSurfaceArgs(target),
          ),
          "click",
        );
        return appendResolvedAppRef(
          { method: "window_event", pid: target.pid, window_id: target.windowId },
          params,
          target,
        );
      }
      if (
        !forceRawEvent &&
        options.allowAxHitTestClick !== false &&
        button === "left" &&
        !modifiers &&
        typeof adapter.clickElementAtPoint === "function"
      ) {
        const r = adapter.clickElementAtPoint(point.x, point.y, clicks, false, "png", expectedPid);
        assertClickElementOwnerPid(r, expectedPid, "click", point);
        if (r?.ok) {
          return appendResolvedAppRef({ method: "ax_press", pid: r.pid ?? 0 }, params);
        }
        if (r?.method === "wrong_owner") {
          throw elementUnavailable(
            `click: the AX element at (${point.x},${point.y}) belongs to pid ${r.pid}, not the target app_ref (pid ${expectedPid}). The target may be occluded, minimized, or the element stale. Re-resolve from a fresh get_app_state, or bring the target app to the foreground.`,
          );
        }
      } else if (expectedPid > 0) {
        const expectedBundle =
          typeof params.expected_bundle_id === "string" ? params.expected_bundle_id : "";
        if (params.expected_window_id !== void 0) {
          if (!expectedBundle)
            throw permissionDenied(
              "click: window-scoped raw input requires expected_bundle_id. action_sent=false.",
              { action_sent: false },
            );
          activateConcreteWindow(
            adapter,
            expectedPid,
            expectedBundle,
            params.expected_window_id,
            "click",
          );
        }
        await assertExpectedPidIsFrontmost(axSource, expectedPid, point, "click");
      }
      refusePointerSequenceIfBusy("click");
      if (typeof adapter.clickAtPoint !== "function") {
        throw notAuthorized(
          options.allowAxHitTestClick === false
            ? "click: app policy requires the raw coordinate primitive, which is unavailable in this ZCode build."
            : "click (coordinate fallback) is unavailable in this ZCode build.",
        );
      }
      assertGlobalInputAllowed(adapter, "click");
      const clickResult =
        expectedPid > 0
          ? adapter.clickAtPoint(
              point.x,
              point.y,
              button,
              clicks,
              modifiers,
              expectedPid,
              expectedWindowId || void 0,
            )
          : adapter.clickAtPoint(point.x, point.y, button, clicks, modifiers);
      assertNativeInputSucceeded(clickResult, "click");
      return appendResolvedAppRef({ method: "cg_event" }, params);
    },
    // preventActivation 门:开启后所有全局 CGEvent 合成被 native 拒绝,强制 AX 元素路径(后台不抢焦点)。
    // broker/host 在 CUA action 批次前后 prevent_activation()/reenable_activation() 包住。
    prevent_activation: () => {
      if (
        typeof adapter.preventActivation !== "function" ||
        typeof adapter.isFocusStealPrevented !== "function"
      ) {
        throw notAuthorized("prevent_activation is unavailable in this ZCode build.");
      }
      if (adapter.preventActivation() === false || !adapter.isFocusStealPrevented()) {
        throw permissionDenied("prevent_activation: the native Helper did not enable the gate.");
      }
      return true;
    },
    reenable_activation: () => {
      if (
        typeof adapter.reenableActivation !== "function" ||
        typeof adapter.isFocusStealPrevented !== "function"
      ) {
        throw notAuthorized("reenable_activation is unavailable in this ZCode build.");
      }
      if (adapter.reenableActivation() === false || adapter.isFocusStealPrevented()) {
        throw permissionDenied("reenable_activation: the native Helper did not release the gate.");
      }
      return false;
    },
    is_focus_steal_prevented: () => {
      if (typeof adapter.isFocusStealPrevented !== "function") {
        throw notAuthorized("is_focus_steal_prevented is unavailable in this ZCode build.");
      }
      return adapter.isFocusStealPrevented();
    },
    // Phase 2 实时画中画：为指定窗口开启一个顶置浮窗。优先用 verified ABI（pid+bundle，
    // 防 window id 复用），缺能力时回退到 legacy windowId-only pipStart。
    // 只显示、不转发点击;需 Screen Recording + macOS 14+。失败返回 false。
    pip_start: async (params) => {
      if (
        typeof adapter.pipStart !== "function" &&
        typeof adapter.pipStartVerified !== "function" &&
        typeof adapter.pipStartVerifiedComposite !== "function"
      ) {
        throw notAuthorized("pip_start is unavailable in this ZCode build.");
      }
      const windowId = typeof params.window_id === "number" ? params.window_id : 0;
      if (!Number.isSafeInteger(windowId) || windowId <= 0 || windowId > 4294967295) {
        throw permissionDenied("pip_start requires a positive uint32 window_id.");
      }
      const width = typeof params.width === "number" ? params.width : 0;
      const height = typeof params.height === "number" ? params.height : 0;
      if (!Number.isSafeInteger(width) || width < 0 || width > 1920) {
        throw permissionDenied("pip_start width must be an integer from 0 to 1920.");
      }
      if (!Number.isSafeInteger(height) || height < 0 || height > 1080) {
        throw permissionDenied("pip_start height must be an integer from 0 to 1080.");
      }
      const expectedPid =
        typeof params.expected_pid === "number" &&
        Number.isSafeInteger(params.expected_pid) &&
        params.expected_pid > 0
          ? params.expected_pid
          : null;
      const expectedBundleId =
        typeof params.expected_bundle_id === "string" && params.expected_bundle_id.trim()
          ? params.expected_bundle_id
          : null;
      if (
        expectedPid !== null &&
        expectedBundleId !== null &&
        typeof adapter.pipStartVerifiedComposite === "function"
      ) {
        adapter.pipClearDismissed?.();
        if (
          (await adapter.pipStartVerifiedComposite(
            windowId,
            windowId,
            expectedPid,
            expectedBundleId,
            width,
            height,
          )) !== true
        ) {
          throw permissionDenied(
            "pip_start: the native Helper rejected the composite window identity.",
          );
        }
        return true;
      }
      if (
        expectedPid !== null &&
        expectedBundleId !== null &&
        typeof adapter.pipStartVerified === "function"
      ) {
        adapter.pipClearDismissed?.();
        if (
          (await adapter.pipStartVerified(
            windowId,
            expectedPid,
            expectedBundleId,
            width,
            height,
          )) !== true
        ) {
          throw permissionDenied(
            "pip_start: the native Helper rejected the verified window identity.",
          );
        }
        return true;
      }
      adapter.pipClearDismissed?.();
      return adapter.pipStart(windowId, width, height);
    },
    pip_stop: () => {
      if (typeof adapter.pipStop !== "function") {
        throw notAuthorized("pip_stop is unavailable in this ZCode build.");
      }
      return adapter.pipDismiss?.() ?? adapter.pipStop();
    },
    // dismissed 存在 Helper 进程级全局里，而 Helper 跨对话常驻——没有这个入口，
    // 关闭一次 PiP 会永久抑制之后每一个新对话的 Auto-PiP。调用方是每对话新起的
    // MCP 会话，用它把上一个对话的关闭意图划掉。
    pip_clear_dismissed: () => adapter.pipClearDismissed?.() ?? true,
    pip_is_running: () => {
      if (typeof adapter.pipIsRunning !== "function") {
        throw notAuthorized("pip_is_running is unavailable in this ZCode build.");
      }
      return adapter.pipIsRunning();
    },
    scroll: async (params) => {
      const provenancePoint = extractPoint(params.point);
      if (provenancePoint) {
        params = await validateFrameProvenance(params, "scroll", [provenancePoint]);
      }
      refusePointerSequenceIfBusy("scroll");
      if (macBackgroundMode) {
        return (async () => {
          if (typeof adapter.scrollToWindow !== "function") {
            throw notAuthorized(
              "scroll: macOS background pointer ABI is unavailable; global fallback is disabled.",
            );
          }
          const point2 = extractPoint(params.point);
          if (!point2) throw permissionDenied("scroll requires point {x, y} as numbers.");
          const direction2 = typeof params.direction === "string" ? params.direction : "down";
          const amount2 = scrollAmountParam(params.amount);
          if (amount2 === 0) return appendResolvedAppRef(null, params);
          const target = await resolveMacBackgroundTarget(params, "scroll");
          refusePointerSequenceIfBusy("scroll");
          assertMacBackgroundInputSucceeded(
            await adapter.scrollToWindow(
              target.pid,
              target.bundleId,
              target.windowId,
              target.bounds,
              point2.x,
              point2.y,
              amount2,
              direction2,
              ...provenAttachedSurfaceArgs(target),
            ),
            "scroll",
          );
          return appendResolvedAppRef({ method: "window_event" }, params, target);
        })();
      }
      if (typeof adapter.scrollAt !== "function" || typeof adapter.moveTo !== "function") {
        throw notAuthorized("scroll is unavailable in this ZCode build.");
      }
      const point = extractPoint(params.point);
      if (!point) {
        throw permissionDenied("scroll requires point {x, y} as numbers.");
      }
      const direction = typeof params.direction === "string" ? params.direction : "down";
      const amount = scrollAmountParam(params.amount);
      if (amount === 0) return appendResolvedAppRef(null, params);
      assertGlobalInputAllowed(adapter, "scroll");
      if (platform2 === "win32") {
        return (async () => {
          await resolveWindowsPointerIdentity(axSource, params.app_ref, point, "scroll");
          refusePointerSequenceIfBusy("scroll");
          assertNativeInputSucceeded(adapter.moveTo(point.x, point.y), "scroll:move_to");
          await waitForCursorToSettle(adapter, point, "scroll:move_to");
          refusePointerSequenceIfBusy("scroll");
          assertNativeInputSucceeded(
            adapter.scrollAt(point.x, point.y, amount, direction),
            "scroll",
          );
          return appendResolvedAppRef(null, params);
        })();
      }
      if (!params.app_ref) {
        return (async () => {
          assertNativeInputSucceeded(adapter.moveTo(point.x, point.y), "scroll:move_to");
          await waitForCursorToSettle(adapter, point, "scroll:move_to");
          refusePointerSequenceIfBusy("scroll");
          assertNativeInputSucceeded(
            adapter.scrollAt(point.x, point.y, amount, direction),
            "scroll",
          );
          return appendResolvedAppRef(null, params);
        })();
      }
      return (async () => {
        const identity = await requirePointerAppPid(axSource, params.app_ref, "scroll");
        activateConcreteWindow(
          adapter,
          identity.pid,
          identity.bundleId,
          identity.windowId,
          "scroll",
        );
        await assertExpectedPidIsFrontmost(axSource, identity.pid, point, "scroll");
        assertNativeInputSucceeded(
          adapter.moveTo(point.x, point.y, identity.pid, identity.windowId ?? void 0),
          "scroll:move_to",
        );
        await waitForCursorToSettle(adapter, point, "scroll:move_to");
        refusePointerSequenceIfBusy("scroll");
        assertNativeInputSucceeded(
          adapter.scrollAt(
            point.x,
            point.y,
            amount,
            direction,
            identity.pid,
            identity.windowId ?? void 0,
          ),
          "scroll",
        );
        return appendResolvedAppRef(null, params);
      })();
    },
    drag: async (params) => {
      const provenanceStart = extractPoint(params.start);
      const provenanceEnd = extractPoint(params.end);
      if (provenanceStart && provenanceEnd) {
        params = await validateFrameProvenance(params, "drag", [provenanceStart, provenanceEnd]);
      }
      refusePointerSequenceIfBusy("drag");
      combinedDragInFlight = true;
      try {
        if (macBackgroundMode) {
          if (typeof adapter.dragToWindow !== "function") {
            throw notAuthorized(
              "drag: macOS background pointer ABI is unavailable; global fallback is disabled.",
            );
          }
          const start2 = extractPoint(params.start);
          const end2 = extractPoint(params.end);
          if (!start2 || !end2) {
            throw permissionDenied("drag requires start {x, y} and end {x, y} as numbers.");
          }
          const modifiers2 = modifiersChordParam(params.modifiers, "drag");
          const target = await resolveMacBackgroundTarget(params, "drag");
          assertMacBackgroundInputSucceeded(
            await adapter.dragToWindow(
              target.pid,
              target.bundleId,
              target.windowId,
              target.bounds,
              start2.x,
              start2.y,
              end2.x,
              end2.y,
              "left",
              modifiers2,
              ...provenAttachedSurfaceArgs(target),
            ),
            "drag",
          );
          return appendResolvedAppRef({ method: "window_event" }, params, target);
        }
        if (typeof adapter.drag !== "function") {
          throw notAuthorized("drag is unavailable in this ZCode build.");
        }
        if (typeof adapter.moveTo !== "function") {
          throw notAuthorized(
            "drag: the coordinate move primitive is unavailable in this ZCode build.",
          );
        }
        const start = extractPoint(params.start);
        const end = extractPoint(params.end);
        if (!start || !end) {
          throw permissionDenied("drag requires start {x, y} and end {x, y} as numbers.");
        }
        const modifiers = modifiersChordParam(params.modifiers, "drag");
        assertGlobalInputAllowed(adapter, "drag");
        if (platform2 === "win32") {
          await resolveWindowsPointerIdentity(axSource, params.app_ref, start, "drag");
          await withSyntheticModifiers(adapter, modifiers, "drag", async () => {
            assertNativeInputSucceeded(
              await adapter.drag(start.x, start.y, end.x, end.y, "left"),
              "drag",
            );
          });
          return appendResolvedAppRef(null, params);
        }
        const identity = params.app_ref
          ? await requirePointerAppPid(axSource, params.app_ref, "drag")
          : null;
        if (identity) {
          activateConcreteWindow(
            adapter,
            identity.pid,
            identity.bundleId,
            identity.windowId,
            "drag",
          );
          await assertExpectedPidIsFrontmost(axSource, identity.pid, start, "drag");
        }
        assertNativeInputSucceeded(
          adapter.moveTo(start.x, start.y, identity?.pid, identity?.windowId ?? void 0),
          "drag:move_to_start",
        );
        await waitForCursorToSettle(adapter, start, "drag:move_to_start");
        const dragResult = identity
          ? await adapter.drag(
              start.x,
              start.y,
              end.x,
              end.y,
              "left",
              modifiers,
              identity.pid,
              identity.windowId ?? void 0,
            )
          : await adapter.drag(start.x, start.y, end.x, end.y, "left", modifiers);
        assertNativeInputSucceeded(dragResult, "drag");
        return appendResolvedAppRef(null, params);
      } finally {
        combinedDragInFlight = false;
      }
    },
    type_text: (params) => {
      if (macBackgroundMode) refuseTargetlessMacGlobalInput("type_text");
      if (typeof adapter.typeTextGlobal !== "function") {
        throw notAuthorized("type_text is unavailable in this ZCode build.");
      }
      const text = syntheticTextParam(params.text, "type_text");
      if (!text) return null;
      assertGlobalInputAllowed(adapter, "type_text");
      assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text");
      return null;
    },
    press_key: async (params) => {
      if (macBackgroundMode) refuseTargetlessMacGlobalInput("press_key");
      if (typeof adapter.pressKeyGlobal !== "function") {
        throw notAuthorized("press_key is unavailable in this ZCode build.");
      }
      const text = keyChordParam(params.text, "press_key");
      const modifiers = modifiersChordParam(params.modifiers, "press_key");
      assertGlobalInputAllowed(adapter, "press_key");
      await withSyntheticModifiers(adapter, modifiers, "press_key", () => {
        assertNativeInputSucceeded(adapter.pressKeyGlobal(text), "press_key");
      });
      return null;
    },
    hold_key: async (params) => {
      if (macBackgroundMode) refuseTargetlessMacGlobalInput("hold_key");
      if (typeof adapter.holdKeyGlobal !== "function") {
        throw notAuthorized("hold_key is unavailable in this ZCode build.");
      }
      const text = keyChordParam(params.text, "hold_key");
      const sessionKey = sessionKeyParam(params.session_key);
      const modifiers = modifiersChordParam(params.modifiers, "hold_key");
      assertGlobalInputAllowed(adapter, "hold_key");
      await withSyntheticModifiers(adapter, modifiers, "hold_key", async () => {
        assertNativeInputSucceeded(
          await adapter.holdKeyGlobal(
            text,
            clampDurationSeconds(params.duration) * 1e3,
            sessionKey,
          ),
          "hold_key",
        );
      });
      return null;
    },
    cancel_input_holds: (params) => {
      if (typeof adapter.cancelInputHoldsForSession !== "function") {
        throw notAuthorized("cancel_input_holds is unavailable in this ZCode build.");
      }
      const sessionKey = sessionKeyParam(params.session_key);
      adapter.cancelInputHoldsForSession(sessionKey);
      adapter.hideVirtualPointer?.();
      return null;
    },
  };
}
