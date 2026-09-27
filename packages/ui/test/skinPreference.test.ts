import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SKIN_PREFERENCE,
  LEGACY_SKIN_STORAGE_KEY,
  SKIN_STORAGE_KEY,
  loadSkinPreference,
  normalizeSkinPreference,
  parseSkinPreference,
  updateSkinPreference,
  validateWallpaperFile,
} from "../src/skin/skinPreference.js";

test("new and malformed profiles preserve the original default appearance", () => {
  assert.deepEqual(normalizeSkinPreference(null), DEFAULT_SKIN_PREFERENCE);
  assert.deepEqual(
    normalizeSkinPreference({ version: 9, presetId: "missing" }),
    DEFAULT_SKIN_PREFERENCE,
  );
  assert.equal(SKIN_STORAGE_KEY, "drora-skin-v2");
});

test("version 1 preference migrates panel opacity to three independent panels", () => {
  assert.deepEqual(
    parseSkinPreference(
      JSON.stringify({
        version: 1,
        presetId: "forest",
        panelOpacity: 87,
        wallpaperPositionX: 25,
        wallpaperPositionY: 75,
        wallpaperRevision: "11111111-1111-4111-8111-111111111111",
      }),
    ),
    {
      version: 2,
      presetId: "forest",
      customAccentColor: null,
      matchPanelColorsToWallpaper: false,
      conversationOpacity: 87,
      sidebarOpacity: 87,
      sidePaneOpacity: 87,
      wallpaperPositionX: 25,
      wallpaperPositionY: 75,
      wallpaperRevision: "11111111-1111-4111-8111-111111111111",
    },
  );
});

test("stored version 2 takes precedence; legacy metadata is read only during migration", () => {
  const legacy = JSON.stringify({
    version: 1,
    presetId: "plum",
    panelOpacity: 83,
    wallpaperPositionX: 50,
    wallpaperPositionY: 50,
    wallpaperRevision: null,
  });
  const readLegacy = (key: string) => (key === LEGACY_SKIN_STORAGE_KEY ? legacy : null);
  const migration = loadSkinPreference(readLegacy);
  assert.equal(migration.migrated, true);
  assert.equal(migration.preference.sidebarOpacity, 83);
  const current = JSON.stringify({ ...DEFAULT_SKIN_PREFERENCE, presetId: "ocean" });
  const loaded = loadSkinPreference((key) =>
    key === SKIN_STORAGE_KEY ? current : key === LEGACY_SKIN_STORAGE_KEY ? legacy : null,
  );
  assert.equal(loaded.migrated, false);
  assert.equal(loaded.preference.presetId, "ocean");
  assert.equal(loaded.preference.matchPanelColorsToWallpaper, false);
});

test("new preset IDs keep existing version 2 skin choices intact", () => {
  const current = {
    ...DEFAULT_SKIN_PREFERENCE,
    presetId: "forest" as const,
    customAccentColor: "#aabbcc",
    matchPanelColorsToWallpaper: true,
    sidebarOpacity: 87,
  };
  for (const presetId of ["ink", "geometry", "celestial"] as const) {
    const next = updateSkinPreference(current, { presetId });
    assert.equal(next.presetId, presetId);
    assert.equal(next.customAccentColor, current.customAccentColor);
    assert.equal(next.matchPanelColorsToWallpaper, true);
    assert.equal(next.sidebarOpacity, current.sidebarOpacity);
    assert.equal(parseSkinPreference(JSON.stringify(next)).presetId, presetId);
  }
});

test("normalization bounds each opacity, color and image position", () => {
  assert.deepEqual(
    normalizeSkinPreference({
      version: 2,
      presetId: "unknown",
      conversationOpacity: 12,
      wallpaperPositionX: 140,
      wallpaperPositionY: -10,
      wallpaperRevision: "not-a-uuid",
    }),
    DEFAULT_SKIN_PREFERENCE,
  );
  assert.deepEqual(
    normalizeSkinPreference({
      version: 2,
      presetId: "ocean",
      customAccentColor: "#AABBCC",
      matchPanelColorsToWallpaper: true,
      conversationOpacity: 10,
      sidebarOpacity: 105,
      sidePaneOpacity: 20,
      wallpaperPositionX: 120,
      wallpaperPositionY: -5,
      wallpaperRevision: null,
    }),
    {
      version: 2,
      presetId: "ocean",
      customAccentColor: "#aabbcc",
      matchPanelColorsToWallpaper: true,
      conversationOpacity: 20,
      sidebarOpacity: 100,
      sidePaneOpacity: 20,
      wallpaperPositionX: 100,
      wallpaperPositionY: 0,
      wallpaperRevision: null,
    },
  );
  assert.equal(
    normalizeSkinPreference({ ...DEFAULT_SKIN_PREFERENCE, customAccentColor: "red" })
      .customAccentColor,
    null,
  );
  assert.equal(
    normalizeSkinPreference({ ...DEFAULT_SKIN_PREFERENCE, matchPanelColorsToWallpaper: "yes" })
      .matchPanelColorsToWallpaper,
    false,
  );
});

test("resetting a skin does not change theme mode", () => {
  const previous = updateSkinPreference(DEFAULT_SKIN_PREFERENCE, {
    presetId: "forest",
    conversationOpacity: 85,
    sidebarOpacity: 92,
    customAccentColor: "#336699",
  });
  assert.equal(previous.presetId, "forest");
  assert.equal(previous.conversationOpacity, 85);
  assert.equal(previous.sidebarOpacity, 92);
  assert.deepEqual(
    updateSkinPreference(previous, DEFAULT_SKIN_PREFERENCE),
    DEFAULT_SKIN_PREFERENCE,
  );
});

test("wallpaper import checks content signature and size even when picker MIME is missing or wrong", async () => {
  const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])], "wallpaper.png", {
    type: "image/png",
  });
  assert.equal(await validateWallpaperFile(png), null);
  const pngWithoutMime = new File([await png.arrayBuffer()], "wallpaper.png");
  assert.equal(await validateWallpaperFile(pngWithoutMime), null);
  const pngWithWrongMime = new File([await png.arrayBuffer()], "wallpaper.png", {
    type: "application/octet-stream",
  });
  assert.equal(await validateWallpaperFile(pngWithWrongMime), null);
  const disguised = new File([new Uint8Array(12)], "fake.png", { type: "image/png" });
  assert.equal(await validateWallpaperFile(disguised), "invalid");
  const huge = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "huge.png", {
    type: "image/png",
  });
  assert.equal(await validateWallpaperFile(huge), "too-large");
});
