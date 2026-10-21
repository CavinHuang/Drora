import sharp from "sharp";

/** The decoder must actually read pixels; metadata alone accepts truncated images. */
export async function decodeDesktopPetImage(bytes: Buffer) {
  // Electron nativeImage 只支持 PNG/JPEG 缓冲区；原版 Codex 的合法 WebP 会返回空图，必须统一走完整解码。
  const { info } = await sharp(bytes, { failOn: "warning", limitInputPixels: 1536 * 2288 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height };
}
