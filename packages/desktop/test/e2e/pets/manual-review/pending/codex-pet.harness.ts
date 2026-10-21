import { app, BrowserWindow, ipcMain, screen, Menu } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  PlatformChannels,
  type AppSettings,
  type DesktopPetPresentation,
  type Locale,
} from "@drora/shared";
import { registerDesktopPetWindow } from "../../../../../src/main/desktopPetWindow.js";
import { createDesktopPetLibrary } from "../../../../../src/main/desktopPetLibrary.js";
import { decodeDesktopPetImage } from "../../../../../src/main/desktopPetImageDecoder.js";
import { registerDesktopPetLibraryPort } from "../../../../../src/main/desktopPetLibraryPort.js";

const root = process.argv.at(-1)!;
app.setPath("userData", join(root, "electron"));
void app
  .whenReady()
  .then(async () => {
    const source = new BrowserWindow({
      show: false,
      width: 500,
      height: 400,
      title: "Drora pet parity source",
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/pet-source.cjs"),
        sandbox: true,
      },
    });
    await source.loadURL(
      'data:text/html,<title>Drora pet parity source</title><body data-pet-document="source"><h1>Isolated pet test source</h1></body>',
    );
    let cursor: { x: number; y: number } | null = null;
    let locale: Locale = "en-US";
    let settings: Partial<AppSettings> = {
      desktopPetEnabled: true,
      desktopPetCharacter: "custom:test-v2",
      desktopPetSize: 112,
      desktopPetPosition: { x: 500, y: 350 },
    };
    const saved: Partial<AppSettings>[] = [];
    const ignored = new Map<number, boolean>();
    app.on("browser-window-created", (_event, window) => {
      const original = window.setIgnoreMouseEvents.bind(window);
      window.setIgnoreMouseEvents = (value, options) => {
        ignored.set(window.id, value);
        original(value, options);
      };
    });
    let lastMenuItems: string[] = [];
    let closeLastMenu = () => {};
    const nativePopup = Menu.prototype.popup;
    Menu.prototype.popup = function (options) {
      lastMenuItems = this.items.map((item) => item.label);
      closeLastMenu = this.closePopup.bind(this);
      nativePopup.call(this, options);
    };
    const warnings: string[] = [];
    const logger = {
      warn: (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
        process.stderr.write(args.map(String).join(" ") + "\n");
      },
    };
    let secondary: BrowserWindow | null = null;
    const isMainWindow = (window: BrowserWindow) => window === source || window === secondary;
    const library = createDesktopPetLibrary(root, decodeDesktopPetImage);
    const controller = registerDesktopPetWindow({
      settings,
      library,
      locale: () => locale,
      isMainWindow,
      saveSettings: async (patch) => {
        settings = { ...settings, ...patch };
        saved.push(patch);
        await writeFile(join(root, "settings.json"), JSON.stringify(settings));
      },
      logger,
      getCursorPoint: () => cursor ?? screen.getCursorScreenPoint(),
    });
    const port = registerDesktopPetLibraryPort({
      library,
      isMainWindow,
      onChanged: controller.refreshConfiguration,
      onDelete: async (id) => {
        if (settings.desktopPetCharacter === id) {
          settings.desktopPetCharacter = "violet";
          controller.updateSettings(settings);
        }
      },
    });
    const opened: unknown[] = [];
    const openedOwners: number[] = [];
    ipcMain.on("pet-e2e-opened", (event, target: unknown) => {
      opened.push(target);
      openedOwners.push(BrowserWindow.fromWebContents(event.sender)!.id);
    });
    const api = {
      setCursor(value: { x: number; y: number } | null) {
        cursor = value;
      },
      setLocale(value: Locale) {
        locale = value;
        controller.refreshLocale();
      },
      closeSource() {
        source.destroy();
      },
      async publishSecondary(value: DesktopPetPresentation) {
        if (!secondary) {
          secondary = new BrowserWindow({
            show: false,
            title: "Secondary pet source",
            webPreferences: {
              preload: join(import.meta.dirname, "../preload/pet-source.cjs"),
              sandbox: true,
            },
          });
          await secondary.loadURL("data:text/html,<title>Secondary pet source</title>");
        }
        ipcMain.emit(PlatformChannels.DesktopPetPublish, { sender: secondary.webContents }, value);
        return secondary.id;
      },
      closeSecondary() {
        secondary?.destroy();
        secondary = null;
      },
      update(patch: Partial<AppSettings>) {
        settings = { ...settings, ...patch };
        controller.updateSettings(patch);
      },
      publish(value: DesktopPetPresentation) {
        ipcMain.emit(PlatformChannels.DesktopPetPublish, { sender: source.webContents }, value);
      },
      state() {
        return {
          settings,
          saved,
          warnings,
          opened,
          openedOwners,
          sourceId: source.id,
          menu: lastMenuItems,
          windows: BrowserWindow.getAllWindows().map((window) => ({
            id: window.id,
            bounds: window.getBounds(),
            visible: window.isVisible(),
            owned: controller.ownsWindow(window),
            title: window.getTitle(),
            ignored: ignored.get(window.id),
          })),
        };
      },
      closeMenu() {
        closeLastMenu();
      },
      async refresh() {
        await controller.refreshConfiguration();
      },
      async dispose() {
        port.dispose();
        controller.dispose();
      },
    };
    Object.assign(globalThis, { petParityHarness: api });
    app.on("window-all-closed", () => {});
    app.on("before-quit", () => {
      port.dispose();
      controller.dispose();
    });
  })
  .catch((error: unknown) => {
    process.stderr.write(String(error));
    app.exit(1);
  });
