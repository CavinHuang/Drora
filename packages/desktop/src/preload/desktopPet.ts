import { ipcRenderer } from "electron";
import { desktopPetPresentationSchema, PlatformChannels } from "@drora/shared";

let currentMode = "idle";
ipcRenderer.on(PlatformChannels.DesktopPetRender, (_event, raw: unknown) => {
  const parsed = desktopPetPresentationSchema.safeParse(raw);
  if (!parsed.success) return;
  currentMode = parsed.data.mode;
  const pet = document.getElementById("pet");
  const badge = document.getElementById("badge");
  if (pet) pet.dataset.mode = currentMode;
  if (badge) badge.textContent = String(parsed.data.attentionCount);
});

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pet")?.addEventListener("click", () => {
    ipcRenderer.send(PlatformChannels.DesktopPetActivate);
  });
  const pet = document.getElementById("pet");
  if (pet) pet.dataset.mode = currentMode;
});
