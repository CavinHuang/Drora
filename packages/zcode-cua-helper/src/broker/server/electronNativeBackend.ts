/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { win32 } from "node:path";
import { displayTopologyFingerprint } from "../../lib/display-topology.js";
import {
  BrokerError,
  elementUnavailable,
  foregroundRequired,
  invalidRequest,
  launchFailed,
  notAuthorized,
  permissionDenied,
} from "../types.js";
import { AxTokenRegistry, createAxReadOnlyMethods } from "./axReadOnly.js";
import { createElectronDisplaySelection } from "./electronDisplaySelection.js";
import { cuaBundleIdsEqual, resolvePidIdentity } from "./cuaAppIdentity.js";
import { createElectronDisplayTopology } from "./electronDisplayTopology.js";
import {
  createElectronInputHandlers,
  replaceTextValueWithVerifiedInput,
} from "./electronInputHandlers.js";
import {
  FAIL_CLOSED_REASON,
  capabilityList2,
  hasAppScopedKeyboard,
  hasRawMouseKeyboard,
  hasTokenScopedElementActions,
  mapScreenStatus,
  readAccessibilityProbe,
  wantsCapability,
} from "./electronNativeBackendTypes.js";
import {
  accessibilityActionRequired,
  authorizationSubject,
  authorizationSubjectHint,
  automationActionRequired,
  permissionGuideMessage,
  screenRecordingActionRequired,
} from "./electronPermissionHints.js";
import { authorizationSubjectKind, createUnavailableNativeBackend } from "./nativeBackend.js";
import { createPipAutoStarter } from "./pipAutoStart.js";
import { createForeignWindowScreenCaptureProbe } from "./screenCaptureProbe.js";
import { snapshotWindowServerWindows } from "./windowServerSnapshot.js";

// PNG buffer → base64（screenshot 返回契约）。Buffer.from 兼容 Uint8Array 输入。
function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function captureScreenshotWindows(adapter, displayBounds) {
  if (!adapter.listScreenCaptureProbeWindows) return null;
  return snapshotWindowServerWindows(
    adapter.listScreenCaptureProbeWindows(),
    displayBounds,
    process.pid,
  );
}
function topologyDesktopBounds(entries) {
  const left = Math.min(...entries.map((entry) => entry.bounds[0]));
  const top = Math.min(...entries.map((entry) => entry.bounds[1]));
  const right = Math.max(...entries.map((entry) => entry.bounds[0] + entry.bounds[2]));
  const bottom = Math.max(...entries.map((entry) => entry.bounds[1] + entry.bounds[3]));
  return [left, top, right - left, bottom - top];
}
function sameSurfaceBounds(left, right) {
  return (
    left.length === 4 &&
    right.length === 4 &&
    left.every((part, index) => Math.abs(part - right[index]) <= 1)
  );
}
function buildStableAppFrameSurfaceSet(snapshot, before, after) {
  const actualWindowId = snapshot.window.window_id;
  const presentationWindowId = snapshot.window.presentation_window_id ?? actualWindowId;
  const candidates = snapshot.surfaces;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {};
  }
  const hasAttachedSurface = candidates.some(
    (candidate) =>
      candidate.relation === "ax_descendant" ||
      candidate.actual_window_id !== candidate.presentation_window_id,
  );
  if (!before || !after) {
    return hasAttachedSurface ? { capture_surfaces_status: "capture_surfaces_unavailable" } : {};
  }
  if (
    typeof actualWindowId !== "number" ||
    typeof presentationWindowId !== "number" ||
    candidates.length > 64
  ) {
    return { capture_surfaces_status: "capture_surfaces_unavailable" };
  }
  const stable = [];
  for (const candidate of candidates) {
    const beforeWindow = before.windows.find(
      (window) => window.window_id === candidate.actual_window_id,
    );
    const afterWindow = after.windows.find(
      (window) => window.window_id === candidate.actual_window_id,
    );
    if (
      !beforeWindow ||
      !afterWindow ||
      beforeWindow.owner_bundle_id === null ||
      afterWindow.owner_bundle_id === null ||
      beforeWindow.owner_pid !== candidate.owner_pid ||
      beforeWindow.owner_pid !== afterWindow.owner_pid ||
      !cuaBundleIdsEqual(beforeWindow.owner_bundle_id, afterWindow.owner_bundle_id) ||
      beforeWindow.layer !== afterWindow.layer ||
      !sameSurfaceBounds(beforeWindow.bounds, candidate.bounds) ||
      !sameSurfaceBounds(beforeWindow.bounds, afterWindow.bounds)
    ) {
      return { capture_surfaces_status: "capture_surfaces_changed" };
    }
    stable.push({
      actual_window_id: candidate.actual_window_id,
      presentation_window_id: candidate.presentation_window_id,
      surface_kind: candidate.surface_kind,
      relation: candidate.relation,
      owner_pid: beforeWindow.owner_pid,
      owner_bundle_id: beforeWindow.owner_bundle_id,
      layer: beforeWindow.layer,
      bounds: beforeWindow.bounds,
    });
  }
  const byId = new Map(stable.map((surface) => [surface.actual_window_id, surface]));
  const orderSurfaces = (windowSnapshot) =>
    windowSnapshot.windows.flatMap((window) => {
      const surface = byId.get(window.window_id);
      return surface ? [surface] : [];
    });
  const orderedBefore = orderSurfaces(before);
  const orderedAfter = orderSurfaces(after);
  if (
    orderedBefore.length !== stable.length ||
    orderedAfter.length !== stable.length ||
    !orderedBefore.some((surface) => surface.actual_window_id === actualWindowId)
  ) {
    return { capture_surfaces_status: "capture_surfaces_unavailable" };
  }
  const fingerprint2 = (ordered) =>
    JSON.stringify(
      ordered.map((surface) => [
        surface.actual_window_id,
        surface.presentation_window_id,
        surface.owner_pid,
        surface.owner_bundle_id,
        surface.layer,
        ...surface.bounds,
      ]),
    );
  const beforeFingerprint = fingerprint2(orderedBefore);
  const afterFingerprint = fingerprint2(orderedAfter);
  if (beforeFingerprint !== afterFingerprint) {
    return { capture_surfaces_status: "capture_surfaces_changed" };
  }
  return {
    capture_surfaces: {
      presentation_window_id: presentationWindowId,
      before_fingerprint: beforeFingerprint,
      after_fingerprint: afterFingerprint,
      order: "front_to_back",
      surfaces: orderedBefore,
    },
  };
}
var MAC_BACKGROUND_WINDOW_SETTLE_ATTEMPTS = 30;
function hasOnscreenWindow(windows) {
  return Array.isArray(windows) && windows.some((window) => window?.onscreen !== false);
}
async function settleApplicationWindow(axSource, appRef) {
  if (!axSource.listWindows) return false;
  for (let attempt = 0; attempt < MAC_BACKGROUND_WINDOW_SETTLE_ATTEMPTS; attempt += 1) {
    const windows = await axSource.listWindows(appRef);
    if (hasOnscreenWindow(windows)) return true;
    if (attempt + 1 < MAC_BACKGROUND_WINDOW_SETTLE_ATTEMPTS) {
      await new Promise((resolve2) => setTimeout(resolve2, 100));
    }
  }
  return false;
}

// —— open_application helper 家族（原版 63 表最后一项，底稿：官方 SEA payload）——
function textParam(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function urlListParam(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const urls = value.filter((item) => typeof item === "string" && item.trim().length > 0);
  return urls.length > 0 ? urls : undefined;
}
function positiveInt(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
function optionalText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function launchHintPayload(value, target) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const pid = positiveInt(record.pid) ?? null;
  const bundleId =
    optionalText(record.bundle_id) ?? optionalText(record.bundleId) ?? target.bundleId ?? null;
  const name =
    optionalText(record.name) ?? target.name ?? bundleId ?? (pid ? `pid ${pid}` : null);
  if (!pid && !bundleId && !name) return null;
  return {
    pid,
    bundle_id: bundleId,
    name,
    active: typeof record.active === "boolean" ? record.active : false,
  };
}
function appPayload(app) {
  return {
    pid: app.pid,
    bundle_id: app.bundle_id ?? null,
    name: app.name ?? null,
    active: app.active ?? false,
  };
}
function positiveWindowId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
async function openAppDelay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
var OPEN_APPLICATION_RESOLVE_ATTEMPTS = 30;
function canonicalWindowsExecutable(value) {
  const trimmed = value?.trim();
  if (!trimmed || !win32.isAbsolute(trimmed)) return null;
  const withoutDevicePrefix = trimmed.startsWith("\\\\?\\") ? trimmed.slice(4) : trimmed;
  return win32.normalize(withoutDevicePrefix).toLowerCase();
}
function exactNameMatches(app, targetName) {
  const expected = targetName?.trim().toLocaleLowerCase();
  return Boolean(
    expected && typeof app.name === "string" && app.name.trim().toLocaleLowerCase() === expected,
  );
}
async function settleLiveActiveApp(axSource, found, target, excludedPids, budgetMs) {
  const steps = Math.max(1, Math.ceil(budgetMs / 100));
  for (let i = 0; i < steps; i += 1) {
    const apps = await axSource.listApplications();
    const matches = apps.filter((app) => {
      if (excludedPids?.has(app.pid)) return false;
      if (target.pid) return app.pid === target.pid;
      if (target.bundleId && !cuaBundleIdsEqual(app.bundle_id, target.bundleId, { loose: true })) {
        return false;
      }
      if (
        target.name &&
        app.name?.trim().toLocaleLowerCase() !== target.name.trim().toLocaleLowerCase()
      ) {
        return false;
      }
      return Boolean(target.bundleId || target.name);
    });
    const preferred = matches.find((app) => app.pid === found.pid);
    if (preferred?.active) return preferred;
    if (!target.pid) {
      const activeSibling = matches.find((app) => app.active);
      if (activeSibling) return activeSibling;
    }
    await openAppDelay(100);
  }
  return null;
}
async function settleLiveActive(axSource, pid, budgetMs) {
  const steps = Math.max(1, Math.ceil(budgetMs / 100));
  let active = false;
  for (let i = 0; i < steps; i += 1) {
    const apps = await axSource.listApplications();
    const match = apps.find((app) => app.pid === pid);
    active = match?.active ?? false;
    if (active) break;
    if (i + 1 < steps) await openAppDelay(100);
  }
  return active;
}
async function resolveOpenedApp(axSource, target, options: any = {}) {
  const rawLaunchHint = launchHintPayload(options.launchResult, target);
  const launchHint =
    rawLaunchHint?.pid && options.excludedPids?.has(rawLaunchHint.pid) ? null : rawLaunchHint;
  const platform2 = options.platform ?? "darwin";
  const isWindows = platform2 === "win32";
  if (!axSource) {
    return isWindows ? null : launchHint;
  }
  const windowsAppUserModelId =
    isWindows && options.windowsAppUserModelId?.trim() ? options.windowsAppUserModelId.trim() : undefined;
  if (windowsAppUserModelId) {
    if (!axSource.applicationInfoByAumid) return null;
    let found = null;
    for (let attempt = 0; attempt < OPEN_APPLICATION_RESOLVE_ATTEMPTS && !found; attempt += 1) {
      const candidate = await axSource.applicationInfoByAumid(windowsAppUserModelId);
      if (
        candidate &&
        typeof candidate.pid === "number" &&
        Number.isSafeInteger(candidate.pid) &&
        candidate.pid > 0
      ) {
        found = candidate;
        break;
      }
      await openAppDelay(100);
    }
    if (!found) return null;
    if (options.activateRequested && found.pid) {
      found = { ...found, active: await settleLiveActive(axSource, found.pid, 800) };
    }
    return found;
  }
  const preLaunchPids = new Set(
    (options.preLaunchApplications ?? [])
      .map((app) => app.pid)
      .filter((pid) => typeof pid === "number" && pid > 0),
  );
  const canonicalLaunchIdentity = canonicalWindowsExecutable(options.canonicalLaunchIdentity);
  let found = null;
  const attempts = options.attempts ?? (isWindows ? OPEN_APPLICATION_RESOLVE_ATTEMPTS : 8);
  for (let attempt = 0; attempt < attempts && !found; attempt += 1) {
    const preferredPid = launchHint?.pid ?? target.pid;
    const resolved = await axSource.applicationInfo?.(
      preferredPid
        ? { pid: preferredPid }
        : {
            bundle_id: target.bundleId ?? null,
            name: target.name ?? null,
          },
    );
    if (
      resolved &&
      !options.excludedPids?.has(resolved.pid) &&
      (!isWindows ||
        (canonicalLaunchIdentity !== null &&
          canonicalWindowsExecutable(resolved.bundle_id) === canonicalLaunchIdentity))
    ) {
      found = resolved;
      break;
    }
    const apps = await axSource.listApplications();
    if (isWindows) {
      if (preferredPid && options.preLaunchApplications && canonicalLaunchIdentity && axSource.applicationInfo) {
        const candidates = [
          ...new Map(
            apps
              .filter(
                (candidate) =>
                  typeof candidate.pid === "number" &&
                  candidate.pid > 0 &&
                  candidate.pid !== preferredPid &&
                  !preLaunchPids.has(candidate.pid) &&
                  !options.excludedPids?.has(candidate.pid) &&
                  canonicalWindowsExecutable(candidate.bundle_id) === canonicalLaunchIdentity,
              )
              .map((candidate: any) => [candidate.pid, candidate]),
          ).values(),
        ];
        const liveCandidates = (
          await Promise.all(
            candidates.map(async (candidate: any) => {
              const live = await axSource.applicationInfo?.({ pid: candidate.pid ?? undefined });
              return live &&
                live.pid === candidate.pid &&
                canonicalWindowsExecutable(live.bundle_id) === canonicalLaunchIdentity
                ? live
                : null;
            }),
          )
        ).filter((candidate) => candidate !== null);
        if (liveCandidates.length === 1) found = liveCandidates[0];
      }
    } else {
      const matches = target.bundleId
        ? apps.filter((app) => cuaBundleIdsEqual(app.bundle_id, target.bundleId, { loose: true }))
        : apps.filter((app) => exactNameMatches(app, target.name));
      const eligibleMatches = matches.filter((candidate) => !options.excludedPids?.has(candidate.pid));
      const app =
        eligibleMatches.find((candidate) => candidate.pid === preferredPid) ??
        eligibleMatches.find((candidate) => candidate.active) ??
        eligibleMatches[0];
      if (app) found = app;
    }
    if (!found && attempt + 1 < attempts) await openAppDelay(100);
  }
  if (!found) return isWindows ? null : launchHint;
  if (options.activateRequested && found.pid) {
    found = isWindows
      ? { ...found, active: await settleLiveActive(axSource, found.pid, 800) }
      : (await settleLiveActiveApp(axSource, found, target, options.excludedPids, 800)) ?? {
          ...found,
          active: false,
        };
  }
  return found;
}
var WINDOWS_CALCULATOR_AUMID = "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App";
var WINDOWS_PACKAGED_APP_ALIASES = /* @__PURE__ */ new Map([
  ["calculator", WINDOWS_CALCULATOR_AUMID],
  ["windows calculator", WINDOWS_CALCULATOR_AUMID],
  ["calc", WINDOWS_CALCULATOR_AUMID],
  ["calc.exe", WINDOWS_CALCULATOR_AUMID],
  ["\u8BA1\u7B97\u5668", WINDOWS_CALCULATOR_AUMID],
]);
function isWindowsAppUserModelId(value) {
  const trimmed = value?.trim();
  return Boolean(
    trimmed && trimmed.length <= 512 && /^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$/u.test(trimmed),
  );
}
function resolveWindowsPackagedAppAlias(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return WINDOWS_PACKAGED_APP_ALIASES.get(normalized);
}
var FILE_URL_WINDOW_VERIFY_ATTEMPTS = 30;
function fileTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "file:") return null;
  const encodedName = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!encodedName) return null;
  let filename;
  try {
    filename = decodeURIComponent(encodedName);
  } catch {
    filename = encodedName;
  }
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return { filename, stem };
}
function windowIdsOf(windows) {
  return new Set(
    windows
      .map((window) => window.window_id)
      .filter((id) => typeof id === "number" && Number.isInteger(id)),
  );
}
function titleMatches(title, target) {
  const normalized = title?.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return target.titleCandidates.some((candidate) => normalized === candidate.trim().toLocaleLowerCase());
}
function distinguishableTargets(targets) {
  const normalize = (value) => value.trim().toLocaleLowerCase();
  const filenameOwners = /* @__PURE__ */ new Map();
  for (const [targetIndex, target] of targets.entries()) {
    const filename = normalize(target.filename);
    const ownerIndex = filenameOwners.get(filename);
    if (ownerIndex !== undefined) {
      throw new Error(
        `file URL window verification cannot distinguish duplicate filename ${JSON.stringify(filename)} for ${JSON.stringify(targets[ownerIndex].filename)} and ${JSON.stringify(target.filename)}; the requested files cannot be verified safely.`,
      );
    }
    filenameOwners.set(filename, targetIndex);
  }
  const stemCounts = /* @__PURE__ */ new Map();
  for (const target of targets) {
    const stem = normalize(target.stem);
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  return targets.map((target, targetIndex) => {
    const filename = normalize(target.filename);
    const stem = normalize(target.stem);
    const stemConflictsWithFilename = [...filenameOwners.entries()].some(
      ([candidate, ownerIndex]) => candidate === stem && ownerIndex !== targetIndex,
    );
    const stemIsUnambiguous =
      stem !== filename && stemCounts.get(stem) === 1 && !stemConflictsWithFilename;
    return {
      ...target,
      titleCandidates: stemIsUnambiguous ? [target.filename, target.stem] : [target.filename],
    };
  });
}
function hasOneToOneWindowMatch(windows, baseline) {
  const targets = baseline.targets;
  const baselineWindowIds = baseline.windowIds;
  const candidateWindows = windows.filter(
    (window) => typeof window.window_id === "number" && Number.isInteger(window.window_id),
  );
  const targetForWindow = /* @__PURE__ */ new Map();
  const assign = (targetIndex, visited) => {
    for (const window of candidateWindows) {
      const target = targets[targetIndex];
      const isFresh = !baselineWindowIds.has(window.window_id);
      const baselineTitle = baseline.windowTitles?.get(window.window_id);
      const existingWindowNavigated =
        baselineWindowIds.has(window.window_id) &&
        !titleMatches(baselineTitle, target) &&
        titleMatches(window.title, target);
      if (
        (!isFresh && !existingWindowNavigated) ||
        visited.has(window.window_id) ||
        !titleMatches(window.title, target)
      ) {
        continue;
      }
      visited.add(window.window_id);
      const previousTarget = targetForWindow.get(window.window_id);
      if (previousTarget === undefined || assign(previousTarget, visited)) {
        targetForWindow.set(window.window_id, targetIndex);
        return true;
      }
    }
    return false;
  };
  return targets.every((_target, targetIndex) => assign(targetIndex, /* @__PURE__ */ new Set()));
}
async function captureFileUrlWindowBaseline(listWindows, urls) {
  if (!listWindows || !urls) return null;
  const parsedTargets = urls.map(fileTarget).filter((target) => target !== null);
  if (parsedTargets.length === 0) return null;
  const targets = distinguishableTargets(parsedTargets);
  try {
    const windows = await listWindows();
    if (!windows) return null;
    return {
      targets,
      windowIds: windowIdsOf(windows),
      windowTitles: new Map(
        windows
          .filter(
            (window) =>
              typeof window.window_id === "number" && Number.isInteger(window.window_id),
          )
          .map((window) => [window.window_id, window.title]),
      ),
    };
  } catch {
    return null;
  }
}
async function verifyFileUrlWindowEffect(listWindows, baseline, options: any = {}) {
  if (!baseline || !listWindows) return "unavailable";
  const attempts = options.attempts ?? FILE_URL_WINDOW_VERIFY_ATTEMPTS;
  const delayFn =
    options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastWindows = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const windows = await listWindows();
    if (windows) {
      lastWindows = windows;
      if (hasOneToOneWindowMatch(windows, baseline)) {
        return "verified";
      }
    }
    if (attempt + 1 < attempts) await delayFn(100);
  }
  throw new Error(
    `the app process resolved, but the requested file URL did not produce a matching accessibility window. Requested files: ${baseline.targets.map((target) => target.filename).join(", ")}; before window_ids=${JSON.stringify([...baseline.windowIds])}; after window_ids=${JSON.stringify([...windowIdsOf(lastWindows)])}.`,
  );
}
async function resolveAppByPid(axSource, pid, options: any = {}) {
  if (!axSource) return null;
  if (axSource.applicationInfo) {
    try {
      const info = await axSource.applicationInfo({ pid });
      if (info && info.pid !== pid) {
        const details = {
          action_sent: options.actionSent === true,
          request_delivery_state: options.actionSent === true ? "possibly_sent" : "not_sent",
          reason: "pid_identity_conflict",
          requested_pid: pid,
          actual_pid: info.pid,
        };
        const message = `open_application direct PID lookup conflict: requested pid ${pid}, but applicationInfo returned pid ${String(info.pid)}.`;
        throw options.actionSent === true ? launchFailed(message, details) : invalidRequest(message, details);
      }
      if (info?.pid === pid && (info.bundle_id || info.name)) {
        return info;
      }
    } catch (error) {
      if (error instanceof BrokerError) throw error;
    }
  }
  const apps = await axSource.listApplications();
  return apps.find((app) => app.pid === pid) ?? null;
}
async function rollbackFreshApplication(adapter, axSource, app) {
  if (!app.pid || !app.bundle_id || !adapter.terminateApplication) {
    return "unavailable";
  }
  let live;
  try {
    live = await resolveAppByPid(axSource, app.pid);
  } catch {
    return "refused_identity_unavailable";
  }
  if (!live?.bundle_id || !cuaBundleIdsEqual(live.bundle_id, app.bundle_id)) {
    return "refused_identity_changed";
  }
  try {
    const terminated = await adapter.terminateApplication(app.pid, app.bundle_id);
    return terminated ? `terminated_verified_pid_${app.pid}` : `termination_refused_for_verified_pid_${app.pid}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `termination_failed_for_verified_pid_${app.pid}: ${message}`;
  }
}
var FRESH_ROLLBACK_DISCOVERY_ATTEMPTS = 4;
var FRESH_ROLLBACK_DISCOVERY_DELAY_MS = 25;
async function discoverFreshApplicationForRollback(axSource, baselinePids, target, preferredPids) {
  if (!axSource) return null;
  for (let attempt = 0; attempt < FRESH_ROLLBACK_DISCOVERY_ATTEMPTS; attempt += 1) {
    let apps;
    try {
      apps = await axSource.listApplications();
    } catch {
      apps = [];
    }
    const freshMatches = apps.filter((candidate) => {
      if (baselinePids.has(candidate.pid) || !candidate.bundle_id) return false;
      if (target.bundleId) {
        return cuaBundleIdsEqual(candidate.bundle_id, target.bundleId, { loose: true });
      }
      return Boolean(
        target.name &&
          candidate.name?.trim().toLocaleLowerCase() === target.name.trim().toLocaleLowerCase(),
      );
    });
    const preferred = freshMatches.find((candidate) => preferredPids.has(candidate.pid));
    const candidate = preferred ?? (freshMatches.length === 1 ? freshMatches[0] : null);
    if (candidate?.bundle_id) {
      return { pid: candidate.pid, bundle_id: candidate.bundle_id };
    }
    if (freshMatches.length > 1) return null;
    if (attempt + 1 < FRESH_ROLLBACK_DISCOVERY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, FRESH_ROLLBACK_DISCOVERY_DELAY_MS));
    }
  }
  return null;
}
async function settleActivatedAppByPid(axSource, pid, budgetMs = 800) {
  const attempts = Math.max(1, Math.ceil(budgetMs / 100));
  let app = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    app = await resolveAppByPid(axSource, pid, { actionSent: true });
    if (!app || app.active === true) return app;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return app;
}
async function activateMacFilePanelSurface(options) {
  const { adapter, axSource, app, windowId } = options;
  if (!axSource?.captureApp || !app.pid || !app.bundle_id) {
    throw foregroundRequired(
      "open_application: confirmed file-panel activation requires live AX app, bundle, and surface evidence. action_sent=false.",
      { action_sent: false, reason: "foreground_required" },
    );
  }
  const foregroundPidBefore =
    (await axSource.listApplications()).find((candidate) => candidate.active === true)?.pid ?? null;
  let snapshot;
  try {
    snapshot = await axSource.captureApp({
      pid: app.pid,
      bundle_id: app.bundle_id,
      window_id: windowId,
    });
  } catch {
    snapshot = null;
  }
  try {
    const actualWindowId = snapshot?.window.window_id;
    const presentationWindowId =
      positiveWindowId(snapshot?.window.presentation_window_id) ?? actualWindowId;
    const surfaceKind = snapshot?.window.surface_kind;
    if (
      !snapshot ||
      typeof actualWindowId !== "number" ||
      actualWindowId !== windowId ||
      typeof presentationWindowId !== "number"
    ) {
      throw elementUnavailable(
        "open_application: requested file-panel surface was closed or replaced before activation. For ordinary application activation, retry with window_id omitted. action_sent=false.",
        {
          action_sent: false,
          reason: "surface_replaced",
          expected_window_id: windowId,
          actual_window_id: typeof actualWindowId === "number" ? actualWindowId : null,
        },
      );
    }
    if (
      surfaceKind !== "open_panel" &&
      surfaceKind !== "save_panel" &&
      surfaceKind !== "attached_dialog"
    ) {
      throw foregroundRequired(
        "open_application: confirmed foreground recovery is limited to open/save panels and their attached sheets. For ordinary application activation, retry with window_id omitted. action_sent=false.",
        {
          action_sent: false,
          reason: "unsupported_surface_kind",
          surface_kind: surfaceKind ?? "unknown",
        },
      );
    }
    const exactSurface = snapshot.surfaces?.find(
      (surface) =>
        surface.actual_window_id === actualWindowId &&
        surface.presentation_window_id === presentationWindowId &&
        surface.surface_kind === surfaceKind,
    );
    const hasPanelAncestor =
      surfaceKind !== "attached_dialog" ||
      snapshot.surfaces?.some(
        (surface) =>
          surface.presentation_window_id === presentationWindowId &&
          (surface.surface_kind === "open_panel" || surface.surface_kind === "save_panel"),
      ) === true;
    if (!exactSurface || !hasPanelAncestor) {
      throw foregroundRequired(
        "open_application: attached surface has no fresh open/save panel lineage. action_sent=false.",
        {
          action_sent: false,
          reason: "surface_lineage_unverified",
          actual_window_id: actualWindowId,
          presentation_window_id: presentationWindowId,
          surface_kind: surfaceKind,
        },
      );
    }
    const actualOwnerPid = positiveWindowId(snapshot.window.actual_owner_pid) ?? app.pid;
    const actualOwnerBundleId =
      typeof snapshot.window.actual_owner_bundle_id === "string" &&
      snapshot.window.actual_owner_bundle_id.trim()
        ? snapshot.window.actual_owner_bundle_id.trim()
        : actualOwnerPid === app.pid
          ? app.bundle_id
          : (await resolvePidIdentity(axSource, actualOwnerPid, "open_application:file_panel_surface_owner"))
              ?.bundle_id;
    if (!actualOwnerBundleId) {
      throw elementUnavailable(
        "open_application: file-panel surface owner has no verified bundle identity. action_sent=false.",
        {
          action_sent: false,
          reason: "surface_owner_unverified",
          actual_owner_pid: actualOwnerPid,
          actual_window_id: actualWindowId,
        },
      );
    }
    if (typeof adapter.activateAppFrameSurface !== "function") {
      throw notAuthorized(
        "open_application: native file-panel surface activation ABI is unavailable. action_sent=false.",
      );
    }
    const activated = adapter.activateAppFrameSurface({
      logicalPid: app.pid,
      logicalBundleId: app.bundle_id,
      presentationWindowId,
      actualOwnerPid,
      actualOwnerBundleId,
      actualWindowId,
      surfaceKind,
    });
    if (!activated.ok) {
      if (activated.reason === "not_trusted") {
        throw permissionDenied(
          "open_application: Accessibility is not granted to the Computer Use Helper. action_sent=false.",
          { action_sent: false, reason: "not_trusted" },
        );
      }
      throw foregroundRequired(
        `open_application: native file-panel surface activation failed verification (native_reason=${activated.reason}, foreground_pid_before=${activated.foreground_pid_before ?? "unknown"}, foreground_pid_after=${activated.foreground_pid_after ?? "unknown"}). action_sent=false.`,
        {
          action_sent: false,
          reason: "foreground_required",
          native_reason: activated.reason,
          actual_window_id: actualWindowId,
          presentation_window_id: presentationWindowId,
        },
      );
    }
    const nativeForegroundPidAfter = activated.foreground_pid_after;
    if (nativeForegroundPidAfter !== app.pid) {
      throw foregroundRequired(
        "open_application: native file-panel activation returned no matching WindowServer foreground owner. action_sent=false.",
        {
          action_sent: false,
          reason: "foreground_required",
          foreground_pid_before: activated.foreground_pid_before ?? foregroundPidBefore,
          foreground_pid_after: nativeForegroundPidAfter ?? null,
          expected_pid: app.pid,
        },
      );
    }
    let verified = null;
    try {
      verified = await axSource.captureApp({
        pid: app.pid,
        bundle_id: app.bundle_id,
        window_id: actualWindowId,
      });
      if (
        !verified ||
        verified.app.active !== true ||
        verified.window.focused !== true ||
        verified.window.window_id !== actualWindowId ||
        verified.window.presentation_window_id !== presentationWindowId ||
        verified.window.surface_kind !== surfaceKind
      ) {
        const replaced =
          verified?.window.window_id_fallback === true ||
          (typeof verified?.window.window_id === "number" && verified.window.window_id !== actualWindowId);
        const factory = replaced ? elementUnavailable : foregroundRequired;
        throw factory(
          replaced
            ? "open_application: file-panel surface changed during activation. action_sent=false."
            : "open_application: logical app or exact file-panel surface did not become frontmost and focused. action_sent=false.",
          {
            action_sent: false,
            reason: replaced ? "surface_replaced" : "foreground_required",
            expected_window_id: actualWindowId,
            actual_window_id: verified?.window.window_id ?? null,
          },
        );
      }
    } finally {
      verified?.captureLease?.release();
    }
    return {
      active: true,
      actual_window_id: actualWindowId,
      presentation_window_id: presentationWindowId,
      actual_owner_pid: actualOwnerPid,
      actual_owner_bundle_id: actualOwnerBundleId,
      surface_kind: surfaceKind,
      foreground_pid_before: foregroundPidBefore,
      foreground_pid_after: nativeForegroundPidAfter,
      focused_window_id: activated.focused_window_id ?? actualWindowId,
      native_reason: "activated",
    };
  } finally {
    snapshot?.captureLease?.release();
  }
}

export function createElectronNativeBackend(options) {
  const { adapter, brokerInfo, axSource } = options;
  const diagnostic = options.onDiagnostic;
  const supportsScreenCapture = adapter.supportsScreenCapture !== false;
  const supportsClipboard = adapter.supportsClipboard !== false;
  const screenCaptureUnavailableMessage =
    brokerInfo.platform === "win32"
      ? "Screen capture is unavailable in this Windows Computer Use Helper build until Windows Graphics Capture is implemented."
      : "Screen capture is unavailable in this ZCode Computer Use build because no capture adapter is installed.";
  const hasAxSource = Boolean(axSource);
  const hasAutomationBridge = Boolean(axSource?.warmAutomationPermission);
  const hasElementActions = hasTokenScopedElementActions(axSource);
  const hasCoordinateHitTest = Boolean(axSource?.elementAtPoint);
  const hasAppScopedInput = hasAppScopedKeyboard(adapter);
  const automationPermissionStatus = hasAutomationBridge ? "unknown" : "not_required";
  const displayTopology = createElectronDisplayTopology(adapter);
  // 原版 63 表（第十轮重放）：screen_size/cursor_position/list_displays/set_display
  // 共享的显示器选择状态（用户显式 set_display 后快照跟随选择，否则跟随主屏）。
  const displaySelection = createElectronDisplaySelection(adapter);
  const captureTopology = () => {
    const { displays, primaryId } = displayTopology.topology();
    const entries = displays.map((display, index) => ({
      index: index + 1,
      id: display.id,
      bounds: [display.bounds.x, display.bounds.y, display.bounds.width, display.bounds.height],
      main: display.id === primaryId,
      scale_factor: display.scaleFactor,
    }));
    return {
      entries,
      fingerprint: displayTopologyFingerprint(entries),
    };
  };
  const screenCaptureStatus = () => mapScreenStatus(adapter.getScreenMediaAccessStatus());
  const requireVerifiedWindowsFramePixels = (method) => {
    if (brokerInfo.platform !== "win32") return;
    const dpi = adapter.getNativeDpiAwareness?.();
    if (dpi?.awareness === 2 && dpi.per_monitor_v2 === true) return;
    throw elementUnavailable(
      `${method}: the Helper is not effectively per-monitor-v2 DPI aware; capture and input coordinates cannot safely mint actionable frame pixels.`,
      { action_sent: false, reason: "dpi_awareness_unverified" },
    );
  };
  const inputHandlers = createElectronInputHandlers({
    adapter,
    axSource,
    // AX hit-test 始终可用。
    allowAxHitTestClick: true,
    platform: brokerInfo.platform,
    getDisplayTopology: () => captureTopology().entries,
  });
  const implemented = {
    // app-scoped + global synthetic-input handlers live in electronInputHandlers.ts
    // (click/scroll/drag/type_text*/press_key/hold_key and *_to_app).
    ...inputHandlers,
    broker_info: () => ({
      ...brokerInfo,
      backend: "electron",
      // Phase 4 wire handshake:broker 协议版本(非破坏)。客户端握手后比对,版本不匹配时升级/降级提示。
      // 当前帧格式仍是 NDJSON(换行分隔);未来切 4 字节长度前缀时此版本号 +1,客户端据此协商。
      api_version: "ZCodeComputerUseIPC-1",
      framing: "ndjson",
      // 承载 broker 的进程 pid：standalone helper 时即 helper 自己的 pid，让 ZCode 主进程能
      // terminate/relaunch；in-process 时是 ZCode 主进程 pid。
      pid: process.pid,
      authorization_subject: authorizationSubject(brokerInfo),
      tcc_grant_owner: brokerInfo.bundle_id,
      one_time_grant_supported: true,
      accessibility_bridge: hasAutomationBridge
        ? "system_events_bridge"
        : hasAxSource
          ? "native_ax"
          : "none",
      automation_permission_required: hasAutomationBridge,
      automation_permission_status: automationPermissionStatus,
      automation_permission_grant_owner: hasAutomationBridge ? brokerInfo.bundle_id : null,
      automation_permission_target: hasAutomationBridge ? "com.apple.systemevents" : null,
      native_dpi_awareness:
        brokerInfo.platform === "win32" ? (adapter.getNativeDpiAwareness?.() ?? null) : null,
      capabilities: {
        screen: supportsScreenCapture,
        screenshot: supportsScreenCapture,
        app_scoped_capture: hasAxSource,
        clipboard: supportsClipboard,
        open_application: Boolean(adapter.openApplication),
        ax_observation: hasAxSource,
        token_scoped_element_actions: hasElementActions,
        coordinate_hit_test: hasCoordinateHitTest,
        app_scoped_text_input: hasAppScopedInput,
        app_scoped_key_input: hasAppScopedInput,
        synthetic_input: false,
        raw_mouse_keyboard: hasRawMouseKeyboard(adapter),
      },
    }),
    request_access: (params) => {
      const requested = capabilityList2(params.capabilities);
      const wantsAccessibility = wantsCapability(requested, [
        "accessibility",
        "input",
        "keyboard",
        "mouse",
        "a11y",
      ]);
      const wantsScreen = wantsCapability(requested, [
        "screen",
        "screen_recording",
        "screenshot",
        "capture",
      ]);
      const accessibilityBefore = adapter.isTrustedAccessibilityClient(false)
        ? "granted"
        : "denied";
      const accessibilityAfter = accessibilityBefore;
      const automationBefore = automationPermissionStatus;
      const automationAfter = automationBefore;
      const automationWarmupAttempted = false;
      const automationWarmupError = null;
      const screenBefore = screenCaptureStatus();
      const screenAfter = screenBefore;
      const screenWarmupAttempted = false;
      const screenPrompted = false;
      const screenImageCaptured = false;
      const screenWarmupError = null;
      const screenCaptureImplementationUnavailable = wantsScreen && !supportsScreenCapture;
      const missingPanes = [];
      if (wantsAccessibility && accessibilityAfter !== "granted") {
        missingPanes.push("accessibility");
      }
      if (wantsScreen && supportsScreenCapture && screenAfter !== "granted") {
        missingPanes.push("screen_recording");
      }
      const permissionMessage = permissionGuideMessage({
        brokerInfo,
        accessibility: wantsAccessibility ? accessibilityAfter : "not_required",
        screenRecording: wantsScreen && supportsScreenCapture ? screenAfter : "not_required",
      });
      return {
        grant_owner: brokerInfo.bundle_id,
        owner: authorizationSubject(brokerInfo),
        requested_capabilities: requested,
        accessibility: {
          status_before: accessibilityBefore,
          prompted: false,
          status_after: accessibilityAfter,
          action_required:
            wantsAccessibility && accessibilityAfter !== "granted"
              ? accessibilityActionRequired(brokerInfo)
              : null,
        },
        automation_permission: hasAutomationBridge
          ? {
              status_before: automationBefore,
              warmup_attempted: automationWarmupAttempted,
              status_after: automationAfter,
              grant_owner: brokerInfo.bundle_id,
              target: "com.apple.systemevents",
              action_required: wantsAccessibility
                ? automationActionRequired(
                    automationAfter === "not_required" ? "unknown" : automationAfter,
                    brokerInfo,
                  )
                : null,
              error: automationWarmupError,
            }
          : {
              status_before: "not_required",
              warmup_attempted: false,
              status_after: "not_required",
              grant_owner: null,
              target: null,
              action_required: null,
              error: null,
            },
        screen_recording: {
          status_before: screenBefore,
          prompted: screenPrompted,
          warmup_attempted: screenWarmupAttempted,
          image_captured: screenImageCaptured,
          status_after: screenAfter,
          action_required: screenCaptureImplementationUnavailable
            ? screenCaptureUnavailableMessage
            : wantsScreen
              ? screenAfter === "granted"
                ? null
                : screenRecordingActionRequired(brokerInfo)
              : null,
          error: screenWarmupError,
        },
        // 友好的权限汇总：给 agent / 用户一条可直接读的提示，点名 app、两项用途与各自状态。
        // （只列 Accessibility + Screen Recording——Computer Use Helper 实际只需这两项；Input Monitoring 是
        // 给监听输入用的，本 Helper 合成输入归 Accessibility 管，不需要。）
        permission_guide: {
          all_required_granted:
            missingPanes.length === 0 && !screenCaptureImplementationUnavailable,
          missing: missingPanes,
          message: screenCaptureImplementationUnavailable
            ? `${screenCaptureUnavailableMessage} ${permissionMessage}`
            : permissionMessage,
        },
        note:
          authorizationSubjectKind(brokerInfo) === "zcode_helper"
            ? "Authorization status belongs to ZCode Computer Use.app. This report is read-only; request missing grants through the trusted ZCode host UI."
            : "Authorization status belongs to ZCode.app. This report is read-only; request missing grants through the trusted ZCode host UI.",
      };
    },
    // 诊断：AX 信任度做 supports_accessibility / input 权限的诊断代理（prompt=false 不弹窗）。
    supports_accessibility: () => hasAxSource && adapter.isTrustedAccessibilityClient(false),
    input_permission_status: () =>
      adapter.isTrustedAccessibilityClient(false) ? "granted" : "denied",
    screen_capture_status: () => screenCaptureStatus(),
    // 只读权限快照（不弹窗）：供 UI 权限面板实时展示 Accessibility + Screen Recording 两项。
    // AX 用 prompt=false（AXIsProcessTrusted）、Screen 用 CGPreflightScreenCaptureAccess，均无副作用。
    // 注意：这是 preflight 快照，仅用于 UI 展示，不做 effective-readiness 探测、也不触发任何弹窗/二次确认。
    // 弹窗是纯引导：不自动 requestPermissions、不做任务恢复；request_access 仅由按钮显式触发。
    // TCC.db 的 service+bundle-id 行仅作诊断：它没有证明当前 binary 的 csreq/CDHash 获授权，不能
    // 参与 granted/stale 判定。用户从系统设置回来后由 UI 精确重启一次 Helper，再以新进程的 runtime
    // preflight + 功能探针收敛；无 Full Disk Access 时 persisted=false 也不改变状态语义。
    permission_status: () => {
      const client = brokerInfo.bundle_id;
      const axRuntime = adapter.isTrustedAccessibilityClient(false);
      const axProbe = readAccessibilityProbe(adapter);
      const effectiveGranted =
        axProbe.classification === "functional" ||
        (axProbe.classification !== "disabled" && axRuntime);
      const accessibility = effectiveGranted ? "granted" : "denied";
      const screenRuntime = screenCaptureStatus();
      return {
        grant_owner: client,
        owner: authorizationSubject(brokerInfo),
        accessibility,
        accessibility_probe: {
          source: axProbe.source,
          ok: axProbe.ok,
          ax_error: axProbe.axError,
          classification: axProbe.classification,
          runtime: axRuntime,
          // Hot readiness poll 不再同步查询 user/system TCC SQLite：历史 row 不参与任何决策，且无 FDA
          // 时结果也无诊断价值。显式诊断面后续可按需采样；null 明确表示本快照未采样。
          persisted: null,
        },
        screen_recording: screenRuntime,
        screen_recording_probe: {
          runtime: screenRuntime,
          persisted: null,
        },
      };
    },
    // 非破坏性 screen-capture 探针（readiness 用）：TCC 预检可能报 granted 而 WindowServer 尚未放行本
    // 进程截屏，只有真抓到像素才算 screen 端到端可用。
    //
    // 修复原因（review !1460 Critical / Filesystem-Privacy）：之前只在 status==="denied" 时跳过抓取，
    // 但 mapScreenStatus 会把 Electron 的 not-determined 归一成 "unknown"，此时仍会调 captureScreenPng()
    // ——而首次截屏正是 macOS 触发/预热系统录屏授权流程的动作。后台 readiness 探针绝不能在用户尚未主动
    // 授权时改变权限交互状态、弹出授权对话框。因此收紧成：只有 status==="granted" 才真截屏；denied 与
    // unknown/not-determined 一律 probed:false 直接返回（未知权限 != 已授权，read-only 分类才成立）。
    screen_capture_probe: createForeignWindowScreenCaptureProbe(adapter, screenCaptureStatus),
    /**
     * 原生粘贴。整个「保存剪贴板 → 写入 → 发粘贴键 → 还原」在 Helper 内部一次完成。
     *
     * 为什么不在 host 侧用 read_clipboard/write_clipboard 拼四步：
     *   1. 那需要保留两个 broker 剪贴板原语，而它们已经没有别的消费者（协议瘦身 63 → 49）；
     *   2. 四步之间用户或另一个进程改写剪贴板，还原会把对方的新内容覆盖掉 —— 原子化消掉这个竞态。
     * 与 Codex 同构：它的 paste 也是 performAction 的一个 native variant，而非 host 侧组合。
     *
     * 粘贴键按平台选择：macOS cmd+v，Linux / Windows ctrl+v。
     */
    // —— 原版 63 表方法（第十轮重放，底稿：官方 SEA payload 未混淆 bundle）——
    // 显示器选择四件套：尺寸跟随当前选择（未显式 set_display 时为主屏）；
    // cursor_position 归属判定按显示器 bounds 命中；list_displays 输出 1 基下标。
    screen_size: () => {
      const display = displaySelection.current();
      return { width: display.size.width, height: display.size.height };
    },
    cursor_position: () => {
      const point = adapter.getCursorScreenPoint();
      const displayStatus = displaySelection.status();
      const displays = displayStatus.displays;
      let cursorDisplay = null;
      for (let i = 0; i < displays.length; i += 1) {
        const { x: ox, y: oy, width: w, height: h } = displays[i].bounds;
        if (point.x >= ox && point.x < ox + w && point.y >= oy && point.y < oy + h) {
          cursorDisplay = i + 1;
          break;
        }
      }
      return {
        x: point.x,
        y: point.y,
        coordinateSpace: "screen",
        selected_display: displayStatus.selectedIndex,
        cursor_display: cursorDisplay,
      };
    },
    list_displays: () => {
      const { displays, primaryId } = displaySelection.topology();
      return displays.map((display, index) => ({
        index: index + 1,
        id: display.id,
        bounds: [display.bounds.x, display.bounds.y, display.bounds.width, display.bounds.height],
        main: display.id === primaryId,
        scale_factor: display.scaleFactor,
      }));
    },
    set_display: (params) => {
      displaySelection.select(params.index);
      return null;
    },
    // 全屏截图：捕获前后双拓扑指纹 + WindowServer 窗口栈指纹，任一变化即拒绝，
    // 保证返回像素与坐标系可安全配对（frame_pixel_projection_v1）。
    screenshot: async (params) => {
      if (!supportsScreenCapture) {
        throw notAuthorized(screenCaptureUnavailableMessage);
      }
      if (screenCaptureStatus() === "denied") {
        throw permissionDenied(
          `Screen Recording is denied for ZCode. ${authorizationSubjectHint(brokerInfo, "Screen Recording")}`,
        );
      }
      requireVerifiedWindowsFramePixels("screenshot");
      const displaySnapshot = Object.prototype.hasOwnProperty.call(params, "display_id")
        ? displaySelection.snapshotForId(params.display_id)
        : displaySelection.snapshot();
      const selectedDisplay = displaySnapshot.current;
      const selectedDisplayBounds = [
        selectedDisplay.bounds.x,
        selectedDisplay.bounds.y,
        selectedDisplay.bounds.width,
        selectedDisplay.bounds.height,
      ];
      if (
        selectedDisplay.framePixelVerified === false ||
        displaySnapshot.displays.some((display) => display.framePixelVerified === false)
      ) {
        throw elementUnavailable(
          "screenshot: native display geometry is unavailable; raster-dimension fallback displays cannot mint actionable frame pixels. Retry after the native display topology is ready.",
          { action_sent: false, reason: "display_geometry_unverified" },
        );
      }
      const beforeTopology = displaySnapshot.displays.map((display, index) => ({
        index: index + 1,
        id: display.id,
        bounds: [display.bounds.x, display.bounds.y, display.bounds.width, display.bounds.height],
        main: index === 0,
        scale_factor: display.scaleFactor,
      }));
      let beforeWindows = null;
      let png = null;
      const maxCaptureAttempts = adapter.listScreenCaptureProbeWindows ? 3 : 1;
      for (let attempt = 1; attempt <= maxCaptureAttempts; attempt += 1) {
        beforeWindows = captureScreenshotWindows(adapter, selectedDisplayBounds);
        png = await adapter.captureScreenPng(selectedDisplay.bounds);
        if (!png || png.length === 0) {
          throw permissionDenied(
            `Screen capture returned no image. ${authorizationSubjectHint(brokerInfo, "Screen Recording")}`,
          );
        }
        const afterTopology = captureTopology();
        if (displayTopologyFingerprint(beforeTopology) !== afterTopology.fingerprint) {
          throw elementUnavailable(
            "screenshot: display topology or scale factor changed while the image was captured; capture again. action_sent=false.",
            { action_sent: false, reason: "display_topology_changed" },
          );
        }
        const afterWindows = beforeWindows
          ? captureScreenshotWindows(adapter, selectedDisplayBounds)
          : null;
        if (!beforeWindows || (afterWindows && beforeWindows.fingerprint === afterWindows.fingerprint)) {
          break;
        }
        if (attempt === maxCaptureAttempts) {
          throw elementUnavailable(
            "screenshot: WindowServer window ordering or ownership changed while the image was captured; capture again. action_sent=false.",
            { action_sent: false, reason: "window_stack_changed" },
          );
        }
      }
      if (!png) {
        throw permissionDenied(
          `Screen capture returned no image. ${authorizationSubjectHint(brokerInfo, "Screen Recording")}`,
        );
      }
      return {
        format: "png",
        data: toBase64(png),
        display: {
          // 截图溯源命名真正提供像素的显示器，与用户是否显式 set_display 无关；
          // selectedIndex 的可空语义只属于 cursor_position 的「显式选择」状态。
          index: displaySnapshot.currentIndex,
          id: selectedDisplay.id,
          bounds: [
            selectedDisplay.bounds.x,
            selectedDisplay.bounds.y,
            selectedDisplay.bounds.width,
            selectedDisplay.bounds.height,
          ],
          main: selectedDisplay.id === displaySnapshot.displays[0]?.id,
          scale_factor: selectedDisplay.scaleFactor,
        },
        display_topology: beforeTopology,
        coordinate_contract: "frame_pixel_projection_v1",
        ...(beforeWindows ? { capture_windows: beforeWindows } : {}),
      };
    },
    // 剪贴板：adapter 层按平台提供（win32 原生导出；mac 无原生剪贴板导出时
    // supportsClipboard=false，与原版 mac 同样 fail-closed notAuthorized）。
    read_clipboard: async () => {
      if (!supportsClipboard) {
        throw notAuthorized("read_clipboard is unavailable in this ZCode Computer Use build.");
      }
      return await adapter.readClipboardText();
    },
    write_clipboard: async (params) => {
      if (!supportsClipboard) {
        throw notAuthorized("write_clipboard is unavailable in this ZCode Computer Use build.");
      }
      const text = typeof params.text === "string" ? params.text : "";
      await adapter.writeClipboardText(text);
      return null;
    },
    // 原版 63 表最后一项（第十一轮重放）：应用启动 + 启动后身份核验。关键语义：
    // pid/bundle_id/name 三选一；darwin 上 name 为权威输入时先消歧并反查 bundle id；
    // new_instance 仅 darwin LaunchServices 支持，失败时做 fresh-process 回滚；
    // file:// URL 启动要验证「真的开出了对应标题的窗口」后才报成功。
    open_application: async (params) => {
      if (!adapter.openApplication) {
        throw notAuthorized("open_application is unavailable in this ZCode build.");
      }
      const timingStartedAt = performance.now();
      let timingPhaseStartedAt = timingStartedAt;
      const timingMs = {};
      const finishTimingPhase = (name) => {
        const now = performance.now();
        timingMs[name] = Math.max(0, Math.round(now - timingPhaseStartedAt));
        timingPhaseStartedAt = now;
      };
      if (brokerInfo.platform === "win32" && !axSource) {
        throw permissionDenied(
          "open_application requires the native Windows UIA app resolver; refusing to launch because post-launch identity cannot be verified.",
        );
      }
      const appObj =
        params.app && typeof params.app === "object" && !Array.isArray(params.app) ? params.app : {};
      const bundleId = textParam(params.bundle_id) ?? textParam(appObj.bundle_id);
      const name = textParam(params.name) ?? textParam(appObj.name);
      const rawPid =
        typeof params.pid === "number" && Number.isInteger(params.pid) && params.pid > 0
          ? params.pid
          : typeof appObj.pid === "number" && Number.isInteger(appObj.pid) && appObj.pid > 0
            ? appObj.pid
            : undefined;
      const requestedSurfaceWindowId = positiveWindowId(params.window_id) ?? positiveWindowId(appObj.window_id);
      const newInstance = params.new_instance === true || appObj.new_instance === true;
      if (newInstance && rawPid) {
        throw invalidRequest(
          "open_application new_instance=true cannot be combined with app.pid: a pinned pid names an existing process. Omit pid and reuse the fresh pid returned after launch.",
        );
      }
      if (newInstance && brokerInfo.platform !== "darwin") {
        throw permissionDenied(
          `open_application new_instance=true is unavailable on ${brokerInfo.platform}; only macOS LaunchServices supports this verified isolation mode.`,
        );
      }
      if (newInstance && !axSource) {
        throw launchFailed(
          "open_application new_instance=true requires the native AX app resolver to verify a fresh pid before reporting success.",
        );
      }
      const resolvedWindowsPackagedAppAlias2 =
        brokerInfo.platform === "win32" && !rawPid && !bundleId
          ? resolveWindowsPackagedAppAlias(name)
          : undefined;
      const windowsAppUserModelId =
        brokerInfo.platform === "win32" && !rawPid
          ? isWindowsAppUserModelId(bundleId)
            ? bundleId
            : resolvedWindowsPackagedAppAlias2
          : undefined;
      if (!bundleId && !name && !rawPid) {
        throw invalidRequest("open_application requires bundle_id, name, or pid.");
      }
      let resolvedBundleId = windowsAppUserModelId ?? bundleId;
      let nameIsAuthoritative =
        brokerInfo.platform === "darwin" ? !rawPid && !bundleId : Boolean(name);
      let resolvedName = windowsAppUserModelId || !nameIsAuthoritative ? undefined : name;
      if (brokerInfo.platform === "darwin" && nameIsAuthoritative && name) {
        const liveNameMatches = axSource
          ? (await axSource.listApplications()).filter(
              (candidate) => candidate.name?.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
            )
          : [];
        if (liveNameMatches.length > 1) {
          throw invalidRequest(
            `open_application app name is ambiguous: ${JSON.stringify(name)} matched ${liveNameMatches.length} live processes. Call list_apps and retry with app.pid.`,
            { action_sent: false, reason: "ambiguous_app_name" },
          );
        }
        const registeredBundleId =
          liveNameMatches[0]?.bundle_id ??
          (adapter.resolveApplicationBundleId ? await adapter.resolveApplicationBundleId(name) : null);
        if (!registeredBundleId) {
          throw invalidRequest(
            `open_application could not resolve the installed macOS application named ${JSON.stringify(name)}. Use the original user-provided name once; do not translate it, search with Bash/Finder/Spotlight, or substitute another application.`,
            { action_sent: false, reason: "application_name_unresolved" },
          );
        }
        resolvedBundleId = registeredBundleId;
        resolvedName = undefined;
        nameIsAuthoritative = false;
      }
      if (rawPid) {
        if (!axSource) {
          throw invalidRequest(
            `open_application by pid (${rawPid}) requires the native AX app resolver, which is unavailable in this ZCode build. Pass bundle_id or name instead.`,
          );
        }
        const resolved = await resolveAppByPid(axSource, rawPid);
        if (!resolved) {
          throw invalidRequest(
            `open_application by pid (${rawPid}) failed: no running app matches that pid. The process may have exited \u2014 call list_apps for a fresh pid, or pass bundle_id/name.`,
          );
        }
        if (bundleId && (!resolved.bundle_id || !cuaBundleIdsEqual(resolved.bundle_id, bundleId))) {
          throw invalidRequest(
            `open_application app identity mismatch: pid ${rawPid} belongs to bundle_id ${JSON.stringify(resolved.bundle_id)}, not requested ${JSON.stringify(bundleId)}. Call list_apps and retry with fields from the same process.`,
          );
        }
        if (
          nameIsAuthoritative &&
          name &&
          resolved.name?.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()
        ) {
          throw invalidRequest(
            `open_application app identity mismatch: pid ${rawPid} belongs to app name ${JSON.stringify(resolved.name)}, not requested ${JSON.stringify(name)}. Call list_apps and retry with fields from the same process.`,
          );
        }
        resolvedBundleId = bundleId ?? resolved.bundle_id ?? undefined;
        resolvedName = resolvedBundleId ? undefined : (resolved.name ?? name ?? undefined);
        if (!resolvedBundleId && !resolvedName) {
          throw invalidRequest(
            `open_application by pid (${rawPid}) resolved to an app with neither bundle_id nor name; cannot launch. Pass bundle_id or name instead.`,
          );
        }
      }
      if (!newInstance && nameIsAuthoritative && name && axSource) {
        const requestedName = name.trim().toLocaleLowerCase();
        const nameMatches = (await axSource.listApplications()).filter(
          (app) => app.name?.trim().toLocaleLowerCase() === requestedName,
        );
        if (nameMatches.length > 1) {
          throw invalidRequest(
            `open_application app name is ambiguous: ${JSON.stringify(name)} matched ${nameMatches.length} live processes ${JSON.stringify(nameMatches.map((app) => ({ pid: app.pid, bundle_id: app.bundle_id })))}. Call list_apps and retry with app.pid.`,
          );
        }
      }
      const urls =
        urlListParam(params.urls) ?? urlListParam(params.url) ?? urlListParam(appObj.urls) ?? urlListParam(appObj.url);
      const activate = params.activate === true;
      if (activate && adapter.isFocusStealPrevented?.() === true) {
        throw permissionDenied(
          "open_application activate=true was refused because the trusted host prevent_activation policy is engaged. action_sent=false.",
          {
            action_sent: false,
            request_delivery_state: "not_sent",
            reason: "focus_steal_prevented",
          },
        );
      }
      finishTimingPhase("identity_resolution");
      let resolvedExistingWindowsApp = null;
      if (windowsAppUserModelId) {
        if (urls && urls.length > 0) {
          throw permissionDenied(
            "open_application cannot open URL(s) with a Windows AUMID in this build. Open the packaged app first, then navigate through its own UI.",
          );
        }
        if (!axSource?.applicationInfoByAumid) {
          throw permissionDenied(
            "open_application requires the exact Windows AUMID app resolver; refusing to launch because HWND identity cannot be verified.",
          );
        }
        let runningApp;
        try {
          runningApp = await axSource.applicationInfoByAumid(windowsAppUserModelId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw permissionDenied(
            `open_application could not query the exact Windows AUMID identity before launch: ${message}`,
          );
        }
        if (runningApp) {
          if (
            typeof runningApp.pid !== "number" ||
            !Number.isSafeInteger(runningApp.pid) ||
            runningApp.pid <= 0
          ) {
            throw permissionDenied(
              "open_application exact Windows AUMID lookup returned an invalid PID.",
            );
          }
          if (activate && runningApp.active !== true) {
            if (!adapter.activateApplication) {
              throw notAuthorized(
                "open_application requires the native Windows application activation primitive in this ZCode build.",
              );
            }
            if (adapter.activateApplication(runningApp.pid) !== true) {
              throw permissionDenied(
                `open_application by AUMID could not activate live pid ${runningApp.pid}.`,
              );
            }
            const activatedApp = await settleActivatedAppByPid(axSource, runningApp.pid);
            if (!activatedApp || activatedApp.active !== true) {
              throw permissionDenied(
                `open_application by AUMID was dispatched, but Windows did not make pid ${runningApp.pid} frontmost.`,
              );
            }
            runningApp = activatedApp;
          }
          resolvedExistingWindowsApp = runningApp;
        }
      }
      if (brokerInfo.platform === "win32" && rawPid) {
        if (!axSource) {
          throw permissionDenied(
            "open_application by pid requires the native Windows UIA app resolver.",
          );
        }
        if (urls && urls.length > 0) {
          throw permissionDenied(
            "open_application by pid cannot open URL(s) in this Windows CUA build without launching another process. Activate the existing pid first, then navigate through that application's own UI.",
          );
        }
        let runningApp = await resolveAppByPid(axSource, rawPid);
        if (!runningApp) {
          throw permissionDenied(
            `open_application by pid (${rawPid}) failed: no running app matches that pid. The process may have exited \u2014 call list_apps for a fresh pid.`,
          );
        }
        if (activate && runningApp.active !== true) {
          if (!adapter.activateApplication) {
            throw notAuthorized(
              "open_application by pid requires the native Windows application activation primitive in this ZCode build.",
            );
          }
          if (adapter.activateApplication(rawPid) !== true) {
            throw permissionDenied(
              `open_application by pid (${rawPid}) could not activate the live target window.`,
            );
          }
          const activatedApp = await settleActivatedAppByPid(axSource, rawPid);
          if (!activatedApp || activatedApp.active !== true) {
            throw permissionDenied(
              `open_application by pid (${rawPid}) was dispatched, but Windows did not make the target frontmost.`,
            );
          }
          runningApp = activatedApp;
        }
        resolvedExistingWindowsApp = runningApp;
      }
      const preOpenAppRef = {
        ...(rawPid ? { pid: rawPid } : {}),
        ...(resolvedBundleId ? { bundle_id: resolvedBundleId } : {}),
        ...(resolvedName ? { name: resolvedName } : {}),
      };
      const fileUrlWindowBaseline = await captureFileUrlWindowBaseline(
        newInstance
          ? async () => []
          : axSource?.listWindows
            ? () => axSource.listWindows(preOpenAppRef)
            : undefined,
        urls,
      );
      finishTimingPhase("file_window_baseline");
      const liveApps = axSource ? await axSource.listApplications() : [];
      finishTimingPhase("live_app_enumeration");
      const matchingLiveApp = liveApps.find((candidate) => {
        if (rawPid && candidate.pid !== rawPid) return false;
        if (resolvedBundleId && !cuaBundleIdsEqual(candidate.bundle_id, resolvedBundleId)) {
          return false;
        }
        if (
          resolvedName &&
          candidate.name?.trim().toLocaleLowerCase() !== resolvedName.trim().toLocaleLowerCase()
        ) {
          return false;
        }
        return Boolean(rawPid || resolvedBundleId || resolvedName);
      });
      const alreadyRunning = resolvedExistingWindowsApp !== null || matchingLiveApp !== undefined;
      const backgroundWindowTarget =
        brokerInfo.platform === "darwin" && !newInstance && !urls && axSource?.listWindows
          ? (resolvedExistingWindowsApp ?? matchingLiveApp ?? null)
          : null;
      let needsBackgroundWindowRecovery = false;
      if (backgroundWindowTarget && axSource?.listWindows) {
        const windows = await axSource.listWindows({
          pid: backgroundWindowTarget.pid,
          bundle_id: backgroundWindowTarget.bundle_id,
          name: backgroundWindowTarget.name,
        });
        needsBackgroundWindowRecovery = Array.isArray(windows) && !hasOnscreenWindow(windows);
      }
      if (
        brokerInfo.platform === "darwin" &&
        params.activate === true &&
        requestedSurfaceWindowId !== null &&
        rawPid !== undefined &&
        bundleId !== undefined
      ) {
        const activationApp = resolvedExistingWindowsApp ?? matchingLiveApp ?? null;
        if (!activationApp) {
          throw foregroundRequired(
            "open_application: confirmed file-panel activation requires a live app from the same observation. action_sent=false.",
            { action_sent: false, reason: "foreground_required" },
          );
        }
        const activation = await activateMacFilePanelSurface({
          adapter,
          axSource,
          app: activationApp,
          windowId: requestedSurfaceWindowId,
        });
        finishTimingPhase("file_panel_activation");
        const activeApp = { ...activationApp, active: true };
        return {
          ...appPayload(activeApp),
          activation_diagnostics: activation,
          file_window_verification: {
            status: "unavailable",
          },
          timing_ms: {
            ...timingMs,
            total: Math.max(0, Math.round(performance.now() - timingStartedAt)),
          },
        };
      }
      let launchResult;
      if (!resolvedExistingWindowsApp && rawPid && alreadyRunning && activate && !urls) {
        const activateExactPid =
          brokerInfo.platform === "darwin" ? axSource?.activateApplication : adapter.activateApplication;
        if (!activateExactPid) {
          const platformHint =
            brokerInfo.platform === "linux"
              ? "This Linux backend does not support foreground activation by pid; retry with an app name or bundle identity that the system launcher can activate."
              : "Update the Helper and retry.";
          throw permissionDenied(
            `open_application cannot safely activate the exact requested pid ${rawPid}: this platform does not expose pid-targeted activation. No bundle/name fallback was sent because it could select a sibling process. ${platformHint}`,
          );
        }
        if (!activateExactPid(rawPid)) {
          throw permissionDenied(
            `open_application could not activate the exact requested pid ${rawPid}; no fallback was sent because bundle/name activation could select a sibling process. Call list_apps and retry with a fresh pid.`,
          );
        }
        const activatedApp = await settleActivatedAppByPid(axSource, rawPid);
        if (!activatedApp || activatedApp.active !== true) {
          throw launchFailed(
            `open_application activate=true was dispatched for pid ${rawPid}, but the live target never became foreground.`,
            {
              active: false,
              activation_dispatched: true,
              request_delivery_state: "possibly_sent",
            },
          );
        }
        launchResult = {
          pid: activatedApp.pid,
          bundleId: activatedApp.bundle_id ?? resolvedBundleId,
          name: activatedApp.name ?? resolvedName,
          active: true,
        };
      } else if (
        !resolvedExistingWindowsApp &&
        (newInstance || !alreadyRunning || urls || activate || needsBackgroundWindowRecovery)
      ) {
        try {
          launchResult = await adapter.openApplication({
            bundleId: resolvedBundleId,
            name: resolvedName,
            urls,
            activate,
            newInstance,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[cua-openapp-diag] launcher dispatch FAILED: ${message}`);
          throw launchFailed(
            `open_application failed in the ZCode app launcher: ${message} Call list_apps to verify the exact app name/bundle_id before retrying.`,
          );
        }
      }
      console.error(
        `[cua-openapp-diag] dispatch done alreadyRunning=${JSON.stringify(alreadyRunning)} needsBgRecovery=${JSON.stringify(needsBackgroundWindowRecovery)} launchResult=${JSON.stringify(launchResult && typeof launchResult === "object" ? launchResult : null)}`,
      );
      finishTimingPhase("launcher_dispatch");
      let app = null;
      const launcherPid =
        launchResult &&
        typeof launchResult.pid === "number" &&
        Number.isInteger(launchResult.pid) &&
        launchResult.pid > 0
          ? launchResult.pid
          : undefined;
      let canonicalLaunchIdentity = null;
      if (brokerInfo.platform === "win32" && !windowsAppUserModelId && launcherPid && adapter.processExecutablePath) {
        try {
          canonicalLaunchIdentity = adapter.processExecutablePath(launcherPid)?.trim() || null;
        } catch {}
      }
      try {
        try {
          app =
            resolvedExistingWindowsApp ??
            (await resolveOpenedApp(
              axSource,
              { pid: rawPid, bundleId: resolvedBundleId, name: resolvedName },
              {
                launchResult,
                activateRequested: activate,
                platform: brokerInfo.platform,
                preLaunchApplications: liveApps,
                canonicalLaunchIdentity,
                windowsAppUserModelId,
                ...(newInstance
                  ? {
                      excludedPids: new Set(liveApps.map((candidate) => candidate.pid)),
                      attempts: 30,
                    }
                  : {}),
              },
            ));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[cua-openapp-diag] resolveOpenedApp FAILED: ${message}`);
          throw launchFailed(
            `open_application could not verify the dispatched app identity: ${message} Call list_apps and retry with pid, bundle_id, and name from the same live process.`,
          );
        }
        finishTimingPhase("app_resolution");
        console.error(
          `[cua-openapp-diag] resolved app=${JSON.stringify(app && typeof app === "object" ? { pid: app.pid, bundle_id: app.bundle_id } : null)}`,
        );
        if (!app || (newInstance && !app.pid)) {
          throw launchFailed(
            "open_application dispatched through ZCode, but the fresh app process could not be resolved afterward.",
          );
        }
        if (rawPid && app.pid !== rawPid) {
          throw invalidRequest(
            `open_application app identity mismatch after dispatch: requested pid ${rawPid}, but the launcher resolved pid ${JSON.stringify(app.pid)}. Call list_apps and retry with fields from the same live process.`,
          );
        }
        if (
          bundleId &&
          !windowsAppUserModelId &&
          (!app.bundle_id || !cuaBundleIdsEqual(app.bundle_id, bundleId, { loose: true }))
        ) {
          throw invalidRequest(
            `open_application app identity mismatch after dispatch: requested bundle_id ${JSON.stringify(bundleId)}, but the launcher resolved ${JSON.stringify(app.bundle_id)}. Call list_apps and retry with fields from the same live process.`,
          );
        }
        if (
          nameIsAuthoritative &&
          name &&
          !resolvedWindowsPackagedAppAlias2 &&
          !(brokerInfo.platform === "win32" && canonicalLaunchIdentity) &&
          app.name?.trim().toLocaleLowerCase() !== name.trim().toLocaleLowerCase()
        ) {
          throw invalidRequest(
            `open_application app identity mismatch after dispatch: requested app name ${JSON.stringify(name)}, but the launcher resolved ${JSON.stringify(app.name)}. Call list_apps and retry with fields from the same live process.`,
          );
        }
        if (activate && app.active !== true) {
          throw launchFailed(
            "open_application activate=true was dispatched, but the live target never became foreground.",
            {
              active: false,
              activation_dispatched: true,
              request_delivery_state: "possibly_sent",
            },
          );
        }
        if (
          needsBackgroundWindowRecovery &&
          !(await settleApplicationWindow(axSource, {
            pid: app.pid,
            bundle_id: app.bundle_id,
            name: app.name,
          }))
        ) {
          throw launchFailed(
            "open_application dispatched a macOS background reopen, but the running app still exposes zero AX windows.",
          );
        }
        const postOpenAppRef = {
          ...(app.pid ? { pid: app.pid } : {}),
          ...(app.bundle_id ? { bundle_id: app.bundle_id } : {}),
          ...(app.name ? { name: app.name } : {}),
        };
        let fileWindowVerificationStatus;
        try {
          fileWindowVerificationStatus = await verifyFileUrlWindowEffect(
            axSource?.listWindows ? () => axSource.listWindows(postOpenAppRef) : undefined,
            fileUrlWindowBaseline,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw elementUnavailable(
            `open_application could not verify the requested file was opened: ${message} Call list_windows before retrying; do not assume the returned app process opened the file.`,
          );
        }
        finishTimingPhase("file_window_verification");
        return {
          ...appPayload(app),
          file_window_verification: {
            status: fileWindowVerificationStatus,
          },
          timing_ms: {
            ...timingMs,
            total: Math.max(0, Math.round(performance.now() - timingStartedAt)),
          },
        };
      } catch (error) {
        if (!newInstance) throw error;
        const launchPid =
          launchResult &&
          typeof launchResult === "object" &&
          typeof launchResult.pid === "number" &&
          Number.isInteger(launchResult.pid) &&
          launchResult.pid > 0
            ? launchResult.pid
            : null;
        const preferredPids = new Set(launchPid ? [launchPid] : []);
        const rollbackCandidate = await discoverFreshApplicationForRollback(
          axSource,
          new Set(liveApps.map((candidate) => candidate.pid)),
          { bundleId: resolvedBundleId, name: resolvedName },
          preferredPids,
        );
        const rollback = rollbackCandidate
          ? await rollbackFreshApplication(adapter, axSource, rollbackCandidate)
          : "unavailable";
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof BrokerError) {
          throw new BrokerError(error.code, `${message} Fresh-process rollback: ${rollback}.`, error.details);
        }
        throw elementUnavailable(`${message} Fresh-process rollback: ${rollback}.`);
      }
    },
    paste: async (params) => {
      if (!supportsClipboard) {
        throw notAuthorized("paste is unavailable in this ZCode Computer Use build.");
      }
      const text = typeof params.text === "string" ? params.text : "";
      const format = typeof params.format === "string" ? params.format : "text";
      const pressKeyToApp = inputHandlers.press_key_to_app;
      if (typeof pressKeyToApp !== "function") {
        throw notAuthorized("paste requires app-scoped keyboard dispatch in this build.");
      }
      const chord = brokerInfo.platform === "darwin" ? "cmd+v" : "ctrl+v";
      const providedPaste = adapter.providedPaste;
      if (format !== "text" && !providedPaste) {
        throw new BrokerError(
          "unimplemented",
          `paste format "${format}" requires the provided-paste path, which is unavailable in this build; use format "text".`,
        );
      }
      if (providedPaste) {
        const begun = providedPaste.begin(text, format);
        if (!begun.ok) {
          throw new BrokerError(
            "internal",
            "paste could not take over the system pasteboard, so nothing was sent. action_sent=false.",
            { action_sent: false, reason: begun.error ?? "pasteboard_write_failed" },
          );
        }
        let dispatchResult;
        try {
          const marked = providedPaste.markDispatched?.(begun.token) ?? null;
          const dispatchedAt = Date.now();
          dispatchResult = await pressKeyToApp({
            ...params,
            text: chord,
          });
          const keyPostedAt = Date.now();
          const read = await providedPaste.awaitRead(begun.token);
          diagnostic?.(
            "paste_provided",
            {
              ok: read.ok,
              reason: read.error ?? null,
              reads: read.reads,
              reads_before_dispatch: read.readsBeforeDispatch ?? null,
              hold_ms: read.holdMs ?? null,
              dispatch_marked: marked,
              format,
              text_utf16_units: text.length,
              key_post_ms: keyPostedAt - dispatchedAt,
              await_ms: Date.now() - keyPostedAt,
            },
            read.ok ? "info" : "warn",
          );
          if (!read.ok) {
            if (read.error === "pasteboard_changed_during_paste") {
              throw new BrokerError(
                "internal",
                "paste was interrupted: something else took over the system pasteboard while the app was reading it. Check the app's state to make sure the user's clipboard content was not pasted instead of your text before continuing. action_sent=true.",
                {
                  action_sent: true,
                  reason: read.error,
                  reads: read.reads,
                  reads_before_dispatch: read.readsBeforeDispatch ?? null,
                },
              );
            }
            throw new BrokerError(
              "internal",
              "paste timed out waiting for the app to read the pasteboard; the app never consumed the paste shortcut. Nothing was inserted. Use set_value on a settable element, or activate the app and focus the field, then retry. action_sent=true.",
              {
                action_sent: true,
                reason: read.error ?? "pasteboard_read_timed_out",
                reads: read.reads,
                reads_before_dispatch: read.readsBeforeDispatch ?? null,
              },
            );
          }
        } catch (error51) {
          diagnostic?.(
            "paste_provided_failed",
            {
              stage: "dispatch_or_await",
              format,
              text_utf16_units: text.length,
              message: error51 instanceof Error ? error51.message : String(error51),
              ...(error51 instanceof BrokerError ? { code: error51.code } : {}),
            },
            "warn",
          );
          throw error51;
        } finally {
          providedPaste.finish(begun.token);
        }
        return dispatchResult;
      }
      diagnostic?.(
        "paste_legacy_path",
        { platform: brokerInfo.platform, format, text_utf16_units: text.length },
        brokerInfo.platform === "darwin" ? "warn" : "info",
      );
      let previous = null;
      try {
        previous = await adapter.readClipboardText();
      } catch {
        previous = null;
      }
      await adapter.writeClipboardText(text);
      try {
        return await pressKeyToApp({
          ...params,
          text: chord,
        });
      } finally {
        if (previous !== null) {
          await Promise.resolve(adapter.writeClipboardText(previous)).catch(() => void 0);
        }
      }
    },
  };
  const axRegistry = new AxTokenRegistry();
  const pipAutoStart = createPipAutoStarter(adapter);
  const axMethods = axSource
    ? createAxReadOnlyMethods(axSource, axRegistry, {
        permissionDeniedHint: authorizationSubjectHint(brokerInfo, "Accessibility"),
        // 与 paste 的 provided-paste 诊断同一通道（helperMain 已接到 helperRuntimeLogger）。
        onDiagnostic: diagnostic,
        beginCaptureGeometry: () => {
          requireVerifiedWindowsFramePixels("capture_app");
          const topology = captureTopology();
          return {
            topology,
            windows:
              brokerInfo.platform === "darwin"
                ? captureScreenshotWindows(adapter, topologyDesktopBounds(topology.entries))
                : null,
          };
        },
        completeCaptureGeometry: (guard, snapshot) => {
          const captured = guard;
          const before = captured.topology;
          const after = captureTopology();
          if (before.fingerprint !== after.fingerprint) {
            throw elementUnavailable(
              "capture_app: display topology or scale factor changed while the image was captured; capture again before using pixels.",
              { action_sent: false, reason: "display_topology_changed" },
            );
          }
          const pointer = snapshot.screenshot_bounds;
          if (
            !pointer ||
            pointer.length !== 4 ||
            !pointer.every(Number.isFinite) ||
            pointer[2] <= 0 ||
            pointer[3] <= 0
          ) {
            throw elementUnavailable(
              "capture_app: native capture returned no usable pixel-to-pointer rectangle.",
              { action_sent: false, reason: "capture_geometry_unavailable" },
            );
          }
          const [x, y, width, height] = pointer;
          const containing = before.entries.filter(({ bounds }) => {
            const [dx, dy, dw, dh] = bounds;
            return x >= dx && y >= dy && x + width <= dx + dw && y + height <= dy + dh;
          });
          const display = containing.length === 1 ? containing[0] : null;
          const captureSurfaceEvidence =
            brokerInfo.platform === "darwin"
              ? buildStableAppFrameSurfaceSet(
                  snapshot,
                  captured.windows,
                  captureScreenshotWindows(adapter, topologyDesktopBounds(after.entries)),
                )
              : {};
          return {
            coordinate_contract: "frame_pixel_projection_v1",
            pointer: {
              x,
              y,
              width,
              height,
              unit:
                brokerInfo.platform === "darwin"
                  ? "point"
                  : brokerInfo.platform === "win32"
                    ? "physical_pixel"
                    : "x11_root_pixel",
            },
            display: {
              id: display?.id ?? null,
              index: display?.index ?? null,
              topology_fingerprint: before.fingerprint,
            },
            display_topology: before.entries,
            ...captureSurfaceEvidence,
          };
        },
        // role→kind 注入：缺省（darwin 不传 roleToKind）= macOS ROLE_TO_KIND，行为不变。
        // Windows/Linux 调用方通过 CreateElectronNativeBackendOptions.roleToKind 传入各自 map。
        ...(options.roleToKind ? { roleToKind: options.roleToKind } : {}),
        onCaptureWindow: (target, context) => {
          if (options.onPipCaptureWindow) {
            options.onPipCaptureWindow(target, context);
            return;
          }
          if (options.allowControllerVisuals?.() === false) return;
          pipAutoStart.onCaptureWindow(target);
        },
        // macOS windowless app：capture_app 读到 cg-only-no-ax-window 时由这里把真窗口开出来，
        // 让它重读一次再返回完整树（对齐 Codex get_app_state：它一次到位，我们过去要模型自己
        // 绕 open_application→wait→再读，窗口反复上屏才是用户报的「打断」）。
        // activate:false 是硬要求——窗口会上屏但键盘焦点不动（Codex 同样不隐藏窗口）。
        // 用 settleApplicationWindow 确认「真窗口出现了」：它按 onscreen 标记计数，不会被
        // WindowServer 残留的 offscreen 窗口骗过（见 hasOnscreenWindow）。
        ...(brokerInfo.platform === "darwin" && adapter.openApplication
          ? {
              reopenWindowlessApp: async (target) => {
                if (typeof target.pid !== "number" || target.pid <= 0) {
                  return false;
                }
                if (!target.bundle_id && !target.name) return false;
                try {
                  await adapter.openApplication({
                    ...(target.bundle_id ? { bundleId: target.bundle_id } : {}),
                    ...(target.name ? { name: target.name } : {}),
                    activate: false,
                    newInstance: false,
                  });
                } catch {
                  return false;
                }
                return settleApplicationWindow(axSource, {
                  pid: target.pid,
                  bundle_id: target.bundle_id,
                  name: target.name,
                });
              },
            }
          : {}),
        ...(hasAppScopedInput && axSource.elementFocus
          ? {
              replaceTextValueWithInput: async ({
                ref,
                value,
                pid,
                bundleId,
                bounds,
                windowId,
              }) => {
                return replaceTextValueWithVerifiedInput({
                  adapter,
                  axSource,
                  ref,
                  value,
                  pid,
                  bundleId,
                  bounds,
                  windowId,
                });
              },
            }
          : {}),
      })
    : {};
  const backend = {
    ...createUnavailableNativeBackend({
      brokerInfo,
      reason: FAIL_CLOSED_REASON,
    }),
    ...axMethods,
    ...implemented,
  };
  return backend;
}
