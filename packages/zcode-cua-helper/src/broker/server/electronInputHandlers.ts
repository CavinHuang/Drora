/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { parseAppFrameSurfaceSet } from "../../lib/app-frame-surfaces.js";
import { displayTopologyFingerprint } from "../../lib/display-topology.js";
// 还原自发行 bundle（官方 0.6.5 win32 entry :21534-21595）：投递轨迹封套与写后
// 读回裁决（W3 机械域）；win32 操作域上下文（validateElementProvenance 的
// presentationWindowId 读取）。
import {
  appendAttempt,
  finalizeDelivery,
  type DeliveryAttempt,
} from "./windowsDeliveryReceipt.js";
import { classifyInsertionReadback } from "./windowsValueReadback.js";
import { currentWindowsOperationContext } from "../../native/windows-operation-request.js";
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
    // 还原自官方 0.6.5 win32 entry :24375：优先 dispatchTarget.presentationAppRef
    //（rememberFrameTarget 记忆的 presentation 面），其次 params.presentation_app_ref
    //（element_provenance 改写时保真），最后原始 app_ref。
    supplied = appRefParam(dispatchTarget?.presentationAppRef ?? params.presentation_app_ref ?? params.app_ref);
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
    ...(actual && result?.dispatch_surface === void 0
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
      // R8/G2（还原自官方 SEA offset 85381190 区）：active pid 先去重——同一 pid 在
      // 快照里出现多行（多 surface 上报）时，旧版会被误判为"多个 active app"而拒绝。
      active = [...new Set(applications2.filter((app) => app.active === true).map((app) => app.pid))];
      if (active.length === 1 && active[0] === expectedPid) return;
      if (active.length > 0 || attempt === FRONTMOST_EMPTY_SNAPSHOT_ATTEMPTS - 1) {
        break;
      }
      await new Promise((resolve2) => setTimeout(resolve2, FRONTMOST_EMPTY_SNAPSHOT_RETRY_MS));
    }
    const observed = active.length === 1 ? `pid ${active[0]}` : `${active.length} active apps`;
    throw elementUnavailable(
      `${method}: raw foreground event for app_ref pid ${expectedPid} was refused because the live frontmost application is ${observed}. action_sent=false. Target an element instead so the action goes through accessibility on a background app, or retry once the intended window is in front.`,
      {
        action_sent: false,
        expected_pid: expectedPid,
        active_pids: active,
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
// R8/G5（还原自官方 SEA offset 85389303/85389381）：app-scoped 前台升级的激活拒绝
// 诊断。官方在 dispatchWindowsForegroundKeyed 的 pid 兜底分支用它替代静默失败：
// 缺 activateApplication ABI 与激活失败分别给出可辨识的拒绝文案（后者带
// reason=activation_failed，与 G2 活窗门禁同码族）。
function activateWindowsApplication(adapter, pid, expectedBundleId, method) {
  if (typeof adapter.activateApplication !== "function") {
    throw notAuthorized(
      `${method}: app-scoped input needs to bring pid ${pid} to the foreground, but native activation support is unavailable in this ZCode build. action_sent=false.`,
      { action_sent: false },
    );
  }
  if (!adapter.activateApplication(pid, expectedBundleId)) {
    throw permissionDenied(
      `${method}: target app (pid ${pid}) could not be brought to the foreground, so nothing was sent. action_sent=false. Target an element instead so the action goes through accessibility on a background app, or re-observe the app and retry.`,
      { action_sent: false, expected_pid: pid, reason: "activation_failed" },
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
// 清退（2026-11-10 R10 后续）：resolveWindowsPointerIdentity（move_to/mouse_down
// 的 win32 前置身份/前台校验包装）已随两方法删除——官方 0.6.5 win entry 零出现；
// 其底层 requirePointerAppPid/assertExpectedPidIsFrontmost 由存续的 click/scroll/
// drag 继续使用。
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
// =====================================================================================
// R8 输入守卫还原批（specs/cua-gap-remediation-2026-11-09.md 第五节 R8）。
// 以下 windows 输入派发基础设施逐字还原自官方 SEA（3.17.2，unminified JS payload
// offset 85180513 起）的 packages/zcode-cua/dist/broker/server/windowsInputDispatch.js
// 与 electronInputHandlers.js 区；逐件证据锚见各函数头注释。mac addon（136 导出面）
// 不含 hasActiveInputHolds/frameWindowContext/getForegroundRootWindowId 等 ABI 时，
// 对应守卫/恢复按官方同款可选链降级为 no-op，与官方 mac 行为一致。
// =====================================================================================
// 官方 SEA offset 85354464：windows 物理输入串行 lane（createWindowsPhysicalLane）。
// 所有 win32 前台升级派发（click/scroll/drag/type_text 系）共用同一条 promise 尾链，
// 防止两次前台升级交错互踩（前后台恢复窗口错乱）。
function createWindowsPhysicalLane() {
  let tail = Promise.resolve();
  let active = false;
  return {
    get busy() {
      return active;
    },
    run(action, body) {
      void action;
      const runOnce = async () => {
        active = true;
        try {
          return await body();
        } finally {
          active = false;
        }
      };
      const result = tail.then(runOnce, runOnce);
      tail = result.then(() => void 0, () => void 0);
      return result;
    },
  };
}
var windowsPhysicalLaneByAdapter = /* @__PURE__ */ new WeakMap();
// 官方 SEA offset 85404990：lane 未注册的 fail-closed 文案（adapter 未走
// createElectronInputHandlers 装配时拒绝输入，绝不静默跳过串行化）。
var windowsPhysicalLaneFor = (adapter) => {
  const lane = windowsPhysicalLaneByAdapter.get(adapter);
  if (!lane) {
    throw permissionDenied("windows input dispatch lane is not registered for this adapter; input refused.", {
      action_sent: false,
      reason: "input_dispatch_lane_unavailable",
    });
  }
  return lane;
};
// 官方 SEA offset 85405097：前台恢复 scope。快照升级前的前台根窗口，激活成功后
// 记录目标根窗口，收尾时把前台还给升级前的窗口。addon 缺
// getForegroundRootWindowId/restoreForegroundWindow ABI 时全程 no-op（官方 mac 同款）。
function foregroundRestoreScope(adapter) {
  let previousRoot = null;
  let targetRoot = 0;
  let beforeTaken = false;
  return {
    snapshotBefore() {
      if (typeof adapter.getForegroundRootWindowId !== "function") return;
      try {
        previousRoot = adapter.getForegroundRootWindowId();
        beforeTaken = true;
      } catch {}
    },
    snapshotAfterActivate() {
      if (!beforeTaken) return;
      if (typeof adapter.getForegroundRootWindowId !== "function") return;
      try {
        const now = adapter.getForegroundRootWindowId();
        if (typeof now === "number" && now > 0) targetRoot = now;
      } catch {}
    },
    restore() {
      if (!beforeTaken || targetRoot <= 0) return;
      if (typeof adapter.restoreForegroundWindow !== "function") return;
      try {
        adapter.restoreForegroundWindow(previousRoot, targetRoot);
      } catch {}
    },
  };
}
// R8/G2（还原自官方 SEA offset 85355323，四段门禁文案锚 85356277/85356605/85356992/
// 85357494）：win32 窗口级前台输入的活窗四段门禁。派发前按序校验：①窗口源可用
// （window_source_unavailable）②活窗身份可读（window_identity_unverified）③目标窗口
// 仍在活窗列表（window_gone）④未聚焦时显式激活并校验（activation_failed）。菜单/
// 宿主窗口段（menu_host_not_foreground）依赖 frameWindowContext ABI，mac 136 面无此
// 导出 → 可选链跳过，直接落四段门禁（官方 mac 同路径）。
// export 供单测直接驱动四段门禁（先例：helperMain 导出 resolveDisableCpsActivationFromArgv）。
export async function windowsForegroundWindowGate(options) {
  const { axSource, activateWindow, target, method } = options;
  const context = options.windowContext?.(target.windowId);
  if (context?.is_menu || context?.operation_foreground_host_window_id) {
    const identity =
      context.window_id === target.windowId &&
      context.pid === target.pid &&
      context.bundle_id.replaceAll("/", "\\").toLowerCase() ===
        target.bundleId.replaceAll("/", "\\").toLowerCase();
    const host = context.menu_foreground_host_window_id || context.operation_foreground_host_window_id;
    if (!identity || !context.visible || !context.enabled || !host) {
      throw elementUnavailable(`${method}: the menu's proven host is not foreground; re-observe before sending.`, {
        action_sent: false,
        reason: "menu_host_not_foreground",
      });
    }
    return { previousForegroundWindowId: host };
  }
  if (!axSource || typeof axSource.listWindows !== "function") {
    throw elementUnavailable(
      `${method}: window-scoped foreground input requires a live window source; action_sent=false. Re-observe the application and retry.`,
      { action_sent: false, reason: "window_source_unavailable" },
    );
  }
  const windows = await axSource.listWindows({ pid: target.pid });
  if (!Array.isArray(windows)) {
    throw elementUnavailable(
      `${method}: live window identity for pid ${target.pid} could not be read; action_sent=false. Re-observe the application and retry.`,
      { action_sent: false, reason: "window_identity_unverified" },
    );
  }
  const live = windows;
  const targetWindow = live.find((window) => window.window_id === target.windowId);
  if (!targetWindow) {
    throw elementUnavailable(
      `${method}: window ${target.windowId} of pid ${target.pid} is no longer in the live window list. action_sent=false. Re-observe from a fresh get_app_state.`,
      { action_sent: false, reason: "window_gone" },
    );
  }
  const previousFocused = live.find((window) => window.focused === true);
  const previousForegroundWindowId = previousFocused?.window_id ?? null;
  if (targetWindow.focused) {
    return { previousForegroundWindowId };
  }
  if (!activateWindow(target.pid, target.bundleId, target.windowId)) {
    throw permissionDenied(
      `${method}: target window ${target.windowId} could not be brought to the foreground, so nothing was sent. action_sent=false.`,
      { action_sent: false, reason: "activation_failed" },
    );
  }
  return { previousForegroundWindowId };
}
// R8/G6（还原自官方 SEA offset 85360793，uia_ 前缀文案族）：win32 前台升级点击的
// hit-test 并发指引。hit-test 结果非 invoked/miss（timeout/possibly_sent 等）时，
// 拒绝并告知"当前 job 落定后重试或重新观察"；action_sent 按 possibly 语义区分。
// W3 机械域（还原自官方 0.6.5 win32 entry :23979-24045）：postMessage 段补投递
// 轨迹——每步经 record2 回写 attempt（entry/capability_unavailable/threw/sent/
// refused/possibly_*），拒绝路径附 finalizeDelivery 封套；postMessageClickAsync
// ABI 缺失时按官方 capability_unavailable 语义记 not_sent 后回退前台派发。
async function postMessageLevel(native, target, record2) {
  record2({ path: "post_message", dispatch_status: "not_sent", reason: "entry" });
  if (!native.postMessageClickAsync) {
    record2({ path: "post_message", dispatch_status: "not_sent", reason: "capability_unavailable" });
    return { terminal: false };
  }
  let outcome;
  try {
    outcome = await native.postMessageClickAsync(
      target.windowId,
      target.pid,
      target.x,
      target.y,
      target.button,
      target.clicks,
    );
  } catch {
    const attempt = {
      path: "post_message",
      dispatch_status: "possibly_sent",
      reason: "threw",
    } as const;
    record2(attempt);
    throw elementUnavailable("delivery is unknown; re-observe before retrying.", {
      action_sent: true,
      delivery: finalizeDelivery(appendAttempt(null, attempt)) ?? void 0,
    });
  }
  if (outcome.ok && !outcome.error) {
    record2({ path: "post_message", dispatch_status: "sent" });
    return { terminal: true };
  }
  const error = outcome.error ?? "unknown";
  if (!["failed"].includes(error) && !error.startsWith("possibly")) {
    const unknown = error === "worker_failed" || error === "unknown";
    const attempt: DeliveryAttempt = {
      path: "post_message",
      dispatch_status: unknown ? "possibly_sent" : "not_sent",
      reason: error,
    };
    record2(attempt);
    throw elementUnavailable(
      `background delivery was refused: ${error}. action_sent=${unknown ? "possibly" : "false"}.`,
      {
        action_sent: unknown,
        reason: error,
        delivery: finalizeDelivery(appendAttempt(null, attempt)) ?? void 0,
      },
    );
  }
  if (error.startsWith("possibly")) {
    const attempt = {
      path: "post_message",
      dispatch_status: "possibly_sent",
      reason: error,
    } as const;
    record2(attempt);
    throw elementUnavailable(
      `${target.button} click possibly landed (${error}); do not replay. Re-observe before retrying.`,
      {
        action_sent: true,
        reason: error,
        delivery: finalizeDelivery(appendAttempt(null, attempt)) ?? void 0,
      },
    );
  }
  record2({ path: "post_message", dispatch_status: "not_sent", reason: error });
  return { terminal: false };
}
// 官方 SEA offset 85357729 / W3 机械域还原至官方 0.6.5 win32 entry :23828-23978
//（dispatchWindowsClick）：win32 点击的模式梯 + 投递轨迹封套。精确目标
//（pid+window_id+bundle）时按 前台升级 → hit-test → postMessage 的顺序尝试；
// forceForeground/modifiers 直走前台（reason=explicit_event/
// modifiers_require_send_input）。每步 attempt（path + dispatch_status + reason：
// background_gesture_unreachable/hit_test_entry/droppable_*/miss/uia_*）汇入
// delivery，返回 { result, delivery }；catch 内 BrokerError 且无已送尝试时补
// foreground possibly_sent（native_input_interrupted）并附封套重抛。
async function dispatchWindowsClick(native, request) {
  const { windowId, pid, x, y, button, clicks, modifiers, forceForeground, isChromiumHost, classify, dispatchForeground, method } = request;
  let delivery = null;
  try {
    const plainSingleLeftOrMiddle = (button === "left" || button === "middle") && clicks === 1 && !modifiers;
    if (forceForeground || modifiers) {
      delivery = appendAttempt(delivery, {
        path: "foreground_send_input",
        dispatch_status: "not_sent",
        reason: forceForeground ? "explicit_event" : "modifiers_require_send_input",
      });
      await dispatchForeground();
      delivery = appendAttempt(delivery, {
        path: "foreground_send_input",
        dispatch_status: "sent",
      });
      return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
    }
    const host = classify(windowId, "mouse_click").host;
    if (
      (host === "winui3_exempt" && (button !== "left" || clicks > 1)) ||
      (host === "embedded_chromium_wpf" && button === "right")
    ) {
      delivery = appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "not_sent",
        reason: "background_gesture_unreachable",
      });
      await dispatchForeground();
      delivery = appendAttempt(delivery, {
        path: "foreground_send_input",
        dispatch_status: "sent",
      });
      return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
    }
    if (isChromiumHost && button === "left" && clicks === 1) {
      const posted2 = await postMessageLevel(native, { windowId, pid, x, y, button, clicks }, (attempt) => {
        delivery = appendAttempt(delivery, attempt);
      });
      if (posted2.terminal) {
        return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
      }
      await dispatchForeground();
      delivery = appendAttempt(delivery, {
        path: "foreground_send_input",
        dispatch_status: "sent",
      });
      return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
    }
    if (plainSingleLeftOrMiddle && native.hitTestInvokeAtPointAsync) {
      delivery = appendAttempt(delivery, {
        path: "ax",
        dispatch_status: "not_sent",
        reason: "hit_test_entry",
      });
      let hit;
      try {
        hit = await native.hitTestInvokeAtPointAsync(windowId, pid, x, y);
      } catch {
        hit = { ok: false, result: "possibly_sent" };
      }
      if (hit.result === "invoked") {
        delivery = appendAttempt(delivery, { path: "ax", dispatch_status: "sent" });
        return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
      }
      if (hit.result === "miss") {
        delivery = appendAttempt(delivery, {
          path: "ax",
          dispatch_status: "not_sent",
          reason: "miss",
        });
      } else {
        delivery = appendAttempt(delivery, {
          path: "ax",
          dispatch_status: ["timeout", "possibly_sent"].includes(hit.result) ? "possibly_sent" : "not_sent",
          reason: hit.result,
        });
        throw elementUnavailable(
          `${method}: the accessibility hit-test could not complete (${hit.result}); action_sent=${["timeout", "possibly_sent"].includes(hit.result) ? "possibly" : "false"}. Retry after the current job settles or re-observe the target.`,
          {
            action_sent: ["timeout", "possibly_sent"].includes(hit.result),
            delivery: finalizeDelivery(delivery) ?? void 0,
            reason: `uia_${hit.result}`,
          },
        );
      }
    }
    const matrix = classify(windowId, "mouse_click");
    if (matrix.delivery === "dropped") {
      delivery = appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "not_sent",
        reason: `droppable_${matrix.host}`,
      });
      await dispatchForeground();
      delivery = appendAttempt(delivery, {
        path: "foreground_send_input",
        dispatch_status: "sent",
      });
      return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
    }
    const posted = await postMessageLevel(native, { windowId, pid, x, y, button, clicks }, (attempt) => {
      delivery = appendAttempt(delivery, attempt);
    });
    if (posted.terminal) {
      return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
    }
    await dispatchForeground();
    delivery = appendAttempt(delivery, {
      path: "foreground_send_input",
      dispatch_status: "sent",
    });
    return { result: { method: "click" }, delivery: finalizeDelivery(delivery) };
  } catch (error) {
    if (error instanceof BrokerError) {
      if (error.details.action_sent !== false && !delivery?.attempts.some((attempt) => attempt.dispatch_status !== "not_sent")) {
        delivery = appendAttempt(delivery, {
          path: "foreground_send_input",
          dispatch_status: "possibly_sent",
          reason: "native_input_interrupted",
        });
      }
      throw new BrokerError(error.code, error.message, {
        ...error.details,
        delivery: finalizeDelivery(delivery),
      });
    }
    throw error;
  }
}
// =====================================================================================
// W3 机械域还原批（官方 0.6.5 win32 entry :25127-25576，windowsInputDispatch.ts 区）：
// win32 后台投递族四件——元素文本插入（postMessageCharAsync）、后台键（postMessageKeyAsync
// + XAML 加速器 invokeAcceleratorAsync）、后台滚动（postMessageScrollAsync）、后台拖拽
//（postMessageDragAsync）。全部 additive ABI 探测：任一原语/classify 缺导出时返回 null，
// 调用方回退前台派发（与官方旧 addon 降级一致）；classify 三态（false/非对象=不可分类
// →null 退前台；delivery=dropped / host=winui3_exempt 等按矩阵记 not_sent 后退前台）。
// 拒绝路径一律附 finalizeDelivery 封套（delivery_unknown 族 reason + action_sent
// possibly 语义），防止调用方盲目重放。
// =====================================================================================
// 官方 :25127-25255（dispatchWindowsElementInsertion）：element_native 后台插入。
// 读回链（registry + winAxElementFromToken/Release + elementValueReadAsync 齐备时）
// 先读 before 值，插入成功后读 after 值，classifyInsertionReadback 裁决
//（changed_contains/unchanged/unreadable）写入 readback 字段。
async function dispatchWindowsElementInsertion(options) {
  const { adapter, axSource, registry: registry2, elementNative, text, pid, windowId, method } = options;
  const postChar = adapter.postMessageCharAsync;
  const classify = adapter.classifyPostMessageDelivery;
  const fromToken = axSource?.winAxElementFromToken?.bind(axSource);
  const releaseRef = axSource?.winAxElementRelease?.bind(axSource);
  const valueRead = axSource?.elementValueReadAsync?.bind(axSource);
  const elementWindowId = axSource?.elementWindowId?.bind(axSource);
  if (!postChar || !classify || !windowId) {
    return null;
  }
  let beforeValue = null;
  let heldRef = null;
  let readHandle = null;
  if (registry2 && fromToken && releaseRef && valueRead) {
    const ref = registry2.refFor(elementNative);
    if (ref) {
      const token = fromToken(ref);
      if (token.ok) {
        heldRef = token.element;
        try {
          const hostWindowId = (await elementWindowId?.(ref)) ?? windowId;
          const before = await valueRead(token.element, hostWindowId);
          beforeValue = before.ok ? before.value : null;
          readHandle = token.element;
        } catch {
          releaseRef(token.element);
          heldRef = null;
        }
      }
    }
  }
  const readElementAfter = async () => {
    if (!readHandle || !valueRead || heldRef === null) return null;
    try {
      const after = await valueRead(heldRef, windowId);
      return after.ok ? after.value : null;
    } catch {
      return null;
    }
  };
  const releaseHeld = () => {
    if (heldRef !== null && releaseRef) releaseRef(heldRef);
  };
  let delivery = null;
  try {
    const matrix = classify(windowId, "text_input");
    if (matrix === false || typeof matrix !== "object") {
      return null;
    }
    if (matrix.delivery === "dropped") {
      return appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "not_sent",
        reason: `droppable_${matrix.host}`,
      });
    }
    if (matrix.host === "winui3_exempt") {
      return appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "not_sent",
        reason: "droppable_xaml_input",
      });
    }
    const elementRefForHost =
      registry2 && (readHandle !== null || heldRef !== null) ? (registry2.refFor(elementNative) ?? null) : null;
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: "entry",
    });
    let outcome;
    try {
      outcome = await postChar(windowId, pid, text, elementRefForHost ?? void 0);
    } catch {
      delivery = appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "possibly_sent",
        reason: "threw",
      });
      throw elementUnavailable(`${method}: background insertion delivery is unknown; re-observe before retrying.`, {
        action_sent: true,
        reason: "delivery_unknown",
        delivery: finalizeDelivery(delivery) ?? void 0,
      });
    }
    if (!outcome.ok) {
      const error = outcome.error ?? "unknown";
      if (error.startsWith("possibly")) {
        delivery = appendAttempt(delivery, {
          path: "post_message",
          dispatch_status: "possibly_sent",
          reason: error,
        });
        throw elementUnavailable(`${method}: background insertion possibly landed; do not replay. Re-observe.`, {
          action_sent: true,
          reason: error,
          delivery: finalizeDelivery(delivery) ?? void 0,
        });
      }
      delivery = appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "not_sent",
        reason: error,
      });
      return delivery;
    }
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "sent",
    });
    const afterValue = await readElementAfter();
    const verdict = classifyInsertionReadback(beforeValue, afterValue, text);
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "sent",
      reason: `readback_${verdict.verify}`,
    });
    const finalized = finalizeDelivery(delivery);
    finalized.effect = verdict.effect;
    finalized.readback = { verify: verdict.verify };
    return finalized;
  } finally {
    releaseHeld();
  }
}
// 官方 :25267-25415（dispatchWindowsBackgroundKeyed）：后台键梯。host=winui3_exempt
//（XAML）时先试 invokeAcceleratorAsync（accelerator_missed/accelerator_timeout 族
// 轨迹；invoked 即终态）；组合键（key_combo）在非 XAML 宿主不可达
//（chord_key_state_unreachable——postMessage 无法维持和弦键状态）；矩阵 dropped
// 记 droppable_* 后退前台。
async function dispatchWindowsBackgroundKeyed(options) {
  const { adapter, axSource, chord, pid, windowId, method } = options;
  const postKey = adapter.postMessageKeyAsync;
  const invokeAccel = adapter.invokeAcceleratorAsync;
  const classify = adapter.classifyPostMessageDelivery;
  if (!postKey || !classify || !windowId || !axSource) {
    return null;
  }
  const tokens = chord.split("+").map((t) => t.trim().toLowerCase());
  const isCombo = tokens.length > 1;
  let delivery = null;
  const matrix = classify(windowId, isCombo ? "key_combo" : "keystroke");
  if (matrix === false || typeof matrix !== "object") {
    return null;
  }
  if (matrix.host === "winui3_exempt") {
    if (invokeAccel) {
      delivery = appendAttempt(delivery, {
        path: "ax",
        dispatch_status: "not_sent",
        reason: "xaml_accelerator_entry",
      });
      let accel;
      try {
        accel = await invokeAccel(windowId, pid, chord);
      } catch {
        delivery = appendAttempt(delivery, {
          path: "ax",
          dispatch_status: "possibly_sent",
          reason: "threw",
        });
        throw elementUnavailable(`${method}: XAML accelerator delivery is unknown; re-observe before retrying.`, {
          action_sent: true,
          reason: "delivery_unknown",
          delivery: finalizeDelivery(delivery) ?? void 0,
        });
      }
      if (accel.result === "invoked") {
        return finalizeDelivery(
          appendAttempt(delivery, {
            path: "ax",
            dispatch_status: "sent",
            reason: "accelerator:invoked",
          }),
        );
      }
      if (accel.result === "possibly_sent" || accel.result === "timeout") {
        delivery = appendAttempt(delivery, {
          path: "ax",
          dispatch_status: "possibly_sent",
          reason: `accelerator:${accel.result}`,
        });
        throw elementUnavailable(
          `${method}: the matched accelerator invocation did not complete; do not replay. Re-observe.`,
          {
            action_sent: true,
            reason: `accelerator_${accel.result}`,
            delivery: finalizeDelivery(delivery) ?? void 0,
          },
        );
      }
      if (accel.result === "miss") {
        delivery = appendAttempt(delivery, {
          path: "ax",
          dispatch_status: "not_sent",
          reason: "accelerator_missed",
        });
      } else {
        delivery = appendAttempt(delivery, {
          path: "ax",
          dispatch_status: "not_sent",
          reason: `accelerator_${accel.result}`,
        });
      }
    }
    return appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: "droppable_xaml_input",
    });
  }
  if (isCombo) {
    return appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: "chord_key_state_unreachable",
    });
  }
  if (matrix.delivery === "dropped") {
    return appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: `droppable_${matrix.host}`,
    });
  }
  delivery = appendAttempt(delivery, {
    path: "post_message",
    dispatch_status: "not_sent",
    reason: "entry",
  });
  let outcome;
  try {
    outcome = await postKey(windowId, pid, chord);
  } catch {
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "possibly_sent",
      reason: "threw",
    });
    throw elementUnavailable(`${method}: background key delivery is unknown; re-observe before retrying.`, {
      action_sent: true,
      reason: "delivery_unknown",
      delivery: finalizeDelivery(delivery) ?? void 0,
    });
  }
  if (!outcome.ok) {
    const error = outcome.error ?? "unknown";
    if (error.startsWith("possibly")) {
      delivery = appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "possibly_sent",
        reason: error,
      });
      throw elementUnavailable(`${method}: background key delivery possibly landed; do not replay. Re-observe.`, {
        action_sent: true,
        reason: error,
        delivery: finalizeDelivery(delivery) ?? void 0,
      });
    }
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: error,
    });
    return delivery;
  }
  return finalizeDelivery(
    appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "sent",
    }),
  );
}
// 官方 :25416-25495（dispatchWindowsBackgroundScroll）：后台滚动。仅 wpf/
// winui3_exempt 宿主可达（其余 scroll_unreachable_<host> 记 not_sent 后退前台）。
async function dispatchWindowsBackgroundScroll(options) {
  const { adapter, pid, windowId, direction, amount, method } = options;
  const postScroll = adapter.postMessageScrollAsync;
  const classify = adapter.classifyPostMessageDelivery;
  if (!postScroll || !classify || !windowId) {
    return null;
  }
  let delivery = null;
  const matrix = classify(windowId, "mouse_scroll");
  if (matrix === false || typeof matrix !== "object") {
    return null;
  }
  if (matrix.host === "wpf" || matrix.host === "winui3_exempt") {
    // 可达，落入 postMessage 段。
  } else {
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: `scroll_unreachable_${matrix.host}`,
    });
    return delivery;
  }
  delivery = appendAttempt(delivery, {
    path: "post_message",
    dispatch_status: "not_sent",
    reason: "entry",
  });
  let outcome;
  try {
    outcome = await postScroll(windowId, pid, direction, amount);
  } catch {
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "possibly_sent",
      reason: "threw",
    });
    throw elementUnavailable(`${method}: background scroll delivery is unknown; re-observe before retrying.`, {
      action_sent: true,
      reason: "delivery_unknown",
      delivery: finalizeDelivery(delivery) ?? void 0,
    });
  }
  if (!outcome.ok) {
    const error = outcome.error ?? "unknown";
    if (error.startsWith("possibly")) {
      delivery = appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "possibly_sent",
        reason: error,
      });
      throw elementUnavailable(`${method}: background scroll possibly landed; do not replay. Re-observe.`, {
        action_sent: true,
        reason: error,
        delivery: finalizeDelivery(delivery) ?? void 0,
      });
    }
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: error,
    });
    return delivery;
  }
  return finalizeDelivery(
    appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "sent",
    }),
  );
}
// 官方 :25496-25576（dispatchWindowsBackgroundDrag）：后台拖拽。dropped 或
// winui3_exempt/wpf/vcl 宿主记 droppable_* 后退前台（mouse_move 矩阵）。
async function dispatchWindowsBackgroundDrag(options) {
  const { adapter, pid, windowId, start, end, method } = options;
  const postDrag = adapter.postMessageDragAsync;
  const classify = adapter.classifyPostMessageDelivery;
  if (!postDrag || !classify || !windowId) {
    return null;
  }
  let delivery = null;
  const matrix = classify(windowId, "mouse_move");
  if (matrix === false || typeof matrix !== "object") {
    return null;
  }
  if (matrix.delivery === "dropped" || matrix.host === "winui3_exempt" || matrix.host === "wpf" || matrix.host === "vcl") {
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: `droppable_${matrix.host}`,
    });
    return delivery;
  }
  delivery = appendAttempt(delivery, {
    path: "post_message",
    dispatch_status: "not_sent",
    reason: "entry",
  });
  let outcome;
  try {
    outcome = await postDrag(windowId, pid, start.x, start.y, end.x, end.y);
  } catch {
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "possibly_sent",
      reason: "threw",
    });
    throw elementUnavailable(`${method}: background drag delivery is unknown; re-observe before retrying.`, {
      action_sent: true,
      reason: "delivery_unknown",
      delivery: finalizeDelivery(delivery) ?? void 0,
    });
  }
  if (!outcome.ok) {
    const error = outcome.error ?? "unknown";
    if (error.startsWith("possibly")) {
      delivery = appendAttempt(delivery, {
        path: "post_message",
        dispatch_status: "possibly_sent",
        reason: error,
      });
      throw elementUnavailable(`${method}: background drag possibly landed; do not replay. Re-observe.`, {
        action_sent: true,
        reason: error,
        delivery: finalizeDelivery(delivery) ?? void 0,
      });
    }
    delivery = appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "not_sent",
      reason: error,
    });
    return delivery;
  }
  return finalizeDelivery(
    appendAttempt(delivery, {
      path: "post_message",
      dispatch_status: "sent",
    }),
  );
}
// R8/G1+G3（还原自官方 SEA offset 85405947 dispatchWindowsForegroundKeyed）：
// win32 前台升级键盘派发守卫链。相对旧版（仅 assert frontmost + allow + dispatch）补齐：
// ①串行 lane（防两次前台升级交错）②application_source_unavailable 预检 ③窗口级
// 目标走 G2 活窗四段门禁，pid 级目标走 targetIsFrontmost→激活 ④G3 key-hold 防误路由
// （hold 未释放时拒绝切前台，窗口/pid 两变体）⑤G1 收尾排水 max(120, drainHintMs)ms
// 上限 3000ms——注入成功后等排水再恢复前台；未注入立即恢复。
async function dispatchWindowsForegroundKeyed(
  axSource,
  adapter,
  method,
  target,
  dispatch,
  // 官方 JS 形参 laneHold/drainHintMs 无默认值（调用方传 void 0）；TS 侧按可选
  // 落默认值，语义不变（null/undefined 都走 windowsPhysicalLaneFor 与 120ms 底）。
  laneHold = null,
  drainHintMs = void 0,
  restoreAfterInjection = true,
) {
  const run = (body) => (laneHold ? laneHold.run(body) : windowsPhysicalLaneFor(adapter).run(method, body));
  await run(async () => {
    const restore = foregroundRestoreScope(adapter);
    restore.snapshotBefore();
    let settled = false;
    try {
      assertGlobalInputAllowed(adapter, method);
      if (!axSource) {
        throw elementUnavailable(
          `${method}: raw foreground event for app_ref pid ${target.pid} was refused because no live application source is available. action_sent=false.`,
          {
            action_sent: false,
            expected_pid: target.pid,
            method,
            reason: "application_source_unavailable",
          },
        );
      }
      const hasWindowLevelSource = typeof axSource.listWindows === "function";
      if (target.windowId !== void 0 && target.windowId !== null && hasWindowLevelSource) {
        await windowsForegroundWindowGate({
          axSource,
          windowContext: adapter.frameWindowContext?.bind(adapter),
          activateWindow: (pid, bundleId, windowId) => {
            // G3 key-hold 防误路由（文案锚 85407196/85407343）：有 key hold 未释放时
            // 切前台会把按键路由到新前台应用，拒绝并要求等 hold 收尾。
            if (adapter.hasActiveInputHolds?.()) {
              throw permissionDenied(
                `${method}: refused to bring window ${windowId} of pid ${pid} to the foreground because another key hold is still active \u2014 switching foreground now would misroute the held keys. action_sent=false. Wait for the hold to finish and retry.`,
                { action_sent: false, reason: "input_hold_active", expected_pid: pid },
              );
            }
            activateConcreteWindow(adapter, pid, bundleId, windowId, method);
            return true;
          },
          target: {
            pid: target.pid,
            bundleId: target.bundleId,
            windowId: target.windowId,
          },
          method,
        });
      } else {
        if (!(await targetIsFrontmost(axSource, target.pid))) {
          // G3 pid 级变体（文案锚 85407343 区）：同 window 级语义。
          if (adapter.hasActiveInputHolds?.()) {
            throw permissionDenied(
              `${method}: refused to bring pid ${target.pid} to the foreground because another key hold is still active \u2014 switching foreground now would misroute the held keys. action_sent=false. Wait for the hold to finish and retry.`,
              { action_sent: false, reason: "input_hold_active", expected_pid: target.pid },
            );
          }
          if (target.windowId !== void 0 && target.windowId !== null) {
            activateConcreteWindow(adapter, target.pid, target.bundleId, target.windowId, method);
          } else {
            activateWindowsApplication(adapter, target.pid, target.bundleId, method);
          }
        }
      }
      await assertExpectedPidIsFrontmost(axSource, target.pid, null, method);
      restore.snapshotAfterActivate();
      let injected = false;
      const drainScope = async () => {
        // G1 文本链排水（官方注释锚 85454076-85454109）：max(120, drainHintMs)ms，
        // 上限 3000ms。固定 120ms 对长 CJK 串不足（官方实测泵速 ≈17ms/字）。
        const scaled = typeof drainHintMs === "number" && drainHintMs > 120 ? drainHintMs : 120;
        const drainMs = Math.min(scaled, 3e3);
        await new Promise((resolve2) => setTimeout(resolve2, drainMs));
        if (restoreAfterInjection) restore.restore();
      };
      try {
        await dispatch(() => {
          injected = true;
        });
      } finally {
        if (injected) {
          await drainScope();
        } else {
          restore.restore();
        }
        settled = true;
      }
    } finally {
      if (!settled) restore.restore();
    }
  });
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
// 清退（2026-11-10 R10 后续）：pointerSessionKeyParam / isMacBackgroundMouseDownOutcome /
// assertMacBackgroundMouseDownSucceeded 已随 mouse_down/mouse_up 方法删除——三者
// 在官方 0.6.5 win entry 零出现（分离按下语义整条不在 43 表构建里）。
export function createElectronInputHandlers(options) {
  const { adapter, axSource } = options;
  const platform2 = options.platform ?? process.platform;
  const macBackgroundMode = platform2 === "darwin" && adapter.macBackgroundInputRequired === true;
  // 清退（2026-11-10 R10 后续）：指针序列所有权三态中的 buttonHolder（已持有按下
  // 键的会话）、splitDownInFlight（mouse_down 进行中）、backgroundButtonHold（后台
  // 按下目标/点位）随 mouse_down/mouse_up 删除——官方 0.6.5 win entry :26041-26052
  // 的终清与指针门禁只剩 combinedDragInFlight 单态。combinedDragInFlight 保留
  //（合成 drag 在 43 表内存续）。
  let combinedDragInFlight = false;
  const validatedFrameTargetByParams = /* @__PURE__ */ new WeakMap();
  // 还原自发行 bundle（官方 0.6.5 win32 entry :25599-25604）：帧目标记忆——同一
  // 事实（target + presentation_app_ref）同时挂在派发 params 与原始入参 params 上
  //（validateFrameProvenance/validateElementProvenance 链上两次改写 params 时，
  // 消费端按任一对象都能取回）。
  const rememberFrameTarget = (input2, params, target) => {
    const fact = { ...target, presentationAppRef: params.presentation_app_ref };
    validatedFrameTargetByParams.set(params, fact);
    validatedFrameTargetByParams.set(input2, fact);
  };
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
  // 还原自发行 bundle（官方 0.6.5 win32 entry :25955-26040，validateElementProvenance）：
  // win32 element_provenance 二次校验。逐记录核：token 可解析（registry.refFor）→
  // 元素仍活（readElement）→ 宿主窗一致（elementWindowId/elementDispatchWindowId +
  // frameWindowContext 的 pid/tid/bundle/visible/non-minimized）→ 归属 pid 未变 →
  // bounds 与记录一致且包含目标点（element_geometry_changed）。失败码：
  // invalid_element_provenance（形状）/element_surface_replaced（身份偷换）/
  // element_geometry_changed（几何漂移）/element_surface_unavailable（宿主事实缺）/
  // pointer_receiver_mismatch（多端点接收窗漂移）。通过后把 params 改写为已证实的
  // 精确目标（expected_pid/bundle/window_id + app_ref），并经 rememberFrameTarget 记
  // 忆供 appendResolvedAppRef 的 dispatch_surface 消费。win32 之外或无
  // element_provenance 时原样返回。
  const validateElementProvenance = async (input2, method, points, original = input2) => {
    if (platform2 !== "win32" || input2.element_provenance === void 0) return input2;
    const fail = (reason, facts = {}) => {
      throw elementUnavailable(`${method}: native element ${reason}; observe again. action_sent=false.`, {
        action_sent: false,
        reason,
        ...facts,
      });
    };
    const records = input2.element_provenance;
    if (!Array.isArray(records) || records.length === 0 || records.length > points.length)
      fail("invalid_element_provenance");
    const params = { ...input2 };
    let recipient = validatedFrameTargetByParams.get(input2);
    const registry2 = options.windowsElementReadback?.registry;
    const seen = /* @__PURE__ */ new Set();
    for (const record2 of records) {
      if (!record2 || typeof record2 !== "object" || Array.isArray(record2)) fail("invalid_element_provenance");
      const index = record2.endpoint_index;
      if (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        seen.has(index) ||
        !points[index] ||
        typeof record2.native !== "string" ||
        !Array.isArray(record2.bounds) ||
        record2.bounds.length !== 4 ||
        !record2.bounds.every(Number.isFinite)
      )
        fail("invalid_element_provenance");
      const endpoint = index;
      seen.add(endpoint);
      const ref = registry2?.refFor(record2.native);
      const live = ref ? await axSource?.readElement(ref) : null;
      const host = ref ? await axSource?.elementWindowId?.(ref) : null;
      const windowId = ref ? await (axSource?.elementDispatchWindowId ?? axSource?.elementWindowId)?.call(axSource, ref) : null;
      const facts = host ? adapter.frameWindowContext?.(host) : null;
      const owner = ref ? registry2?.ownerPidForRef(ref) : void 0;
      const identityFacts = {
        element_token_valid: !!ref,
        element_live_found: !!live,
        captured_owner_pid: owner,
        live_owner_pid: live?.ownerPid,
        element_host_window_id: host,
        element_dispatch_window_id: windowId,
        element_host_context: facts,
      };
      if (
        !ref ||
        !live ||
        !facts ||
        !owner ||
        !windowId ||
        ((facts.pid !== owner && windowId === host) || facts.window_id !== host || !facts.visible || facts.minimized || !facts.bundle_id)
      )
        fail("element_surface_replaced", identityFacts);
      if (live.ownerPid != null && live.ownerPid !== owner) fail("element_surface_replaced", identityFacts);
      if (!sameFrameBounds(live.bounds, record2.bounds) || !windowContainsPoint2(live.bounds, points[endpoint]))
        fail("element_geometry_changed");
      if (facts.bounds.length !== 4 || !facts.bounds.every(Number.isFinite)) fail("element_surface_unavailable");
      const target = {
        pid: facts.pid,
        bundleId: facts.bundle_id,
        windowId: facts.window_id,
        bounds: facts.bounds,
        // C4（2026-10-26）：presentation 回退链去掉「宿主自身」兜底——旁路直连
        //（无 session context）时 presentation 退化为 actual 会丢失逻辑应用身份
        //（§3.3）。产品主链 broker-client 对每个 win32 action 注入 context 不受
        // 影响；此处缺 context 直接不设 presentationWindowId，由消费端按无值处理
        //（不虚构身份），不再把 actual 伪装成 presentation。
        presentationWindowId:
          currentWindowsOperationContext()?.presentation_window_id ?? currentWindowsOperationContext()?.root_window_id,
        // C1（2026-10-26）：kind 优先级对齐 native 帧枚举（链① GW_OWNER 命中即
        // owned_popup，ax_win.cc EnumerateSurfacesForFrame）；此前 is_menu 先判，
        // 同一「有 owner 的菜单」在 frame 记录与回执里 kind 分叉。
        surfaceKind: facts.owner_window_id ? "owned_popup" : facts.is_menu ? "menu_popup" : "window",
      };
      if (
        recipient &&
        (recipient.pid !== target.pid ||
          recipient.windowId !== target.windowId ||
          !cuaBundleIdsEqual(recipient.bundleId, target.bundleId) ||
          !sameFrameBounds(recipient.bounds, target.bounds))
      )
        fail("pointer_receiver_mismatch");
      recipient = target;
    }
    if (!recipient) fail("element_surface_unavailable");
    params.presentation_app_ref ??= params.app_ref;
    params.app_ref = {
      pid: recipient.pid,
      bundle_id: recipient.bundleId,
      window_id: recipient.windowId,
    };
    params.expected_pid = recipient.pid;
    params.expected_bundle_id = recipient.bundleId;
    params.expected_window_id = recipient.windowId;
    rememberFrameTarget(original, params, recipient);
    if (original !== input2) rememberFrameTarget(input2, params, recipient);
    return params;
  };
  const resolveMacBackgroundTarget = (params, method) => {
    const validated = validatedFrameTargetByParams.get(params);
    return validated
      ? Promise.resolve(validated)
      : requireMacBackgroundWindowTarget(axSource, params.app_ref, method);
  };
  pointerSequenceGateByAdapter.set(adapter, (action) => refusePointerSequenceIfBusy(action));
  // R8（官方 SEA offset 85406231 区）：win32 物理输入串行 lane 注册。所有 win32
  // 前台升级派发（dispatchWindowsForegroundKeyed/click/scroll/drag/type_text 系）经
  // windowsPhysicalLaneFor 取同一条 lane；未注册时 fail-closed（见该函数注释）。
  const windowsInputDispatchLease = createWindowsPhysicalLane();
  windowsPhysicalLaneByAdapter.set(adapter, windowsInputDispatchLease);
  // 还原自发行 bundle（官方 0.6.5 win32 entry :26055-26066）：独立 surface 的物理
  // 输入门禁。操作域 context 标记 independent_root 时，物理输入的目标窗必须是已证
  // 明 operation association 的候选窗或根窗，否则拒绝
  //（independent_surface_requires_association，fail-closed 不猜归属）。
  const assertWindowsPhysicalAssociation = (windowId) => {
    const context = currentWindowsOperationContext();
    if (!context?.independent_root) return;
    const proofs = context.associations ?? [];
    if (
      windowId !== void 0 &&
      proofs.some((proof) => proof.candidate.window_id === windowId || proof.root.window_id === windowId)
    )
      return;
    throw elementUnavailable(
      "Independent Windows surfaces require operation association before physical input. action_sent=false.",
      { action_sent: false, reason: "independent_surface_requires_association" },
    );
  };
  // 清退（2026-11-10 R10 后续，官方 0.6.5 win32 entry :26041-26052 逐字）：
  // 分离按下语义（mouse_down/mouse_up）不在 43 表构建里，终清不再有「持有按钮
  // 先补发 mouse_up 再清所有权」的链，只剩合成 drag 在飞判定；指针门禁同样
  // 只剩 combinedDragInFlight 单态（拒绝文案 "Wait for drag completion or
  // stop_computer_control." 为官方原文）。requirePointerMoveOwnership/
  // refuseCombinedDragIfBusy/claimSplitDown/releaseSplitDownClaim 随
  // move_to/mouse_down/mouse_up 一并退役（官方零出现）。
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
  // 官方 0.6.5 win32 entry :26614（createElectronInputHandlers）：handlers 先落
  // 局部变量，win32 后置包装（文件尾）改写后再 return。
  const handlers = {
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
        // R8/G1（还原自官方 SEA offset 85451500-85455200 区，文案锚 85452514/
        // 85453452/85453721/85454109）：win32 前台文本注入守卫链——焦点预检 +
        // typeTextGlobalAsync 截断双语义 + 收尾排水。
        // W3（还原至官方 0.6.5 win32 entry :26158-26273 完整形态）：element_native
        // 存在时先走 dispatchWindowsElementInsertion（元素级后台插入 + 写后读回
        // changed_contains/unchanged/unreadable 裁决）；插入尝试非全 not_sent 即
        // window_event 终态；焦点预检仅在 insertionDelivery 非空时取 ref（官方
        // :26188 同款），element_focus_unavailable 拒绝附 finalizeDelivery 封套；
        // 前台注入成功后把 foreground_send_input sent attempt 并入 insertionDelivery
        // 封套返回（foreground_event）。
        const elementNative =
          typeof params.element_native === "string" && params.element_native
            ? params.element_native
            : null;
        let insertionDelivery = null;
        if (elementNative) {
          insertionDelivery = await dispatchWindowsElementInsertion({
            adapter,
            axSource,
            registry: options.windowsElementReadback?.registry,
            elementNative,
            text,
            pid: target.pid,
            windowId: target.windowId,
            method: "type_text_to_app",
          });
        }
        if (insertionDelivery?.attempts.some((a) => a.dispatch_status !== "not_sent")) {
          return {
            method: "window_event",
            delivery: insertionDelivery,
          };
        }
        const focusRefForInsertion =
          elementNative && insertionDelivery
            ? (options.windowsElementReadback?.registry?.refFor(elementNative) ?? null)
            : null;
        await dispatchWindowsForegroundKeyed(
          axSource,
          adapter,
          "type_text_to_app",
          target,
          async (markInjected) => {
            // 焦点预检（element_focus_unavailable/@85452514）：已知目标元素 ref 时，
            // 前台注入前确认元素确实拿到键盘焦点，否则拒绝（text 可能落到别处）。
            if (focusRefForInsertion && axSource?.elementFocus) {
              const focused = await axSource.elementFocus(focusRefForInsertion);
              const focusOk =
                focused === true ||
                (typeof focused === "object" && focused !== null && "ok" in focused && focused.ok === true);
              if (!focusOk) {
                throw elementUnavailable(
                  "type_text_to_app: refused to send text because the target element could not take keyboard focus; re-observe before retrying.",
                  {
                    action_sent: false,
                    reason: "element_focus_unavailable",
                    delivery: finalizeDelivery(insertionDelivery) ?? void 0,
                  },
                );
              }
            }
            // 截断双语义：typeTextGlobalAsync 可用则用异步原语——部分落地
            //（text_truncated/@85453452，前缀可能已落地，勿重放）与零落地
            //（text_injection_failed/@85453721，可重试）分别拒绝；ABI 缺失回退
            // 同步 typeTextGlobal（mac 136 导出面即走此路径，与官方 mac 一致）。
            if (typeof adapter.typeTextGlobalAsync !== "function") {
              if (typeof adapter.typeTextGlobal !== "function") {
                throw notAuthorized(
                  "type_text_to_app: the global keystroke primitive is unavailable in this ZCode build.",
                );
              }
              assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text_to_app");
              markInjected();
              return;
            }
            const typed = await adapter.typeTextGlobalAsync(text);
            if (!typed.ok) {
              if (typed.sent > 0) {
                markInjected();
                throw elementUnavailable(
                  `type_text_to_app: text injection truncated after ${typed.sent}/${typed.total} characters; the prefix possibly landed. Do not replay; re-observe before retrying.`,
                  { action_sent: true, reason: "text_truncated" },
                );
              }
              throw elementUnavailable(
                "type_text_to_app: text injection failed before any character was sent.",
                { action_sent: false, reason: "text_injection_failed" },
              );
            }
            markInjected();
          },
          void 0,
          // 官方注释锚 85454076-85454109（保留原文）：
          // 文本链排水缩放（verify V3）：max(120, 字符数 × 20)ms——固定
          // 120ms 对长 CJK 串不足（实测泵速 ≈17ms/字，16 字只落地前 7 字）。
          text.length * 20,
          // CR-02：长文本收尾保留目标前台；50 单位以内沿用原条件恢复。
          text.length <= 50,
        );
        // 还原自官方 :26260-26273：前台注入回执并轨 insertionDelivery 封套。
        if (insertionDelivery) {
          return {
            method: "foreground_event",
            delivery: finalizeDelivery(
              appendAttempt(insertionDelivery, {
                path: "foreground_send_input",
                dispatch_status: "sent",
              }),
            ),
          };
        }
        return {
          method: "foreground_event",
          delivery: finalizeDelivery(
            appendAttempt(null, { path: "foreground_send_input", dispatch_status: "sent" }),
          ),
        };
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
        // R8：对齐官方 dispatchWindowsForegroundKeyed 新形态（target 对象 + markInjected
        // 回调；官方 SEA offset 85459627 区）。markInjected 标记注入已发生，驱动收尾
        // 排水而非立即恢复前台（键击后目标可能仍在处理输入）。
        // W3（还原至官方 0.6.5 win32 entry :26410-26447 完整形态）：strategy!=event
        // 时先走 dispatchWindowsBackgroundKeyed（postMessageKeyAsync 后台键 / XAML
        // 宿主 invokeAcceleratorAsync 加速器梯），非全 not_sent 即 window_event
        // 终态；前台注入成功后 foreground_send_input sent attempt 并轨封套返回。
        const backgroundDelivery =
          params.strategy === "event"
            ? null
            : await dispatchWindowsBackgroundKeyed({
                adapter,
                axSource,
                chord: text,
                pid: target.pid,
                windowId: target.windowId,
                method: "press_key_to_app",
              });
        if (backgroundDelivery && backgroundDelivery.attempts.some((a) => a.dispatch_status !== "not_sent")) {
          return { method: "window_event", delivery: backgroundDelivery };
        }
        await dispatchWindowsForegroundKeyed(
          axSource,
          adapter,
          "press_key_to_app",
          target,
          (markInjected) => {
            if (typeof adapter.pressKeyGlobal !== "function") {
              throw notAuthorized(
                "press_key_to_app: the global keystroke primitive is unavailable in this ZCode build.",
              );
            }
            assertNativeInputSucceeded(adapter.pressKeyGlobal(text), "press_key_to_app");
            markInjected();
          },
        );
        if (backgroundDelivery) {
          return {
            method: "foreground_event",
            delivery: finalizeDelivery(
              appendAttempt(backgroundDelivery, {
                path: "foreground_send_input",
                dispatch_status: "sent",
              }),
            ),
          };
        }
        return {
          method: "foreground_event",
          delivery: finalizeDelivery(
            appendAttempt(null, { path: "foreground_send_input", dispatch_status: "sent" }),
          ),
        };
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
        // R8：对齐官方新形态（官方 SEA offset 85463725 区，markInjected 语义同
        // press_key_to_app）。注：hold 期间前台保持由 hold 语义本身承担，官方此分支
        // 不传排水参数（drainHintMs 缺省走 120ms 底）。
        await dispatchWindowsForegroundKeyed(
          axSource,
          adapter,
          "hold_key_to_app",
          target,
          async (markInjected) => {
            if (typeof adapter.holdKeyGlobal !== "function") {
              throw notAuthorized(
                "hold_key_to_app: the global hold primitive is unavailable in this ZCode build.",
              );
            }
            assertNativeInputSucceeded(
              await adapter.holdKeyGlobal(text, duration3 * 1e3, sessionKey),
              "hold_key_to_app",
            );
            markInjected();
          },
        );
        return null;
      }
      await runAppScopedInput("hold_key_to_app", () =>
        adapter.holdKeyToApp(target.pid, target.bundleId, text, duration3, sessionKey),
      );
      return null;
    },
    // 清退（2026-11-10 R10 后续）：click_element_at_point handler 已随方法删除
    // ——方法名双官方构建零命中；AX hit-test 原语 adapter.clickElementAtPoint 与
    // owner 校验 assertClickElementOwnerPid 由存续的 click（AX hit-test 优先路径）
    // 继续使用。
    // 清退（2026-11-10 R10 后续）：move_to handler 已随方法删除——方法名双官方
    // 构建零命中（该词仅以 scroll:move_to / drag:move_to_start 内部 reason 串
    // 存活，win entry :27114/:27352）；adapter.moveTo 由存续的 scroll/drag/click
    // 坐标派发继续使用。
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
      // 还原自发行 bundle（官方 0.6.5 win32 entry :26605-26608）：element_provenance
      // 二次校验链（win32 element_native 目标改写，见 validateElementProvenance 注释）。
      const frameAdmissionParams = params;
      params = await validateElementProvenance(params, "click", [point], frameAdmissionParams);
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
      } else if (expectedPid > 0 && platform2 !== "win32") {
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
      // R8（官方 SEA offset 85471173-85474500 区）：win32 专用坐标点击派发——串行
      // lane + 精确/非精确目标分流 + clickAtPointAsync 异步通道（G4）+ key-hold
      // 防误路由（G3 click 变体/@85472831）+ 活窗门禁（G2）+ hit-test 模式梯（G6）。
      if (platform2 === "win32") {
        return windowsInputDispatchLease.run("click", async () => {
          // 还原自官方 0.6.5 win32 entry :26738-26739：进 lane 后重验 provenance——
          // 排队期间的帧/元素漂移在派发前再拦一次（frameAdmissionParams 为入队前
          // 原始 params，rememberFrameTarget 键不被中途改写丢记忆）。
          if (params.frame_provenance) await validateFrameProvenance(frameAdmissionParams, "click", [point]);
          if (params.element_provenance) await validateElementProvenance(params, "click", [point]);
          const expectedBundle =
            typeof params.expected_bundle_id === "string" ? params.expected_bundle_id : "";
          const hasPreciseTarget = expectedPid > 0 && expectedWindowId > 0 && expectedBundle;
          if (!hasPreciseTarget) {
            if (expectedPid > 0) {
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
            assertGlobalInputAllowed(adapter, "click");
            // G4（缺 ABI 拒绝文案锚 85471771）：非精确目标的坐标点击必须走异步原语
            //（同步 clickAtPoint 会在 SendInput 语义下丢失投放确认），缺 ABI 即拒绝。
            if (typeof adapter.clickAtPointAsync !== "function") {
              throw notAuthorized(
                "click: this ZCode build lacks the async foreground click primitive; input refused. action_sent=false.",
                { action_sent: false },
              );
            }
            const clickResult =
              expectedPid > 0
                ? await adapter.clickAtPointAsync(
                    point.x,
                    point.y,
                    button,
                    clicks,
                    modifiers,
                    expectedPid,
                    expectedWindowId || void 0,
                  )
                : await adapter.clickAtPointAsync(point.x, point.y, button, clicks, modifiers);
            assertNativeInputSucceeded(clickResult, "click");
            // 还原自官方 0.6.5 win32 entry :26767-26780：非精确目标（无 pid+window+
            // bundle 三元组）的前台点击也带投递封套——reason 区分仅 pid
            //（imprecise_target_pid_only）与全无（imprecise_target）。
            return appendResolvedAppRef(
              {
                method: "click",
                delivery: finalizeDelivery(
                  appendAttempt(null, {
                    path: "foreground_send_input",
                    dispatch_status: "sent",
                    reason: expectedPid > 0 ? "imprecise_target_pid_only" : "imprecise_target",
                  }),
                ),
              },
              params,
            );
          }
          const dispatchForeground = async () => {
            // 还原自官方 :26793：前台升级点击同样过独立 surface 物理输入门禁。
            assertWindowsPhysicalAssociation(expectedWindowId);
            assertGlobalInputAllowed(adapter, "click");
            // G3 click 变体（文案锚 85472831）：key hold 未释放时拒绝为点击切前台。
            if (adapter.hasActiveInputHolds?.()) {
              throw permissionDenied(
                "refused to bring pid in front for a click because another key hold is still active. action_sent=false.",
                { action_sent: false, reason: "input_hold_active" },
              );
            }
            const restore = foregroundRestoreScope(adapter);
            restore.snapshotBefore();
            try {
              const context = adapter.frameWindowContext?.(expectedWindowId);
              if (context?.is_menu || context?.operation_foreground_host_window_id) {
                await windowsForegroundWindowGate({
                  axSource,
                  windowContext: adapter.frameWindowContext?.bind(adapter),
                  target: { pid: expectedPid, bundleId: expectedBundle, windowId: expectedWindowId },
                  activateWindow: () => false,
                  method: "click",
                });
              } else {
                activateConcreteWindow(adapter, expectedPid, expectedBundle, expectedWindowId, "click");
                await assertExpectedPidIsFrontmost(axSource, expectedPid, point, "click");
              }
              restore.snapshotAfterActivate();
              assertGlobalInputAllowed(adapter, "click");
              if (typeof adapter.clickAtPointAsync !== "function") {
                throw notAuthorized(
                  "click: this ZCode build lacks the async foreground click primitive; input refused. action_sent=false.",
                  { action_sent: false },
                );
              }
              assertNativeInputSucceeded(
                await adapter.clickAtPointAsync(
                  point.x,
                  point.y,
                  button,
                  clicks,
                  modifiers,
                  expectedPid,
                  expectedWindowId,
                ),
                "click",
              );
            } finally {
              restore.restore();
            }
          };
          // 官方 classify fallback（classifyPostMessageDelivery ABI 缺失时）：
          // {delivery: "deliverable", host: "unknown"}——梯级继续而非拒绝。
          const classifyFallback = () => ({ delivery: "deliverable", host: "unknown" });
          const classifyWith = adapter.classifyPostMessageDelivery
            ? (windowId, kind) => {
                const r = adapter.classifyPostMessageDelivery(windowId, kind);
                return r === false || typeof r !== "object" ? classifyFallback() : r;
              }
            : classifyFallback;
          let chromiumHost = false;
          if (adapter.classifyPostMessageDelivery) {
            const probe = adapter.classifyPostMessageDelivery(expectedWindowId, "mouse_click");
            chromiumHost = typeof probe === "object" && probe !== null && probe.host === "chromium";
          }
          const { result, delivery } = await dispatchWindowsClick(
            {
              hitTestInvokeAtPointAsync: adapter.hitTestInvokeAtPointAsync,
              postMessageClickAsync: adapter.postMessageClickAsync,
              clickAtPoint: adapter.clickAtPoint,
            },
            {
              windowId: expectedWindowId,
              pid: expectedPid,
              bundleId: expectedBundle,
              x: point.x,
              y: point.y,
              button,
              clicks,
              modifiers,
              forceForeground: forceRawEvent,
              isChromiumHost: chromiumHost,
              classify: classifyWith,
              dispatchForeground,
              method: "click",
            },
          );
          // 还原自官方 :26882：结果带 delivery 轨迹 + 记忆帧目标三参回执。
          return appendResolvedAppRef(
            { ...result, delivery },
            params,
            validatedFrameTargetByParams.get(params),
          );
        });
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
      // 还原自官方 0.6.5 win32 entry :27014-27019：admissionParams 记入队前原始
      // params；frame + element 双 provenance 校验（element 原始入参作 original，
      // rememberFrameTarget 键不丢）。
      const admissionParams = params;
      const provenancePoint = extractPoint(params.point);
      if (provenancePoint) {
        params = await validateFrameProvenance(params, "scroll", [provenancePoint]);
        params = await validateElementProvenance(params, "scroll", [provenancePoint], admissionParams);
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
        // R8（官方 SEA offset 85483300-85484600 区）：win32 app_ref 滚动走串行 lane +
        // key-hold 防误路由（G3 scroll 变体/@85484612）+ 前台恢复 scope + 显式激活链。
        // W3（还原至官方 0.6.5 win32 entry :27071-27140 完整形态）：strategy!=event
        // 时先尝试 postMessage 后台滚动（dispatchWindowsBackgroundScroll，mouse_scroll
        // 矩阵），非全 not_sent 即 window_event 终态；进 lane 后重验 provenance +
        // assertWindowsPhysicalAssociation；前台滚动成功后 foreground_send_input
        // sent attempt 并轨封套返回（foreground_event）。
        return (async () => {
          const identity = await requirePointerAppPid(axSource, params.app_ref, "scroll");
          refusePointerSequenceIfBusy("scroll");
          let backgroundDelivery = null;
          if (params.strategy !== "event") {
            backgroundDelivery = await dispatchWindowsBackgroundScroll({
              adapter,
              pid: identity.pid,
              windowId: identity.windowId ?? void 0,
              direction,
              amount,
              method: "scroll",
            });
            if (backgroundDelivery && backgroundDelivery.attempts.some((a) => a.dispatch_status !== "not_sent")) {
              return appendResolvedAppRef({ method: "window_event", delivery: backgroundDelivery }, params);
            }
          }
          await windowsInputDispatchLease.run("scroll", async () => {
            if (params.frame_provenance) await validateFrameProvenance(admissionParams, "scroll", [point]);
            if (params.element_provenance) await validateElementProvenance(params, "scroll", [point]);
            assertWindowsPhysicalAssociation(
              typeof params.expected_window_id === "number" ? params.expected_window_id : void 0,
            );
            if (adapter.hasActiveInputHolds?.()) {
              throw permissionDenied(
                "scroll: refused to bring the target to the foreground because another key hold is still active. action_sent=false.",
                { action_sent: false, reason: "input_hold_active" },
              );
            }
            const restore = foregroundRestoreScope(adapter);
            restore.snapshotBefore();
            try {
              activateConcreteWindow(
                adapter,
                identity.pid,
                identity.bundleId,
                identity.windowId,
                "scroll",
              );
              await assertExpectedPidIsFrontmost(axSource, identity.pid, point, "scroll");
              restore.snapshotAfterActivate();
              assertNativeInputSucceeded(adapter.moveTo(point.x, point.y), "scroll:move_to");
              await waitForCursorToSettle(adapter, point, "scroll:move_to");
              assertNativeInputSucceeded(
                adapter.scrollAt(point.x, point.y, amount, direction),
                "scroll",
              );
            } finally {
              restore.restore();
            }
          });
          if (backgroundDelivery) {
            return appendResolvedAppRef(
              {
                method: "foreground_event",
                delivery: finalizeDelivery(
                  appendAttempt(backgroundDelivery, {
                    path: "foreground_send_input",
                    dispatch_status: "sent",
                  }),
                ),
              },
              params,
            );
          }
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
      // 还原自官方 0.6.5 win32 entry :27191-27197：admissionParams 记入队前原始
      // params；frame + element 双 provenance 校验（element 原始入参作 original）。
      const admissionParams = params;
      const provenanceStart = extractPoint(params.start);
      const provenanceEnd = extractPoint(params.end);
      if (provenanceStart && provenanceEnd) {
        params = await validateFrameProvenance(params, "drag", [provenanceStart, provenanceEnd]);
        params = await validateElementProvenance(params, "drag", [provenanceStart, provenanceEnd], admissionParams);
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
          // R8（官方 SEA offset 85489300-85490600 区）：win32 拖拽走串行 lane + key-hold
          // 防误路由（G3 drag 变体/@85490603）+ 前台恢复 scope + 显式激活链；修饰键经
          // withSyntheticModifiers 合成（与 drag 本体分离）。
          // W3（还原至官方 0.6.5 win32 entry :27252-27335 完整形态）：strategy!=event
          // 时先尝试 postMessage 后台拖拽（dispatchWindowsBackgroundDrag，mouse_move
          // 矩阵），非全 not_sent 即 window_event 终态；进 lane 后重验 provenance +
          // assertWindowsPhysicalAssociation；前台拖拽成功后 foreground_send_input
          // sent attempt 并轨封套返回（foreground_event，strategy=event 时 reason=
          // explicit_event_strategy）。
          const escalatedResult = await windowsInputDispatchLease.run("drag", async () => {
            if (params.frame_provenance)
              await validateFrameProvenance(admissionParams, "drag", [start, end]);
            if (params.element_provenance) await validateElementProvenance(params, "drag", [start, end]);
            const identity = await requirePointerAppPid(axSource, params.app_ref, "drag");
            let backgroundDelivery = null;
            if (params.strategy !== "event") {
              backgroundDelivery = await dispatchWindowsBackgroundDrag({
                adapter,
                pid: identity.pid,
                windowId: identity.windowId ?? void 0,
                start,
                end,
                method: "drag",
              });
              if (backgroundDelivery && backgroundDelivery.attempts.some((a) => a.dispatch_status !== "not_sent")) {
                return appendResolvedAppRef({ method: "window_event", delivery: backgroundDelivery }, params);
              }
            }
            assertWindowsPhysicalAssociation(
              typeof params.expected_window_id === "number" ? params.expected_window_id : void 0,
            );
            if (adapter.hasActiveInputHolds?.()) {
              throw permissionDenied(
                "drag: refused to bring pid in front because another key hold is still active. action_sent=false.",
                { action_sent: false, reason: "input_hold_active" },
              );
            }
            const restore = foregroundRestoreScope(adapter);
            restore.snapshotBefore();
            try {
              activateConcreteWindow(
                adapter,
                identity.pid,
                identity.bundleId,
                identity.windowId,
                "drag",
              );
              await assertExpectedPidIsFrontmost(axSource, identity.pid, start, "drag");
              restore.snapshotAfterActivate();
              await withSyntheticModifiers(adapter, modifiers, "drag", async () => {
                assertNativeInputSucceeded(
                  await adapter.drag(start.x, start.y, end.x, end.y, "left"),
                  "drag",
                );
              });
            } finally {
              restore.restore();
            }
            if (backgroundDelivery) {
              return appendResolvedAppRef(
                {
                  method: "foreground_event",
                  delivery: finalizeDelivery(
                    appendAttempt(backgroundDelivery, {
                      path: "foreground_send_input",
                      dispatch_status: "sent",
                    }),
                  ),
                },
                params,
              );
            }
            return appendResolvedAppRef(
              {
                method: "foreground_event",
                delivery: finalizeDelivery(
                  appendAttempt(null, {
                    path: "foreground_send_input",
                    dispatch_status: "sent",
                    ...(params.strategy === "event" ? { reason: "explicit_event_strategy" } : {}),
                  }),
                ),
              },
              params,
            );
          });
          return escalatedResult;
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
    // 清退（2026-11-10 R10 后续）：mouse_down/mouse_up 两个 3.11.2 血统 broker
    // 方法 handler 整体删除——方法名在官方 0.6.5 win entry 与 mac SEA（3.17.2）双
    // 零命中（这两词仅以 accepts_left_mouse_down capture 字段与
    // mouse_down_to_window/mouse_up_to_window 后台 ABI 名存活）；官方 v3.1 协议瘦身
    // 49→43（win entry :19750 墓碑）。保留边界：adapter.mouseDown/mouseUp/mouseUpToPid
    // 的 adapter 面不删（官方 win entry :32075-32085 逐字保留，mouseUpToPid 注释
    // surfaced ONLY as the bounded cleanup release）；分离按下所有权状态机
    // （buttonHolder/splitDownInFlight/claimSplitDown/requirePointerMoveOwnership）
    // 随 handler 一并退役，指针门禁对齐官方仅剩 combinedDragInFlight 单态
    //（win entry :26041-26052）。
    type_text: (params) => {
      if (macBackgroundMode) refuseTargetlessMacGlobalInput("type_text");
      // R8/G1（官方 SEA offset 85493700-85494700 区）：win32 走串行 lane +
      // typeTextGlobalAsync 截断双语义（与 type_text_to_app 同族，文案前缀 type_text）；
      // 同步 ABI 缺失且无异步原语时才拒绝。mac（136 面）走同步路径不变。
      const useWindowsAsync =
        platform2 === "win32" && typeof adapter.typeTextGlobalAsync === "function";
      if (typeof adapter.typeTextGlobal !== "function" && !useWindowsAsync) {
        throw notAuthorized("type_text is unavailable in this ZCode build.");
      }
      const text = syntheticTextParam(params.text, "type_text");
      if (!text) return null;
      if (platform2 === "win32") {
        return windowsPhysicalLaneFor(adapter).run("type_text", async () => {
          assertGlobalInputAllowed(adapter, "type_text");
          if (!useWindowsAsync) {
            assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text");
            return null;
          }
          const typed = await adapter.typeTextGlobalAsync(text);
          if (!typed.ok) {
            const sentAny = typed.sent > 0;
            throw elementUnavailable(
              sentAny
                ? `type_text: text injection truncated after ${typed.sent}/${typed.total} characters; the prefix possibly landed. Do not replay; re-observe before retrying.`
                : "type_text: text injection failed before any character was sent.",
              {
                action_sent: sentAny,
                reason: sentAny ? "text_truncated" : "text_injection_failed",
              },
            );
          }
          return null;
        });
      }
      assertGlobalInputAllowed(adapter, "type_text");
      assertNativeInputSucceeded(adapter.typeTextGlobal(text), "type_text");
      return null;
    },
    // 清退（2026-11-10 R10 后续）：type_text_into_current_focus handler 已随
    // 方法删除——方法名双官方构建零命中；其全局注入原语 adapter.typeTextGlobal
    // 由存续的 type_text/type_text_to_app 继续使用。
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
    // 清退（2026-11-10 R10 后续）：key_down/key_up handler 已随方法删除——
    // 方法名双官方构建零命中（仅以 "modifiers require the key_down/key_up native
    // primitives" 错误文案存活，win entry :24559，供 press_key/hold_key 的修饰键
    // 合成链 withSyntheticModifiers 使用）；adapter.keyDownGlobal/keyUpGlobal 保留。
  };
  // 还原自发行 bundle（官方 0.6.5 win32 entry :27461-27485）：win32 六方法后置
  // 包装——成功结果未带 dispatch_surface 时统一经 appendResolvedAppRef 补发投递
  // 面（优先 validatedFrameTargetByParams 记忆的帧目标）；element_provenance 校验
  // 失败且无记忆目标时原样上抛，BrokerError 且有记忆目标时把 details 也补上
  // resolved_app_ref/dispatch_surface（消费端凭它对齐应用身份）。*_to_app 方法
  // 的 params 做浅拷贝（记忆 WeakMap 挂原始入参，不被中途改写丢键）。
  if (platform2 === "win32") {
    for (const method of ["click", "scroll", "drag", "type_text_to_app", "press_key_to_app", "hold_key_to_app"]) {
      const handler = handlers[method];
      if (!handler) continue;
      handlers[method] = async (inputParams) => {
        const params = method.endsWith("_to_app") ? { ...inputParams } : inputParams;
        try {
          const result = await handler(params);
          if (result && typeof result === "object" && "dispatch_surface" in result) return result;
          return appendResolvedAppRef(result, params, validatedFrameTargetByParams.get(params));
        } catch (error) {
          if (params.element_provenance && !validatedFrameTargetByParams.has(params)) throw error;
          const remembered = validatedFrameTargetByParams.get(params);
          if (error instanceof BrokerError) {
            if (!remembered) throw error;
            throw new BrokerError(
              error.code,
              error.message,
              appendResolvedAppRef({ ...error.details }, params, remembered) ?? {},
            );
          }
          throw error;
        }
      };
    }
  }
  return handlers;
}
