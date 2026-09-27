import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PRESET_ART = ["ocean", "forest", "plum", "ink", "geometry", "celestial"] as const;

test("bundled skin wallpapers are optimized WebP assets", async () => {
  for (const preset of PRESET_ART) {
    const url = new URL(`../src/skin/wallpapers/${preset}.webp`, import.meta.url);
    const image = await readFile(url);
    assert.equal(image.toString("ascii", 0, 4), "RIFF", `${preset} RIFF header`);
    assert.equal(image.toString("ascii", 8, 12), "WEBP", `${preset} WebP header`);
    assert.ok(image.byteLength < 200_000, `${preset} must stay below 200 KB`);
  }
});
