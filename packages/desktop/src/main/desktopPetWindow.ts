import { join } from "node:path";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import type { DesktopPetPresentation, DesktopPetTarget, Locale } from "@drora/shared";
import { desktopPetPresentationSchema, PlatformChannels } from "@drora/shared";
import { desktopPetContent } from "./desktopPetContent.js";

const WIDTH = 112;
const HEIGHT = 128;
const IDLE: DesktopPetPresentation = { mode: "idle", activeCount: 0, attentionCount: 0 };

function visiblePosition(saved?: { x: number; y: number }): { x: number; y: number } {
  const display = saved
    ? (screen
        .getAllDisplays()
        .find(
          ({ workArea }) =>
            saved.x < workArea.x + workArea.width &&
            saved.x + WIDTH > workArea.x &&
            saved.y < workArea.y + workArea.height &&
            saved.y + HEIGHT > workArea.y,
        ) ?? screen.getPrimaryDisplay())
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    x: Math.min(
      Math.max(saved?.x ?? area.x + area.width - WIDTH - 28, area.x),
      area.x + area.width - WIDTH,
    ),
    y: Math.min(
      Math.max(saved?.y ?? area.y + area.height - HEIGHT - 28, area.y),
      area.y + area.height - HEIGHT,
    ),
  };
}

/** Native presentation adapter. Task facts are owned by the Host/renderer, never this controller. */
export function registerDesktopPetWindow(options: {
  enabled: boolean;
  position?: { x: number; y: number };
  locale: () => Locale;
  isMainWindow: (window: BrowserWindow) => boolean;
  savePosition: (position: { x: number; y: number }) => Promise<void>;
  logger: { warn: (...args: unknown[]) => void };
}) {
  const byWindow = new Map<number, DesktopPetPresentation>();
  const observedWindowIds = new Set<number>();
  let enabled = options.enabled;
  let window: BrowserWindow | null = null;
  let sourceWindowId: number | null = null;
  let position = options.position;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const sourceWindow = () => {
    const source = sourceWindowId == null ? null : BrowserWindow.fromId(sourceWindowId);
    return source && !source.isDestroyed() && options.isMainWindow(source) ? source : null;
  };
  const pickFallbackSource = () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && options.isMainWindow(focused) && byWindow.has(focused.id)) return focused.id;
    for (const id of [...byWindow.keys()].reverse()) {
      const candidate = BrowserWindow.fromId(id);
      if (candidate && !candidate.isDestroyed() && options.isMainWindow(candidate)) return id;
    }
    return null;
  };
  const render = () => {
    if (!window || window.isDestroyed() || window.webContents.isLoading()) return;
    window.webContents.send(
      PlatformChannels.DesktopPetRender,
      sourceWindowId == null ? IDLE : (byWindow.get(sourceWindowId) ?? IDLE),
    );
  };
  const create = () => {
    if (!enabled || (window && !window.isDestroyed())) return;
    let created: BrowserWindow;
    try {
      const bounds = visiblePosition(position);
      created = new BrowserWindow({
        ...bounds,
        width: WIDTH,
        height: HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        focusable: false,
        webPreferences: {
          preload: join(import.meta.dirname, "../preload/desktopPet.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          devTools: false,
        },
      });
    } catch (error) {
      options.logger.warn("[desktop-pet] window creation failed", error);
      return;
    }
    window = created;
    created.setAlwaysOnTop(true, "floating");
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.webContents.once("did-finish-load", () => {
      if (created.isDestroyed() || !enabled) return;
      created.showInactive();
      render();
    });
    created.on("moved", () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (created.isDestroyed()) return;
        const bounds = created.getBounds();
        position = { x: bounds.x, y: bounds.y };
        void options
          .savePosition(position)
          .catch((error) =>
            options.logger.warn("[desktop-pet] position persistence failed", error),
          );
      }, 250);
    });
    created.on("closed", () => {
      if (window === created) window = null;
    });
    const html = desktopPetContent(options.locale());
    void created
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .catch((error) => {
        options.logger.warn("[desktop-pet] document load failed", error);
        if (!created.isDestroyed()) created.destroy();
      });
  };
  const chooseSource = (candidate: BrowserWindow) => {
    if (!options.isMainWindow(candidate)) return;
    sourceWindowId = candidate.id;
    render();
  };
  const onFocus = (_event: Electron.Event, focused: BrowserWindow) => chooseSource(focused);
  const onDisplayChange = () => {
    if (!window || window.isDestroyed()) return;
    try {
      const next = visiblePosition(window.getBounds());
      window.setPosition(next.x, next.y);
    } catch (error) {
      options.logger.warn("[desktop-pet] display reposition failed", error);
    }
  };
  const onPublish = (event: Electron.IpcMainEvent, raw: unknown) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (!sender || sender.isDestroyed() || !options.isMainWindow(sender)) return;
    const parsed = desktopPetPresentationSchema.safeParse(raw);
    if (!parsed.success) return;
    byWindow.set(sender.id, parsed.data);
    if (sourceWindowId == null || sender.isFocused() || sourceWindowId === sender.id) {
      sourceWindowId = sender.id;
      render();
    }
    if (!observedWindowIds.has(sender.id)) {
      observedWindowIds.add(sender.id);
      const contents = sender.webContents;
      const invalidatePresentation = () => {
        byWindow.delete(sender.id);
        if (sourceWindowId === sender.id) render();
      };
      contents.on("did-start-loading", invalidatePresentation);
      contents.on("render-process-gone", invalidatePresentation);
      sender.once("closed", () => {
        observedWindowIds.delete(sender.id);
        contents.removeListener("did-start-loading", invalidatePresentation);
        contents.removeListener("render-process-gone", invalidatePresentation);
        byWindow.delete(sender.id);
        if (sourceWindowId === sender.id) {
          sourceWindowId = pickFallbackSource();
          render();
        }
      });
    }
  };
  const onActivate = (event: Electron.IpcMainEvent) => {
    if (!window || event.sender !== window.webContents) return;
    const source = sourceWindow();
    if (!source) return;
    if (source.isMinimized()) source.restore();
    source.show();
    if (process.platform === "darwin") app.focus({ steal: true });
    source.focus();
    const target: DesktopPetTarget | undefined = byWindow.get(source.id)?.target;
    if (target) source.webContents.send(PlatformChannels.DesktopPetOpenTask, target);
  };

  ipcMain.on(PlatformChannels.DesktopPetPublish, onPublish);
  ipcMain.on(PlatformChannels.DesktopPetActivate, onActivate);
  app.on("browser-window-focus", onFocus);
  screen.on("display-removed", onDisplayChange);
  screen.on("display-metrics-changed", onDisplayChange);
  create();
  return {
    ownsWindow(candidate: BrowserWindow) {
      return window === candidate;
    },
    refreshLocale() {
      const current = window;
      if (!current || current.isDestroyed()) return;
      const html = desktopPetContent(options.locale());
      void current
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        .then(render)
        .catch((error) => options.logger.warn("[desktop-pet] locale refresh failed", error));
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (enabled) create();
      else if (window && !window.isDestroyed()) window.destroy();
    },
  };
}
