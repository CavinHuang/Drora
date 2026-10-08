import { BrokerError, elementUnavailable, notAuthorized, permissionDenied } from "../types.js";
import { resolveAppRefIdentity } from "./cuaAppIdentity.js";

export function appRefParam(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw permissionDenied("app-scoped keyboard input requires app_ref.");
  }
  const record2 = value;
  const pid: any =
    typeof record2.pid === "number" && Number.isInteger(record2.pid) && record2.pid > 0
      ? record2.pid
      : void 0;
  const bundleId =
    typeof record2.bundle_id === "string" && record2.bundle_id.trim()
      ? record2.bundle_id.trim()
      : null;
  const name = typeof record2.name === "string" && record2.name.trim() ? record2.name.trim() : null;
  const windowId =
    typeof record2.window_id === "number" &&
    Number.isSafeInteger(record2.window_id) &&
    record2.window_id > 0
      ? record2.window_id
      : null;
  if (!pid && !bundleId && !name) {
    throw permissionDenied(
      "app-scoped keyboard input requires app_ref.pid, app_ref.bundle_id, or app_ref.name.",
    );
  }
  return { pid, bundle_id: bundleId, name, window_id: windowId };
}
export async function resolveAppInputTarget(
  axSource,
  appRef,
  method = "app-scoped keyboard input",
) {
  if (!axSource) {
    throw notAuthorized(
      "app-scoped keyboard input requires the native AX app resolver in this ZCode build.",
    );
  }
  if (!appRef.pid && !appRef.bundle_id && !appRef.name) {
    throw permissionDenied(`${method}: app_ref was not bound to a pid, bundle_id, or name.`);
  }
  const identity: any = await resolveAppRefIdentity(axSource, appRef, method);
  if (!identity) {
    if (typeof appRef.window_id === "number") {
      const processIdentity = await resolveAppRefIdentity(
        axSource,
        {
          pid: appRef.pid,
          bundle_id: appRef.bundle_id,
          name: appRef.name,
        },
        method,
      );
      if (processIdentity) {
        throw elementUnavailable(
          `${method}: surface_replaced; app_ref.window_id ${appRef.window_id} no longer identifies the live attached surface. Call get_app_state, use the new actual_window_id, and retry once. action_sent=false.`,
          {
            action_sent: false,
            reason: "surface_replaced",
            recovery:
              "Call get_app_state and use the new attached surface identity; do not reuse the old window_id.",
          },
        );
      }
    }
    const conflict =
      typeof appRef.pid === "number" &&
      typeof appRef.bundle_id === "string" &&
      appRef.bundle_id.trim()
        ? ` pid ${appRef.pid} does not match bundle_id ${appRef.bundle_id};`
        : "";
    throw permissionDenied(
      `${method}: app_ref${conflict || " did not resolve to a unique live application;"} refusing before any keyboard action. Call list_apps and reuse one row's pid, bundle_id, and name together. action_sent=false.`,
    );
  }
  const requestedBundleId = typeof appRef.bundle_id === "string" ? appRef.bundle_id.trim() : "";
  let liveBundleId = identity.bundle_id;
  if (!requestedBundleId && typeof appRef.pid === "number" && axSource.applicationInfo) {
    try {
      const live = await axSource.applicationInfo({ pid: identity.pid });
      if (typeof live?.bundle_id === "string" && live.bundle_id.trim()) {
        liveBundleId = live.bundle_id.trim();
      }
    } catch {}
  }
  return {
    pid: identity.pid,
    // Identity comparison is case-insensitive, but the native ABI and existing
    // callers retain the live/requested spelling. Verification must not turn
    // canonicalization into an observable payload rewrite.
    bundleId: requestedBundleId || liveBundleId,
    ...(typeof appRef.window_id === "number" ? { windowId: appRef.window_id } : {}),
  };
}
export async function runAppScopedInput(label, action) {
  try {
    await action();
  } catch (error51) {
    if (error51 instanceof BrokerError) throw error51;
    const message = error51 instanceof Error ? error51.message : String(error51);
    throw permissionDenied(
      `${label} failed in the ZCode native app-scoped input backend: ${message}`,
    );
  }
}
