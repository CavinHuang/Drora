import { loadSharp } from "../../lib/load-sharp.js";

export async function cropLinuxWindowFromScreen(fullPng, bounds) {
  if (!fullPng || fullPng.length === 0) return null;
  try {
    const sharp = await loadSharp();
    const image = sharp(Buffer.from(fullPng));
    const meta3 = await image.metadata();
    const imgW = meta3.width ?? 0;
    const imgH = meta3.height ?? 0;
    if (imgW <= 0 || imgH <= 0) return null;
    const requestedLeft = Math.round(bounds[0]);
    const requestedTop = Math.round(bounds[1]);
    const requestedRight = requestedLeft + Math.round(bounds[2]);
    const requestedBottom = requestedTop + Math.round(bounds[3]);
    const left = Math.max(0, Math.min(imgW, requestedLeft));
    const top = Math.max(0, Math.min(imgH, requestedTop));
    const right = Math.max(0, Math.min(imgW, requestedRight));
    const bottom = Math.max(0, Math.min(imgH, requestedBottom));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return null;
    const png = await image.extract({ left, top, width, height }).png().toBuffer();
    return {
      png: new Uint8Array(png),
      bounds: [left, top, width, height],
    };
  } catch {
    return null;
  }
}
