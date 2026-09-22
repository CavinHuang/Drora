import { permissionDenied } from "../types.js";

var SAFE_BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
var SAFE_APP_IDENTIFIER = /^[A-Za-z0-9].{0,254}$/u;
export function canonicalizeCuaBundleId(value, options: any = {}) {
  const bundleId = value.trim();
  const pattern: any = options.loose ? SAFE_APP_IDENTIFIER : SAFE_BUNDLE_ID;
  if (!pattern.test(bundleId)) {
    throw new Error(`Invalid CUA app bundle identifier: ${JSON.stringify(value)}`);
  }
  return bundleId;
}
function cuaBundleIdKey(value, options = {}) {
  return canonicalizeCuaBundleId(value, options).toLowerCase();
}
function shapeIndependentBundleKey(value, options) {
  try {
    return cuaBundleIdKey(value, options);
  } catch {
    return value.trim().toLowerCase();
  }
}
export function cuaBundleIdsEqual(left, right, options = {}) {
  if (!left || !right) return false;
  return shapeIndependentBundleKey(left, options) === shapeIndependentBundleKey(right, options);
}
function validPid(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
var PINNED_PID_IDENTITY_ATTEMPTS = 5;
var PINNED_PID_IDENTITY_RETRY_MS = 25;
function bundleOf(app) {
  if (typeof app?.bundle_id !== "string" || !app.bundle_id.trim()) return null;
  try {
    return canonicalizeCuaBundleId(app.bundle_id, { loose: true });
  } catch {
    return null;
  }
}
export async function applications(source, method) {
  try {
    return await source.listApplications();
  } catch (error51) {
    throw permissionDenied(
      `${method}: target app identity lookup failed; refusing the action (${error51 instanceof Error ? error51.message : String(error51)}).`,
    );
  }
}
function appMatchesRef(app, appRef) {
  if (validPid(appRef.pid) && app.pid !== appRef.pid) return false;
  if (appRef.bundle_id?.trim()) {
    let expectedBundleId;
    try {
      expectedBundleId = canonicalizeCuaBundleId(appRef.bundle_id, {
        loose: true,
      });
    } catch {
      return false;
    }
    if (!cuaBundleIdsEqual(bundleOf(app), expectedBundleId, { loose: true })) return false;
  }
  if (appRef.name?.trim()) {
    const expectedName = appRef.name.trim().toLocaleLowerCase();
    if (app.name?.trim().toLocaleLowerCase() !== expectedName) return false;
  }
  return true;
}
export async function resolveAppRefIdentity(source, appRef, method) {
  if (!validPid(appRef.pid) && !appRef.bundle_id?.trim() && !appRef.name?.trim()) {
    return null;
  }
  if (validPid(appRef.pid) && source.applicationInfo) {
    let direct = null;
    for (let attempt = 0; attempt < PINNED_PID_IDENTITY_ATTEMPTS; attempt += 1) {
      try {
        direct = await source.applicationInfo(appRef);
      } catch (error51) {
        throw permissionDenied(
          `${method}: target app identity lookup failed; refusing the action (${error51 instanceof Error ? error51.message : String(error51)}).`,
        );
      }
      if (direct || attempt + 1 === PINNED_PID_IDENTITY_ATTEMPTS) break;
      await new Promise((resolve2) => setTimeout(resolve2, PINNED_PID_IDENTITY_RETRY_MS));
    }
    if (!direct || !appMatchesRef(direct, appRef)) return null;
    const bundleId = bundleOf(direct);
    if (!validPid(direct.pid) || !bundleId) return null;
    return {
      pid: direct.pid,
      bundle_id: bundleId,
      name: direct.name?.trim() || null,
      active: direct.active === true,
    };
  }
  const candidates = (await applications(source, method))
    .filter((app) => appMatchesRef(app, appRef))
    .flatMap((app) => {
      const bundleId = bundleOf(app);
      if (!validPid(app.pid) || !bundleId) return [];
      return [
        {
          pid: app.pid,
          bundle_id: bundleId,
          name: app.name?.trim() || null,
          active: app.active === true,
        },
      ];
    });
  const unique: any = [
    ...new Map(
      candidates.map((candidate) => [`${candidate.pid}\0${candidate.bundle_id}`, candidate]),
    ).values(),
  ];
  if (unique.length === 1) return unique[0];
  if (validPid(appRef.pid)) return null;
  const active = unique.filter((candidate) => candidate.active === true);
  return active.length === 1 ? active[0] : null;
}
export async function resolvePidBundleId(source, pid, method) {
  return (await resolvePidIdentity(source, pid, method))?.bundle_id ?? null;
}
export async function resolvePidIdentity(source, pid, method) {
  if (!validPid(pid)) return null;
  return resolveAppRefIdentity(source, { pid }, method);
}
