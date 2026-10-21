import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { decodeDesktopPetImage } from "../src/main/desktopPetImageDecoder.js";
import { createDesktopPetLibrary } from "../src/main/desktopPetLibrary.js";
import { petImageMetadata } from "../src/main/desktopPetImage.js";

test("Codex v1/v2 packs import unchanged, survive restart, export, and delete without touching the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-pet-library-"));
  try {
    const source = join(root, "codex");
    const home = join(root, "drora");
    for (const version of [1, 2] as const) {
      const folder = join(source, `pet-${version}`);
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "pet.json"),
        JSON.stringify({ displayName: `Test ${version}`, spriteVersionNumber: version }),
      );
      await sharp({
        create: {
          width: 1536,
          height: version === 1 ? 1872 : 2288,
          channels: 4,
          background: "#0000",
        },
      })
        .webp()
        .toFile(join(folder, "spritesheet.webp"));
    }
    const library = createDesktopPetLibrary(home, decodeDesktopPetImage);
    const imported = await library.importDirectory(source);
    assert.equal(imported.pets.length, 2);
    assert.deepEqual(imported.errors, []);
    assert.equal(
      (await createDesktopPetLibrary(home, decodeDesktopPetImage).list()).pets.length,
      2,
    );
    const pet = imported.pets.find((pet) => pet.spriteVersionNumber === 2)!;
    assert.match((await library.load(pet.id))!.image, /^data:image\/webp;base64,/);
    const output = join(root, "exports");
    await library.exportPet(pet.id, output);
    assert.equal(
      (await createDesktopPetLibrary(output, decodeDesktopPetImage).list()).pets.length,
      0,
    );
    const exported = JSON.parse(await readFile(join(output, pet.id.slice(7), "pet.json"), "utf8"));
    assert.equal(exported.spriteVersionNumber, 2);
    await library.remove(pet.id);
    assert.equal((await library.list()).pets.length, 1);
    assert.ok(await readFile(join(source, "pet-2", "pet.json")));
    await library.importDirectory(join(source, "pet-1"));
    assert.equal((await library.list()).pets.length, 2, "collision imports use a new folder");
    const caseVariant = join(root, "PET-1.png");
    await writeFile(caseVariant, await readFile(join(source, "pet-1", "spritesheet.webp")));
    const caseImported = await library.importImage(caseVariant);
    assert.equal(caseImported.pets.length, 3, "case-insensitive collisions also use a new folder");
    await assert.rejects(() => library.remove("custom:../codex"));
    await assert.rejects(() => library.remove("violet"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("valid dimensions in a truncated PNG/WebP header do not admit a corrupt pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-pet-corrupt-"));
  try {
    const library = createDesktopPetLibrary(root, decodeDesktopPetImage);
    for (const format of ["png", "webp"] as const) {
      const valid = await sharp({
        create: { width: 1536, height: 2288, channels: 4, background: "#80808080" },
      })
        .toFormat(format)
        .toBuffer();
      const truncated = valid.subarray(0, format === "png" ? 33 : 40);
      assert.deepEqual(petImageMetadata(truncated), {
        width: 1536,
        height: 2288,
        mime: `image/${format}`,
      });
      const path = join(root, `corrupt.${format}`);
      await writeFile(path, truncated);
      await assert.rejects(() => library.importImage(path));
      const pack = join(root, "pets", `corrupt-${format}`);
      await mkdir(pack, { recursive: true });
      await writeFile(
        join(pack, "pet.json"),
        JSON.stringify({ spriteVersionNumber: 2, spritesheetPath: "sheet" }),
      );
      await writeFile(join(pack, "sheet"), truncated);
    }
    const result = await library.list();
    assert.equal(result.pets.length, 0);
    assert.deepEqual(result.errors.sort(), ["corrupt-png", "corrupt-webp"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("upgrade preparation resolves the real legacy path and never changes source artwork", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-pet-upgrade-"));
  try {
    const directory = join(root, "avatars", "legacy");
    await mkdir(directory, { recursive: true });
    const manifest = JSON.stringify({ displayName: "Original" });
    await writeFile(join(directory, "avatar.json"), manifest);
    const image = await sharp({
      create: { width: 1536, height: 1872, channels: 4, background: "#0000" },
    })
      .png()
      .toBuffer();
    await writeFile(join(directory, "spritesheet.webp"), image);
    const library = createDesktopPetLibrary(root, decodeDesktopPetImage);
    // macOS 的 os.tmpdir() 返回 /var/... 而 realpath 为 /private/var/...；
    // 生产侧返回 realpath 归一路径（符号链接安全），期望值同样 realpath 归一。
    assert.deepEqual(await library.prepareUpgrade("custom:legacy"), {
      id: "custom:legacy",
      directoryPath: await realpath(directory),
    });
    assert.equal(await readFile(join(directory, "avatar.json"), "utf8"), manifest);
    assert.deepEqual(await readFile(join(directory, "spritesheet.webp")), image);
    await assert.rejects(() => library.prepareUpgrade("violet"));
    await assert.rejects(() => library.prepareUpgrade("custom:missing"));
    await assert.rejects(() => library.prepareUpgrade("custom:../legacy"));
    const v2 = await sharp({
      create: { width: 1536, height: 2288, channels: 4, background: "#0000" },
    })
      .png()
      .toBuffer();
    await writeFile(join(directory, "spritesheet.webp"), v2);
    await writeFile(join(directory, "avatar.json"), JSON.stringify({ spriteVersionNumber: 2 }));
    await assert.rejects(() => library.prepareUpgrade("custom:legacy"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest defaults and legacy precedence, invalid packs and path escapes are isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-pet-library-"));
  try {
    const image = await sharp({
      create: { width: 1536, height: 1872, channels: 4, background: "#0000" },
    })
      .png()
      .toBuffer();
    const create = async (directory: string, manifest: unknown, legacy = false) => {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, legacy ? "avatar.json" : "pet.json"),
        JSON.stringify(manifest),
      );
      await writeFile(join(directory, "spritesheet.webp"), image);
    };
    await create(join(root, "avatars", "same"), { id: "Legacy name" }, true);
    await create(join(root, "pets", "same"), { displayName: "Current name" });
    await create(join(root, "pets", "invalid"), { spriteVersionNumber: 3 });
    await create(join(root, "pets", "escape"), { spritesheetPath: "../../outside.png" });
    await writeFile(join(root, "outside.png"), image);
    await create(join(root, "pets", "wrong-size"), {});
    await writeFile(join(root, "pets", "wrong-size", "spritesheet.webp"), Buffer.from("invalid"));
    const library = createDesktopPetLibrary(root, decodeDesktopPetImage);
    const result = await library.list();
    assert.equal(result.pets.length, 1);
    assert.equal(result.pets[0].displayName, "Current name");
    assert.equal(result.pets[0].spriteVersionNumber, 1);
    assert.equal(result.errors.length, 3);
    // Windows 普通账户可能没有创建文件符号链接权限；其他路径逃逸仍在上面实际验证。
    if (process.platform !== "win32") {
      await create(join(root, "pets", "symlink"), { spritesheetPath: "link.png" });
      await symlink(join(root, "outside.png"), join(root, "pets", "symlink", "link.png"));
      assert.ok((await library.list()).errors.some((error) => error.includes("symlink")));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("oversized/wrong-sized sprites and directory junctions cannot escape the owned library", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-pet-library-bounds-"));
  try {
    const library = createDesktopPetLibrary(join(root, "owned"), decodeDesktopPetImage);
    const small = join(root, "small.png");
    await sharp({ create: { width: 16, height: 16, channels: 4, background: "#0000" } })
      .png()
      .toFile(small);
    await assert.rejects(() => library.importImage(small), /1536/);
    const huge = join(root, "huge.png");
    await writeFile(huge, Buffer.alloc(20 * 1024 * 1024 + 1));
    await assert.rejects(() => library.importImage(huge), /size limit/);
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    const pets = join(root, "owned", "pets");
    await mkdir(pets, { recursive: true });
    await symlink(
      outside,
      join(pets, "external"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(() => library.remove("custom:external"), /escapes/);
    assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
