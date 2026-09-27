import type { SkinPresetId } from "./skinPreference.js";

// 预置图的代表色经过人工校正：亮度仍交给主题，避免深色星野图把浅色工作区染黑。
const PRESET_WALLPAPER_COLORS: Record<Exclude<SkinPresetId, "default">, string> = {
  ocean: "#7e99a3",
  forest: "#748b76",
  plum: "#846e88",
  ink: "#a7a4a1",
  geometry: "#c1aa94",
  celestial: "#43517e",
  tea: "#8fa768",
  botanical: "#9cae8c",
  jade: "#286b56",
};

export function getPresetWallpaperColor(presetId: SkinPresetId): string | null {
  return presetId === "default" ? null : PRESET_WALLPAPER_COLORS[presetId];
}

function hexChannel(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

function hueOf(red: number, green: number, blue: number): number {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const chroma = maximum - minimum;
  if (chroma === 0) return 0;
  const hue =
    maximum === red
      ? ((green - blue) / chroma) % 6
      : maximum === green
        ? (blue - red) / chroma + 2
        : (red - green) / chroma + 4;
  return (hue * 60 + 360) % 360;
}

export function deriveRepresentativeWallpaperColor(pixels: Uint8ClampedArray): string | null {
  const buckets = Array.from({ length: 12 }, () => ({ weight: 0, red: 0, green: 0, blue: 0 }));
  let opaqueCount = 0;
  let colorfulCount = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const red = pixels[index]!;
    const green = pixels[index + 1]!;
    const blue = pixels[index + 2]!;
    if (pixels[index + 3]! < 128) continue;
    opaqueCount += 1;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const chroma = maximum - minimum;
    const lightness = (maximum + minimum) / 510;
    if (chroma < 18 || lightness < 0.08 || lightness > 0.95) continue;
    colorfulCount += 1;
    const hue = hueOf(red, green, blue);
    const weight = (chroma / 255) * (1 - Math.abs(lightness - 0.5) * 0.4);
    const bucket = buckets[Math.floor(hue / 30)]!;
    bucket.weight += weight;
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
  }
  const dominant = buckets.reduce((best, bucket) => (bucket.weight > best.weight ? bucket : best));
  if (dominant.weight === 0 || colorfulCount < opaqueCount * 0.05) return null;
  return `#${hexChannel(dominant.red / dominant.weight)}${hexChannel(dominant.green / dominant.weight)}${hexChannel(dominant.blue / dominant.weight)}`;
}

export function toMutedWallpaperColor(color: string): string {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
  const mutedSaturation = saturation < 0.06 ? 0 : Math.min(0.28, Math.max(0.16, saturation));
  return `hsl(${Math.round(hueOf(red, green, blue))} ${Math.round(mutedSaturation * 100)}% 54%)`;
}

export async function sampleWallpaperColor(blob: Blob): Promise<string | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close();
    }
  } else {
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Wallpaper could not be sampled"));
        element.src = url;
      });
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  // 黑白照片或只有极小彩色点的图片使用中性色，不误借当前预设的色相。
  return (
    deriveRepresentativeWallpaperColor(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
    ) ?? "#888888"
  );
}
