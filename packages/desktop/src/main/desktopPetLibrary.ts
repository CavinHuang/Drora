import { mkdir, readdir, readFile, writeFile, realpath, stat, rm, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DESKTOP_PET_CONTRACT as C,
  desktopPetManifestSchema,
  desktopPetCharacterIdSchema,
  type DesktopPetLibraryEntry,
  type DesktopPetLibraryResult,
} from "@drora/shared";
import { validatePetImage } from "./desktopPetImage.js";
import { desktopPetBuiltinPacks } from "./desktopPetBuiltinPacks.js";

function isInside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function containedPath(root: string, child: string): Promise<string> {
  const candidate = resolve(root, child);
  if (!isInside(root, candidate)) throw new Error("Pet path escapes its directory");
  const [actualRoot, actualChild] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!isInside(actualRoot, actualChild)) throw new Error("Pet symlink escapes its directory");
  return actualChild;
}

async function boundedRead(path: string, limit: number) {
  const size = (await stat(path)).size;
  if (size > limit) throw new Error("Pet file exceeds the size limit");
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error("Pet file exceeds the size limit");
  return bytes;
}

interface LoadedPet {
  entry: DesktopPetLibraryEntry;
  directory: string | null;
  bytes: Buffer;
  extension: string;
  image: string;
}

type PetImageDecoder = (bytes: Buffer) => Promise<{ width: number; height: number }>;

async function readPack(
  root: string,
  folder: string,
  manifestName: string,
  decode: PetImageDecoder,
): Promise<LoadedPet> {
  const directory = await containedPath(root, folder);
  const manifestPath = await containedPath(directory, manifestName);
  const manifest = desktopPetManifestSchema.parse(
    JSON.parse((await boundedRead(manifestPath, 64 * 1024)).toString("utf8")),
  );
  const imagePath = await containedPath(directory, manifest.spritesheetPath);
  const bytes = await boundedRead(imagePath, C.maxImageBytes);
  const { version, image, extension } = validatePetImage(bytes, manifest.spriteVersionNumber);
  await validateDecodedImage(bytes, version, decode);
  const [manifestStat, imageStat] = await Promise.all([stat(manifestPath), stat(imagePath)]);
  return {
    directory,
    bytes,
    image,
    extension,
    entry: {
      id: C.customPrefix + folder,
      displayName: (manifest.displayName ?? manifest.id ?? folder).slice(0, 160),
      description: manifest.description?.slice(0, 1000) ?? null,
      spriteVersionNumber: version,
      updatedAt: Math.max(manifestStat.mtimeMs, imageStat.mtimeMs),
    },
  };
}

async function validateDecodedImage(bytes: Buffer, version: 1 | 2, decode: PetImageDecoder) {
  // 文件头可被截断或伪造；完整解码后再接纳，避免保存一个永远加载失败的已选宠物。
  const size = await decode(bytes);
  if (size.width !== 1536 || size.height !== (version === 1 ? 1872 : 2288))
    throw new Error("Decoded pet image dimensions do not match its manifest");
}

/** Single filesystem owner. Mutations are serialized by the native library command port. */
export function createDesktopPetLibrary(dataRoot: string, decodeImage: PetImageDecoder) {
  const petsRoot = join(dataRoot, C.directory);
  const legacyRoot = join(dataRoot, C.legacyDirectory);
  let generation = 0;
  const scanRoot = async (root: string, manifest: string, errors: string[]) => {
    const entries = await readdir(root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const pets: DesktopPetLibraryEntry[] = [];
    for (const entry of entries.slice(0, 256)) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith(".")) continue;
      try {
        pets.push((await readPack(root, entry.name, manifest, decodeImage)).entry);
      } catch {
        errors.push(entry.name);
      }
    }
    return pets;
  };
  const list = async (): Promise<DesktopPetLibraryResult> => {
    await mkdir(petsRoot, { recursive: true });
    const errors: string[] = [];
    const legacy = await scanRoot(legacyRoot, C.legacyManifest, errors);
    const current = await scanRoot(petsRoot, C.manifest, errors);
    const unique = new Map([...legacy, ...current].map((pet) => [pet.id, pet]));
    return {
      directoryPath: petsRoot,
      pets: [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      errors,
    };
  };
  const load = async (id: string): Promise<LoadedPet | null> => {
    if (!desktopPetCharacterIdSchema.safeParse(id).success) return null;
    const bundled = desktopPetBuiltinPacks.find((pet) => pet.id === id);
    if (bundled) {
      const manifest = desktopPetManifestSchema.parse(bundled.manifest);
      const bytes = Buffer.from(bundled.base64, "base64");
      const { version, image, extension } = validatePetImage(bytes, manifest.spriteVersionNumber);
      await validateDecodedImage(bytes, version, decodeImage);
      return {
        directory: null,
        bytes,
        image,
        extension,
        entry: {
          id,
          displayName: manifest.displayName ?? manifest.id ?? id,
          description: manifest.description,
          spriteVersionNumber: version,
          updatedAt: 0,
        },
      };
    }
    if (!id.startsWith(C.customPrefix)) return null;
    const folder = id.slice(C.customPrefix.length);
    try {
      return await readPack(petsRoot, folder, C.manifest, decodeImage);
    } catch {
      try {
        return await readPack(legacyRoot, folder, C.legacyManifest, decodeImage);
      } catch {
        return null;
      }
    }
  };
  const writePack = async (pet: LoadedPet, root: string) => {
    await mkdir(root, { recursive: true });
    if (root === petsRoot) await containedPath(dataRoot, C.directory);
    const stem =
      (pet.entry.id.startsWith(C.customPrefix)
        ? pet.entry.id.slice(C.customPrefix.length)
        : pet.entry.id
      )
        .replace(/[^\p{L}\p{N}_-]/gu, "-")
        .slice(0, 80) || "pet";
    const names = new Set((await readdir(root)).map((name) => name.toLowerCase()));
    let folder = stem;
    for (let n = 2; names.has(folder.toLowerCase()); n++) folder = `${stem}-${n}`;
    const temporary = join(root, `.import-${randomUUID()}`);
    await mkdir(temporary);
    try {
      const imageName = `spritesheet.${pet.extension}`;
      await writeFile(join(temporary, imageName), pet.bytes);
      await writeFile(
        join(temporary, C.manifest),
        JSON.stringify(
          {
            displayName: pet.entry.displayName,
            description: pet.entry.description,
            spriteVersionNumber: pet.entry.spriteVersionNumber,
            spritesheetPath: imageName,
          },
          null,
          2,
        ),
      );
      await rename(temporary, join(root, folder));
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
    generation++;
    return C.customPrefix + folder;
  };
  return {
    list,
    load,
    get generation() {
      return generation;
    },
    async importDirectory(source: string) {
      const absolute = await realpath(source);
      const errors: string[] = [];
      let direct: LoadedPet | null = null;
      // Codex 导出既可能指向单只宠物，也可能指向 pets/avatars 根；只检查这一层，禁止递归扫描用户目录。
      for (const manifest of [C.manifest, C.legacyManifest]) {
        try {
          direct = await readPack(dirname(absolute), basename(absolute), manifest, decodeImage);
          break;
        } catch {
          /* try root */
        }
      }
      let imported = 0;
      if (direct) {
        await writePack(direct, petsRoot);
        imported++;
      } else {
        const folders = await readdir(absolute, { withFileTypes: true });
        // 逐只导入并释放图片，不把整座宠物库的 base64 同时保留在内存里。
        for (const folder of folders.slice(0, 256)) {
          if ((!folder.isDirectory() && !folder.isSymbolicLink()) || folder.name.startsWith("."))
            continue;
          let pet: LoadedPet | null = null;
          for (const manifest of [C.manifest, C.legacyManifest]) {
            try {
              pet = await readPack(absolute, folder.name, manifest, decodeImage);
              break;
            } catch {
              /* try legacy */
            }
          }
          if (pet) {
            await writePack(pet, petsRoot);
            imported++;
          } else errors.push(folder.name);
        }
      }
      if (!imported && !errors.length) errors.push("No compatible pet manifests found");
      const result = await list();
      return { ...result, errors: [...errors, ...result.errors] };
    },
    async importImage(path: string) {
      const bytes = await boundedRead(path, C.maxImageBytes);
      const { version, image, extension } = validatePetImage(bytes);
      await validateDecodedImage(bytes, version, decodeImage);
      const name = basename(path).replace(/\.[^.]+$/, "");
      await writePack(
        {
          directory: dirname(path),
          bytes,
          image,
          extension,
          entry: {
            id: C.customPrefix + name,
            displayName: name,
            description: null,
            spriteVersionNumber: version,
            updatedAt: Date.now(),
          },
        },
        petsRoot,
      );
      return list();
    },
    async remove(id: string) {
      if (!desktopPetCharacterIdSchema.safeParse(id).success || !id.startsWith(C.customPrefix))
        throw new Error("Only owned custom pets can be removed");
      const folder = id.slice(C.customPrefix.length);
      for (const root of [petsRoot, legacyRoot]) {
        try {
          await containedPath(dataRoot, basename(root));
          await containedPath(root, folder);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        // 删除前 realpath 已证明目标位于指定宠物根；绝不对源 Codex 目录执行删除。
        await rm(resolve(root, folder), { recursive: true });
      }
      generation++;
      return list();
    },
    async exportPet(id: string, destination: string) {
      const pet = await load(id);
      if (!pet) throw new Error("Pet is unavailable");
      const dest = resolve(destination);
      if (
        dest === resolve(petsRoot) ||
        (pet.directory && (isInside(pet.directory, dest) || dest === pet.directory))
      )
        throw new Error("Choose a different export directory");
      await writePack(pet, dest);
    },
    async prepareUpgrade(id: string) {
      const pet = await load(id);
      if (!pet?.directory || !id.startsWith(C.customPrefix) || pet.entry.spriteVersionNumber !== 1)
        throw new Error("Only an available custom v1 pet can be upgraded");
      return { id: pet.entry.id, directoryPath: pet.directory };
    },
    async createTemplate() {
      await mkdir(petsRoot, { recursive: true });
      await containedPath(dataRoot, C.directory);
      const path = join(petsRoot, "README.md");
      const text =
        "# Custom pets / 自定义宠物\n\nCreate a folder with pet.json and a transparent PNG/WebP spritesheet.\n\n```json\n" +
        JSON.stringify(
          { displayName: "My pet", spriteVersionNumber: 2, spritesheetPath: C.spritesheet },
          null,
          2,
        ) +
        "\n```\n\nv1: 1536×1872 (8×9); v2: 1536×2288 (8×11). Cells: 192×208.\nRows: idle, right, left, wave, jump, fail, wait, run, review; v2 adds 16 clockwise look directions (north first).\nCopy a compatible Codex pet folder here and refresh in Settings.\n";
      await writeFile(path, text, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      return path;
    },
  };
}
