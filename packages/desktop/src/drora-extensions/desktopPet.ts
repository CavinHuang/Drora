import { BrowserWindow } from "electron";
import { PlatformChannels, type AppSettings, type Locale } from "@drora/shared";
import { getDroraDataRootDir } from "@drora/services/node";
import { registerDesktopPetWindow } from "../main/desktopPetWindow.js";
import { createDesktopPetLibrary } from "../main/desktopPetLibrary.js";
import { decodeDesktopPetImage } from "../main/desktopPetImageDecoder.js";
import { registerDesktopPetLibraryPort } from "../main/desktopPetLibraryPort.js";

/** 宠物由独立控制器持有；官方 Main 只转发设置和生命周期，不持有任务事实。 */
export function createDroraDesktopPetExtension(dependencies: {
  getLocale(): Locale;
  isMainWindow(window: BrowserWindow): boolean;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  logger: { warn: (...args: unknown[]) => void };
}) {
  let controller: ReturnType<typeof registerDesktopPetWindow> | null = null;
  let libraryPort: ReturnType<typeof registerDesktopPetLibraryPort> | null = null;
  let currentSettings: Partial<AppSettings> = {};
  const saveSettings = async (patch: Partial<AppSettings>) => {
    await dependencies.updateSettings(patch);
    currentSettings = { ...currentSettings, ...patch };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && dependencies.isMainWindow(window))
        window.webContents.send(PlatformChannels.SettingsChanged);
    }
  };
  return {
    initialize(settings: Partial<AppSettings> | null | undefined) {
      if (controller) return;
      currentSettings = { ...settings };
      const library = createDesktopPetLibrary(getDroraDataRootDir(), decodeDesktopPetImage);
      controller = registerDesktopPetWindow({
        settings: currentSettings,
        library,
        locale: dependencies.getLocale,
        isMainWindow: dependencies.isMainWindow,
        saveSettings,
        logger: dependencies.logger,
      });
      libraryPort = registerDesktopPetLibraryPort({
        library,
        isMainWindow: dependencies.isMainWindow,
        onChanged: async () => {
          await controller?.refreshConfiguration();
        },
        onDelete: async (id) => {
          if (currentSettings.desktopPetCharacter === id) {
            const patch = { desktopPetCharacter: "violet" };
            await saveSettings(patch);
            controller?.updateSettings(patch);
          } else await controller?.refreshConfiguration();
        },
      });
    },
    updateSettings(patch: Partial<AppSettings>) {
      currentSettings = { ...currentSettings, ...patch };
      controller?.updateSettings(patch);
    },
    ownsWindow(window: BrowserWindow) {
      return controller?.ownsWindow(window) ?? false;
    },
    refreshLocale() {
      controller?.refreshLocale();
    },
    dispose() {
      libraryPort?.dispose();
      controller?.dispose();
    },
  };
}
