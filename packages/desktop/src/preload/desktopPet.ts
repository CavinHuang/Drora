import { ipcRenderer } from "electron";
import {
  DESKTOP_PET_CONTRACT as C,
  desktopPetPresentationSchema,
  PlatformChannels,
  desktopPetConfigurationSchema,
  desktopPetPointerSchema,
  type DesktopPetPresentation,
} from "@drora/shared";
import { createDesktopPetPlayer } from "./desktopPetPlayer.js";
import { attachPetPointer } from "./desktopPetPointer.js";
import { createDesktopPetTray } from "./desktopPetTray.js";

let current: DesktopPetPresentation = { mode: "idle", activeCount: 0, attentionCount: 0 };
let apply = () => {};
ipcRenderer.on(PlatformChannels.DesktopPetRender, (_event, raw: unknown) => {
  const value = desktopPetPresentationSchema.safeParse(raw);
  if (value.success) {
    current = value.data;
    apply();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  const pet = document.getElementById("pet");
  if (!pet) {
    const render = createDesktopPetTray();
    apply = () => render(current);
    apply();
    return;
  }
  const art = document.getElementById("pet-art")!;
  const badge = document.getElementById("badge") as HTMLButtonElement;
  let pointer = { x: -1, y: -1 };
  let lastInteractive: boolean | null = null;
  let lastCaptured = false;
  let lastHover = false;
  const refreshHit = () => {
    const bounds = badge.getBoundingClientRect();
    const badgeHit =
      !badge.hidden &&
      pointer.x >= bounds.left &&
      pointer.x < bounds.right &&
      pointer.y >= bounds.top &&
      pointer.y < bounds.bottom;
    const spriteHit = player.hit(pointer);
    const captured = gestures.isCaptured();
    const active = spriteHit || badgeHit || captured;
    if (active !== lastInteractive || captured !== lastCaptured) {
      lastInteractive = active;
      lastCaptured = captured;
      ipcRenderer.send(C.channels.command, { action: "hit-test", interactive: active, captured });
    }
    const hovered = spriteHit && !badgeHit && !gestures.isDragging();
    // 跳跃会改变透明轮廓；悬停期间保留命中盒，避免同一静止鼠标导致 jumping/idle 来回抖动。
    const heldHover =
      lastHover &&
      !badgeHit &&
      pointer.x >= 8 &&
      pointer.x < pet.offsetWidth + 8 &&
      pointer.y >= 8 &&
      pointer.y < pet.offsetHeight + 8 &&
      !gestures.isDragging();
    const nextHover = hovered || heldHover;
    if (nextHover !== lastHover) {
      lastHover = nextHover;
      player.setHover(nextHover);
    }
  };
  const player = createDesktopPetPlayer(art, () => refreshHit());
  const gestures = attachPetPointer(pet, badge, (state) => {
    player.setDrag(state);
    refreshHit();
  });
  ipcRenderer.on(C.channels.configure, (_event, raw: unknown) => {
    const parsed = desktopPetConfigurationSchema.safeParse(raw);
    if (!parsed.success) return;
    const value = parsed.data;
    pet.style.width = `${value.width}px`;
    pet.style.height = `${value.height}px`;
    badge.dataset.corner = value.badgeCorner;
    void player
      .configure(value)
      .then((applied) => {
        if (!applied) return;
        pet.dataset.ready = "true";
        refreshHit();
      })
      .catch(() => {
        pet.dataset.ready = "error";
        ipcRenderer.send(C.channels.command, { action: "hit-test", interactive: false });
      });
  });
  ipcRenderer.on(C.channels.pointer, (_event, raw: unknown) => {
    const parsed = desktopPetPointerSchema.safeParse(raw);
    if (!parsed.success) return;
    pointer = parsed.data;
    player.setPointer(parsed.data);
    refreshHit();
  });
  apply = () => {
    const count = current.activities?.length ?? current.attentionCount + current.activeCount;
    const zh = document.documentElement.lang.startsWith("zh");
    const labels = zh
      ? {
          idle: "待命",
          working: "正在处理",
          attention: "需要处理",
          completed: "已完成",
          error: "遇到问题",
        }
      : {
          idle: "Idle",
          working: "Running",
          attention: "Needs input",
          completed: "Ready",
          error: "Blocked",
        };
    badge.textContent = String(count);
    badge.dataset.mode = current.mode;
    badge.title = labels[current.mode];
    badge.setAttribute("aria-label", `${labels[current.mode]} (${count})`);
    pet.title = current.preview ?? labels[current.mode];
    badge.hidden = count === 0;
    pet.dataset.mode = current.mode;
    player.setMode(current.mode);
    refreshHit();
  };
  window.addEventListener("unload", () => player.dispose(), { once: true });
  apply();
});
