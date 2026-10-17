import { DESKTOP_PET_CONTRACT } from "@drora/shared";

export function petImageMetadata(
  bytes: Buffer,
): { width: number; height: number; mime: string } | null {
  if (bytes.length > DESKTOP_PET_CONTRACT.maxImageBytes) return null;
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mime: "image/png" };
  }
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP"
  )
    return null;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const tag = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + length > bytes.length) return null;
    if (tag === "VP8X" && length >= 10)
      return {
        width: bytes.readUIntLE(data + 4, 3) + 1,
        height: bytes.readUIntLE(data + 7, 3) + 1,
        mime: "image/webp",
      };
    if (tag === "VP8L" && length >= 5 && bytes[data] === 47) {
      const packed = bytes.readUInt32LE(data + 1);
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
        mime: "image/webp",
      };
    }
    if (
      tag === "VP8 " &&
      length >= 10 &&
      bytes.subarray(data + 3, data + 6).equals(Buffer.from([157, 1, 42]))
    )
      return {
        width: bytes.readUInt16LE(data + 6) & 0x3fff,
        height: bytes.readUInt16LE(data + 8) & 0x3fff,
        mime: "image/webp",
      };
    offset = data + length + (length % 2);
  }
  return null;
}

export function validatePetImage(bytes: Buffer, version?: 1 | 2) {
  const meta = petImageMetadata(bytes);
  const detectedVersion: 1 | 2 | null =
    meta?.height === 1872 ? 1 : meta?.height === 2288 ? 2 : null;
  if (
    !meta ||
    meta.width !== 1536 ||
    detectedVersion == null ||
    (version && version !== detectedVersion)
  ) {
    throw new Error(
      "Expected a Codex PNG/WebP spritesheet: 1536×1872 (v1) or 1536×2288 (v2), at most 20 MiB",
    );
  }
  return {
    version: detectedVersion,
    extension: meta.mime === "image/png" ? "png" : "webp",
    image: `data:${meta.mime};base64,${bytes.toString("base64")}`,
  };
}
