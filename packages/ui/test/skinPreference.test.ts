import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SKIN_PREFERENCE,
  SKIN_STORAGE_KEY,
  normalizeSkinPreference,
  updateSkinPreference,
  validateWallpaperFile,
} from "../src/skin/skinPreference.js";

test("new and malformed profiles preserve the original default appearance", () => {
  assert.deepEqual(normalizeSkinPreference(null), DEFAULT_SKIN_PREFERENCE);
  assert.deepEqual(
    normalizeSkinPreference({ version: 9, presetId: "missing" }),
    DEFAULT_SKIN_PREFERENCE,
  );
  assert.equal(SKIN_STORAGE_KEY, "drora-skin-v1");
});

test("normalization bounds opacity and image position while rejecting unknown presets", () => {
  assert.deepEqual(
    normalizeSkinPreference({
      version: 1,
      presetId: "unknown",
      panelOpacity: 12,
      wallpaperPositionX: 140,
      wallpaperPositionY: -10,
      wallpaperRevision: "not-a-uuid",
    }),
    DEFAULT_SKIN_PREFERENCE,
  );
  assert.deepEqual(
    normalizeSkinPreference({
      version: 1,
      presetId: "ocean",
      panelOpacity: 75,
      wallpaperPositionX: 120,
      wallpaperPositionY: -5,
      wallpaperRevision: null,
    }),
    {
      version: 1,
      presetId: "ocean",
      panelOpacity: 80,
      wallpaperPositionX: 100,
      wallpaperPositionY: 0,
      wallpaperRevision: null,
    },
  );
});

test("resetting a skin does not change theme mode", () => {
  const previous = updateSkinPreference(DEFAULT_SKIN_PREFERENCE, {
    presetId: "forest",
    panelOpacity: 85,
  });
  assert.equal(previous.presetId, "forest");
  assert.equal(previous.panelOpacity, 85);
  assert.deepEqual(
    updateSkinPreference(previous, DEFAULT_SKIN_PREFERENCE),
    DEFAULT_SKIN_PREFERENCE,
  );
});

test("wallpaper import checks signature, declared type and size", async () => {
  const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])], "wallpaper.png", {
    type: "image/png",
  });
  assert.equal(await validateWallpaperFile(png), null);
  const disguised = new File([new Uint8Array(12)], "fake.png", { type: "image/png" });
  assert.equal(await validateWallpaperFile(disguised), "invalid");
  const huge = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "huge.png", {
    type: "image/png",
  });
  assert.equal(await validateWallpaperFile(huge), "too-large");
});
