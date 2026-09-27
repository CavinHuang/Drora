import type { SkinPreference } from "./skinPreference.js";
import { loadWallpaper } from "./skinImageStore.js";

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
  if (
    preference.presetId !== "default" ||
    preference.panelOpacity < 100 ||
    preference.wallpaperRevision
  ) {
    root.dataset.droraSkinActive = "true";
  } else {
    delete root.dataset.droraSkinActive;
  }
  root.style.setProperty("--skin-panel-opacity", `${preference.panelOpacity}%`);
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
