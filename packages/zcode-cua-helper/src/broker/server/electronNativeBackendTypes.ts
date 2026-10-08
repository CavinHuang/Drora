function validAccessibilityProbeStatus(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return (
    typeof candidate.ok === "boolean" &&
    (candidate.axError === null || typeof candidate.axError === "string")
  );
}
export function readAccessibilityProbe(adapter) {
  try {
    const structured =
      typeof adapter.probeAccessibilityStatus === "function"
        ? adapter.probeAccessibilityStatus()
        : void 0;
    if (validAccessibilityProbeStatus(structured)) {
      return {
        source: "structured",
        ok: structured.ok,
        axError: structured.axError,
        classification:
          structured.ok && structured.axError === null
            ? "functional"
            : !structured.ok && structured.axError === "api_disabled"
              ? "disabled"
              : "indeterminate",
      };
    }
  } catch {}
  try {
    const legacy =
      typeof adapter.probeAccessibility === "function" ? adapter.probeAccessibility() : void 0;
    if (legacy === true || legacy === false) {
      return {
        source: "legacy",
        ok: legacy,
        axError: null,
        // Bugfix：旧 false 同时覆盖 api_disabled/cannot_complete/failure，不能再直接判 stale。
        classification: legacy ? "functional" : "indeterminate",
      };
    }
  } catch {}
  return {
    source: "none",
    ok: null,
    axError: null,
    classification: "unavailable",
  };
}
export var FAIL_CLOSED_REASON =
  "requires a native AX/CGEvent backend that is not implemented in the Electron backend yet; high-fidelity AX and synthetic mouse/keyboard are not available in product mode until a signed native helper ships.";
export function mapScreenStatus(raw) {
  switch (raw) {
    case "granted":
      return "granted";
    case "denied":
    case "restricted":
      return "denied";
    default:
      return "unknown";
  }
}
export function capabilityList2(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
export function wantsCapability(requested, names) {
  if (requested.length === 0) return true;
  const normalized = new Set(requested.map((item) => item.trim().toLowerCase()));
  return names.some((name) => normalized.has(name));
}
export function hasTokenScopedElementActions(axSource) {
  return Boolean(
    axSource?.elementPress ||
    axSource?.elementShowMenu ||
    axSource?.elementFocus ||
    axSource?.elementSetValue ||
    axSource?.elementPerformAction ||
    axSource?.elementSelectText,
  );
}
export function hasAppScopedKeyboard(adapter) {
  return (
    typeof adapter.typeTextToApp === "function" &&
    typeof adapter.pressKeyToApp === "function" &&
    typeof adapter.holdKeyToApp === "function"
  );
}
export function hasRawMouseKeyboard(adapter) {
  return (
    typeof adapter.preventActivation === "function" &&
    typeof adapter.reenableActivation === "function" &&
    typeof adapter.isFocusStealPrevented === "function" &&
    typeof adapter.clickAtPoint === "function" &&
    typeof adapter.moveTo === "function" &&
    typeof adapter.scrollAt === "function" &&
    typeof adapter.drag === "function" &&
    typeof adapter.mouseDown === "function" &&
    typeof adapter.mouseUp === "function" &&
    typeof adapter.typeTextGlobal === "function" &&
    typeof adapter.pressKeyGlobal === "function" &&
    typeof adapter.holdKeyGlobal === "function" &&
    typeof adapter.keyDownGlobal === "function" &&
    typeof adapter.keyUpGlobal === "function"
  );
}
