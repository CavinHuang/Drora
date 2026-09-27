import type { SkinPreference } from "./skinPreference.js";
import { loadWallpaper } from "./skinImageStore.js";
import { resolveCustomBrandColor } from "./skinAccent.js";

let requestGeneration = 0;
let activeRevision: string | null = null;
let activeObjectUrl: string | null = null;

function releaseObjectUrl(): void {
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
  activeRevision = null;
  document.documentElement.style.removeProperty("--skin-custom-wallpaper");
}

export function applySkinPreference(preference: SkinPreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.droraSkin = preference.presetId;
  if (preference.customAccentColor) {
    root.dataset.droraCustomAccent = "true";
    root.style.setProperty(
      "--skin-custom-brand-light",
      resolveCustomBrandColor(preference.customAccentColor, "light"),
    );
    root.style.setProperty(
      "--skin-custom-brand-dark",
      resolveCustomBrandColor(preference.customAccentColor, "dark"),
    );
  } else {
    delete root.dataset.droraCustomAccent;
    root.style.removeProperty("--skin-custom-brand-light");
    root.style.removeProperty("--skin-custom-brand-dark");
  }
  if (
    preference.presetId !== "default" ||
    preference.conversationOpacity < 100 ||
    preference.sidebarOpacity < 100 ||
    preference.sidePaneOpacity < 100 ||
    preference.wallpaperRevision
  ) {
    root.dataset.droraSkinActive = "true";
  } else {
    delete root.dataset.droraSkinActive;
  }
  root.style.setProperty("--skin-conversation-opacity", `${preference.conversationOpacity}%`);
  root.style.setProperty("--skin-sidebar-opacity", `${preference.sidebarOpacity}%`);
  root.style.setProperty("--skin-side-pane-opacity", `${preference.sidePaneOpacity}%`);
  root.style.setProperty("--skin-wallpaper-position-x", `${preference.wallpaperPositionX}%`);
  root.style.setProperty("--skin-wallpaper-position-y", `${preference.wallpaperPositionY}%`);

  const generation = ++requestGeneration;
  if (!preference.wallpaperRevision) {
    releaseObjectUrl();
    return;
  }
  if (activeRevision === preference.wallpaperRevision && activeObjectUrl) return;
  releaseObjectUrl();
  void loadWallpaper()
    .then((blob) => {
      if (generation !== requestGeneration || !blob) return;
      activeObjectUrl = URL.createObjectURL(blob);
      activeRevision = preference.wallpaperRevision;
      root.style.setProperty("--skin-custom-wallpaper", `url("${activeObjectUrl}")`);
    })
    .catch(() => {
      // 修复：壁纸数据可能在浏览器清理或另一个窗口删除后消失。
      // 仅回退到预设背景，不覆盖用户的其他皮肤偏好。
      if (generation === requestGeneration) releaseObjectUrl();
    });
}
