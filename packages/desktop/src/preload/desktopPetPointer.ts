import { ipcRenderer } from "electron";
import { DESKTOP_PET_CONTRACT as C, PlatformChannels } from "@drora/shared";
import {
  beginPetGesture,
  advancePetGesture,
  finishPetGesture,
  type PetGesture,
} from "../shared/desktopPetGesture.js";

const sample = (event: PointerEvent) => ({
  pointerId: event.pointerId,
  x: event.screenX,
  y: event.screenY,
});
const command = (value: unknown) => ipcRenderer.send(C.channels.command, value);

export function attachPetPointer(
  pet: HTMLElement,
  badge: HTMLButtonElement,
  onDrag: (direction: string | null) => void,
) {
  let state: PetGesture | null = null;
  let badgeState: PetGesture | null = null;
  const finish = (event: PointerEvent, cancelled = false) => {
    if (!state || state.pointerId !== event.pointerId) return;
    const result = finishPetGesture(state, sample(event), cancelled);
    state = null;
    if (result.moved) ipcRenderer.send(PlatformChannels.DesktopPetDrag, { phase: "move" });
    ipcRenderer.send(PlatformChannels.DesktopPetDrag, {
      phase: cancelled ? "cancel" : "end",
      altKey: event.altKey,
    });
    if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
    onDrag(null);
    if (result.activate) command({ action: "toggle-tray" });
  };
  pet.addEventListener("pointerdown", (event) => {
    if (event.target === badge) return;
    const next = beginPetGesture({
      ...sample(event),
      button: event.button,
      ctrlKey: event.ctrlKey,
    });
    if (!next || state) return;
    state = next;
    event.preventDefault();
    pet.setPointerCapture(event.pointerId);
    ipcRenderer.send(PlatformChannels.DesktopPetDrag, { phase: "start" });
  });
  pet.addEventListener("pointermove", (event) => {
    if (!state || state.pointerId !== event.pointerId) return;
    state = advancePetGesture(state, sample(event));
    if (state.moved) {
      onDrag(state.direction ?? "running");
      ipcRenderer.send(PlatformChannels.DesktopPetDrag, { phase: "move" });
    }
  });
  pet.addEventListener("pointerup", (event) => finish(event));
  pet.addEventListener("pointercancel", (event) => finish(event, true));
  pet.addEventListener("lostpointercapture", (event) => finish(event, true));
  pet.addEventListener("keydown", (event) => {
    if (event.target !== pet) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      command({ action: "toggle-tray" });
    }
    if (
      (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      command({ action: "menu" });
    }
  });
  pet.addEventListener("click", (event) => {
    if (event.target === pet && event.detail === 0) command({ action: "toggle-tray" });
  });
  pet.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    command({ action: "menu" });
  });
  badge.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    const next = beginPetGesture({
      ...sample(event),
      button: event.button,
      ctrlKey: event.ctrlKey,
    });
    if (!next || badgeState) return;
    badgeState = next;
    if (badgeState) badge.setPointerCapture(event.pointerId);
  });
  badge.addEventListener("pointermove", (event) => {
    event.stopPropagation();
    if (!badgeState || badgeState.pointerId !== event.pointerId) return;
    badgeState = advancePetGesture(badgeState, sample(event));
    if (badgeState.moved) {
      badge.style.translate = `${event.screenX - badgeState.origin.x}px ${event.screenY - badgeState.origin.y}px`;
    }
  });
  const finishBadge = (event: PointerEvent, cancelled = false) => {
    event.stopPropagation();
    if (!badgeState || badgeState.pointerId !== event.pointerId) return;
    const result = finishPetGesture(badgeState, sample(event), cancelled);
    badgeState = null;
    badge.style.translate = "";
    if (badge.hasPointerCapture(event.pointerId)) badge.releasePointerCapture(event.pointerId);
    if (result.moved && !cancelled) {
      const bounds = pet.getBoundingClientRect();
      const corner = `${event.clientY < bounds.top + bounds.height / 2 ? "top" : "bottom"}-${event.clientX < bounds.left + bounds.width / 2 ? "start" : "end"}`;
      badge.dataset.corner = corner;
      command({ action: "badge-corner", corner });
    }
    if (result.activate) command({ action: "toggle-tray" });
  };
  badge.addEventListener("pointerup", (event) => finishBadge(event));
  badge.addEventListener("pointercancel", (event) => finishBadge(event, true));
  badge.addEventListener("lostpointercapture", (event) => finishBadge(event, true));
  badge.addEventListener("click", (event) => {
    event.stopPropagation();
    // Ctrl/非主键或取消的 pointerup 不会获得 activation；click 仅保留键盘/辅助技术入口。
    if (event.detail === 0 && !event.ctrlKey) command({ action: "toggle-tray" });
  });
  return {
    isDragging: () => state?.moved === true || badgeState?.moved === true,
    isCaptured: () => state != null || badgeState != null,
  };
}
