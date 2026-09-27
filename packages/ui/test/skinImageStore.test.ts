import assert from "node:assert/strict";
import test from "node:test";
import { decodeWallpaper } from "../src/skin/skinImageStore.js";

test("decoded high-resolution images are accepted when image bytes meet the size limit", async () => {
  const original = globalThis.createImageBitmap;
  let closed = false;
  globalThis.createImageBitmap = async () =>
    ({ width: 8193, height: 1, close: () => (closed = true) }) as ImageBitmap;
  try {
    await decodeWallpaper(new File([new Uint8Array(12)], "wide.png", { type: "image/png" }));
    assert.equal(closed, true);
  } finally {
    globalThis.createImageBitmap = original;
  }
});
