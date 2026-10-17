import { ipcRenderer } from "electron";
import {
  DESKTOP_PET_CONTRACT as C,
  desktopPetTargetKey,
  type DesktopPetPresentation,
} from "@drora/shared";

export function createDesktopPetTray() {
  const activities = document.getElementById("activities")!;
  const empty = document.getElementById("empty")!;
  const zh = document.documentElement.lang.startsWith("zh");
  let revision = "";
  document
    .getElementById("close-tray")
    ?.addEventListener("click", () =>
      ipcRenderer.send(C.channels.command, { action: "toggle-tray" }),
    );
  document.getElementById("collapse")?.addEventListener("click", (event) => {
    const collapsed = activities.classList.toggle("collapsed");
    (event.currentTarget as HTMLElement).setAttribute("aria-expanded", String(!collapsed));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") ipcRenderer.send(C.channels.command, { action: "toggle-tray" });
  });
  const labels = zh
    ? { working: "正在处理", attention: "需要处理", completed: "已完成", error: "遇到问题" }
    : { working: "Running", attention: "Needs input", completed: "Ready", error: "Blocked" };
  return (presentation: DesktopPetPresentation) => {
    const rows = presentation.activities ?? [];
    const next = JSON.stringify(rows);
    if (next === revision) return;
    revision = next;
    const focusId = (document.activeElement as HTMLElement | null)?.dataset.activityKey;
    const nodes = rows.map((row) => {
      const container = document.createElement("div");
      container.className = "activity";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "open-task";
      open.dataset.activityKey = desktopPetTargetKey(row.target);
      open.addEventListener("click", () =>
        ipcRenderer.send(C.channels.command, { action: "open", target: row.target }),
      );
      for (const [className, text] of [
        ["activity-title", row.title],
        ["activity-status", labels[row.mode]],
        ["activity-preview", row.preview ?? ""],
      ] as const) {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = text;
        open.append(span);
      }
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "dismiss";
      dismiss.textContent = "×";
      dismiss.setAttribute("aria-label", zh ? "隐藏此活动" : "Dismiss activity");
      dismiss.addEventListener("click", () =>
        ipcRenderer.send(C.channels.command, {
          action: "dismiss",
          target: row.target,
          revision: row.revision,
        }),
      );
      container.append(open, dismiss);
      return container;
    });
    activities.replaceChildren(...nodes);
    empty.hidden = nodes.length > 0;
    if (focusId)
      [...activities.querySelectorAll<HTMLButtonElement>(".open-task")]
        .find((button) => button.dataset.activityKey === focusId)
        ?.focus();
  };
}
