function adaptApp(app) {
  return {
    pid: app.pid,
    // Linux has no bundle ids; the addon fills bundle_id with the AT-SPI app
    // name (closest stable id). cuaAppIdentity treats unknown schemes as null.
    bundle_id: app.bundle_id,
    name: app.name,
    active: app.active,
  };
}
function adaptElement(el) {
  return {
    ref: el.ref,
    role: el.role,
    title: el.title,
    value: el.value,
    bounds: el.bounds,
    enabled: el.enabled,
    focused: el.focused,
    editable: el.editable,
    actions: el.actions,
    ownerPid: el.ownerPid,
  };
}
function adaptSnapshot(snap) {
  return {
    app: adaptApp(snap.app),
    window: {
      title: snap.window.title,
      bounds: snap.window.bounds,
      window_id: snap.window.window_id,
      main: snap.window.main,
      focused: snap.window.focused,
    },
    elements: snap.elements.map(adaptElement),
  };
}
function resolvePid(native, appRef) {
  if (typeof appRef.pid === "number" && appRef.pid > 0) return appRef.pid;
  if (appRef.name) {
    const apps = native.listApplications();
    const lower = appRef.name.toLowerCase();
    for (const app of apps) {
      if (app.name && app.name.toLowerCase().includes(lower)) {
        return app.pid;
      }
    }
  }
  return null;
}
export function createAxLinuxReadOnlySource(native, options) {
  if (!native.probeAccessibility() || native.sessionType() !== "x11") {
    return null;
  }
  const source = {
    listApplications: () => native.listApplications().map(adaptApp),
    applicationInfo: (appRef) => {
      const pid = resolvePid(native, appRef);
      if (pid === null) return null;
      const info = native.applicationInfo(pid);
      return info ? adaptApp(info) : null;
    },
    listWindows: (appRef) => {
      const pid = resolvePid(native, appRef);
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
      const pid = resolvePid(native, appRef);
      if (pid === null) return null;
      const snap = native.captureApp(pid);
      if (!snap) return null;
      const adapted: any = adaptSnapshot(snap);
      const wantScreenshot = captureOptions?.includeScreenshot !== false;
      const captureRegion = options?.captureWindowRegionPng;
      if (wantScreenshot && captureRegion) {
        const bounds = adapted.window.bounds;
        if (Array.isArray(bounds) && bounds.length === 4 && bounds[2] > 0 && bounds[3] > 0) {
          try {
            const captured = await captureRegion([bounds[0], bounds[1], bounds[2], bounds[3]]);
            if (captured && captured.png.length > 0) {
              adapted.screenshot = {
                format: "png",
                data: Buffer.from(captured.png).toString("base64"),
              };
              adapted.screenshot_bounds = captured.bounds;
            }
          } catch {}
        }
      }
      return adapted;
    },
    readElement: (ref) => {
      const el = native.readElement(ref);
      return el ? adaptElement(el) : null;
    },
    elementAtPoint: (x, y) => {
      const el = native.elementAtPoint(x, y);
      return el ? adaptElement(el) : null;
    },
    // Element actuation — mirrors nativeAxSource.ts:772-779 field-for-field.
    // The native addon returns {ok, axError} which already matches AxActionOutcome
    // structurally, so we just forward. performAction carries the macOS-style
    // verb name (AXPress / AXShowMenu / model verb); MapAxActionToIndex in
    // ax_linux.cc resolves it to the AT-SPI action index.
    elementPress: (ref) => native.performAction(ref, "AXPress"),
    elementShowMenu: (ref) => native.performAction(ref, "AXShowMenu"),
    elementFocus: (ref) => native.setFocused(ref),
    elementSetValue: (ref, value) => native.setValue(ref, value),
    elementPerformAction: (ref, action) => native.performAction(ref, action),
    elementSelectText: (ref, textRange) =>
      textRange ? native.selectText(ref, textRange[0], textRange[1]) : true,
  };
  return source;
}
