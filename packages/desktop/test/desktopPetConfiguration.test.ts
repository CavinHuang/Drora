import assert from "node:assert/strict";
import test from "node:test";
import { DESKTOP_PET_BUILTINS, desktopPetConfigurationSchema } from "@drora/shared";
import { createDesktopPetLibrary } from "../src/main/desktopPetLibrary.js";
import { resolvePetConfiguration } from "../src/main/desktopPetConfiguration.js";
import { decodeDesktopPetImage } from "../src/main/desktopPetImageDecoder.js";

test("saved built-in IDs retain selection while sizes and geometry use the Codex contract", async () => {
  const library = createDesktopPetLibrary("unused", decodeDesktopPetImage);
  for (const { id } of DESKTOP_PET_BUILTINS) {
    for (const size of [80, 112, 224]) {
      const value = await resolvePetConfiguration(
        { desktopPetCharacter: id, desktopPetSize: size },
        library,
      );
      assert.equal(value.id, id);
      assert.equal(value.width, size);
      assert.equal(value.height, Math.ceil((size * 208) / 192));
      assert.equal(desktopPetConfigurationSchema.safeParse(value).success, true);
    }
  }
});

test("missing and unknown selections fall back to a standard pack, with no old geometry", async () => {
  const library = createDesktopPetLibrary("unused", decodeDesktopPetImage);
  const fallback = await resolvePetConfiguration({}, library);
  for (const id of ["not-a-character", "custom:missing"]) {
    assert.deepEqual(await resolvePetConfiguration({ desktopPetCharacter: id }, library), fallback);
  }
  assert.equal(fallback.id, "violet");
  assert.equal(fallback.rows, 9);
  assert.equal(fallback.spriteVersionNumber, 1);
});

test("renderer configuration rejects legacy layouts, missing versions and out-of-atlas tracks", async () => {
  const value = await resolvePetConfiguration(
    {},
    createDesktopPetLibrary("unused", decodeDesktopPetImage),
  );
  for (const patch of [
    { rows: 5 },
    { columns: 4 },
    { rows: 11 },
    { spriteVersionNumber: undefined },
    { tracks: [{ state: "idle", frames: [{ column: 0, row: 9, durationMs: 100 }], loopStart: 0 }] },
  ])
    assert.equal(desktopPetConfigurationSchema.safeParse({ ...value, ...patch }).success, false);
});
