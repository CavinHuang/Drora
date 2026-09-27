import { LEGACY_SKIN_STORAGE_KEY, SKIN_STORAGE_KEY } from "@drora/shared";

export { LEGACY_SKIN_STORAGE_KEY, SKIN_STORAGE_KEY };
export const MAX_WALLPAPER_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CUSTOM_ACCENT_COLOR = "#176d97";
export const SKIN_PRESET_IDS = [
  "default",
  "ocean",
  "forest",
  "plum",
  "ink",
  "geometry",
  "celestial",
  "tea",
  "botanical",
  "jade",
] as const;
export type SkinPresetId = (typeof SKIN_PRESET_IDS)[number];

export interface SkinPreference {
  version: 2;
  presetId: SkinPresetId;
  customAccentColor: string | null;
  matchPanelColorsToWallpaper: boolean;
  conversationOpacity: number;
  sidebarOpacity: number;
  sidePaneOpacity: number;
  wallpaperPositionX: number;
  wallpaperPositionY: number;
  wallpaperRevision: string | null;
}

export const DEFAULT_SKIN_PREFERENCE: SkinPreference = {
  version: 2,
  presetId: "default",
  customAccentColor: null,
  matchPanelColorsToWallpaper: false,
  conversationOpacity: 100,
  sidebarOpacity: 100,
  sidePaneOpacity: 100,
  wallpaperPositionX: 50,
  wallpaperPositionY: 50,
  wallpaperRevision: null,
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function normalizeSkinPreference(value: unknown): SkinPreference {
  if (!value || typeof value !== "object") return DEFAULT_SKIN_PREFERENCE;
  const raw = value as Record<string, unknown>;
  if (
    (raw.version !== 1 && raw.version !== 2) ||
    !SKIN_PRESET_IDS.includes(raw.presetId as SkinPresetId)
  ) {
    return DEFAULT_SKIN_PREFERENCE;
  }
  const legacyOpacity = boundedNumber(raw.panelOpacity, 100, 20, 100);
  const opacity = (field: string) =>
    raw.version === 1 ? legacyOpacity : boundedNumber(raw[field], 100, 20, 100);
  return {
    version: 2,
    presetId: raw.presetId as SkinPresetId,
    customAccentColor:
      typeof raw.customAccentColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.customAccentColor)
        ? raw.customAccentColor.toLowerCase()
        : null,
    matchPanelColorsToWallpaper: raw.matchPanelColorsToWallpaper === true,
    conversationOpacity: opacity("conversationOpacity"),
    sidebarOpacity: opacity("sidebarOpacity"),
    sidePaneOpacity: opacity("sidePaneOpacity"),
    wallpaperPositionX: boundedNumber(raw.wallpaperPositionX, 50, 0, 100),
    wallpaperPositionY: boundedNumber(raw.wallpaperPositionY, 50, 0, 100),
    wallpaperRevision:
      typeof raw.wallpaperRevision === "string" &&
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(raw.wallpaperRevision)
        ? raw.wallpaperRevision
        : null,
  };
}

export function isSkinPreferencePayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return (
    (raw.version === 1 || raw.version === 2) &&
    SKIN_PRESET_IDS.includes(raw.presetId as SkinPresetId)
  );
}

export function updateSkinPreference(
  current: SkinPreference,
  patch: Partial<SkinPreference>,
): SkinPreference {
  return normalizeSkinPreference({ ...current, ...patch });
}

export function parseSkinPreference(raw: string | null): SkinPreference {
  if (!raw) return DEFAULT_SKIN_PREFERENCE;
  try {
    return normalizeSkinPreference(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_SKIN_PREFERENCE;
  }
}

export function loadSkinPreference(read: (key: string) => string | null): {
  preference: SkinPreference;
  migrated: boolean;
} {
  const current = read(SKIN_STORAGE_KEY);
  if (current !== null) return { preference: parseSkinPreference(current), migrated: false };
  const legacy = read(LEGACY_SKIN_STORAGE_KEY);
  return { preference: parseSkinPreference(legacy), migrated: legacy !== null };
}

export type WallpaperValidationError = "invalid" | "too-large";

export async function validateWallpaperFile(file: File): Promise<WallpaperValidationError | null> {
  if (file.size > MAX_WALLPAPER_BYTES) return "too-large";
  if (file.size < 9) return "invalid";
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png =
    header[0] === 137 &&
    header[1] === 80 &&
    header[2] === 78 &&
    header[3] === 71 &&
    header[4] === 13 &&
    header[5] === 10 &&
    header[6] === 26 &&
    header[7] === 10;
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  const webp =
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  // 修复：桌面文件选择器可能留空或误报 MIME；以内容签名和后续实际解码结果为准。
  return png || jpeg || webp ? null : "invalid";
}
