import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import type { AppSettings, Locale } from "@drora/shared";
import { PlatformChannels } from "@drora/shared";
import { registerDesktopPetWindow } from "../main/desktopPetWindow.js";
import { buildDesktopPetCatalog } from "../main/desktopPetCatalog.js";

/** 宠物由独立控制器持有；官方 Main 只转发设置和生命周期，不持有任务事实。 */
export function createDroraDesktopPetExtension(dependencies: {
  getLocale(): Locale;
  isMainWindow(window: BrowserWindow): boolean;
  updateSettings(patch: Partial<AppSettings>): Promise<void>;
  logger: { warn: (...args: unknown[]) => void };
}) {
  // 角色目录是纯打包资产读数，随应用生命周期注册一次即可（specs/desktop-pet.md §third release）。
  ipcMain.handle(PlatformChannels.DesktopPetCatalog, () => buildDesktopPetCatalog());
  let controller: ReturnType<typeof registerDesktopPetWindow> | null = null;
  return {
    initialize(settings: Partial<AppSettings> | null | undefined) {
      if (controller) return;
      controller = registerDesktopPetWindow({
        enabled: settings?.desktopPetEnabled ?? false,
        character: settings?.desktopPetCharacter,
        position: settings?.desktopPetPosition,
        locale: dependencies.getLocale,
        isMainWindow: dependencies.isMainWindow,
        savePosition: (position) => dependencies.updateSettings({ desktopPetPosition: position }),
        logger: dependencies.logger,
      });
    },
    updateSettings(patch: Partial<AppSettings>) {
      if (typeof patch.desktopPetEnabled === "boolean")
        controller?.setEnabled(patch.desktopPetEnabled);
      if (patch.desktopPetCharacter) controller?.setCharacter(patch.desktopPetCharacter);
    },
    ownsWindow(window: BrowserWindow) {
      return controller?.ownsWindow(window) ?? false;
    },
    refreshLocale() {
      controller?.refreshLocale();
    },
    dispose() {
      controller?.setEnabled(false);
    },
  };
}
