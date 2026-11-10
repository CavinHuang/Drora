/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { elementUnavailable, permissionDenied } from "../broker/types.js";
import { WindowsScreenCaptureError } from "./windowsScreenCapture.js";
// 还原自发行 bundle（官方 0.6.5 win32 entry :30555/:31280）：win32 专用操作请求
// instrument（mutations 守卫 + evidence 采集）与帧目标选择/菜单观察。mac 编译形态
// 下 createAxWinReadOnlySource 不被装配（nodeAutomationAdapter 仅 win32 调用），
// 与官方对齐。
import {
  currentWindowsOperationContext,
  instrumentWindowsOperationNative,
  verifyWindowsOperationChain,
} from "./windows-operation-request.js";
import { observeWindowsOperationMenus } from "./windows-menu-observation.js";
import { selectWindowsFrameTarget } from "./windows-frame-target.js";

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
// 还原自发行 bundle（官方 0.6.5 win32 entry :30227-30263）：把 frame surface
// 枚举报告（enumerateSurfacesForFrame）接到快照上——surfaces（actual/presentation/
// kind/relation/owner/layer/class_name + 身份增强 tid/start_time/generation/
// producer）、independent_candidates、decorative_summaries；菜单域经
// observeWindowsOperationMenus 产出 windows_operation_associations。ABI 缺失
//（enumerateSurfacesForFrame 不可用 / rootHwnd 无效）返回 null，快照无 surface 域。
function attachFrameSurfaceReport(native, pid, rootHwnd, adapted) {
  if (
    typeof native.enumerateSurfacesForFrame !== "function" ||
    rootHwnd === null ||
    !Number.isSafeInteger(rootHwnd) ||
    rootHwnd <= 0
  ) {
    return null;
  }
  let report = null;
  try {
    report = native.enumerateSurfacesForFrame(pid, rootHwnd);
  } catch {
    return null;
  }
  if (!report || !Array.isArray(report.surfaces)) return null;
  adapted.windows_operation_associations = observeWindowsOperationMenus(
    native,
    report,
    rootHwnd,
    currentWindowsOperationContext(),
  );
  const presentationWindowId = rootHwnd;
  adapted.surfaces = report.surfaces
    .filter((s) => Number.isSafeInteger(s.window_id) && s.window_id > 0)
    .map((s) => ({
      actual_window_id: s.window_id,
      presentation_window_id: presentationWindowId,
      surface_kind: s.surface_kind,
      relation: s.relation,
      owner_pid: s.pid,
      bounds: s.bounds,
      layer: s.layer,
      class_name: s.class_name,
      ...(s.relation === "operation_association"
        ? {
            operation_association: adapted.windows_operation_associations?.find(
              (proof) => proof.candidate.window_id === s.window_id,
            ),
          }
        : {}),
    }));
  for (const surface of adapted.surfaces) {
    const context = native.frameWindowContext?.(surface.actual_window_id);
    if (context?.pid === surface.owner_pid) {
      if (context.tid) surface.owner_tid = context.tid;
      if (context.process_start_time) surface.process_start_time = context.process_start_time;
      if (context.window_generation) surface.window_generation = context.window_generation;
      if (context.producer_id) surface.producer_id = context.producer_id;
    }
  }
  adapted.independent_candidates = Array.isArray(report.independent_candidates)
    ? report.independent_candidates
    : [];
  adapted.decorative_summaries = Array.isArray(report.decorative_summaries)
    ? report.decorative_summaries
    : [];
  return report;
}
// 还原自发行 bundle（官方 0.6.5 win32 entry :30265-30294）：复合抓图的 popup 选择。
// 仅 owned_popup/menu_popup 且 bounds 与 root 相交的进 popups（layer 降序）；
// 相离的记 gaps（reason=outside_root_bounds，不含进合成也不丢弃事实）。
function selectCompositePopups(report, rootBounds) {
  const popups = [];
  const gaps = [];
  if (!rootBounds) return { popups, gaps };
  const [rx, ry, rw, rh] = rootBounds;
  for (const surface of report.surfaces) {
    if (surface.surface_kind !== "owned_popup" && surface.surface_kind !== "menu_popup") {
      continue;
    }
    if (
      !Number.isSafeInteger(surface.window_id) ||
      surface.window_id <= 0 ||
      !Number.isSafeInteger(surface.pid) ||
      surface.pid <= 0 ||
      !Array.isArray(surface.bounds) ||
      surface.bounds.length !== 4 ||
      !surface.bounds.every((part) => typeof part === "number" && Number.isFinite(part))
    ) {
      continue;
    }
    const [x, y, w, h] = surface.bounds;
    if (x >= rx + rw || y >= ry + rh || x + w <= rx || y + h <= ry) {
      gaps.push({ window_id: surface.window_id, reason: "outside_root_bounds" });
      continue;
    }
    popups.push({
      windowId: surface.window_id,
      pid: surface.pid,
      expectedBounds: [x, y, w, h],
      layer: surface.layer,
    });
  }
  popups.sort((a, b) => b.layer - a.layer);
  return { popups, gaps };
}
// 还原自发行 bundle（官方 0.6.5 win32 entry :30296-30339）：合成截图回执组装。
// root surface 块缺失即拒绝（合成图不可用）；popups 按 captured 顺序、gaps 合并
// native gaps 与选择 gaps（去重）。method 字面量即 WSF 契约
// root_wgc_plus_popup_wgc_premultiplied_composite。
function buildScreenshotComposition(report, composited, selectionGaps) {
  const byId = new Map<any, any>(report.surfaces.map((s) => [s.window_id, s]));
  const entry = (windowId) => {
    const surface = byId.get(windowId);
    const captured = composited.captured.find((c) => c.window_id === windowId);
    if (!captured || !surface) return null;
    return {
      window_id: windowId,
      pid: captured.pid,
      owner_bundle_id: captured.owner_bundle_id,
      bounds: captured.bounds,
      layer: surface.layer,
      surface_kind: surface.surface_kind,
      relation: surface.relation,
    };
  };
  const rootSurface = report.surfaces.find((s) => s.surface_kind === "window");
  const root = rootSurface ? entry(rootSurface.window_id) : null;
  if (!root) {
    throw elementUnavailable(
      "capture_app: composite capture receipt is missing the root surface block; treat this raster as unusable and re-observe.",
    );
  }
  const popups = [];
  for (const captured of composited.captured) {
    if (captured.window_id === rootSurface.window_id) continue;
    const composed = entry(captured.window_id);
    if (composed) popups.push(composed);
  }
  const gapIds = new Set(composited.gaps.map((g) => g.window_id));
  const gaps = [
    ...composited.gaps,
    ...selectionGaps.filter((g) => !gapIds.has(g.window_id)),
  ];
  return {
    method: "root_wgc_plus_popup_wgc_premultiplied_composite",
    root,
    popups,
    gaps,
  };
}
export function createAxWinReadOnlySource(native, sourceOptions: any = {}) {
  // 还原自发行 bundle（官方 0.6.5 win32 entry :30555）：源级 instrument——mutations
  // 集方法经 windows-operation-request 的 Proxy（操作关联守卫 + evidence 采集），
  // 幂等（WeakMap 缓存包装结果）。
  native = instrumentWindowsOperationNative(native);
  if (!native.isInteractiveSession()) {
    return null;
  }
  // 还原自发行 bundle（官方 0.6.5 win32 entry :30724-30725）：元素强引用桥——
  // token（ref 字符串）→ 原生 element 句柄（winAxElementFromToken）与释放
  //（winAxElementRelease）。additive ABI：缺导出为 undefined，UIA 梯/读回链
  //（axReadOnly element_perform_action/element_set_value）判能力缺失走降级。
  const winAxElementFromToken =
    typeof native.winAxElementFromToken === "function" ? (ref) => native.winAxElementFromToken(ref) : void 0;
  const winAxElementRelease =
    typeof native.winAxElementRelease === "function" ? (element) => native.winAxElementRelease(element) : void 0;
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
    // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:30643-30648）：
    // 三参签名 (aumid ?? null, target_path ?? null, arguments ?? null)——此前还原稿
    // 漏了第三参 app.arguments。
    const launchedPid = await native.launchApplicationAsync(
      app.aumid ?? null,
      app.target_path ?? null,
      app.arguments ?? null,
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
    // 还原自官方 30656-30664：20×500ms（10 秒）绑窗轮询；超窗仍无窗直接抛
    // elementUnavailable（带 pid 的官方长文案），不回退 resolveTarget——拉起已成功，
    // 回退只会把"启动慢"误报成"名字不匹配"。
    for (let attempt = 0; attempt < 20 && target === null; attempt += 1) {
      target = launchedViaAumid
        ? (bindLiveInstalledApp(app) ?? launchedWindowTarget())
        : (launchedWindowTarget() ?? bindLiveInstalledApp(app));
      if (target === null) await sleep(500);
    }
    if (target === null) {
      throw elementUnavailable(
        `capture_app: launch succeeded for ${JSON.stringify(app.name)} (pid ${launchedPid}), but no visible window appeared within 10 seconds \u2014 the app is probably still starting. This is not a name problem: the name matched an installed application, and the process is running. Bind the app again after a short wait, with the same name or pid ${launchedPid}; the binding succeeds once its window is up.`,
      );
    }
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
  // any：elementScroll 桥在对象字面量之后按能力探测 attach（官方 31073-31076 形态）。
  const source: any = {
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
      // 还原自发行 bundle（官方 0.6.5 win32 entry :30781-30798）：会话根延续——
      // 操作请求域里有根/演示根时优先沿它复选目标（同一会话内观察根漂移最小化），
      // previousRoot 仍可见且属于目标（同 pid 或同帧 surface 集）时改指它。
      const priorContext = currentWindowsOperationContext();
      const independentSelection =
        priorContext?.independent_root &&
        priorContext.root_window_id === (appRef.window_id ?? target.windowId);
      const previousRoot = independentSelection
        ? priorContext.root_window_id
        : (priorContext?.presentation_window_id ?? priorContext?.root_window_id);
      const previousRootContext = previousRoot ? native.frameWindowContext?.(previousRoot) : null;
      if (previousRoot) {
        const previous = previousRootContext;
        if (
          previous?.visible &&
          (previous.pid === target.pid ||
            native
              .enumerateSurfacesForFrame?.(target.pid, target.windowId ?? 0)
              ?.surfaces.some((surface) => surface.window_id === previousRoot))
        ) {
          target = { ...target, windowId: previousRoot };
        }
      }
      let pid = target.pid;
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
      let effectiveRequest = requestedWindowId ?? target.windowId;
      // 还原自发行 bundle（官方 0.6.5 win32 entry :30801-30831）：帧目标域。沿
      // owner chain 上溯（≤8 层、同 pid、防环）取 frame root，经
      // selectWindowsFrameTarget 决定 actual/presentation（独立窗/模态面板/主窗），
      // 多模态面板 → ambiguous_observation_root；frameWindowContext/
      // enumerateSurfacesForFrame 任一 ABI 缺失时整域跳过（frameTarget=undefined，
      // 与官方旧 addon 降级一致）。
      let frameTarget;
      if (native.frameWindowContext && native.enumerateSurfacesForFrame && target.windowId) {
        let root = native.frameWindowContext(target.windowId);
        const known = currentWindowsOperationContext();
        const requested = requestedWindowId ? native.frameWindowContext(requestedWindowId) : null;
        if (
          requested?.minimized &&
          known &&
          known.presentation_window_id === requestedWindowId &&
          !known.independent_root &&
          requested.pid === target.pid &&
          root &&
          windowsIdentitiesEqual(requested.bundle_id, root.bundle_id)
        )
          root = requested;
        const seen = /* @__PURE__ */ new Set();
        for (
          let depth = 0;
          !independentSelection &&
          !(priorContext?.presentation_independent_root && root?.window_id === priorContext.presentation_window_id) &&
          root?.owner_window_id &&
          depth < 8;
          depth++
        ) {
          if (seen.has(root.window_id)) break;
          seen.add(root.window_id);
          const owner = native.frameWindowContext(root.owner_window_id);
          if (!owner || owner.pid !== target.pid) break;
          root = owner;
        }
        if (root) {
          const report = native.enumerateSurfacesForFrame(root.pid, root.window_id);
          try {
            frameTarget = selectWindowsFrameTarget(
              root,
              requestedWindowId,
              report?.surfaces ?? [],
              (id) => native.frameWindowContext(id),
            );
          } catch (error62) {
            throw elementUnavailable(
              `capture_app: ${error62 instanceof Error ? error62.message : "window_identity_unverified"}; re-observe the requested window.`,
              { action_sent: false },
            );
          }
          if (!frameTarget.actual) {
            throw elementUnavailable(
              "capture_app: multiple proven modal panels; explicitly select a window_id from window_candidates.",
              { action_sent: false, reason: "ambiguous_observation_root", window_candidates: frameTarget.candidates },
            );
          }
          pid = frameTarget.actual.pid;
          effectiveRequest = frameTarget.actual.window_id;
        }
      }
      const observed = await makeObservable(
        pid,
        effectiveRequest,
        includeScreenshot,
        // target.aumid 只描述 target.windowId 那个窗口；模型改指了别的窗口就不能沿用。
        effectiveRequest === target.windowId ? target.aumid : void 0,
      );
      const effectiveWindowId = observed.windowId;
      // 还原自官方 30833-30845：帧目标最小窗在观察期被恢复（makeObservable 激活）
      // 后重读身份，八字段任一变化 → surface_replaced（不把激活后的偷换窗当目标）。
      if (frameTarget?.actual?.minimized && !observed.minimized) {
        const before = frameTarget.actual;
        const restored = native.frameWindowContext?.(before.window_id);
        if (
          !restored?.visible ||
          restored.minimized ||
          restored.pid !== before.pid ||
          restored.tid !== before.tid ||
          restored.process_start_time !== before.process_start_time ||
          restored.producer_id !== before.producer_id ||
          restored.owner_window_id !== before.owner_window_id ||
          !windowsIdentitiesEqual(restored.bundle_id, before.bundle_id)
        )
          throw elementUnavailable("capture_app: the restored window identity changed; re-observe.", {
            action_sent: false,
            reason: "surface_replaced",
          });
        frameTarget = {
          ...frameTarget,
          actual: restored,
          presentation:
            frameTarget.presentation.window_id === restored.window_id ? restored : frameTarget.presentation,
        };
      }
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
      // any：官方在 adapted.window 上动态挂 independent_root/presentation_independent_root/
      // presentation_window_id/actual_owner_* 等 surface 域字段（30848-30900）。
      const adapted: any = adaptSnapshot2(snap);
      // 还原自官方 30848-30861：independent_root / presentation_independent_root
      // 标记（会话域独立选择、菜单无主窗、跨根改指、帧目标独立 presentation）。
      const operationContext = currentWindowsOperationContext();
      if (operationContext?.independent_root && operationContext.root_window_id === adapted.window.window_id)
        adapted.window.independent_root = true;
      if (frameTarget?.independent || (frameTarget?.actual?.is_menu && !frameTarget.actual.owner_window_id))
        adapted.window.independent_root = true;
      if (
        requestedWindowId &&
        previousRoot &&
        previousRoot !== requestedWindowId &&
        !previousRootContext &&
        frameTarget?.actual?.window_id === requestedWindowId &&
        frameTarget.presentation.window_id === requestedWindowId
      )
        adapted.window.independent_root = true;
      if (frameTarget?.actual) {
        const actual = frameTarget.actual;
        const presentation = frameTarget.presentation;
        const independentPresentation =
          frameTarget.independent ||
          (adapted.window.independent_root && actual.window_id === presentation.window_id) ||
          (operationContext?.presentation_independent_root &&
            operationContext.presentation_window_id === presentation.window_id);
        if (independentPresentation) {
          adapted.window.presentation_independent_root = true;
          if (actual.window_id === presentation.window_id) adapted.window.independent_root = true;
        }
        const logical = readLiveApp(native, presentation.pid);
        adapted.app = {
          ...adapted.app,
          ...(logical ? adaptApp2(logical) : {}),
          pid: presentation.pid,
          bundle_id: presentation.bundle_id,
          window_id: presentation.window_id,
        };
        adapted.window.presentation_window_id = presentation.window_id;
        adapted.window.actual_owner_pid = actual.pid;
        adapted.window.actual_owner_bundle_id = actual.bundle_id;
        if (frameTarget.modal_blocker) adapted.window.modal_blocker = frameTarget.modal_blocker;
      }
      // 还原自官方 30865-30880：frame surface 报告接入（菜单观察 + surface 身份集），
      // presentation ≠ actual 时逐 surface 重指 presentation 并把 actual 标
      // owned_popup/owner_chain。
      const surfaceReport = attachFrameSurfaceReport(
        native,
        pid,
        typeof snap.window.window_id === "number" ? snap.window.window_id : null,
        adapted,
      );
      if (frameTarget?.actual && frameTarget.presentation.window_id !== frameTarget.actual.window_id) {
        for (const surface of adapted.surfaces ?? []) {
          surface.presentation_window_id = frameTarget.presentation.window_id;
          if (surface.actual_window_id === frameTarget.actual.window_id) {
            surface.surface_kind = "owned_popup";
            surface.relation = "owner_chain";
          }
        }
      }
      // 还原自官方 30883-30900：菜单 surface 的元素并入快照树（弹层菜单的
      // MenuItem 不在主窗树里；child_window 除外）。
      const elementRefs = new Set(adapted.elements.map((element) => element.ref));
      for (const surface of surfaceReport?.surfaces ?? []) {
        if (surface.window_id === snap.window.window_id || surface.surface_kind === "child_window") continue;
        const context = native.frameWindowContext?.(surface.window_id);
        if (!context?.visible || !context.is_menu || context.pid !== surface.pid) continue;
        const menu = native.captureApp(surface.pid, surface.window_id);
        if (!menu || menu.window.window_id !== surface.window_id) continue;
        for (const element of menu.elements) {
          if (!elementRefs.has(element.ref)) {
            adapted.elements.push(adaptElement2(element));
            elementRefs.add(element.ref);
          }
        }
      }
      // 官方 0.6.5 win entry :30901-30924 此处有 displayNameFor 段（installed-index
      // 别名索引回填 app.name）。我方 installedIndex 为早期还原版（无 records()/
      // displayNameFor，属 installed-index 别名域，非本批 delivery/provenance/uia/
      // composite 机械域），该段不在此批还原，app.name 维持窗口枚举名。
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
      // 还原自发行 bundle（官方 0.6.5 win32 entry :30940-30980）：像素取证三段
      // verifySelectedFrame——①操作关联链重验（菜单域防偷换，surface_replaced）；
      // ②逐 surface 生命周期（window_generation/producer_id）；③帧目标 actual/
      // presentation 身份与关系复核（bounds 逐值 JSON 比对）。抓图后逐段执行，
      // 任一变化即拒绝该帧像素。
      const verifySelectedFrame = () => {
        if (
          verifyWindowsOperationChain(
            native,
            adapted.windows_operation_associations ?? [],
            currentWindowsOperationContext()?.session_id ?? "",
          ) === null
        )
          throw elementUnavailable(
            "capture_app: Windows menu operation association changed during image capture; re-observe.",
            { action_sent: false, reason: "surface_replaced" },
          );
        for (const surface of adapted.surfaces ?? []) {
          if (surface.window_generation === void 0 || surface.surface_kind === "child_window") continue;
          const current = native.frameWindowContext?.(surface.actual_window_id);
          if (
            !current?.visible ||
            current.window_generation !== surface.window_generation ||
            current.producer_id !== surface.producer_id
          ) {
            throw elementUnavailable("capture_app: a captured surface lifecycle changed; re-observe.", {
              action_sent: false,
              reason: "surface_replaced",
            });
          }
        }
        if (!frameTarget?.actual || !native.frameWindowContext) return;
        const before = frameTarget.actual;
        const after = native.frameWindowContext(before.window_id);
        const presentation = native.frameWindowContext(frameTarget.presentation.window_id);
        const same =
          after?.visible &&
          after.pid === before.pid &&
          windowsIdentitiesEqual(after.bundle_id, before.bundle_id) &&
          after.window_generation === before.window_generation &&
          after.process_start_time === before.process_start_time &&
          after.owner_window_id === before.owner_window_id &&
          JSON.stringify(after.bounds) === JSON.stringify(before.bounds);
        const rootSame =
          presentation?.pid === frameTarget.presentation.pid &&
          windowsIdentitiesEqual(presentation?.bundle_id, frameTarget.presentation.bundle_id) &&
          presentation?.process_start_time === frameTarget.presentation.process_start_time;
        const related =
          before.window_id === frameTarget.presentation.window_id ||
          native
            .enumerateSurfacesForFrame?.(frameTarget.presentation.pid, frameTarget.presentation.window_id)
            ?.surfaces.some((s) => s.window_id === before.window_id && s.pid === before.pid);
        if (!same || !rootSame || !related)
          throw elementUnavailable(
            "capture_app: selected panel identity, geometry or relationship changed during capture; re-observe.",
            { action_sent: false, reason: "surface_replaced" },
          );
      };
      // 还原自发行 bundle（官方 0.6.5 win32 entry :30981-31008）：复合截图分支——
      // frame surface 报告选出 owned_popup/menu_popup 且与 root 相交的弹层，
      // captureWindowPngComposite 可用（captureWindowPngCompositeAsync 导出）时走
      // root+popups 合成抓图，回执组装 screenshot_composition；native 拒绝
      // invalid_target/target_changed 上抛，其余降级 screenshot_error。缺 composite
      // ABI（mac 官方形态）时 selection.popups 非空也无合成路径，落单窗 verified。
      const selection = surfaceReport ? selectCompositePopups(surfaceReport, snap.window.bounds ?? null) : null;
      if (selection && selection.popups.length > 0 && sourceOptions.captureWindowPngComposite) {
        try {
          const composited: any = await sourceOptions.captureWindowPngComposite({
            root: {
              windowId,
              pid: snap.app.pid,
              expectedCanonicalBundleId,
              expectedBounds: snap.window.bounds,
            },
            popups: selection.popups.map(({ windowId: _w, pid: _p, expectedBounds, layer: _l }) => ({
              windowId: _w,
              pid: _p,
              expectedBounds,
            })),
          });
          verifySelectedFrame();
          const composition = buildScreenshotComposition(surfaceReport, composited, selection.gaps);
          return {
            ...adapted,
            screenshot: {
              format: "png",
              data: Buffer.from(composited.data).toString("base64"),
            },
            screenshot_bounds: composited.bounds,
            screenshot_error: null,
            screenshot_composition: composition,
          };
        } catch (error62) {
          if (!(error62 instanceof WindowsScreenCaptureError)) throw error62;
          if (error62.code === "invalid_target" || error62.code === "target_changed") {
            throw elementUnavailable(
              `capture_app: the verified Windows capture target is unavailable (${error62.code}); re-observe before acting.`,
            );
          }
          return {
            ...adapted,
            screenshot: null,
            screenshot_error: error62.code,
          };
        }
      }
      try {
        const captured: any = await sourceOptions.captureWindowPngVerified({
          windowId,
          pid: snap.app.pid,
          expectedCanonicalBundleId,
          expectedBounds: snap.window.bounds,
        });
        verifySelectedFrame();
        // 还原自官方 30992-30998：单窗抓图回执带 windows_capture_root（该帧像素
        // 的 root surface 块，bounds 取实际抓图 bounds）——供 buildWindowsAppFrameSurfaceSet
        // 在无 composition 时构造 capture_surfaces。
        const surface = adapted.surfaces?.find((s) => s.actual_window_id === windowId);
        return {
          ...adapted,
          screenshot: {
            format: "png",
            data: Buffer.from(captured.data).toString("base64"),
          },
          screenshot_bounds: captured.bounds,
          ...(frameTarget?.actual && surface
            ? {
                windows_capture_root: {
                  ...surface,
                  owner_bundle_id: frameTarget.actual.bundle_id,
                  layer: surface.layer ?? 0,
                  bounds: captured.bounds,
                },
              }
            : {}),
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
      // 还原自发行 bundle（官方 0.6.5 win32 entry :31017-31024）：强引用代际标记
      //（:generation:\d+ 后缀）的 ref 读不到活元素时抛 surface_replaced——宁可拒绝
      // 也不把 null 当"元素消失"静默传递，防旧代际 ref 继续派发。
      if (!el && /:generation:\d+$/u.test(ref)) {
        throw elementUnavailable("Windows surface reference was retired; observe again and use a new reference.", {
          action_sent: false,
          reason: "surface_replaced",
          auto_reresolve: false,
        });
      }
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
    // 还原自官方发行 bundle（win32 0.6.5 dist/windows-helper.js:31044-31053）：
    // 元素 → 宿主根窗接缝。falsy 且 ref 带 :generation:\d+ 后缀（强引用代际标记）
    // 时抛 elementUnavailable(window_identity_unverified)——宁可拒绝也不把 nullptr
    // 宿主喂给后续派发。消费方：axReadOnly.ts 的 element 诊断（:308）与
    // element_set_value strategy=event 的 windowId（:875）。
    elementWindowId: native.getWindowId
      ? (ref) => {
          const host = native.getWindowId(ref);
          if (!host && /:generation:\d+$/u.test(ref)) {
            throw elementUnavailable(
              "Windows element host could not be reverified; observe again before sending.",
              { action_sent: false, reason: "window_identity_unverified", auto_reresolve: false },
            );
          }
          return host;
        }
      : void 0,
    // 还原自发行 bundle（官方 0.6.5 win32 entry :31039-31072，定义 :30724-30725）：
    // 元素强引用桥与 UIA 梯/读回/classify/postMessage 元素级桥（全部 additive——
    // native 缺导出时 undefined，消费方按能力缺失降级：element_set_value 裸写、
    // element_perform_action 退回同步 elementPerformAction、type_text 无后台插入）。
    winAxElementFromToken,
    winAxElementRelease,
    elementDispatchWindowId: native.getDispatchWindowId
      ? (ref) => native.getDispatchWindowId(ref)
      : void 0,
    elementPatternCallAsync: native.elementPatternCallAsync
      ? (element, host, pattern) => native.elementPatternCallAsync(element, host, pattern)
      : void 0,
    setValueReadbackAsync: native.setValueReadbackAsync
      ? (element, host, value) => native.setValueReadbackAsync(element, host, value)
      : void 0,
    elementValueReadAsync: native.elementValueReadAsync
      ? (element, host) => native.elementValueReadAsync(element, host)
      : void 0,
    classifyPostMessageDelivery: native.classifyPostMessageDelivery
      ? (windowId, kind) => native.classifyPostMessageDelivery(windowId, kind)
      : void 0,
    postMessageClickAsync: native.postMessageClickAsync
      ? (windowId, pid, x, y, button, clicks) =>
          native.postMessageClickAsync(windowId, pid, x, y, button, clicks)
      : void 0,
  };
  // 还原自官方 31074-31075：win 有 scrollElement 真导出（对照 mac addon 无此导出，
  // nativeAxSource.ts:847 的 darwin 门控走降级）——attach 后 axReadOnly.ts:962 的
  // element_scroll handler 在 win32 注册为真路径。
  if (typeof native.scrollElement === "function") {
    source.elementScroll = (ref, direction, amount) =>
      adaptOutcome(native.scrollElement(ref, direction, amount));
  }
  return source;
}
