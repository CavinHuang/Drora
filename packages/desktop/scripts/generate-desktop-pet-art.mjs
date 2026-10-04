import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const assetsUrl = new URL("../assets/desktop-pet/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("motion-manifest.json", assetsUrl), "utf8"));
const modulePath = fileURLToPath(new URL("../src/main/desktopPetArtwork.ts", import.meta.url));
const spritePath = fileURLToPath(new URL("violet-cat-motion-atlas.webp", assetsUrl));
const expectedModes = ["idle", "working", "attention", "completed", "error"];
const { cellSize, columns, rows } = manifest;
if (cellSize !== 192 || columns !== 8 || rows.length !== expectedModes.length) {
  throw new Error("Invalid desktop pet atlas geometry");
}

const reference = await sharp(fileURLToPath(new URL("violet-cat-master.png", assetsUrl)))
  .trim({ background: "#00000000" })
  .toBuffer({ resolveWithObject: true });
const scale = 160 / reference.info.width;
const images = [];
const motion = [];

for (const [rowIndex, row] of rows.entries()) {
  if (row.mode !== expectedModes[rowIndex] || !["loop", "once"].includes(row.playback)) {
    throw new Error(`Invalid desktop pet mode at row ${rowIndex}`);
  }
  if (
    row.frames.length < 5 ||
    row.frames.length > columns ||
    !Number.isInteger(row.stillFrame) ||
    row.stillFrame < 0 ||
    row.stillFrame >= row.frames.length
  ) {
    throw new Error(`Invalid frame count or still frame for ${row.mode}`);
  }
  const seen = new Set();
  const durations = [];
  for (const [column, frame] of row.frames.entries()) {
    if (
      typeof frame.source !== "string" ||
      !/^(?:poses\/)?[a-z0-9-]+\.png$/.test(frame.source) ||
      !Number.isInteger(frame.durationMs) ||
      frame.durationMs < 60 ||
      frame.durationMs > 2000 ||
      (seen.has(frame.source) && frame.returning !== true)
    ) {
      throw new Error(`Invalid ${row.mode} frame ${column}`);
    }
    seen.add(frame.source);
    const source = await readFile(new URL(frame.source, assetsUrl));
    const metadata = await sharp(source).metadata();
    if (!metadata.hasAlpha || metadata.width !== metadata.height) {
      throw new Error(`Desktop pet pose must be square with alpha: ${frame.source}`);
    }
    const trimmed = await sharp(source)
      .trim({ background: "#00000000" })
      .toBuffer({ resolveWithObject: true });
    const width = Math.round(trimmed.info.width * scale);
    const height = Math.round(trimmed.info.height * scale);
    const lift = frame.liftPx ?? 0;
    if (!Number.isInteger(lift) || lift < 0 || lift > 24) {
      throw new Error(`Invalid lift for ${row.mode} frame ${column}`);
    }
    const left = column * cellSize + Math.floor((cellSize - width) / 2);
    const top = rowIndex * cellSize + 181 - lift - height;
    if (width > cellSize || top < rowIndex * cellSize || top + height > (rowIndex + 1) * cellSize) {
      throw new Error(`Desktop pet pose escapes atlas cell: ${frame.source}`);
    }
    images.push({
      input: await sharp(trimmed.data).resize(width, height).png().toBuffer(),
      left,
      top,
    });
    durations.push(frame.durationMs);
  }
  motion.push({
    mode: row.mode,
    playback: row.playback,
    stillFrame: row.stillFrame,
    frames: durations.map((durationMs) => ({ durationMs })),
  });
}

const sprite = await sharp({
  create: {
    width: columns * cellSize,
    height: rows.length * cellSize,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(images)
  .webp({ quality: 88, alphaQuality: 100, effort: 6 })
  .toBuffer();

await writeFile(spritePath, sprite);
await writeFile(
  modulePath,
  `/** Generated from assets/desktop-pet/motion-manifest.json by scripts/generate-desktop-pet-art.mjs. */\nexport const desktopPetArtworkDataUrl =\n  "data:image/webp;base64,${sprite.toString("base64")}";\nexport const desktopPetMotion = ${JSON.stringify(motion)} as const;\n`,
  "utf8",
);
