import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { _electron } from "playwright-core";

// Exercise the actual production Main/extension/preloads, rather than the isolated harness.
// Run build:no-runtime-assets first. This checks pet assembly, not Agent/chat readiness.
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const require = createRequire(import.meta.url);
const root = await mkdtemp(join(tmpdir(), "drora-pet-production-"));
const referenceArg = process.argv.indexOf("--codex-reference-root");
let source = join(desktop, "assets/desktop-pets/violet");
if (referenceArg >= 0) {
  assert.ok(process.argv[referenceArg + 1], "Expected reference root");
  const referenceRoot = resolve(process.argv[referenceArg + 1]);
  const folders = (await readdir(referenceRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(folders.length, "Reference root contains no pet packs");
  source = join(referenceRoot, folders[0]);
}
const manifest = JSON.parse(await readFile(join(source, "pet.json"), "utf8"));
const rows = manifest.spriteVersionNumber === 2 ? 11 : 9;
const data = join(root, ".drora");
await mkdir(join(data, "v2"), { recursive: true });
await mkdir(join(data, "pets"), { recursive: true });
await cp(source, join(data, "pets/production-reference"), { recursive: true });
await writeFile(
  join(data, "v2/setting.json"),
  JSON.stringify({
    desktopPetEnabled: true,
    desktopPetCharacter: "custom:production-reference",
    desktopPetSize: 144,
    locale: "en-US",
  }),
);
const env = {
  ...process.env,
  HOME: root,
  DRORA_DATA_BASE_DIR: root,
  DRORA_DESKTOP_HOME_DIR: root,
  DRORA_DESKTOP_USER_DATA_DIR: join(root, "electron"),
  DRORA_DESKTOP_SESSION_DATA_DIR: join(root, "session"),
  DRORA_DESKTOP_APPLICATION_NAME: "Drora Pet Production Test",
  DRORA_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
// Block desktop installation side effects while importing the unchanged production Main.
// Data-root isolation alone does not isolate Windows protocol/Explorer registration.
const bootstrap = join(root, "bootstrap.cjs");
await writeFile(
  bootstrap,
  `
const childProcess = require("node:child_process");
const spawn = childProcess.spawn;
childProcess.spawn = (command, ...args) => {
  if (process.platform === "win32" && /(?:^|[\\\\/])reg(?:\\.exe)?$/i.test(command))
    throw new Error("Registry installation is disabled in the pet production fixture");
  return spawn(command, ...args);
};
require("node:module").syncBuiltinESMExports();
require("electron").app.setAsDefaultProtocolClient = () => false;
import(${JSON.stringify(pathToFileURL(join(desktop, "out/main/index.js")).href)});
`,
);
let app;
let stderr = "";
const passed = [];
async function petWindow() {
  for (let attempt = 0; attempt < 150; attempt++) {
    for (const page of app.windows())
      if (await page.locator("body[data-pet-document=pet]").count()) return page;
    await delay(100);
  }
  throw new Error("Production pet window did not appear");
}
try {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [bootstrap],
    cwd: desktop,
    env,
    timeout: 30_000,
  });
  app.process().stderr.on("data", (bytes) => {
    stderr = (stderr + bytes.toString()).slice(-16_000);
  });
  let pet = await petWindow();
  await pet.locator('#pet-art[data-pet-id="custom:production-reference"][data-row]').waitFor();
  assert.equal(
    await pet.locator("#pet-art").evaluate((el) => el.style.backgroundSize),
    `800% ${rows * 100}%`,
  );
  assert.equal(
    await pet.locator("#pet-art").evaluate((el) => el.getBoundingClientRect().width),
    144,
  );
  passed.push("persisted custom pack loads through production Main and preload");
  await pet.screenshot({ path: join(root, "production-custom.png") });
  const main = await app
    .waitForEvent("window", {
      predicate: (page) => page.url().startsWith("file:"),
      timeout: 1_000,
    })
    .catch(() => app.windows().find((page) => page.url().startsWith("file:")));
  assert.ok(main, "Main application window is present");
  await main.waitForFunction(() => Boolean(window.drora?.manageDesktopPets));
  const library = await main.evaluate(() => window.drora.manageDesktopPets({ action: "list" }));
  assert.deepEqual(
    library.pets.map((entry) => entry.id),
    ["custom:production-reference"],
  );
  assert.deepEqual(library.errors, []);
  for (const id of ["violet", "noir", "snow", "ginger"]) {
    const result = await main.evaluate(
      (id) => window.drora.manageDesktopPets({ action: "preview", id }),
      id,
    );
    assert.equal(result.preview.id, id);
    assert.equal(result.preview.columns, 8);
    assert.equal(result.preview.rows, 9);
  }
  passed.push("actual main-window library IPC lists imported pack and resolves four built-ins");
  await main.evaluate(() =>
    window.drora.syncAppSettings({ desktopPetCharacter: "snow", desktopPetSize: 224 }),
  );
  await pet.locator('#pet-art[data-pet-id="snow"]').waitFor();
  assert.equal(
    await pet.locator("#pet-art").evaluate((el) => el.style.backgroundSize),
    "800% 900%",
  );
  assert.equal(
    await pet.locator("#pet-art").evaluate((el) => el.getBoundingClientRect().width),
    224,
  );
  passed.push("settings IPC switches to standard built-in and resizes native pet");
  const closed = pet.waitForEvent("close");
  await main.evaluate(() => window.drora.syncAppSettings({ desktopPetEnabled: false }));
  await closed;
  passed.push("settings IPC disables and destroys native pet");
  await main.evaluate(() =>
    window.drora.syncAppSettings({
      desktopPetEnabled: true,
      desktopPetCharacter: "custom:production-reference",
    }),
  );
  pet = await petWindow();
  await pet.locator('#pet-art[data-pet-id="custom:production-reference"][data-row]').waitFor();
  passed.push("settings IPC recreates custom pet with production preload");
  await writeFile(join(root, "result.json"), JSON.stringify({ source, rows, passed }, null, 2));
  console.log(JSON.stringify({ artifacts: root, passed }, null, 2));
} catch (error) {
  console.error(error);
  console.error(stderr);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  console.log(`Artifacts: ${root}`);
}
