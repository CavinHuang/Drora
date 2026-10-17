import { BrowserWindow, ipcMain, screen } from "electron";
import { DESKTOP_PET_CONTRACT, PlatformChannels, desktopPetDragSchema } from "@drora/shared";
import { visiblePetPosition, draggedPetPosition, type Point } from "./desktopPetLayout.js";
import { snapPetPosition } from "./desktopPetInteractionLayout.js";

/** One native drag/pointer owner. The isolated renderer only reports gesture intent. */
export function attachDesktopPetInteraction(options: {
  window: BrowserWindow;
  onMove(): void;
  getCursorPoint?(): Point;
}) {
  const pet = options.window;
  let drag: { origin: Point; start: Point; moved: boolean } | null = null;
  let passthrough = false;
  let pixelInteractive = true;
  let pointerCaptured = false;
  const cursor = options.getCursorPoint ?? (() => screen.getCursorScreenPoint());
  const clamp = (pointer?: Point, alt = false) => {
    if (pet.isDestroyed()) return;
    const bounds = pet.getBounds();
    const primary = screen.getPrimaryDisplay().workArea;
    const next =
      alt && pointer
        ? snapPetPosition(pointer, screen.getDisplayNearestPoint(pointer).workArea, bounds)
        : visiblePetPosition(
            bounds,
            screen.getAllDisplays().map((display) => display.workArea),
            primary,
            bounds,
          );
    pet.setPosition(next.x, next.y);
    options.onMove();
  };
  const move = () => {
    if (!drag || pet.isDestroyed()) return;
    const pointer = cursor();
    const next = draggedPetPosition(drag.origin, drag.start, pointer);
    pet.setPosition(Math.round(next.x), Math.round(next.y));
    options.onMove();
  };
  const onDrag = (event: Electron.IpcMainEvent, raw: unknown) => {
    if (pet.isDestroyed() || event.sender !== pet.webContents) return;
    const parsed = desktopPetDragSchema.safeParse(raw);
    if (!parsed.success) return;
    const { phase, altKey } = parsed.data;
    if (phase === "start") {
      const { x, y } = pet.getBounds();
      drag = { origin: { x, y }, start: cursor(), moved: false };
    } else if (drag && phase === "move") {
      drag.moved = true;
      move();
    } else if (drag) {
      // 结束坐标也必须落地；快速 pointerup 可能先于最后一次 pointermove 到达。
      if (drag.moved) move();
      const moved = drag.moved;
      drag = null;
      if (moved) clamp(cursor(), phase === "end" && altKey);
    }
  };
  ipcMain.on(PlatformChannels.DesktopPetDrag, onDrag);
  const timer = setInterval(() => {
    if (pet.isDestroyed() || !pet.isVisible()) return;
    const point = cursor();
    const bounds = pet.getBounds();
    const local = { x: point.x - bounds.x, y: point.y - bounds.y };
    const inside =
      drag != null ||
      pointerCaptured ||
      (pixelInteractive &&
        local.x >= 8 &&
        local.x < bounds.width - 8 &&
        local.y >= 8 &&
        local.y < bounds.height - 8);
    if (passthrough === inside) {
      passthrough = !inside;
      pet.setIgnoreMouseEvents(passthrough, { forward: true });
    }
    pet.webContents.send(DESKTOP_PET_CONTRACT.channels.pointer, local);
  }, 32);
  const displayChanged = () => {
    drag = null;
    clamp();
  };
  screen.on("display-removed", displayChanged);
  screen.on("display-metrics-changed", displayChanged);
  return {
    setInteractive(value: boolean, captured = false) {
      pixelInteractive = value;
      pointerCaptured = captured;
    },
    dispose() {
      clearInterval(timer);
      ipcMain.removeListener(PlatformChannels.DesktopPetDrag, onDrag);
      screen.removeListener("display-removed", displayChanged);
      screen.removeListener("display-metrics-changed", displayChanged);
    },
  };
}
