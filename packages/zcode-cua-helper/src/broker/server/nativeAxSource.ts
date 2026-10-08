/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { elementUnavailable, permissionDenied } from "../types.js";
import { canonicalizeCuaBundleId, cuaBundleIdsEqual } from "./cuaAppIdentity.js";

function toRawElement(el) {
  return {
    ref: el.ref,
    role: el.role,
    subrole: el.subrole,
    title: el.title ?? null,
    value: el.value ?? null,
    description: el.description ?? null,
    bounds: el.bounds,
    enabled: el.enabled,
    focused: el.focused,
    selected: el.selected,
    default_action: el.default_action,
    selected_text_range: el.selected_text_range,
    editable: el.editable,
    actions: el.actions,
    ownerPid: el.ownerPid,
    children: el.children?.map(toRawElement),
    // 必须透传：丢了它，被截断的大容器在模型面就和完整容器无从区分。
    ...(typeof el.children_total === "number"
      ? {
          children_total: el.children_total,
          ...(typeof el.children_offset === "number"
            ? { children_offset: el.children_offset }
            : {}),
        }
      : {}),
  };
}
async function settleWithin(pending, timeoutMs) {
  const timeoutMarker = Symbol("timeout");
  let timer;
  const timeout = new Promise((resolve2) => {
    timer = setTimeout(() => resolve2(timeoutMarker), timeoutMs);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([pending, timeout]);
    return result === timeoutMarker ? { timedOut: true } : { timedOut: false, value: result };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
var MAX_BLANK_SAMPLE_DIMENSION = 64;
var MAX_BLANK_SAMPLED_PIXELS = MAX_BLANK_SAMPLE_DIMENSION * MAX_BLANK_SAMPLE_DIMENSION;
function isValidPngContentSummary(summary) {
  return (
    !!summary &&
    Number.isSafeInteger(summary.width) &&
    summary.width > 0 &&
    Number.isSafeInteger(summary.height) &&
    summary.height > 0 &&
    Number.isSafeInteger(summary.sampleWidth) &&
    summary.sampleWidth > 0 &&
    summary.sampleWidth <= MAX_BLANK_SAMPLE_DIMENSION &&
    Number.isSafeInteger(summary.sampleHeight) &&
    summary.sampleHeight > 0 &&
    summary.sampleHeight <= MAX_BLANK_SAMPLE_DIMENSION &&
    Number.isSafeInteger(summary.sampledPixelCount) &&
    summary.sampledPixelCount > 0 &&
    summary.sampledPixelCount <= MAX_BLANK_SAMPLED_PIXELS &&
    summary.sampledPixelCount === summary.sampleWidth * summary.sampleHeight &&
    Number.isSafeInteger(summary.visiblePixelCount) &&
    summary.visiblePixelCount >= 0 &&
    summary.visiblePixelCount <= summary.sampledPixelCount &&
    Number.isSafeInteger(summary.distinctColorBucketCount) &&
    summary.distinctColorBucketCount >= 0 &&
    summary.distinctColorBucketCount <= summary.visiblePixelCount &&
    Number.isSafeInteger(summary.dominantColorPixelCount) &&
    summary.dominantColorPixelCount >= 0 &&
    summary.dominantColorPixelCount <= summary.visiblePixelCount &&
    Number.isSafeInteger(summary.maxChannelRange) &&
    summary.maxChannelRange >= 0 &&
    summary.maxChannelRange <= 255
  );
}
function validOptionalChannel(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255;
}
function isCapturedImageBlank(addon, image) {
  if (!image || image.format !== "png") return false;
  if (typeof addon.inspectPngContent !== "function") return false;
  try {
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0) return false;
    const summary = addon.inspectPngContent(bytes);
    if (!isValidPngContentSummary(summary)) return false;
    if (summary.visiblePixelCount === 0) return true;
    if (
      !validOptionalChannel(summary.minVisibleChannel) ||
      !validOptionalChannel(summary.maxVisibleChannel)
    ) {
      return false;
    }
    const visibleRatio = summary.visiblePixelCount / summary.sampledPixelCount;
    return (
      visibleRatio >= 0.95 &&
      summary.distinctColorBucketCount <= 1 &&
      summary.maxChannelRange <= 2 &&
      summary.maxVisibleChannel <= 2
    );
  } catch {
    return false;
  }
}
var EMPTY_CAPTURE_DIAGNOSTIC_TEXT = /^[A-Za-z0-9_.,:<>= -]{1,1024}$/u;
function reportEmptyCaptureDiagnostic(snap) {
  const text = snap.empty_capture_diagnostics;
  if (typeof text !== "string" || !EMPTY_CAPTURE_DIAGNOSTIC_TEXT.test(text)) {
    return;
  }
  try {
    process.stderr.write(`[capture-app-empty] ${text}
`);
  } catch {}
}
async function toRawSnapshot(addon, snap, options, includeScreenshot) {
  reportEmptyCaptureDiagnostic(snap);
  const captureEpoch = snap.capture_epoch;
  const hasCaptureEpoch = Number.isSafeInteger(captureEpoch) && captureEpoch > 0;
  if (
    hasCaptureEpoch &&
    (typeof addon.ackCaptureEpoch !== "function" || typeof addon.releaseCaptureEpoch !== "function")
  ) {
    addon.releaseCaptureEpoch?.(snap.app.pid, captureEpoch);
    throw elementUnavailable(
      "capture_app: native token epoch cannot be managed by this Helper ABI.",
    );
  }
  let leaseState = hasCaptureEpoch ? "pending" : "acknowledged";
  const captureLease = hasCaptureEpoch
    ? {
        acknowledge: () => {
          if (leaseState === "acknowledged") return true;
          if (leaseState === "released") return false;
          const acknowledged = addon.ackCaptureEpoch(snap.app.pid, captureEpoch) === true;
          if (acknowledged) leaseState = "acknowledged";
          return acknowledged;
        },
        release: () => {
          if (leaseState !== "pending") return;
          leaseState = "released";
          addon.releaseCaptureEpoch(snap.app.pid, captureEpoch);
        },
      }
    : void 0;
  let leaseTransferred = false;
  try {
    const windowId = snap.window.window_id;
    const actualNativeSurface = snap.surfaces?.find(
      (surface) => surface.actual_window_id === windowId,
    );
    let image = null;
    let screenshotBlank = false;
    if (includeScreenshot && typeof windowId === "number") {
      const logicalBundleId =
        typeof snap.app.bundle_id === "string" && snap.app.bundle_id.trim()
          ? (() => {
              try {
                return canonicalizeCuaBundleId(snap.app.bundle_id);
              } catch {
                return null;
              }
            })()
          : null;
      const crossProcessSurface =
        actualNativeSurface !== void 0 && actualNativeSurface.owner_pid !== snap.app.pid;
      const actualOwner = crossProcessSurface
        ? addon
            .screenCaptureProbeWindows?.()
            .find(
              (window) =>
                window.windowId === windowId &&
                window.ownerPid === actualNativeSurface.owner_pid &&
                window.onScreen,
            )
        : null;
      const actualOwnerBundleId = actualOwner?.ownerBundleId
        ? (() => {
            try {
              return canonicalizeCuaBundleId(actualOwner.ownerBundleId);
            } catch {
              return null;
            }
          })()
        : null;
      const verifiedCaptureIdentity = crossProcessSurface
        ? actualOwnerBundleId
          ? {
              pid: actualNativeSurface.owner_pid,
              bundleId: actualOwnerBundleId,
            }
          : null
        : logicalBundleId
          ? { pid: snap.app.pid, bundleId: logicalBundleId }
          : null;
      const expectedWindowBounds = actualNativeSurface?.bounds ?? snap.window.bounds;
      const captureWindowPngWithStableIdentity = async () => {
        if (
          !verifiedCaptureIdentity ||
          typeof addon.screenCaptureProbeWindows !== "function" ||
          typeof options.captureWindowPng !== "function"
        ) {
          return null;
        }
        const matchingLiveWindow = () =>
          addon.screenCaptureProbeWindows().find((window) => {
            const bounds = [
              window.bounds.x,
              window.bounds.y,
              window.bounds.width,
              window.bounds.height,
            ];
            return (
              window.windowId === windowId &&
              window.ownerPid === verifiedCaptureIdentity.pid &&
              window.onScreen &&
              typeof window.ownerBundleId === "string" &&
              cuaBundleIdsEqual(window.ownerBundleId, verifiedCaptureIdentity.bundleId) &&
              bounds.every((part, index) => Math.abs(part - expectedWindowBounds[index]) <= 1)
            );
          }) ?? null;
        const before = matchingLiveWindow();
        if (!before) return null;
        const png = await options.captureWindowPng(windowId);
        if (!png || png.length === 0) return null;
        const after = matchingLiveWindow();
        if (
          !after ||
          before.ownerPid !== after.ownerPid ||
          before.ownerBundleId !== after.ownerBundleId ||
          before.bounds.x !== after.bounds.x ||
          before.bounds.y !== after.bounds.y ||
          before.bounds.width !== after.bounds.width ||
          before.bounds.height !== after.bounds.height
        ) {
          return null;
        }
        return {
          format: "png",
          data: Buffer.from(png).toString("base64"),
          bounds: [after.bounds.x, after.bounds.y, after.bounds.width, after.bounds.height],
        };
      };
      const captureOnce = async () => {
        if (
          verifiedCaptureIdentity &&
          Number.isSafeInteger(verifiedCaptureIdentity.pid) &&
          verifiedCaptureIdentity.pid > 0 &&
          typeof addon.captureWindowImageVerifiedAsync === "function"
        ) {
          const captured = await settleWithin(
            addon.captureWindowImageVerifiedAsync(
              windowId,
              verifiedCaptureIdentity.pid,
              verifiedCaptureIdentity.bundleId,
            ),
            4500,
          );
          if (!captured.timedOut && captured.value) return captured.value;
          return captureWindowPngWithStableIdentity();
        }
        if (verifiedCaptureIdentity) {
          const stableFallback = await captureWindowPngWithStableIdentity();
          if (stableFallback) return stableFallback;
        }
        if (crossProcessSurface) return null;
        const legacy = addon.captureWindowImage(windowId);
        if (legacy) return legacy;
        if (typeof options.captureWindowPng === "function") {
          const png = await options.captureWindowPng(windowId);
          if (png && png.length > 0) {
            return { format: "png", data: Buffer.from(png).toString("base64") };
          }
        }
        return null;
      };
      image = await captureOnce();
      if (image && isCapturedImageBlank(addon, image)) {
        await new Promise((resolve2) => setTimeout(resolve2, 250));
        const retried = await captureOnce();
        if (retried) image = retried;
        if (isCapturedImageBlank(addon, image)) screenshotBlank = true;
      }
    }
    const raw = {
      app: {
        pid: snap.app.pid,
        bundle_id: snap.app.bundle_id,
        name: snap.app.name,
        active: snap.app.active,
      },
      window: {
        title: snap.window.title,
        bounds: snap.window.bounds,
        window_id: snap.window.window_id,
        ...(typeof snap.window.presentation_window_id === "number"
          ? { presentation_window_id: snap.window.presentation_window_id }
          : {}),
        ...(actualNativeSurface
          ? {
              actual_owner_pid: actualNativeSurface.owner_pid,
              surface_kind: actualNativeSurface.surface_kind,
            }
          : {}),
        main: snap.window.main,
        focused: snap.window.focused,
        // Only present when the requested window_id could not be resolved.
        // Falls through absent on the normal path (and on legacy addons).
        ...(snap.window.window_id_fallback ? { window_id_fallback: true } : {}),
        // 空树/无窗口的原因：模型据此判断"该 reopen app / 走菜单栏"还是"重试读取"。
        ...(typeof snap.window.empty_capture_reason === "string" &&
        snap.window.empty_capture_reason.length > 0
          ? { empty_capture_reason: snap.window.empty_capture_reason }
          : {}),
      },
      ...(Array.isArray(snap.surfaces)
        ? {
            surfaces: snap.surfaces.filter(
              (surface) =>
                Number.isSafeInteger(surface.actual_window_id) &&
                surface.actual_window_id > 0 &&
                Number.isSafeInteger(surface.presentation_window_id) &&
                surface.presentation_window_id > 0 &&
                Number.isSafeInteger(surface.owner_pid) &&
                surface.owner_pid > 0 &&
                Array.isArray(surface.bounds) &&
                surface.bounds.length === 4 &&
                surface.bounds.every(Number.isFinite),
            ),
          }
        : {}),
      elements: snap.elements.map(toRawElement),
      screenshot: image ?? null,
      ...(image?.bounds ? { screenshot_bounds: image.bounds } : {}),
      ...(screenshotBlank ? { screenshot_blank: true } : {}),
      ...(captureLease ? { captureLease } : {}),
    };
    leaseTransferred = true;
    return raw;
  } finally {
    if (!leaseTransferred) captureLease?.release();
  }
}
function toRawWindow(window, index) {
  return {
    index,
    title: window.title ?? null,
    bounds: window.bounds,
    window_id: window.window_id ?? null,
    main: window.main,
    focused: window.focused,
    // Must be threaded through: dropping it here would make every CG-merged
    // offscreen leftover look like a real window to the broker again.
    onscreen: window.onscreen,
  };
}
function countElements(elements) {
  if (!elements) return 0;
  let count = 0;
  const stack = [...elements];
  while (stack.length > 0) {
    const element = stack.pop();
    if (!element) continue;
    count += 1;
    if (element.children) stack.push(...element.children);
  }
  return count;
}
function windowArea(snapshot) {
  const bounds = snapshot?.window?.bounds;
  if (!bounds) return 0;
  const width = Number(bounds[2]);
  const height = Number(bounds[3]);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width * height
    : 0;
}
function scoreAxAppCandidate(candidate) {
  const elementCount = countElements(candidate.snapshot?.elements);
  const area = windowArea(candidate.snapshot);
  return (
    (elementCount > 0 ? 1e4 : 0) +
    (candidate.snapshot ? 1e3 : 0) +
    (candidate.app.active ? 100 : 0) +
    Math.min(elementCount, 900) +
    Math.min(Math.floor(area / 1e4), 90)
  );
}
function selectBestAxAppCandidate(candidates) {
  let best = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scoreAxAppCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best?.app ?? null;
}
async function settleFreshlyLaunchedTree(pid, probe) {
  const deadline = Date.now() + 3e3;
  let previous = null;
  let stableStreak = 0;
  let nullStreak = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve2) => setTimeout(resolve2, 300));
    const current = probe(pid);
    if (current === null) {
      nullStreak += 1;
      if (nullStreak >= 3) return;
      stableStreak = 0;
      previous = null;
      continue;
    }
    nullStreak = 0;
    stableStreak = current === previous ? stableStreak + 1 : 0;
    previous = current;
    if (stableStreak >= 2) {
      console.error(`[cua-captureapp-settle] tree settled at ${current} elements`);
      return;
    }
  }
  console.error(`[cua-captureapp-settle] deadline reached, last count=${previous}`);
}
export function createNativeAxSource(addon, options: any = {}) {
  const iconCache = /* @__PURE__ */ new Map();
  const enrichPresentation = async (app) => {
    if (typeof addon.applicationIconPngAsync !== "function") return app;
    const key = app.bundle_id?.trim().toLowerCase() || `pid:${app.pid}`;
    let icon = iconCache.get(key);
    if (!icon) {
      icon = addon.applicationIconPngAsync(app.pid).catch(() => null);
      iconCache.set(key, icon);
      if (iconCache.size > 256) iconCache.delete(iconCache.keys().next().value);
    }
    return { ...app, icon_png: await icon };
  };
  const readLiveApp2 = (pid) => {
    if (typeof addon.applicationInfo === "function") {
      return addon.applicationInfo(pid);
    }
    return addon.listApplications().find((app) => app.pid === pid) ?? null;
  };
  const resolvePid2 = (appRef) => {
    const requestedPid =
      typeof appRef.pid === "number" && Number.isSafeInteger(appRef.pid) && appRef.pid > 0
        ? appRef.pid
        : null;
    if (requestedPid !== null) {
      const live = readLiveApp2(requestedPid);
      if (!live) return null;
      if (appRef.bundle_id && !cuaBundleIdsEqual(live.bundle_id, appRef.bundle_id)) {
        throw elementUnavailable(
          `app_ref identity mismatch: pid ${requestedPid} belongs to bundle_id ${JSON.stringify(live.bundle_id)}, not requested ${JSON.stringify(appRef.bundle_id)}.`,
        );
      }
      if (
        appRef.name?.trim() &&
        live.name?.trim().toLocaleLowerCase() !== appRef.name.trim().toLocaleLowerCase()
      ) {
        throw elementUnavailable(
          `app_ref identity mismatch: pid ${requestedPid} belongs to app name ${JSON.stringify(live.name)}, not requested ${JSON.stringify(appRef.name)}.`,
        );
      }
      return requestedPid;
    }
    const liveApps = addon.listApplications();
    if (appRef.bundle_id && appRef.name?.trim()) {
      const bundleMatches = liveApps.filter((app) =>
        cuaBundleIdsEqual(app.bundle_id, appRef.bundle_id),
      );
      const requestedName = appRef.name.trim().toLocaleLowerCase();
      if (
        bundleMatches.length > 0 &&
        bundleMatches.every(
          (app) =>
            Boolean(app.name?.trim()) && app.name.trim().toLocaleLowerCase() !== requestedName,
        )
      ) {
        throw elementUnavailable(
          `app_ref identity mismatch: live bundle_id ${JSON.stringify(appRef.bundle_id)} belongs to app name(s) ${JSON.stringify(bundleMatches.map((app) => app.name))}, not requested ${JSON.stringify(appRef.name)}.`,
        );
      }
    }
    const matches = liveApps.filter((app) => {
      if (appRef.bundle_id && !cuaBundleIdsEqual(app.bundle_id, appRef.bundle_id)) {
        return false;
      }
      if (
        appRef.name?.trim() &&
        app.name?.trim().toLocaleLowerCase() !== appRef.name.trim().toLocaleLowerCase()
      ) {
        return false;
      }
      return Boolean(appRef.bundle_id || appRef.name?.trim());
    });
    if (!appRef.bundle_id && appRef.name?.trim() && matches.length > 1) {
      throw elementUnavailable(
        `app_ref.name is ambiguous: ${JSON.stringify(appRef.name)} matched ${matches.length} live processes ${JSON.stringify(
          matches.map((app) => ({
            pid: app.pid,
            bundle_id: app.bundle_id,
          })),
        )}. Call list_apps and retry with app_ref.pid.`,
      );
    }
    const match = selectBestAxAppCandidate(
      // PID 解析只需要 live identity/active 状态，不能为了给候选打分同步遍历整棵 AX 树。
      matches.map((app) => ({ app, snapshot: null })),
    );
    return match ? match.pid : null;
  };
  const nativeCaptureInflight = /* @__PURE__ */ new Map();
  const nativeCaptureRequest = (pid, expectedBundleId, windowId) => {
    const key = `${pid}:${expectedBundleId ?? "<unbound>"}:${windowId ?? "<frontmost>"}`;
    const existing = nativeCaptureInflight.get(key);
    if (existing) return { key, pid, windowId, pending: existing };
    const pending = addon.captureAppAsync(pid, expectedBundleId, windowId);
    nativeCaptureInflight.set(key, pending);
    const cleanup = () => {
      if (nativeCaptureInflight.get(key) === pending) {
        nativeCaptureInflight.delete(key);
      }
    };
    void pending.then(cleanup, cleanup);
    return { key, pid, windowId, pending };
  };
  const readCaptureTimeoutDiagnostic = (pid, windowId) => {
    if (typeof addon.captureAppDiagnostic !== "function") return null;
    try {
      const diagnostic = addon.captureAppDiagnostic(pid, windowId);
      const safeText = (value) =>
        typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/u.test(value);
      if (
        !diagnostic ||
        diagnostic.pid !== pid ||
        diagnostic.window_id !== (windowId ?? null) ||
        !safeText(diagnostic.phase) ||
        !safeText(diagnostic.last_ax_operation) ||
        !Number.isSafeInteger(diagnostic.nodes_visited) ||
        diagnostic.nodes_visited < 0 ||
        !Number.isSafeInteger(diagnostic.elapsed_ms) ||
        diagnostic.elapsed_ms < 0 ||
        typeof diagnostic.deadline_exceeded !== "boolean"
      ) {
        return null;
      }
      return {
        pid: diagnostic.pid,
        window_id: diagnostic.window_id,
        phase: diagnostic.phase,
        last_ax_operation: diagnostic.last_ax_operation,
        nodes_visited: diagnostic.nodes_visited,
        elapsed_ms: diagnostic.elapsed_ms,
        deadline_exceeded: diagnostic.deadline_exceeded,
      };
    } catch {
      return null;
    }
  };
  const formatCaptureTimeoutDiagnostic = (diagnostic) =>
    `phase=${diagnostic.phase} last_ax_operation=${diagnostic.last_ax_operation} nodes_visited=${diagnostic.nodes_visited} elapsed_ms=${diagnostic.elapsed_ms} deadline_exceeded=${String(diagnostic.deadline_exceeded)} pid=${diagnostic.pid} window_id=${diagnostic.window_id ?? "frontmost"}`;
  const awaitNativeCaptureWithinDeadline = async (request) => {
    const { key, pid, windowId, pending } = request;
    const settled = await settleWithin(pending, 8e3);
    if (settled.timedOut) {
      if (nativeCaptureInflight.get(key) === pending) {
        nativeCaptureInflight.delete(key);
      }
      void pending.then(
        (late) => {
          if (late && Number.isSafeInteger(late.capture_epoch) && late.capture_epoch > 0) {
            addon.releaseCaptureEpoch?.(late.app.pid, late.capture_epoch);
          }
        },
        () => void 0,
      );
      const diagnostic = readCaptureTimeoutDiagnostic(pid, windowId);
      if (diagnostic) {
        try {
          process.stderr.write(
            `[capture-app-timeout] ${JSON.stringify(diagnostic)}
`,
          );
        } catch {}
      }
      throw elementUnavailable(
        "capture_app: Accessibility capture exceeded the 8 second wall-clock deadline." +
          (diagnostic ? ` Diagnostic: ${formatCaptureTimeoutDiagnostic(diagnostic)}.` : ""),
      );
    }
    return settled.value;
  };
  const performNativeSnapshot = async (pid, windowId) => {
    if (typeof addon.captureAppAsync !== "function") {
      return addon.captureApp(pid, windowId);
    }
    const before = readLiveApp2(pid);
    const expectedBundleId = before?.bundle_id
      ? (() => {
          try {
            return canonicalizeCuaBundleId(before.bundle_id);
          } catch {
            return null;
          }
        })()
      : null;
    const snapshot = await awaitNativeCaptureWithinDeadline(
      nativeCaptureRequest(pid, expectedBundleId ?? void 0, windowId),
    );
    if (!snapshot) return null;
    if (!Number.isSafeInteger(snapshot.capture_epoch) || snapshot.capture_epoch <= 0) {
      throw permissionDenied(
        "capture_app: native Helper did not return a valid token-epoch lease.",
      );
    }
    try {
      const after = readLiveApp2(pid);
      if (
        snapshot.app.pid !== pid ||
        (expectedBundleId &&
          (!cuaBundleIdsEqual(snapshot.app.bundle_id, expectedBundleId) ||
            (after !== null && !cuaBundleIdsEqual(after.bundle_id, expectedBundleId))))
      ) {
        throw permissionDenied(
          "capture_app target identity changed while the Accessibility snapshot was collected.",
        );
      }
      return snapshot;
    } catch (error51) {
      addon.releaseCaptureEpoch?.(pid, snapshot.capture_epoch);
      throw error51;
    }
  };
  const capturePipelineInflight = /* @__PURE__ */ new Map();
  const capturePipeline = async (pid, includeScreenshot, windowId) => {
    const dedupKey = `${pid}:${windowId ?? "<frontmost>"}`;
    const existing = capturePipelineInflight.get(dedupKey);
    if (existing) {
      if (existing.includeScreenshot || !includeScreenshot) {
        const shared = await existing.promise;
        return shared && !includeScreenshot ? { ...shared, screenshot: null } : shared;
      }
      await existing.promise;
      return capturePipeline(pid, true, windowId);
    }
    const pending = (async () => {
      let snap = null;
      for (let attempt = 0; attempt < 3 && !snap; attempt += 1) {
        snap = await performNativeSnapshot(pid, windowId);
        if (!snap && attempt < 2) await new Promise((r) => setTimeout(r, 500));
      }
      if (snap) return toRawSnapshot(addon, snap, options, includeScreenshot);
      throw elementUnavailable(
        "capture_app: the target app has no readable accessibility tree (no window, not scriptable, or it did not respond). If Accessibility was just granted to the Helper, restart the Helper so its process re-reads the TCC grant.",
      );
    })();
    capturePipelineInflight.set(dedupKey, {
      includeScreenshot,
      promise: pending,
    });
    const cleanup = () => {
      if (capturePipelineInflight.get(dedupKey)?.promise === pending) {
        capturePipelineInflight.delete(dedupKey);
      }
    };
    void pending.then(cleanup, cleanup);
    return pending;
  };
  const source: any = {
    listApplications: async () =>
      Promise.all(addon.listApplications().slice(0, 128).map(enrichPresentation)),
    captureApp: async (appRef, captureOptions) => {
      let pid = resolvePid2(appRef);
      const requestedPid =
        typeof appRef?.pid === "number" && Number.isSafeInteger(appRef.pid) && appRef.pid > 0
          ? appRef.pid
          : null;
      if (pid === null && requestedPid !== null) {
        for (let attempt = 0; attempt < 4 && pid === null; attempt += 1) {
          await new Promise((resolve2) => setTimeout(resolve2, 25));
          pid = resolvePid2(appRef);
        }
      }
      if (pid === null && appRef?.bundle_id) {
        for (let attempt = 0; attempt < 5 && pid === null; attempt += 1) {
          await new Promise((resolve2) => setTimeout(resolve2, 500));
          pid = resolvePid2(appRef);
        }
      }
      if (pid === null) {
        const launchableBundleId =
          typeof appRef?.bundle_id === "string" && appRef.bundle_id.trim()
            ? appRef.bundle_id
            : null;
        const launchableName: any =
          typeof appRef?.name === "string" && appRef.name.trim() ? appRef.name : null;
        let resolvedBundleId = launchableBundleId;
        if (
          resolvedBundleId === null &&
          launchableName !== null &&
          options.resolveApplicationBundleId
        ) {
          try {
            const resolved: any = await options.resolveApplicationBundleId(launchableName);
            if (typeof resolved === "string" && resolved.trim()) {
              resolvedBundleId = resolved.trim();
              console.error(
                `[cua-captureapp-launch] resolved name=${JSON.stringify(launchableName)} -> bundle=${JSON.stringify(resolvedBundleId)}`,
              );
            }
          } catch {}
        }
        if (launchableBundleId === null && resolvedBundleId !== null) {
          pid = resolvePid2({ bundle_id: resolvedBundleId });
          if (pid !== null) {
            console.error(
              `[cua-captureapp-launch] attached to running pid=${pid} via canonical bundle=${JSON.stringify(resolvedBundleId)} (no launch)`,
            );
          }
        }
        if (
          pid === null &&
          (launchableBundleId !== null || launchableName !== null) &&
          typeof addon.openApplicationInBackgroundAsync === "function"
        ) {
          console.error(
            `[cua-captureapp-launch] background launch begin bundle=${JSON.stringify(resolvedBundleId)} name=${JSON.stringify(launchableName)}`,
          );
          const launched = await addon.openApplicationInBackgroundAsync(
            resolvedBundleId,
            launchableName,
          );
          console.error(
            `[cua-captureapp-launch] background launch completed=${JSON.stringify(launched)}`,
          );
          if (launched !== false) {
            if (typeof launched === "number" && Number.isSafeInteger(launched) && launched > 0) {
              pid = resolvePid2(
                resolvedBundleId
                  ? { pid: launched, bundle_id: resolvedBundleId }
                  : { pid: launched },
              );
              if (pid !== null) {
                console.error(
                  `[cua-captureapp-launch] resolved via LaunchServices pid=${pid} (no enumeration wait)`,
                );
              }
            }
            const reResolveRef = resolvedBundleId
              ? { bundle_id: resolvedBundleId }
              : { name: launchableName };
            for (let attempt = 0; attempt < 5 && pid === null; attempt += 1) {
              pid = resolvePid2(reResolveRef);
              if (pid === null) {
                await new Promise((resolve2) => setTimeout(resolve2, 500));
              }
            }
            if (pid !== null) {
              await settleFreshlyLaunchedTree(pid, (probePid) => {
                try {
                  return addon.captureApp(probePid, void 0)?.elements?.length ?? null;
                } catch {
                  return null;
                }
              });
            }
          }
        }
      }
      if (pid === null) {
        throw elementUnavailable(
          // 措辞纪律（2026-09-11 真机）：这段原先给了三条**无法执行**的建议 ——
          //   1) "verify with list_apps"：list_apps 只列正在运行的应用，对一个没运行的
          //      应用查不到任何东西；
          //   2) "an explicit open_application"：mac 面已无该工具（对齐 codex，见
          //      tools/platform-surface.ts）；
          //   3) "use screenshot()"：全屏像素子系统在本轮重构里整体删除。
          // 模型照着走了两轮才放弃、退到 shell 去翻 /Applications。提示必须只给真能走的路。
          "capture_app: could not resolve this app_ref to a process. If app_ref.pid was given, that pid is not running. A running background/accessory process (a status-bar agent, the Dock, Control Center) is not reported by the app list even though it is running \u2014 pass app_ref.pid when you know the pid and it is used directly. Otherwise no installed application matched the reference well enough to launch it. A display name is resolved against installed applications, but it only works when the name matches; pass bundle_id when it does not (a bundle id is exact). If you do not know the bundle id, confirm the app is installed and read it from the app bundle itself, then retry get_app_state with that bundle_id.",
        );
      }
      const rawWindowId = appRef?.window_id;
      const windowId =
        typeof rawWindowId === "number" && Number.isSafeInteger(rawWindowId) && rawWindowId > 0
          ? rawWindowId
          : void 0;
      return capturePipeline(pid, captureOptions?.includeScreenshot !== false, windowId);
    },
    listWindows: (appRef) => {
      const pid = resolvePid2(appRef);
      if (pid === null) return null;
      const windows = addon.listWindows(pid);
      if (windows) return windows.map(toRawWindow);
      if (addon.isTrusted()) {
        throw elementUnavailable(
          "list_windows: the target app exposes no accessibility windows (no window, not scriptable, or it did not respond).",
        );
      }
      return null;
    },
    readElement: (ref) => {
      const el = addon.readElement(ref);
      return el ? toRawElement(el) : null;
    },
    elementWindowId: (ref) => addon.getWindowId(ref),
    applicationInfo: async (appRef) => {
      const pid = resolvePid2(appRef);
      if (pid === null) return null;
      if (typeof addon.applicationInfo === "function") {
        const app2 = addon.applicationInfo(pid);
        return app2 ? enrichPresentation(app2) : null;
      }
      const app = addon.listApplications().find((a) => a.pid === pid) ?? null;
      return app ? enrichPresentation(app) : null;
    },
    // 元素定向动作（不抢焦点）。返回 boolean；false 会被 services 层归一为 permission_denied（fail-closed）。
    elementPress: (ref) => addon.performAction(ref, "AXPress"),
    elementShowMenu: (ref) => addon.performAction(ref, "AXShowMenu"),
    elementFocus: (ref) => addon.setFocused(ref),
    elementSetValue: (ref, value) => addon.setValue(ref, value),
    elementPerformAction: (ref, action) => addon.performAction(ref, action),
    elementSelectText: (ref, textRange) =>
      textRange ? addon.selectText(ref, textRange[0], textRange[1]) : true,
  };
  const elementAtPoint = addon.elementAtPoint;
  if (typeof elementAtPoint === "function") {
    source.elementAtPoint = (x, y) => {
      const el = elementAtPoint(x, y);
      return el ? toRawElement(el) : null;
    };
  }
  const activateApplication = addon.activateApplication;
  if (typeof activateApplication === "function") {
    source.activateApplication = (pid) => activateApplication(pid);
  }
  return source;
}
