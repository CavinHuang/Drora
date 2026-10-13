import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DRORA_OFFICIAL_PLUGIN_MARKETPLACE, type Logger } from "@drora/contracts";
import {
  findMissingOfficialPluginSeedPaths,
  resolveOfficialPluginRoots,
} from "../src/app/bundled-plugins.js";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.js";

const CUA = OFFICIAL_PLUGIN_DEFINITIONS.find(({ name }) => name === "computer-use");
if (!CUA) throw new Error("missing Computer Use definition");
const SKILL_PATH = "skills/computer-use/SKILL.md";
// 官方 Skill/docs/client 与冻结 SDK 的 package/sharp 是独立验收输入；不能从被测清单生成。
const SEED_CONTENTS = new Map([
  [
    ".zcode-plugin/plugin.json",
    JSON.stringify({ name: CUA.name, version: CUA.version, skills: "skills" }),
  ],
  [SKILL_PATH, "# Computer Use\nUse the Computer Use client.\n"],
  ["docs/computer-use.md", "# Computer Use API\n"],
  ["scripts/computer-use-client.mjs", "export const client = {};\n"],
  ["package.json", JSON.stringify({ name: "computer-use", version: CUA.version })],
  ["node_modules/sharp/package.json", JSON.stringify({ name: "sharp" })],
]);

describe("Computer Use seed completeness", () => {
  const cleanups: string[] = [];
  const originalEntrypoint = process.argv[1];

  afterEach(async () => {
    process.argv[1] = originalEntrypoint;
    vi.restoreAllMocks();
    await Promise.all(cleanups.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  for (const source of ["filesystem", "sea"] as const) {
    for (const existingCache of [false, true]) {
      it(`${source}: rejects a missing Skill with ${existingCache ? "an existing" : "no"} cache`, async () => {
        const root = await mkdtemp(join(tmpdir(), "drora-cua-seed-"));
        cleanups.push(root);
        const storageRoot = join(root, "storage");
        const sourceRoot = join(root, "packages", "zcode-cua-plugin");
        const cacheRoot = join(
          storageRoot,
          "cache",
          DRORA_OFFICIAL_PLUGIN_MARKETPLACE,
          CUA.name,
          CUA.version,
        );
        process.argv[1] = join(root, "drora.cjs");
        let contents = new Map(SEED_CONTENTS);
        if (source === "sea") {
          const getBuiltinModule = process.getBuiltinModule;
          vi.spyOn(process, "getBuiltinModule").mockImplementation((id) => {
            if (id !== "node:sea") return getBuiltinModule(id);
            return {
              isSea: () => true,
              getAsset(key: string) {
                if (key === "drora-official-plugins/manifest.json") {
                  return JSON.stringify({
                    version: 1,
                    hash: "test-manifest",
                    plugins: [
                      {
                        marketplace: DRORA_OFFICIAL_PLUGIN_MARKETPLACE,
                        name: CUA.name,
                        version: CUA.version,
                        files: [...contents].map(([path, content]) => ({
                          path,
                          sha256: createHash("sha256").update(content).digest("hex"),
                        })),
                      },
                    ],
                  });
                }
                throw new Error(`unknown manifest asset: ${key}`);
              },
              getRawAsset(key: string) {
                const prefix = `drora-official-plugins/${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}/${CUA.name}/${CUA.version}/`;
                const content = contents.get(key.slice(prefix.length));
                if (content === undefined) throw new Error(`unknown seed asset: ${key}`);
                return Uint8Array.from(Buffer.from(content)).buffer;
              },
            };
          });
        } else {
          for (const [path, content] of contents) {
            const target = join(sourceRoot, ...path.split("/"));
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, content);
          }
        }

        let previousMarker: string | undefined;
        if (existingCache) {
          resolveOfficialPluginRoots({ storageRoot });
          expect(await readFile(join(cacheRoot, SKILL_PATH), "utf8")).toBe(
            SEED_CONTENTS.get(SKILL_PATH),
          );
          previousMarker = await readFile(join(cacheRoot, ".zcode-plugin-seed.json"), "utf8");
        }
        contents = new Map([...contents].filter(([path]) => path !== SKILL_PATH));
        if (source === "filesystem") await rm(join(sourceRoot, SKILL_PATH));
        const logger: Logger = {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: vi.fn(() => logger),
        };

        expect(() => resolveOfficialPluginRoots({ logger, storageRoot })).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(
          "Official plugin cache operation degraded",
          expect.objectContaining({
            errorCode: "DRORA_PLUGIN_SEED_INCOMPLETE",
            pluginId: `${CUA.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`,
            missingSeedPaths: [SKILL_PATH],
          }),
        );
        if (existingCache) {
          expect(await readFile(join(cacheRoot, SKILL_PATH), "utf8")).toBe(
            SEED_CONTENTS.get(SKILL_PATH),
          );
          expect(await readFile(join(cacheRoot, ".zcode-plugin-seed.json"), "utf8")).toBe(
            previousMarker,
          );
        } else {
          expect(existsSync(cacheRoot)).toBe(false);
        }
      });
    }
  }

  it.each(["package.json", "node_modules/sharp/package.json"])(
    "still rejects a missing frozen SDK runtime file: %s",
    (missingPath) => {
      const files = [...SEED_CONTENTS.keys()]
        .filter((path) => path !== missingPath)
        .map((path) => ({ path }));
      expect(findMissingOfficialPluginSeedPaths(CUA, files)).toEqual([missingPath]);
    },
  );
});
