/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { elementUnavailable, permissionDenied } from "../broker/types.js";
import { WindowsScreenCaptureError } from "./windowsScreenCapture.js";

function adaptApp2(app) {
  const aumid: any = app.aumid?.trim() || null;
  const executablePath = app.bundle_id?.trim() || null;
  return {
    pid: app.pid,
    // Windows has no bundle id; the addon fills bundle_id with the exe path.
    // cuaAppIdentity.resolvePidBundleId treats unknown schemes as null.
    bundle_id: app.bundle_id,
    name: app.name,
    active: app.active,
    aumid,
    executable_path:
      executablePath && !isApplicationFrameHostPath(executablePath) ? executablePath : null,
    icon_png: app.icon_png ?? null,
  };
}
function adaptElement2(el) {
  return {
    ref: el.ref,
    role: el.role,
    title: el.title ?? null,
    value: el.value ?? null,
    bounds: el.bounds,
    enabled: el.enabled,
    focused: el.focused,
    editable: el.editable,
    actions: el.actions,
    hasMenu: el.has_menu,
    ownerPid: el.ownerPid,
    children: el.children ? el.children.map(adaptElement2) : void 0,
  };
}
function adaptSnapshot2(snap) {
  return {
    app: adaptApp2(snap.app),
    window: {
      title: snap.window.title,
      bounds: snap.window.bounds,
      window_id: snap.window.window_id,
      main: snap.window.main,
      focused: snap.window.focused,
    },
    elements: snap.elements.map(adaptElement2),
  };
}
function windowsIdentityKey(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\//gu, "\\").toLowerCase();
}
function windowsIdentitiesEqual(left, right) {
  const leftKey = windowsIdentityKey(left);
  return leftKey !== null && leftKey === windowsIdentityKey(right);
}
function isApplicationFrameHostPath(path) {
  return windowsIdentityKey(path)?.endsWith("\\applicationframehost.exe") === true;
}
function windowsNameMatches(liveName, requestedLower) {
  const live = liveName?.trim().toLowerCase();
  return Boolean(live && live.includes(requestedLower));
}
function readLiveApp(native, pid) {
  if (typeof native.applicationInfo === "function") {
    return native.applicationInfo(pid) ?? null;
  }
  return native.listApplications().find((app) => app.pid === pid) ?? null;
}
function createInstalledAppIndex(native) {
  let cache = null;
  let inflight = null;
  const load = (force) => {
    if (!force && cache) return Promise.resolve(cache);
    if (!force && inflight) return inflight;
    const pending = (
      typeof native.listInstalledApplicationsAsync === "function"
        ? native.listInstalledApplicationsAsync().catch(() => [])
        : Promise.resolve([])
    ).then((apps) => {
      cache = apps;
      inflight = null;
      return apps;
    });
    inflight = pending;
    return pending;
  };
  const pick2 = (apps, wanted) =>
    apps.find((app) => app.name.trim().toLowerCase() === wanted) ?? null;
  return {
    /**
     * 按显示名精确匹配（大小写无关）。故意不做模糊匹配 —— 拉起是有副作用的操作。
     *
     * `force` 由调用方决定何时重枚举：常见情况是"名字其实是窗口标题"，那时清单里
     * 本就没有它，每次 miss 都强制重枚举会让常见路径白付一次 ~340ms。只有在所有解析
     * 手段都落空、即将失败时才值得为"刚装上的应用"重来一次。
     */
    async find(name, force) {
      const wanted = name.trim().toLowerCase();
      if (!wanted) return null;
      return pick2(await load(force), wanted);
    },
  };
}
var UNINSTALLER_PATTERN = /uninstall|卸载|unins\d*\.exe$/iu;
function isUninstaller(app) {
  if (UNINSTALLER_PATTERN.test(app.name)) return true;
  const target: any = app.target_path;
  if (!target) return false;
  const base = target.replaceAll("/", "\\").split("\\").pop() ?? "";
  return UNINSTALLER_PATTERN.test(base);
}
function packagedAppMatchesExe(aumid, exePath) {
  if (!exePath) return false;
  const family = aumid.split("!")[0] ?? "";
  const separator = family.lastIndexOf("_");
  if (separator <= 0 || separator === family.length - 1) return false;
  const name = family.slice(0, separator).toLowerCase();
  const publisher = family.slice(separator + 1).toLowerCase();
  const path = exePath.replaceAll("/", "\\").toLowerCase();
  return path.includes(`\\${name}_`) && path.includes(`__${publisher}\\`);
}
function installDirectoryOf(exePath) {
  const key = windowsIdentityKey(exePath);
  if (!key) return null;
  const cut = key.lastIndexOf("\\");
  return cut > 0 ? key.slice(0, cut) : null;
}
function bindSuiteSibling(native, app, targetPath) {
  const directory = installDirectoryOf(targetPath);
  const wanted = app.name.trim().toLowerCase();
  if (!directory || !wanted) return null;
  for (const candidate of native.listApplications()) {
    if (installDirectoryOf(candidate.bundle_id) !== directory) continue;
    const window = (native.listWindows(candidate.pid) ?? []).find(
      (w) =>
        typeof w.window_id === "number" && w.window_id > 0 && windowsNameMatches(w.title, wanted),
    );
    if (window) {
      return { pid: candidate.pid, windowId: window.window_id, windowProven: true };
    }
  }
  return null;
}
async function settleFreshlyLaunchedTree2(pid, probe) {
  const deadline = Date.now() + 3e3;
  let previous = null;
  let stableStreak = 0;
  let nullStreak = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve2) => setTimeout(resolve2, 300));
    const current = probe(pid);
    if (current === null) {
      nullStreak += 1;
      if (nullStreak >= 3) return false;
      stableStreak = 0;
      previous = null;
      continue;
    }
    nullStreak = 0;
    stableStreak = current === previous ? stableStreak + 1 : 0;
    previous = current;
    if (stableStreak >= 2) return true;
  }
  return previous !== null;
}
function targetOf(app, proven?) {
  const target: any = { pid: app.pid };
  if (typeof app.window_id === "number" && app.window_id > 0) {
    target.windowId = app.window_id;
    if (proven?.windowProven === true) target.windowProven = true;
  }
  const aumid = proven?.aumid?.trim();
  if (aumid) target.aumid = aumid;
  return target;
}
function assertProvenWindowOnSharedHost(native, target, requestedWindowId) {
  if (requestedWindowId !== void 0 || target.windowProven === true) return;
  if (!isApplicationFrameHostPath(readLiveApp(native, target.pid)?.bundle_id)) return;
  const hosted = (native.listWindows(target.pid) ?? []).filter(
    (w) => w.cloaked !== true && w.minimized !== true,
  );
  if (hosted.length <= 1) return;
  throw elementUnavailable(
    `app_ref resolves to pid ${target.pid}, which runs ApplicationFrameHost \u2014 the shared host for packaged Windows apps. That pid does not name one app: it currently hosts ${hosted.length} visible windows ${JSON.stringify(hosted.map((w) => ({ window_id: w.window_id, title: w.title })))}. Retry with app_ref.window_id from that list, or with the app's name as the Start menu spells it \u2014 a name resolves to exactly one app.`,
  );
}
function resolveTarget(native, appRef) {
  const requestedBundleId = appRef.bundle_id?.trim() || null;
  const requestedName = appRef.name?.trim() || null;
  if (typeof appRef.pid === "number" && appRef.pid > 0) {
    const live = readLiveApp(native, appRef.pid);
    if (requestedBundleId) {
      if (live && !windowsIdentitiesEqual(live.bundle_id, requestedBundleId)) {
        throw elementUnavailable(
          `app_ref identity mismatch: pid ${appRef.pid} runs ${JSON.stringify(live.bundle_id)}, not requested ${JSON.stringify(requestedBundleId)}. Call list_apps and retry with pid, bundle_id, and name from the same live process.`,
        );
      }
    }
    return live ? targetOf(live) : { pid: appRef.pid };
  }
  if (!requestedBundleId && !requestedName) return null;
  const requestedNameLower = requestedName?.toLowerCase() ?? null;
  const matches = native.listApplications().filter((app) => {
    if (requestedBundleId && !windowsIdentitiesEqual(app.bundle_id, requestedBundleId)) {
      return false;
    }
    if (requestedNameLower !== null && !windowsNameMatches(app.name, requestedNameLower)) {
      return false;
    }
    return true;
  });
  if (matches.length === 0) return null;
  if (!requestedBundleId && matches.length > 1) {
    throw elementUnavailable(
      `app_ref.name is ambiguous: ${JSON.stringify(requestedName)} matched ${matches.length} live windows ${JSON.stringify(
        matches.map((app) => ({ pid: app.pid, name: app.name })),
      )}. Call list_apps and retry with app_ref.pid.`,
    );
  }
  const chosen = matches.find((app) => app.active) ?? matches[0];
  const hasExplicitWindowId = typeof appRef.window_id === "number" && appRef.window_id > 0;
  if (requestedBundleId && !hasExplicitWindowId && isApplicationFrameHostPath(chosen.bundle_id)) {
    const hosted = (native.listWindows(chosen.pid) ?? []).filter(
      (w) => w.cloaked !== true && w.minimized !== true,
    );
    if (hosted.length > 1) {
      throw elementUnavailable(
        `app_ref.bundle_id ${JSON.stringify(requestedBundleId)} is ApplicationFrameHost, the shared host for packaged Windows apps, so it does not name one app. It hosts ${hosted.length} visible windows ${JSON.stringify(hosted.map((w) => ({ window_id: w.window_id, title: w.title })))}. Retry with app_ref.window_id from that list, or with the app's name.`,
      );
    }
  }
  return targetOf(chosen, { windowProven: requestedNameLower !== null });
}
function adaptOutcome(o) {
  return { ok: o.ok, axError: o.axError };
}
export function createAxWinReadOnlySource(native, sourceOptions: any = {}) {
  if (!native.isInteractiveSession()) {
    return null;
  }
  const iconCache = /* @__PURE__ */ new Map();
  const enrichPresentation = async (app) => {
    const adapted = adaptApp2(app);
    if (typeof native.applicationIconPngAsync !== "function") return adapted;
    const key = adapted.aumid?.trim().toLowerCase() || adapted.executable_path?.toLowerCase();
    if (!key) return adapted;
    let icon = iconCache.get(key);
    if (!icon) {
      icon = native.applicationIconPngAsync(app.pid).catch(() => null);
      iconCache.set(key, icon);
      if (iconCache.size > 256) iconCache.delete(iconCache.keys().next().value);
    }
    return { ...adapted, icon_png: await icon };
  };
  const installedIndex = createInstalledAppIndex(native);
  const sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
  const resolveTargetForRead = async (appRef) => {
    const requestedName = appRef.name?.trim() ?? "";
    const nameOnly =
      !(typeof appRef.pid === "number" && appRef.pid > 0) &&
      !appRef.bundle_id?.trim() &&
      requestedName.length > 0;
    if (nameOnly) {
      const installed = await installedIndex.find(requestedName, false);
      const bound = installed ? bindLiveInstalledApp(installed) : null;
      if (bound) return bound;
    }
    return resolveTarget(native, appRef);
  };
  const bindLiveInstalledApp = (app) => {
    const aumid = app.aumid?.trim();
    if (aumid) {
      const hosted = native.applicationInfoByAumid?.(aumid) ?? null;
      if (hosted) return targetOf(hosted, { windowProven: true, aumid });
      const live = native
        .listApplications()
        .find((candidate) => packagedAppMatchesExe(aumid, candidate.bundle_id));
      if (live) return targetOf(live, { aumid });
    }
    const targetPath = app.target_path?.trim();
    if (targetPath) {
      const live = native
        .listApplications()
        .find((candidate) => windowsIdentitiesEqual(candidate.bundle_id, targetPath));
      if (live) return targetOf(live);
      const suite = bindSuiteSibling(native, app, targetPath);
      if (suite) return suite;
    }
    return null;
  };
  const bindOrLaunchInstalledApp = async (app) => {
    if (isUninstaller(app)) {
      throw elementUnavailable(
        `capture_app refuses to launch ${JSON.stringify(app.name)}: it resolves to an uninstaller (${JSON.stringify(app.target_path ?? app.aumid)}). Name an application, not its uninstaller.`,
      );
    }
    const bound = bindLiveInstalledApp(app);
    if (bound) return bound;
    if (typeof native.launchApplicationAsync !== "function") return null;
    const launchedPid = await native.launchApplicationAsync(
      app.aumid ?? null,
      app.target_path ?? null,
    );
    if (typeof launchedPid !== "number" || launchedPid <= 0) return null;
    const launchedViaAumid = Boolean(app.aumid?.trim());
    const launchedWindowTarget = () => {
      const launched = readLiveApp(native, launchedPid);
      return launched && typeof launched.window_id === "number" && launched.window_id > 0
        ? targetOf(launched)
        : null;
    };
    let target = null;
    for (let attempt = 0; attempt < 6 && target === null; attempt += 1) {
      target = launchedViaAumid
        ? (bindLiveInstalledApp(app) ?? launchedWindowTarget())
        : (launchedWindowTarget() ?? bindLiveInstalledApp(app));
      if (target === null) await sleep(500);
    }
    if (target === null) return null;
    const probeTree = (pid) => {
      try {
        return native.captureApp(pid, void 0)?.elements?.length ?? null;
      } catch {
        return null;
      }
    };
    if (!(await settleFreshlyLaunchedTree2(target.pid, probeTree))) {
      const rebound = bindLiveInstalledApp(app);
      if (rebound && rebound.pid !== target.pid) {
        target = rebound;
        await settleFreshlyLaunchedTree2(target.pid, probeTree);
      }
    }
    return target;
  };
  const aumidForWindow = (pid, windowId) => {
    const candidate = readLiveApp(native, pid)?.aumid?.trim();
    if (!candidate) return null;
    if ((native.listWindows(pid) ?? []).length <= 1) return candidate;
    const owner = native.applicationInfoByAumid?.(candidate) ?? null;
    return owner?.window_id === windowId ? candidate : null;
  };
  const makeObservable = async (pid, windowId, includeScreenshot, provenAumid) => {
    if (windowId === void 0) {
      return { windowId: void 0, minimized: false };
    }
    const readWindow = () =>
      (native.listWindows(pid) ?? []).find((w) => w.window_id === windowId) ?? null;
    let win = readWindow();
    if (win?.cloaked === true) {
      const aumid = provenAumid ?? aumidForWindow(pid, windowId);
      if (aumid && typeof native.activateApplicationByAumid === "function") {
        native.activateApplicationByAumid(aumid);
        const deadline = Date.now() + 2e3;
        for (;;) {
          win = readWindow();
          if (win?.cloaked !== true || Date.now() >= deadline) break;
          await sleep(200);
        }
      }
    }
    if (win?.minimized === true && includeScreenshot) {
      const bundleId = readLiveApp(native, pid)?.bundle_id?.trim();
      const hwnd = win.window_id;
      if (
        bundleId &&
        typeof hwnd === "number" &&
        hwnd > 0 &&
        typeof native.activateWindow === "function"
      ) {
        native.activateWindow(pid, bundleId, hwnd);
        win = readWindow();
      }
    }
    return {
      windowId: win?.window_id ?? windowId,
      minimized: win?.minimized === true,
    };
  };
  const source = {
    listApplications: async () =>
      Promise.all(native.listApplications().slice(0, 128).map(enrichPresentation)),
    applicationInfo: async (appRef) => {
      const pid = (await resolveTargetForRead(appRef))?.pid ?? null;
      if (pid === null) return null;
      const info = native.applicationInfo?.(pid);
      return info ? enrichPresentation(info) : null;
    },
    applicationInfoByAumid:
      typeof native.applicationInfoByAumid === "function"
        ? async (aumid) => {
            const info = native.applicationInfoByAumid?.(aumid);
            return info ? enrichPresentation(info) : null;
          }
        : void 0,
    listWindows: async (appRef) => {
      const pid = (await resolveTargetForRead(appRef))?.pid ?? null;
      if (pid === null) return null;
      const wins = native.listWindows(pid);
      if (!wins) return null;
      const out = wins.map((w) => ({
        title: w.title,
        bounds: w.bounds,
        window_id: w.window_id,
        main: w.main,
        focused: w.focused,
      }));
      return out;
    },
    captureApp: async (appRef, captureOptions) => {
      const includeScreenshot: any = captureOptions?.includeScreenshot !== false;
      const requestedName = appRef.name?.trim() ?? "";
      const nameOnly =
        !(typeof appRef.pid === "number" && appRef.pid > 0) &&
        !appRef.bundle_id?.trim() &&
        requestedName.length > 0;
      let installed = nameOnly ? await installedIndex.find(requestedName, false) : null;
      let target = installed ? await bindOrLaunchInstalledApp(installed) : null;
      if (target === null) target = resolveTarget(native, appRef);
      if (target === null && nameOnly && installed === null) {
        installed = await installedIndex.find(requestedName, true);
        if (installed) target = await bindOrLaunchInstalledApp(installed);
      }
      if (target === null) {
        throw elementUnavailable(
          "capture_app: the target Windows app could not be resolved \u2014 no live window matched the requested pid/bundle_id/name, and no installed application matched that name exactly. An app name must match its Start-menu display name character-for-character (that is what Windows registers); a window title is not an app name. Call list_apps and retry with the pid it reports.",
        );
      }
      const pid = target.pid;
      if (native.isTargetElevated?.(pid)) {
        throw permissionDenied(
          `capture_app: the target process (pid ${pid}) runs elevated, so Windows UIPI blocks UI Automation from this non-elevated ZCode. Restart ZCode elevated, or target a non-elevated app. This is not a privacy-permission problem.`,
        );
      }
      const requestedWindowId =
        typeof appRef.window_id === "number" &&
        Number.isSafeInteger(appRef.window_id) &&
        appRef.window_id > 0
          ? appRef.window_id
          : void 0;
      assertProvenWindowOnSharedHost(native, target, requestedWindowId);
      const effectiveRequest = requestedWindowId ?? target.windowId;
      const observed = await makeObservable(
        pid,
        effectiveRequest,
        includeScreenshot,
        // target.aumid 只描述 target.windowId 那个窗口；模型改指了别的窗口就不能沿用。
        effectiveRequest === target.windowId ? target.aumid : void 0,
      );
      const effectiveWindowId = observed.windowId;
      const snap = native.captureApp(pid, effectiveWindowId);
      if (!snap) {
        throw elementUnavailable(
          `capture_app: Windows UI Automation returned no tree for pid ${pid} (the app has no visible top-level window, or it did not respond to the UIA request). Bind by app name instead of this pid: a packaged Windows app hands its window to ApplicationFrameHost shortly after launch, so a pid captured moments earlier can be left holding nothing. Call list_apps only if binding by name does not resolve.`,
        );
      }
      if (effectiveWindowId !== void 0 && snap.window.window_id !== effectiveWindowId) {
        throw elementUnavailable(
          "capture_app: the requested Windows window changed or could not be resolved; call list_windows and re-observe.",
        );
      }
      const adapted = adaptSnapshot2(snap);
      if (!includeScreenshot || !sourceOptions.captureWindowPngVerified) {
        return adapted;
      }
      const windowId = snap.window.window_id;
      const expectedCanonicalBundleId = snap.app.bundle_id?.trim();
      if (
        typeof windowId !== "number" ||
        !Number.isSafeInteger(windowId) ||
        windowId <= 0 ||
        !expectedCanonicalBundleId
      ) {
        throw elementUnavailable(
          "capture_app: Windows window identity is incomplete; re-list the app windows before requesting pixels.",
        );
      }
      try {
        const captured: any = await sourceOptions.captureWindowPngVerified({
          windowId,
          pid: snap.app.pid,
          expectedCanonicalBundleId,
          expectedBounds: snap.window.bounds,
        });
        return {
          ...adapted,
          screenshot: {
            format: "png",
            data: Buffer.from(captured.data).toString("base64"),
          },
          screenshot_bounds: captured.bounds,
          screenshot_error: null,
        };
      } catch (error51) {
        if (!(error51 instanceof WindowsScreenCaptureError)) throw error51;
        if (error51.code === "invalid_target" && observed.minimized) {
          return { ...adapted, screenshot: null, screenshot_error: "minimized" };
        }
        if (error51.code === "invalid_target" || error51.code === "target_changed") {
          throw elementUnavailable(
            `capture_app: the verified Windows capture target is unavailable (${error51.code}); re-observe before acting.`,
          );
        }
        return {
          ...adapted,
          screenshot: null,
          screenshot_error: error51.code,
        };
      }
    },
    readElement: (ref) => {
      const el = native.readElement(ref);
      return el ? adaptElement2(el) : null;
    },
    elementAtPoint: (x, y) => {
      const el = native.elementAtPoint?.(x, y);
      return el ? adaptElement2(el) : null;
    },
    elementPress: (ref) => adaptOutcome(native.performAction(ref, "AXPress")),
    elementShowMenu: (ref) => adaptOutcome(native.performAction(ref, "AXShowMenu")),
    elementFocus: (ref) => adaptOutcome(native.setFocused(ref)),
    elementSetValue: (ref, value) => adaptOutcome(native.setValue(ref, value)),
    elementPerformAction: (ref, action) => adaptOutcome(native.performAction(ref, action)),
    elementSelectText: (ref, textRange) => {
      const start = textRange ? textRange[0] : 0;
      const length = textRange ? textRange[1] : 0;
      return adaptOutcome(native.selectText(ref, start, length));
    },
  };
  return source;
}
