import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveRepresentativeWallpaperColor,
  getPresetWallpaperColor,
  toMutedWallpaperColor,
} from "../src/skin/skinPalette.js";

test("each bundled wallpaper has a curated representative color", () => {
  assert.equal(getPresetWallpaperColor("default"), null);
  for (const preset of [
    "ocean",
    "forest",
    "plum",
    "ink",
    "geometry",
    "celestial",
    "tea",
    "botanical",
    "jade",
  ] as const) {
    assert.match(getPresetWallpaperColor(preset) ?? "", /^#[0-9a-f]{6}$/);
  }
});

test("a representative hue ignores transparent and neutral pixels", () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 240, 20, 10, 255, 255, 255, 255, 255, 0, 0, 255, 0,
  ]);
  const color = deriveRepresentativeWallpaperColor(pixels);
  assert.ok(color);
  assert.match(color, /^#[0-9a-f]{6}$/);
  assert.equal(
    deriveRepresentativeWallpaperColor(new Uint8ClampedArray([255, 255, 255, 255])),
    null,
  );
  assert.equal(deriveRepresentativeWallpaperColor(new Uint8ClampedArray([255, 0, 0, 0])), null);
  const sparseColor = new Uint8ClampedArray(40 * 4).fill(240);
  sparseColor.set([255, 0, 0, 255], 0);
  assert.equal(deriveRepresentativeWallpaperColor(sparseColor), null);
});

test("panel tint retains image hue with bounded saturation", () => {
  assert.match(toMutedWallpaperColor("#ff0000"), /^hsl\(/);
  assert.notEqual(toMutedWallpaperColor("#ff0000"), toMutedWallpaperColor("#0000ff"));
});
