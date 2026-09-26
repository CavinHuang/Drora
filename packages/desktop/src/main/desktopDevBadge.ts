// 官方 dev-badge 对齐（第四十六轮）：dev 构建在应用图标上叠加 DEV 角标，多实例并存
// 时可区分开发实例与打包版。官方 renderDevBadgeIcon 同款：SVG 丝带 → sharp 合成到
// 基础图标 → dest-in 裁回原 alpha → nativeImage；任一步失败回退默认图标（只告警）。
import { nativeImage } from "electron";
import { readFile } from "node:fs/promises";
import type { Logger } from "@drora/shared";

const RIBBON_WIDTH_RATIO = 0.24;
const RIBBON_HEIGHT_RATIO = 0.199;
const RIBBON_FONT_RATIO = 0.152;
const RIBBON_ARM_RATIO = 0.625;
const RIBBON_COLOR = "#2563eb";

function buildDevRibbonSvg(iconSize: number): string {
  const arm = Math.round(iconSize * RIBBON_ARM_RATIO);
  const height = Math.round(iconSize * RIBBON_HEIGHT_RATIO);
  const fontSize = Math.round(iconSize * RIBBON_FONT_RATIO);
  const spacing = Math.max(2, Math.round(iconSize * 0.008));
  const corner = Math.round(iconSize * RIBBON_WIDTH_RATIO);
  return `<svg width="${iconSize}" height="${iconSize}" xmlns="http://www.w3.org/2000/svg">   <g transform="rotate(-45 ${corner} ${corner})">     <rect x="${corner - arm}" y="${corner - height / 2}" width="${arm * 2}" height="${height}" fill="${RIBBON_COLOR}"/>     <text x="${corner}" y="${corner}" fill="#ffffff" font-family="-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="${spacing}" text-anchor="middle" dominant-baseline="central">DEV</text>   </g> </svg>`;
}

export async function renderDevBadgeIcon(
  baseIconPath: string,
  logger: Logger,
): Promise<Electron.NativeImage | null> {
  try {
    const { default: sharp } = await import("sharp");
    const iconBytes = await readFile(baseIconPath);
    const { width, height } = await sharp(iconBytes).metadata();
    if (!width || !height) {
      logger.warn("[dev-badge] base icon has no size metadata, fallback to default icon");
      return null;
    }
    const minSide = Math.min(width, height);
    const ribbon = Buffer.from(buildDevRibbonSvg(minSide));
    // 官方两步合成：丝带叠上去之后用原图 alpha 做 dest-in，保住圆角/透明边缘。
    const withRibbon = await sharp(iconBytes)
      .composite([{ input: ribbon, blend: "over" }])
      .png()
      .toBuffer();
    const masked = await sharp(withRibbon)
      .composite([{ input: iconBytes, blend: "dest-in" }])
      .png()
      .toBuffer();
    const image = nativeImage.createFromBuffer(masked);
    if (image.isEmpty()) {
      logger.warn("[dev-badge] rendered image is empty, fallback to default icon");
      return null;
    }
    const size = image.getSize();
    logger.debug(`[dev-badge] icon rendered ${size.width}x${size.height}`);
    return image;
  } catch (error) {
    logger.warn("[dev-badge] render failed, fallback to default icon:", error);
    return null;
  }
}
