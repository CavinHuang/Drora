import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  DESKTOP_PET_CONTRACT,
  desktopPetLibraryRequestSchema,
  type DesktopPetLibraryRequest,
} from "@drora/shared";
import type { createDesktopPetLibrary } from "./desktopPetLibrary.js";
import { resolvePetConfiguration } from "./desktopPetConfiguration.js";

export function registerDesktopPetLibraryPort(options: {
  library: ReturnType<typeof createDesktopPetLibrary>;
  isMainWindow(window: BrowserWindow): boolean;
  onChanged(): Promise<void>;
  onDelete(id: string): Promise<void>;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  const execute = (raw: DesktopPetLibraryRequest, parent?: BrowserWindow) => {
    const request = desktopPetLibraryRequestSchema.parse(raw);
    const operation = queue.then(async () => {
      if (disposed) throw new Error("Pet library is closed");
      const open = async (image = false) => {
        const settings: Electron.OpenDialogOptions = image
          ? {
              properties: ["openFile"],
              filters: [{ name: "Codex spritesheet", extensions: ["png", "webp"] }],
            }
          : { properties: ["openDirectory", "createDirectory"] };
        return parent && !parent.isDestroyed()
          ? dialog.showOpenDialog(parent, settings)
          : dialog.showOpenDialog(settings);
      };
      switch (request.action) {
        case "prepare-upgrade": {
          const upgrade = await options.library.prepareUpgrade(request.id);
          return { ...(await options.library.list()), upgrade };
        }
        case "preview": {
          const preview = await resolvePetConfiguration(
            { desktopPetCharacter: request.id },
            options.library,
          );
          return { directoryPath: "", pets: [], errors: [], preview };
        }
        case "import-directory":
        case "import-image": {
          const chosen = await open(request.action === "import-image");
          if (chosen.canceled || !chosen.filePaths[0])
            return { ...(await options.library.list()), cancelled: true };
          const result =
            request.action === "import-image"
              ? await options.library.importImage(chosen.filePaths[0])
              : await options.library.importDirectory(chosen.filePaths[0]);
          await options.onChanged();
          return result;
        }
        case "delete":
          await options.library.remove(request.id);
          await options.onDelete(request.id);
          break;
        case "export": {
          const chosen = await open();
          if (chosen.canceled || !chosen.filePaths[0])
            return { ...(await options.library.list()), cancelled: true };
          await options.library.exportPet(request.id, chosen.filePaths[0]);
          break;
        }
        case "create-template": {
          const file = await options.library.createTemplate();
          shell.showItemInFolder(file);
          break;
        }
        case "open-folder": {
          const result = await options.library.list();
          const error = await shell.openPath(result.directoryPath);
          if (error) throw new Error(error);
          return result;
        }
        case "refresh":
          await options.onChanged();
          break;
        case "list":
          break;
      }
      return options.library.list();
    });
    queue = operation.catch(() => {});
    return operation;
  };
  ipcMain.handle(DESKTOP_PET_CONTRACT.channels.library, (event, raw: unknown) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (!sender || sender.isDestroyed() || !options.isMainWindow(sender))
      throw new Error("Pet library requires a main application window");
    return execute(desktopPetLibraryRequestSchema.parse(raw), sender);
  });
  return {
    execute,
    dispose() {
      disposed = true;
      ipcMain.removeHandler(DESKTOP_PET_CONTRACT.channels.library);
    },
  };
}
