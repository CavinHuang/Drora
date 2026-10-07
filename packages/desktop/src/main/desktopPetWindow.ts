import { join } from "node:path";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import type { DesktopPetPresentation, DesktopPetTarget, Locale } from "@drora/shared";
import {
  desktopPetDragSchema,
  desktopPetPresentationSchema,
  PlatformChannels,
} from "@drora/shared";
import { desktopPetBubbleContent } from "./desktopPetBubbleContent.js";
import { desktopPetContent } from "./desktopPetContent.js";
import {
  BUBBLE_HEIGHT,
  BUBBLE_WIDTH,
  draggedPetPosition,
  PET_HEIGHT,
  PET_WIDTH,
  bubblePositionForPet,
  visiblePetPosition,
  type Point,
} from "./desktopPetLayout.js";

const IDLE: DesktopPetPresentation = { mode: "idle", activeCount: 0, attentionCount: 0 };

function visiblePosition(saved?: Point): Point {
  return visiblePetPosition(
    saved,
    screen.getAllDisplays().map((display) => display.workArea),
    screen.getPrimaryDisplay().workArea,
  );
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
  let petReady = false;
  let bubble: BrowserWindow | null = null;
  let bubbleReady = false;
  let sourceWindowId: number | null = null;
  let position = options.position;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let drag: { start: Point; origin: Point } | null = null;

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
  const bubblePosition = () => {
    if (!window || window.isDestroyed() || !bubble || bubble.isDestroyed()) return;
    const bounds = window.getBounds();
    const point = bubblePositionForPet(bounds, screen.getDisplayMatching(bounds).workArea);
    bubble.setPosition(point.x, point.y);
  };
  const createBubble = () => {
    if (!window || window.isDestroyed() || (bubble && !bubble.isDestroyed())) return;
    const bounds = window.getBounds();
    const point = bubblePositionForPet(bounds, screen.getDisplayMatching(bounds).workArea);
    let created: BrowserWindow;
    try {
      created = new BrowserWindow({
        ...point,
        width: BUBBLE_WIDTH,
        height: BUBBLE_HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        skipTaskbar: true,
        resizable: false,
        focusable: false,
        alwaysOnTop: true,
        webPreferences: {
          preload: join(import.meta.dirname, "../preload/desktopPet.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          devTools: false,
        },
      });
    } catch (error) {
      options.logger.warn("[desktop-pet] bubble creation failed", error);
      return;
    }
    bubble = created;
    bubbleReady = false;
    created.setAlwaysOnTop(true, "floating");
    created.setIgnoreMouseEvents(true);
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.on("closed", () => {
      if (bubble === created) {
        bubble = null;
        bubbleReady = false;
      }
    });
    void created
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(desktopPetBubbleContent(options.locale()))}`,
      )
      .then(() => {
        if (bubble !== created || created.isDestroyed()) return;
        bubbleReady = true;
        render();
      })
      .catch((error) => {
        options.logger.warn("[desktop-pet] bubble load failed", error);
        if (!created.isDestroyed()) created.destroy();
      });
  };
  const render = () => {
    if (!window || window.isDestroyed() || !petReady) return;
    const presentation = sourceWindowId == null ? IDLE : (byWindow.get(sourceWindowId) ?? IDLE);
    window.webContents.send(PlatformChannels.DesktopPetRender, presentation);
    if (presentation.mode === "idle") {
      if (bubble && !bubble.isDestroyed()) bubble.hide();
      return;
    }
    createBubble();
    if (bubble && !bubble.isDestroyed() && bubbleReady) {
      bubblePosition();
      bubble.webContents.send(PlatformChannels.DesktopPetRender, presentation);
      bubble.showInactive();
    }
  };
  const afterPositionChange = (created: BrowserWindow) => {
    if (created.isDestroyed()) return;
    bubblePosition();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (created.isDestroyed()) return;
      const bounds = created.getBounds();
      position = { x: bounds.x, y: bounds.y };
      void options
        .savePosition(position)
        .catch((error) => options.logger.warn("[desktop-pet] position persistence failed", error));
    }, 250);
  };
  const create = () => {
    if (!enabled || (window && !window.isDestroyed())) return;
    let created: BrowserWindow;
    try {
      const bounds = visiblePosition(position);
      created = new BrowserWindow({
        ...bounds,
        width: PET_WIDTH,
        height: PET_HEIGHT,
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
    petReady = false;
    created.setAlwaysOnTop(true, "floating");
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.on("move", () => afterPositionChange(created));
    created.on("closed", () => {
      if (window === created) {
        window = null;
        petReady = false;
      }
      drag = null;
      if (bubble && !bubble.isDestroyed()) bubble.destroy();
    });
    const html = desktopPetContent(options.locale());
    void created
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .then(() => {
        if (window !== created || created.isDestroyed() || !enabled) return;
        petReady = true;
        created.showInactive();
        render();
      })
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
      afterPositionChange(window);
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

  const onDrag = (event: Electron.IpcMainEvent, raw: unknown) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents) return;
    const phase = desktopPetDragSchema.safeParse(raw);
    if (!phase.success) return;
    if (phase.data === "start") {
      const [x, y] = window.getPosition();
      drag = { start: screen.getCursorScreenPoint(), origin: { x, y } };
      return;
    }
    if (!drag) return;
    if (phase.data === "move") {
      const next = draggedPetPosition(drag.origin, drag.start, screen.getCursorScreenPoint());
      window.setPosition(Math.round(next.x), Math.round(next.y));
      // Windows 的程序化 setPosition 不保证触发 moved；直接同步气泡和持久化，避免只移动猫。
      afterPositionChange(window);
      return;
    }
    const { origin } = drag;
    drag = null;
    const bounds = window.getBounds();
    if (bounds.x === origin.x && bounds.y === origin.y) return;
    const next = visiblePosition(bounds);
    window.setPosition(next.x, next.y);
    afterPositionChange(window);
  };

  ipcMain.on(PlatformChannels.DesktopPetPublish, onPublish);
  ipcMain.on(PlatformChannels.DesktopPetActivate, onActivate);
  ipcMain.on(PlatformChannels.DesktopPetDrag, onDrag);
  app.on("browser-window-focus", onFocus);
  screen.on("display-removed", onDisplayChange);
  screen.on("display-metrics-changed", onDisplayChange);
  create();
  return {
    ownsWindow(candidate: BrowserWindow) {
      return window === candidate || bubble === candidate;
    },
    refreshLocale() {
      const current = window;
      if (!current || current.isDestroyed()) return;
      petReady = false;
      const html = desktopPetContent(options.locale());
      void current
        .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        .then(() => {
          if (window !== current || current.isDestroyed()) return;
          petReady = true;
          render();
        })
        .catch((error) => options.logger.warn("[desktop-pet] locale refresh failed", error));
      const currentBubble = bubble;
      if (currentBubble && !currentBubble.isDestroyed()) {
        bubbleReady = false;
        void currentBubble
          .loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(desktopPetBubbleContent(options.locale()))}`,
          )
          .then(() => {
            if (bubble !== currentBubble || currentBubble.isDestroyed()) return;
            bubbleReady = true;
            render();
          })
          .catch((error) =>
            options.logger.warn("[desktop-pet] bubble locale refresh failed", error),
          );
      }
    },
    setEnabled(next: boolean) {
      enabled = next;
      if (enabled) create();
      else if (window && !window.isDestroyed()) window.destroy();
      else if (bubble && !bubble.isDestroyed()) bubble.destroy();
    },
  };
}
