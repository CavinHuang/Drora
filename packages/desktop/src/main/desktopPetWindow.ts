import { join } from "node:path";
import { BrowserWindow, ipcMain, screen } from "electron";
import {
  DESKTOP_PET_CONTRACT as C,
  PlatformChannels,
  desktopPetCommandSchema,
  type AppSettings,
  type DesktopPetConfiguration,
  type Locale,
} from "@drora/shared";
import { resolvePetConfiguration } from "./desktopPetConfiguration.js";
import { registerDesktopPetSource } from "./desktopPetSource.js";
import { showDesktopPetMenu } from "./desktopPetMenu.js";
import { desktopPetOverlayContent } from "./desktopPetOverlayContent.js";
import { attachDesktopPetInteraction } from "./desktopPetNativeInteraction.js";
import { visiblePetPosition } from "./desktopPetLayout.js";
import { trayBoundsForPet } from "./desktopPetInteractionLayout.js";
import type { createDesktopPetLibrary } from "./desktopPetLibrary.js";

/** Native presentation owner; accepted session/task state stays in the runtime. */
export function registerDesktopPetWindow(options: {
  settings: Partial<AppSettings>;
  library: ReturnType<typeof createDesktopPetLibrary>;
  locale(): Locale;
  isMainWindow(window: BrowserWindow): boolean;
  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  logger: { warn: (...args: unknown[]) => void };
  getCursorPoint?(): { x: number; y: number };
}) {
  let settings = { ...options.settings };
  let pet: BrowserWindow | null = null;
  let tray: BrowserWindow | null = null;
  let configuration: DesktopPetConfiguration | null = null;
  let interaction: ReturnType<typeof attachDesktopPetInteraction> | null = null;
  let disposed = false;
  let generation = 0;
  let ready = false;
  let trayReady = false;
  let wantsTray = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const positionTray = () => {
    if (!pet || pet.isDestroyed() || !tray || tray.isDestroyed()) return;
    tray.setBounds(
      trayBoundsForPet(pet.getBounds(), screen.getDisplayMatching(pet.getBounds()).workArea),
    );
  };
  const render = () => {
    const next = source.current();
    if (pet && !pet.isDestroyed() && ready)
      pet.webContents.send(PlatformChannels.DesktopPetRender, next);
    if (tray && !tray.isDestroyed() && trayReady) {
      tray.webContents.send(PlatformChannels.DesktopPetRender, next);
      if (wantsTray) {
        positionTray();
        tray.showInactive();
      } else tray.hide();
    }
  };
  const savePosition = () => {
    if (!pet || pet.isDestroyed()) return;
    const { x, y } = pet.getBounds();
    settings.desktopPetPosition = { x, y };
    positionTray();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void options
        .saveSettings({ desktopPetPosition: settings.desktopPetPosition })
        .catch((error) => options.logger.warn("[desktop-pet] position save failed", error));
    }, 250);
  };
  const createNative = (bounds: Electron.Rectangle, isTray: boolean) => {
    const created = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      // Windows 默认 thickFrame 会给透明无边框窗口保留不可见边框，125% 缩放时放大最小高度差异。
      thickFrame: false,
      hasShadow: false,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      focusable: true,
      title: isTray ? "Drora — Pet activity" : "Drora — Pet",
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/desktopPet.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    created.setAlwaysOnTop(true, "floating");
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    return created;
  };
  const createTray = () => {
    if (!pet || pet.isDestroyed() || (tray && !tray.isDestroyed())) return;
    const created = createNative(
      trayBoundsForPet(pet.getBounds(), screen.getDisplayMatching(pet.getBounds()).workArea),
      true,
    );
    tray = created;
    trayReady = false;
    created.on("closed", () => {
      if (tray === created) {
        tray = null;
        trayReady = false;
      }
    });
    void created
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(desktopPetOverlayContent(options.locale(), true))}`,
      )
      .then(() => {
        if (tray !== created || created.isDestroyed() || disposed) return;
        trayReady = true;
        render();
      })
      .catch((error) => {
        options.logger.warn("[desktop-pet] tray load failed", error);
        if (!created.isDestroyed()) created.destroy();
      });
  };
  const toggleTray = () => {
    wantsTray = !wantsTray;
    if (wantsTray) createTray();
    render();
  };
  const closeWindows = () => {
    ready = false;
    interaction?.dispose();
    interaction = null;
    if (pet && !pet.isDestroyed()) {
      const { x, y } = pet.getBounds();
      settings.desktopPetPosition = { x, y };
      pet.destroy();
    }
    if (tray && !tray.isDestroyed()) tray.destroy();
    pet = null;
    tray = null;
    trayReady = false;
  };
  const refreshConfiguration = async () => {
    const version = ++generation;
    if (!settings.desktopPetEnabled || disposed) {
      wantsTray = false;
      closeWindows();
      return;
    }
    const next = await resolvePetConfiguration(settings, options.library);
    if (version !== generation || disposed || !settings.desktopPetEnabled) return;
    configuration = next;
    const size = { width: next.width + 16, height: next.height + 16 };
    const point = visiblePetPosition(
      settings.desktopPetPosition,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
      size,
    );
    if (pet && !pet.isDestroyed()) {
      pet.setBounds({ ...point, ...size });
      if (ready) pet.webContents.send(C.channels.configure, next);
      render();
      return;
    }
    const created = createNative({ ...point, ...size }, false);
    pet = created;
    interaction = attachDesktopPetInteraction({
      window: created,
      onMove: savePosition,
      getCursorPoint: options.getCursorPoint,
    });
    created.on("move", savePosition);
    created.on("closed", () => {
      if (pet === created) {
        interaction?.dispose();
        interaction = null;
        pet = null;
        ready = false;
      }
    });
    try {
      await created.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(desktopPetOverlayContent(options.locale()))}`,
      );
      if (pet !== created || created.isDestroyed() || disposed || !settings.desktopPetEnabled)
        return;
      ready = true;
      created.webContents.send(C.channels.configure, configuration);
      created.showInactive();
      if (wantsTray) createTray();
      render();
    } catch (error) {
      options.logger.warn("[desktop-pet] document load failed", error);
      if (!created.isDestroyed()) created.destroy();
    }
  };
  const persist = async (patch: Partial<AppSettings>) => {
    await options.saveSettings(patch);
    settings = { ...settings, ...patch };
    await refreshConfiguration();
  };
  const onCommand = (event: Electron.IpcMainEvent, raw: unknown) => {
    const fromPet = pet && !pet.isDestroyed() && event.sender === pet.webContents;
    const fromTray = tray && !tray.isDestroyed() && event.sender === tray.webContents;
    if (!fromPet && !fromTray) return;
    const command = desktopPetCommandSchema.safeParse(raw);
    if (!command.success) return;
    const value = command.data;
    switch (value.action) {
      case "hit-test":
        if (fromPet) interaction?.setInteractive(value.interactive, value.captured);
        break;
      case "menu": {
        if (!fromPet || !pet) break;
        const current = pet;
        const version = generation;
        void showDesktopPetMenu({
          window: current,
          isCurrent: () => !disposed && pet === current && version === generation,
          settings,
          locale: options.locale(),
          library: options.library,
          toggleTray,
          persist,
          refresh: refreshConfiguration,
          warn: (error) => options.logger.warn("[desktop-pet] menu action failed", error),
        }).catch((error) => options.logger.warn("[desktop-pet] menu failed", error));
        break;
      }
      case "toggle-tray":
        toggleTray();
        break;
      case "open":
        if (source.open(value.target)) {
          wantsTray = false;
          render();
        }
        break;
      case "dismiss":
        source.dismiss(value.target, value.revision);
        break;
      case "badge-corner":
        if (fromPet)
          void persist({ desktopPetBadgeCorner: value.corner }).catch((error) =>
            options.logger.warn("[desktop-pet] badge save failed", error),
          );
        break;
    }
  };
  const source = registerDesktopPetSource({ isMainWindow: options.isMainWindow, onChange: render });
  ipcMain.on(C.channels.command, onCommand);
  void refreshConfiguration().catch((error) =>
    options.logger.warn("[desktop-pet] initialization failed", error),
  );
  return {
    refreshConfiguration,
    ownsWindow: (window: BrowserWindow) => window === pet || window === tray,
    updateSettings(patch: Partial<AppSettings>) {
      settings = { ...settings, ...patch };
      if (
        [
          "desktopPetEnabled",
          "desktopPetCharacter",
          "desktopPetSize",
          "desktopPetBadgeCorner",
        ].some((key) => key in patch)
      )
        void refreshConfiguration().catch((error) =>
          options.logger.warn("[desktop-pet] configuration failed", error),
        );
    },
    refreshLocale() {
      generation++;
      closeWindows();
      void refreshConfiguration().catch((error) =>
        options.logger.warn("[desktop-pet] locale failed", error),
      );
    },
    dispose() {
      disposed = true;
      generation++;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        void options
          .saveSettings({ desktopPetPosition: settings.desktopPetPosition })
          .catch((error) => options.logger.warn("[desktop-pet] final position save failed", error));
      }
      closeWindows();
      ipcMain.removeListener(C.channels.command, onCommand);
      source.dispose();
    },
  };
}
