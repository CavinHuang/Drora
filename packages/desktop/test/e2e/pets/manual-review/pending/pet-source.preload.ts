import { contextBridge, ipcRenderer } from "electron";
import { DESKTOP_PET_CONTRACT, PlatformChannels } from "@drora/shared";
contextBridge.exposeInMainWorld("petTest", {
  manage: (request: unknown) => ipcRenderer.invoke(DESKTOP_PET_CONTRACT.channels.library, request),
});
ipcRenderer.on(PlatformChannels.DesktopPetOpenTask, (_event, target: unknown) =>
  ipcRenderer.send("pet-e2e-opened", target),
);
