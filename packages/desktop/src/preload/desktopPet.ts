import { ipcRenderer } from "electron";
import {
  DESKTOP_PET_CONTRACT as C,
  desktopPetPresentationSchema,
  PlatformChannels,
  desktopPetConfigurationSchema,
  desktopPetPointerSchema,
  MATE_PET_COMMANDS,
  matePetProjectionSchema,
  EMPTY_MATE_PET_PROJECTION,
  type DesktopPetPresentation,
  type MatePetProjection,
} from "@drora/shared";
import { createDesktopPetPlayer } from "./desktopPetPlayer.js";
import { attachPetPointer } from "./desktopPetPointer.js";
import { createDesktopPetTray } from "./desktopPetTray.js";
import { desktopPetPersonaExpression } from "../drora-extensions/desktopPet.js";

let current: DesktopPetPresentation = { mode: "idle", activeCount: 0, attentionCount: 0 };
let mate: MatePetProjection = EMPTY_MATE_PET_PROJECTION;
let apply = () => {};
ipcRenderer.on(PlatformChannels.DesktopPetRender, (_event, raw: unknown) => {
  const value = desktopPetPresentationSchema.safeParse(raw);
  if (value.success) {
    current = value.data;
    apply();
  }
});
ipcRenderer.on(MATE_PET_COMMANDS.channels.render, (_event, raw: unknown) => {
  const value = matePetProjectionSchema.safeParse(raw);
  if (value.success) {
    mate = value.data;
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
  // Mate 桌宠接缝（spec §11 P3；03 详设 §6）：badge 待决策数优先（destructive 级），
  // =0 回落既有活动数语义；气泡=新汇报一句话，点击直达对应工单（Main 转发 renderer），
  // 展示层自动隐藏计时只是呈现节流，不承担任何同步语义。
  const bubble = document.getElementById("mate-bubble") as HTMLButtonElement | null;
  const bubbleText = document.getElementById("mate-bubble-text");
  let shownBubbleKey: string | null = null;
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  const hideBubble = () => {
    if (bubble) bubble.hidden = true;
    if (bubbleTimer) {
      clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }
  };
  const zhLocale = document.documentElement.lang.startsWith("zh");
  const mateBadgeTitle = zhLocale ? "大副待决策" : "Mate decisions";
  if (bubble && bubbleText) {
    bubble.addEventListener("click", () => {
      const report = mate.latestReport;
      if (report)
        ipcRenderer.send(MATE_PET_COMMANDS.channels.command, {
          action: "open-ticket",
          ticketId: report.ticketId,
          ...(report.targetWorkspaceIdentity ? { targetWorkspaceIdentity: report.targetWorkspaceIdentity } : {}),
        });
      hideBubble();
    });
  }
  const applyMate = () => {
    const pendingCount = mate.pendingDecisions.length;
    const report = mate.latestReport;
    if (report) {
      const key = `${report.ticketId}:${report.updatedAtMs}`;
      if (bubble && bubbleText && key !== shownBubbleKey) {
        shownBubbleKey = key;
        bubbleText.textContent = report.summary;
        bubble.dataset.status = report.status;
        bubble.hidden = false;
        if (bubbleTimer) clearTimeout(bubbleTimer);
        bubbleTimer = setTimeout(hideBubble, 8000);
      }
    } else hideBubble();
    return pendingCount;
  };
  apply = () => {
    const count = current.activities?.length ?? current.attentionCount + current.activeCount;
    const locale = document.documentElement.lang.startsWith("zh") ? "zh-CN" : "en-US";
    // P2 当前态表达（spec §11、PM58）：working=专注、attention=等待回应、error=遇到问题、
    // completed=中性结束（含中断，永不庆祝）；纯映射无失败计数与等待时长推断。
    const { label } = desktopPetPersonaExpression({ mode: current.mode, locale });
    const pendingCount = applyMate();
    if (pendingCount > 0) {
      badge.textContent = String(pendingCount);
      badge.dataset.mode = "decision";
      badge.title = mateBadgeTitle;
      badge.setAttribute("aria-label", `${mateBadgeTitle} (${pendingCount})`);
    } else {
      badge.textContent = String(count);
      badge.dataset.mode = current.mode;
      badge.title = label;
      badge.setAttribute("aria-label", `${label} (${count})`);
    }
    pet.title = current.preview ?? label;
    badge.hidden = pendingCount === 0 && count === 0;
    pet.dataset.mode = current.mode;
    player.setMode(current.mode);
    refreshHit();
  };
  window.addEventListener("unload", () => player.dispose(), { once: true });
  apply();
});
