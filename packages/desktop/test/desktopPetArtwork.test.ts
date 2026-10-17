import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DESKTOP_PET_BUILTINS, desktopPetManifestSchema } from "@drora/shared";
import { decodeDesktopPetImage } from "../src/main/desktopPetImageDecoder.js";
import { resolvePetConfiguration } from "../src/main/desktopPetConfiguration.js";
import { createDesktopPetLibrary } from "../src/main/desktopPetLibrary.js";
import { codexPetTracks } from "../src/shared/desktopPetAnimation.js";

const required = [6, 8, 8, 4, 5, 8, 6, 6, 6];

test("every built-in is a standard Codex pack with exact tracks and populated required cells", async () => {
  const library = createDesktopPetLibrary("unused", decodeDesktopPetImage);
  for (const { id } of DESKTOP_PET_BUILTINS) {
    const pack = await library.load(id);
    assert.ok(pack, `${id} must use the shared pack loader`);
    const asset = new URL(`../assets/desktop-pets/${id}/`, import.meta.url);
    const manifest = desktopPetManifestSchema.parse(
      JSON.parse(await readFile(new URL("pet.json", asset), "utf8")),
    );
    assert.equal(manifest.spriteVersionNumber, 1);
    const bytes = await readFile(new URL(manifest.spritesheetPath, asset));
    assert.deepEqual(pack.bytes, bytes, "embedded pack must match the standard on-disk asset");
    const config = await resolvePetConfiguration({ desktopPetCharacter: id }, library);
    assert.equal(config.id, id);
    assert.equal(config.spriteVersionNumber, 1);
    assert.equal(config.columns, 8);
    assert.equal(config.rows, 9);
    assert.equal(config.height, Math.ceil((config.width * 208) / 192));
    assert.deepEqual(config.tracks, codexPetTracks());
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1536);
    assert.equal(info.height, 1872);
    for (let row = 0; row < 9; row++) {
      for (let column = 0; column < 8; column++) {
        let occupied = false;
        for (let y = row * 208; y < (row + 1) * 208 && !occupied; y++) {
          for (let x = column * 192; x < (column + 1) * 192; x++) {
            if (data[(y * 1536 + x) * 4 + 3] > 0) {
              occupied = true;
              break;
            }
          }
        }
        assert.equal(occupied, column < required[row], `${id} row ${row} cell ${column}`);
      }
    }
  }
});

test("each built-in exports as a standard pack that imports unchanged through the custom path", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-pet-builtin-roundtrip-"));
  try {
    const library = createDesktopPetLibrary(join(root, "owned"), decodeDesktopPetImage);
    for (const { id } of DESKTOP_PET_BUILTINS) {
      const before = await library.load(id);
      await library.exportPet(id, join(root, "export"));
      await library.importDirectory(join(root, "export", id));
      const after = await library.load(`custom:${id}`);
      assert.ok(after);
      assert.deepEqual(after.bytes, before!.bytes);
      assert.equal(after.entry.spriteVersionNumber, before!.entry.spriteVersionNumber);
      const builtin = await resolvePetConfiguration({ desktopPetCharacter: id }, library);
      const custom = await resolvePetConfiguration(
        { desktopPetCharacter: `custom:${id}` },
        library,
      );
      assert.deepEqual({ ...custom, id }, builtin);
      await assert.rejects(() => library.remove(id));
      await assert.rejects(() => library.prepareUpgrade(id));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
