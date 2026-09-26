import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { desktopPetContent } from "../src/main/desktopPetContent.js";
import { desktopPetMotion } from "../src/main/desktopPetArtwork.js";

test("every desktop pet mode has an aligned transparent animation row", async () => {
  const html = desktopPetContent("en-US");
  const match = html.match(/background-image:url\("?data:image\/webp;base64,([A-Za-z0-9+/=]+)"?\)/);
  assert.ok(match, "sprite sheet should be embedded in the isolated document");
  const sprite = Buffer.from(match[1], "base64");
  const image = sharp(sprite);
  const metadata = await image.metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.width, 192 * 8);
  assert.equal(metadata.height, 192 * 5);
  assert.deepEqual(
    desktopPetMotion.map(({ mode, frames }) => [mode, frames.length]),
    [
      ["idle", 7],
      ["working", 6],
      ["attention", 6],
      ["completed", 5],
      ["error", 8],
    ],
  );
  for (let row = 0; row < desktopPetMotion.length; row++) {
    const track = desktopPetMotion[row];
    for (let column = 0; column < 8; column++) {
      const cellBytes = await sharp(sprite)
        .extract({ left: column * 192, top: row * 192, width: 192, height: 192 })
        .toBuffer();
      const cell = await sharp(cellBytes).stats();
      const used = column < track.frames.length;
      assert.equal(cell.channels[3].max > 0, used, `${track.mode} frame ${column} alpha`);
    }
  }
  assert.ok(html.includes('data-mode="idle"'));
  for (const { mode } of desktopPetMotion) {
    assert.ok(html.includes(`@keyframes pet-${mode}`), `${mode} needs a timed frame sequence`);
  }
  assert.match(html, /data-mode=completed[^}]+animation:[^}]+forwards/);
  assert.match(html, /data-mode=error[^}]+animation:[^}]+forwards/);
  assert.ok(html.includes("prefers-reduced-motion:reduce"));
});
