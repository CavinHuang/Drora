function boundsIntersect(left, right) {
  return (
    left[2] > 0 &&
    left[3] > 0 &&
    right[2] > 0 &&
    right[3] > 0 &&
    left[0] < right[0] + right[2] &&
    left[0] + left[2] > right[0] &&
    left[1] < right[1] + right[3] &&
    left[1] + left[3] > right[1]
  );
}
function coversDisplay(bounds, display) {
  const tolerance = 0.5;
  return (
    bounds[0] <= display[0] + tolerance &&
    bounds[1] <= display[1] + tolerance &&
    bounds[0] + bounds[2] >= display[0] + display[2] - tolerance &&
    bounds[1] + bounds[3] >= display[1] + display[3] - tolerance
  );
}
function isNonPixelSystemManagementWindow(window, displayBounds) {
  return (
    window.owner_bundle_id?.toLocaleLowerCase() === "com.apple.dock" &&
    window.layer !== 0 &&
    coversDisplay(window.bounds, displayBounds)
  );
}
var CURSOR_WINDOW_LEVEL = 2147483630;
function isCursorWindow(window) {
  return window.layer === CURSOR_WINDOW_LEVEL && window.owner_bundle_id === null;
}
export function fingerprint(windows) {
  return JSON.stringify(
    windows.map((window) => [
      window.window_id,
      window.owner_pid,
      window.owner_bundle_id,
      window.layer,
      ...window.bounds,
    ]),
  );
}
export function normalizeWindowServerRecords(windows, displayBounds, helperPid) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const window of windows) {
    const bundleId = window.owner_bundle_id?.trim() || null;
    const record2 = { ...window, owner_bundle_id: bundleId };
    if (
      seen.has(record2.window_id) ||
      !Number.isSafeInteger(record2.window_id) ||
      record2.window_id <= 0 ||
      !Number.isSafeInteger(record2.owner_pid) ||
      record2.owner_pid <= 0 ||
      !Number.isSafeInteger(record2.layer) ||
      record2.bounds.some((part) => !Number.isFinite(part)) ||
      record2.bounds[2] <= 0 ||
      record2.bounds[3] <= 0 ||
      !boundsIntersect(record2.bounds, displayBounds) ||
      record2.owner_pid === helperPid ||
      isCursorWindow(record2) ||
      isNonPixelSystemManagementWindow(record2, displayBounds)
    ) {
      continue;
    }
    seen.add(record2.window_id);
    normalized.push(record2);
  }
  return { fingerprint: fingerprint(normalized), order: "front_to_back", windows: normalized };
}
export function snapshotWindowServerWindows(windows, displayBounds, helperPid) {
  return normalizeWindowServerRecords(
    windows
      .filter((window) => window.onScreen)
      .map((window) => ({
        window_id: window.windowId,
        owner_pid: window.ownerPid,
        owner_bundle_id: window.ownerBundleId,
        layer:
          typeof window.layer === "number" && Number.isSafeInteger(window.layer) ? window.layer : 0,
        ...(typeof window.acceptsLeftMouseDown === "boolean"
          ? { accepts_left_mouse_down: window.acceptsLeftMouseDown }
          : {}),
        bounds: [window.bounds.x, window.bounds.y, window.bounds.width, window.bounds.height],
      })),
    displayBounds,
    helperPid,
  );
}
function windowContainsPoint(window, point) {
  const [x, y, width, height] = window.bounds;
  return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
}
export function windowServerOwnerAtPointDetailed(snapshot, point) {
  const skipped = [];
  for (const window of snapshot.windows) {
    if (!windowContainsPoint(window, point)) continue;
    if (window.accepts_left_mouse_down === false) {
      skipped.push(window);
      continue;
    }
    return { owner: window, skipped };
  }
  return { owner: null, skipped };
}
