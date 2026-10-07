import { ipcRenderer } from "electron";
import type { DesktopPetPresentation } from "@drora/shared";
import { desktopPetPresentationSchema, PlatformChannels } from "@drora/shared";

const DRAG_THRESHOLD_PX = 5;
let current: DesktopPetPresentation = { mode: "idle", activeCount: 0, attentionCount: 0 };

function statusLabel(presentation: DesktopPetPresentation): string {
  const chinese = document.documentElement.lang.startsWith("zh");
  switch (presentation.mode) {
    case "attention":
      return chinese
        ? `${presentation.attentionCount} 项需要处理`
        : `${presentation.attentionCount} item${presentation.attentionCount === 1 ? "" : "s"} need attention`;
    case "working":
      return chinese ? "正在处理任务" : "Working on a task";
    case "completed":
      return chinese ? "任务已完成" : "Task completed";
    case "error":
      return chinese ? "任务遇到问题" : "Task needs attention";
    default:
      return chinese ? "待命中" : "Ready";
  }
}

function applyPresentation(): void {
  const pet = document.getElementById("pet");
  const badge = document.getElementById("badge");
  const status = document.getElementById("status");
  const preview = document.getElementById("preview");
  if (pet) pet.dataset.mode = current.mode;
  if (badge) badge.textContent = String(current.attentionCount);
  if (status) status.textContent = statusLabel(current);
  if (preview) preview.textContent = current.preview ?? "";
}

ipcRenderer.on(PlatformChannels.DesktopPetRender, (_event, raw: unknown) => {
  const parsed = desktopPetPresentationSchema.safeParse(raw);
  if (!parsed.success) return;
  current = parsed.data;
  applyPresentation();
});

window.addEventListener("DOMContentLoaded", () => {
  const pet = document.getElementById("pet");
  if (pet) {
    let start: { x: number; y: number; pointerId: number } | null = null;
    let dragged = false;
    let suppressClick = false;
    pet.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.screenX, y: event.screenY, pointerId: event.pointerId };
      dragged = false;
      suppressClick = false;
      pet.setPointerCapture(event.pointerId);
      ipcRenderer.send(PlatformChannels.DesktopPetDrag, "start");
    });
    pet.addEventListener("pointermove", (event) => {
      if (!start || event.pointerId !== start.pointerId) return;
      if (
        !dragged &&
        Math.hypot(event.screenX - start.x, event.screenY - start.y) >= DRAG_THRESHOLD_PX
      ) {
        dragged = true;
      }
      if (dragged) ipcRenderer.send(PlatformChannels.DesktopPetDrag, "move");
    });
    const endDrag = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.pointerId) return;
      start = null;
      ipcRenderer.send(PlatformChannels.DesktopPetDrag, "end");
      if (dragged) {
        suppressClick = true;
      }
    };
    pet.addEventListener("pointerup", endDrag);
    pet.addEventListener("pointercancel", endDrag);
    pet.addEventListener("click", (event) => {
      if (suppressClick && event.detail > 0) {
        event.preventDefault();
        suppressClick = false;
        return;
      }
      suppressClick = false;
      ipcRenderer.send(PlatformChannels.DesktopPetActivate);
    });
  }
  applyPresentation();
});
