import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SKIN_PREFERENCE } from "../src/skin/skinPreference.js";
import { applySkinPreference } from "../src/skin/skinRuntime.js";

test("wallpaper presence is projected only when a preset image is active", () => {
  const previousDocument = globalThis.document;
  const root = {
    dataset: {} as Record<string, string>,
    style: { setProperty() {}, removeProperty() {} },
  };
  globalThis.document = { documentElement: root } as unknown as Document;
  try {
    applySkinPreference({ ...DEFAULT_SKIN_PREFERENCE, presetId: "ocean" });
    assert.equal(root.dataset.droraSkinWallpaper, "true");
    applySkinPreference(DEFAULT_SKIN_PREFERENCE);
    assert.equal(root.dataset.droraSkinWallpaper, undefined);
  } finally {
    globalThis.document = previousDocument;
  }
});
