import { app, BrowserWindow, ipcMain } from "electron";
import {
  PlatformChannels,
  desktopPetPresentationSchema,
  desktopPetTargetKey,
  DESKTOP_PET_CONTRACT,
  DESKTOP_PET_ACTIVITY_PRIORITY as priority,
  type DesktopPetActivity,
  type DesktopPetPresentation,
  type DesktopPetTarget,
} from "@drora/shared";

const IDLE: DesktopPetPresentation = {
  mode: "idle",
  activeCount: 0,
  attentionCount: 0,
  activities: [],
};

/** Main holds bounded display projections and navigation routing, never session business state. */
export function registerDesktopPetSource(options: {
  isMainWindow(window: BrowserWindow): boolean;
  onChange(): void;
}) {
  const projections = new Map<number, DesktopPetPresentation>();
  const observed = new Map<BrowserWindow, () => void>();
  const dismissed = new Map<string, number>();
  let sourceId: number | null = null;
  const rows = () => {
    const unique = new Map<string, { owner: number; row: DesktopPetActivity }>();
    for (const [owner, projection] of projections)
      for (const row of projection.activities ?? []) {
        const key = desktopPetTargetKey(row.target);
        if (dismissed.get(key) === row.revision) continue;
        const previous = unique.get(key);
        if (
          !previous ||
          previous.row.revision < row.revision ||
          (previous.row.revision === row.revision && owner === sourceId)
        )
          unique.set(key, { owner, row });
      }
    return [...unique.values()].sort(
      (a, b) => priority[a.row.mode] - priority[b.row.mode] || b.row.revision - a.row.revision,
    );
  };
  const current = (): DesktopPetPresentation => {
    const original = sourceId == null ? IDLE : (projections.get(sourceId) ?? IDLE);
    const activities = rows().map((entry) => entry.row);
    if (!activities.length && !original.activities) return original;
    const first = activities[0];
    return {
      activities: activities.slice(0, DESKTOP_PET_CONTRACT.maxActivities),
      mode: first?.mode ?? "idle",
      target: first?.target,
      preview: first?.preview,
      attentionCount: Math.min(activities.filter((row) => row.mode === "attention").length, 999),
      activeCount: Math.min(activities.filter((row) => row.mode === "working").length, 999),
    };
  };
  const onPublish = (event: Electron.IpcMainEvent, raw: unknown) => {
    const source = BrowserWindow.fromWebContents(event.sender);
    const parsed = desktopPetPresentationSchema.safeParse(raw);
    if (!source || source.isDestroyed() || !options.isMainWindow(source) || !parsed.success) return;
    projections.set(source.id, parsed.data);
    if (sourceId == null || source.isFocused()) sourceId = source.id;
    if (!observed.has(source)) {
      const contents = source.webContents;
      const invalidate = () => {
        projections.delete(source.id);
        if (sourceId === source.id) options.onChange();
      };
      const cleanup = () => {
        contents.removeListener("did-start-loading", invalidate);
        contents.removeListener("render-process-gone", invalidate);
        source.removeListener("closed", closed);
      };
      const closed = () => {
        projections.delete(source.id);
        cleanup();
        observed.delete(source);
        if (sourceId === source.id) sourceId = [...projections.keys()].at(-1) ?? null;
        options.onChange();
      };
      contents.on("did-start-loading", invalidate);
      contents.on("render-process-gone", invalidate);
      source.once("closed", closed);
      observed.set(source, cleanup);
    }
    options.onChange();
  };
  const onFocus = (_event: Electron.Event, window: BrowserWindow) => {
    if (options.isMainWindow(window)) {
      sourceId = window.id;
      options.onChange();
    }
  };
  ipcMain.on(PlatformChannels.DesktopPetPublish, onPublish);
  app.on("browser-window-focus", onFocus);
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && options.isMainWindow(focused)) sourceId = focused.id;
  return {
    current,
    open(target: DesktopPetTarget) {
      const entry = rows().find(
        (entry) => desktopPetTargetKey(entry.row.target) === desktopPetTargetKey(target),
      );
      const source = entry ? BrowserWindow.fromId(entry.owner) : null;
      if (!source || source.isDestroyed() || !options.isMainWindow(source) || !entry) return false;
      if (source.isMinimized()) source.restore();
      source.show();
      source.focus();
      if (process.platform === "darwin") app.focus({ steal: true });
      // 只能导航当前投影里的原始目标，不能转发调用方提供的同 identity、不同路径的伪造 payload。
      source.webContents.send(PlatformChannels.DesktopPetOpenTask, entry.row.target);
      return true;
    },
    dismiss(target: DesktopPetTarget, revision: number) {
      if (
        !current().activities?.some(
          (row) =>
            desktopPetTargetKey(row.target) === desktopPetTargetKey(target) &&
            row.revision === revision,
        )
      )
        return;
      dismissed.set(desktopPetTargetKey(target), revision);
      if (dismissed.size > 100) dismissed.delete(dismissed.keys().next().value!);
      options.onChange();
    },
    dispose() {
      ipcMain.removeListener(PlatformChannels.DesktopPetPublish, onPublish);
      app.removeListener("browser-window-focus", onFocus);
      for (const cleanup of observed.values()) cleanup();
      observed.clear();
      projections.clear();
      dismissed.clear();
    },
  };
}
