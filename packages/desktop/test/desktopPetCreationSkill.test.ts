import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";
import { DESKTOP_PET_CONTRACT } from "@drora/shared";
import { createDesktopPetLibrary } from "../src/main/desktopPetLibrary.js";
import { decodeDesktopPetImage } from "../src/main/desktopPetImageDecoder.js";
// @ts-expect-error Build-time JS asset collector has no declaration file.
import { collectSeaBundledSkillAssets } from "../../../apps/drora-cli/packages/cli/scripts/sea-bundled-skill-assets.mjs";

const cli = resolve(import.meta.dirname, "../../../apps/drora-cli");
const pack = join(cli, "packages/bundled-skills");
const skill = join(pack, "skills", DESKTOP_PET_CONTRACT.creationSkill);
const execute = promisify(execFile);

async function files(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return files(path);
        return [path];
      }),
    )
  ).flat();
}

test("normal Agent skill adapter discovers and loads the bundled pet skill", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "drora-pet-skill-discovery-"));
  try {
    // Compile the unchanged discovery port, as the Agent bundle does, without booting a provider.
    const entry = join(temporary, "skill-port.mjs");
    await build({
      entryPoints: [join(cli, "packages/adapters/src/skills/index.ts")],
      outfile: entry,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
    });
    const { createNodeSkillAdapter } = await import(pathToFileURL(entry).href);
    const adapter = createNodeSkillAdapter();
    const roots = [
      { path: join(pack, "skills"), source: "bundled", scope: "system", priority: 1_000_000 },
    ];
    const discovered = await adapter.discoverSkills({ workingDirectory: temporary, roots });
    const metadata = discovered.skills.find(
      (item: { name: string }) => item.name === DESKTOP_PET_CONTRACT.creationSkill,
    );
    assert.ok(
      metadata,
      "create-pet must be visible to the same discovery adapter as runtime skills",
    );
    assert.equal(metadata.source, "bundled");
    const loaded = await adapter.loadSkill({
      name: DESKTOP_PET_CONTRACT.creationSkill,
      workingDirectory: temporary,
      roots,
    });
    assert.equal(loaded.baseDirectory, skill);
    assert.equal(loaded.truncated, false);
    assert.match(loaded.content, /publish_pet\.py/);
    for (const match of loaded.content.matchAll(/\]\((references\/[^)]+)\)/gu)) {
      const reference = await readFile(join(skill, match[1]), "utf8");
      assert.ok(reference.length > 0, `Missing skill reference ${match[1]}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("SEA collection retains the complete pet skill and verified upstream license/helpers", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "drora-pet-skill-sea-"));
  try {
    const collected = await collectSeaBundledSkillAssets({
      root: cli,
      stagingDirectory: join(temporary, "stage"),
    });
    const actual = new Set(collected.manifest.files.map((entry: { path: string }) => entry.path));
    for (const path of await files(skill)) {
      const relative = path.slice(pack.length + 1).replaceAll("\\", "/");
      assert.ok(actual.has(relative), `SEA lost ${relative}`);
    }
    const provenance = JSON.parse(await readFile(join(skill, "provenance.json"), "utf8"));
    for (const upstream of provenance.upstreamFiles) {
      const bytes = await readFile(join(skill, upstream.path));
      if (upstream.path === "scripts/prepare_pet_run.py")
        assert.match(bytes.toString(), /Modified by Drora:/);
      else
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          upstream.sha256,
          upstream.path,
        );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("publisher output loads through the production desktop library", async (context) => {
  const python = process.env.PYTHON;
  if (!python)
    return context.skip("Set PYTHON to an interpreter with Pillow for the processing integration");
  const temporary = await mkdtemp(join(tmpdir(), "drora-pet-skill-published-"));
  try {
    const run = join(temporary, "run");
    const root = join(temporary, "home/.drora");
    const script = [
      "import runpy,sys",
      "from pathlib import Path",
      "fixture=runpy.run_path(sys.argv[1])",
      "fixture['create_reviewed_run'](Path(sys.argv[2]))",
      "fixture['PUBLISHER'].publish(Path(sys.argv[2]),Path(sys.argv[3]))",
    ].join("\n");
    await execute(
      python,
      ["-B", "-c", script, join(skill, "tests/test_publish_pet.py"), run, join(root, "pets")],
      { timeout: 120_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    const library = createDesktopPetLibrary(root, decodeDesktopPetImage);
    const catalog = await library.list();
    assert.equal(catalog.pets.length, 1);
    assert.deepEqual(catalog.errors, []);
    const pet = await library.load(catalog.pets[0].id);
    assert.equal(pet?.entry.spriteVersionNumber, 2);
    assert.equal(dirname(pet!.directory!), join(root, "pets"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("prepare emits the thirteen-job dependency graph, prompts and real layout guides", async (context) => {
  const python = process.env.PYTHON;
  if (!python)
    return context.skip("Set PYTHON to an interpreter with Pillow for preparation integration");
  const temporary = await mkdtemp(join(tmpdir(), "drora-pet-skill-prepare-"));
  try {
    const run = join(temporary, "run with spaces");
    await execute(
      python,
      [
        "-B",
        join(skill, "scripts/prepare_pet_run.py"),
        "--pet-name",
        "Blue Bird",
        "--pet-notes",
        "A small blue bird with a red beak",
        "--output-dir",
        run,
      ],
      { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
    const request = JSON.parse(await readFile(join(run, "pet_request.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(run, "imagegen-jobs.json"), "utf8"));
    assert.equal(request.sprite_version_number, 2);
    assert.equal(manifest.jobs.length, 13);
    const jobs = new Map(manifest.jobs.map((job: { id: string }) => [job.id, job]));
    assert.ok(
      (jobs.get("look-row-10") as { depends_on: string[] }).depends_on.includes("look-row-9"),
    );
    for (const guide of request.layout_guides)
      assert.ok((await readFile(join(run, guide.path))).length > 0);
    for (const job of manifest.jobs)
      assert.ok((await readFile(resolve(run, job.prompt_file), "utf8")).trim().length > 0);
    assert.equal(manifest.primary_generation_skill, "enabled-image-generation-tool");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
