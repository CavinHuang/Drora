import type { SkinPreference, SkinPresetId } from "./skinPreference.js";
import { loadWallpaper } from "./skinImageStore.js";
import { resolveCustomBrandColor } from "./skinAccent.js";
import {
  getPresetWallpaperColor,
  sampleWallpaperColor,
  toMutedWallpaperColor,
} from "./skinPalette.js";

let requestGeneration = 0;
let activeRevision: string | null = null;
let activeObjectUrl: string | null = null;
let activeBlob: Blob | null = null;
let activeSample: string | null | undefined;
let activeSamplePromise: Promise<string | null> | null = null;

function releaseObjectUrl(): void {
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
  activeRevision = null;
  activeBlob = null;
  activeSample = undefined;
  activeSamplePromise = null;
  document.documentElement.style.removeProperty("--skin-custom-wallpaper");
}

function projectPanelColor(root: HTMLElement, enabled: boolean, color: string | null): void {
  if (enabled && color) {
    root.dataset.droraSkinImageColor = "true";
    root.style.setProperty("--skin-wallpaper-color", toMutedWallpaperColor(color));
  } else {
    delete root.dataset.droraSkinImageColor;
    root.style.removeProperty("--skin-wallpaper-color");
  }
}

function projectWallpaperPresence(
  root: HTMLElement,
  presetId: SkinPresetId,
  hasCustom: boolean,
): void {
  if (presetId !== "default" || hasCustom) root.dataset.droraSkinWallpaper = "true";
  else delete root.dataset.droraSkinWallpaper;
}

function projectCustomPanelColor(
  root: HTMLElement,
  preference: SkinPreference,
  generation: number,
): void {
  if (!preference.matchPanelColorsToWallpaper || !activeBlob) return;
  const fallback = getPresetWallpaperColor(preference.presetId);
  if (activeSample !== undefined) {
    projectPanelColor(root, true, activeSample ?? fallback);
    return;
  }
  const revision = activeRevision;
  const sample = activeSamplePromise ?? sampleWallpaperColor(activeBlob).catch(() => null);
  activeSamplePromise = sample;
  void sample.then((color) => {
    if (revision !== activeRevision) return;
    activeSample = color;
    activeSamplePromise = null;
    // 修复：导入图片或切换开关时旧的采样结果可能晚于新皮肤返回，不能覆盖新投射。
    if (generation === requestGeneration) projectPanelColor(root, true, color ?? fallback);
  });
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
  projectWallpaperPresence(
    root,
    preference.presetId,
    Boolean(activeObjectUrl && activeRevision === preference.wallpaperRevision),
  );
  const presetColor = getPresetWallpaperColor(preference.presetId);
  const cachedColor =
    activeRevision === preference.wallpaperRevision ? (activeSample ?? presetColor) : presetColor;
  projectPanelColor(root, preference.matchPanelColorsToWallpaper, cachedColor);
  if (!preference.wallpaperRevision) {
    releaseObjectUrl();
    projectWallpaperPresence(root, preference.presetId, false);
    return;
  }
  if (activeRevision === preference.wallpaperRevision && activeObjectUrl) {
    projectCustomPanelColor(root, preference, generation);
    return;
  }
  releaseObjectUrl();
  projectWallpaperPresence(root, preference.presetId, false);
  void loadWallpaper()
    .then((blob) => {
      if (generation !== requestGeneration || !blob) return;
      activeObjectUrl = URL.createObjectURL(blob);
      activeRevision = preference.wallpaperRevision;
      activeBlob = blob;
      root.style.setProperty("--skin-custom-wallpaper", `url("${activeObjectUrl}")`);
      projectWallpaperPresence(root, preference.presetId, true);
      projectCustomPanelColor(root, preference, generation);
    })
    .catch(() => {
      // 修复：壁纸数据可能在浏览器清理或另一个窗口删除后消失。
      // 仅回退到预设背景，不覆盖用户的其他皮肤偏好。
      if (generation === requestGeneration) {
        releaseObjectUrl();
        projectWallpaperPresence(root, preference.presetId, false);
      }
    });
}
