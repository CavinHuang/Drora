/* oxlint-disable max-lines -- Ordered native scenarios share one isolated Electron lifecycle; keeping the driver together preserves cleanup and evidence sequencing. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { _electron } from "playwright-core";
import sharp from "sharp";
import { collectRuntimeModuleClosureEntries } from "../../../../../scripts/runtime-dependency-closure.mjs";
import { createDesktopPetSharpPackaging } from "../../../../../scripts/desktop-pet-sharp-packaging.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "../../../../..");
const root = await mkdtemp(join(tmpdir(), "drora-pet-parity-"));
// Optional local reference packs are test-only inputs and never shipped as resources.
const referenceIndex = process.argv.indexOf("--codex-reference-root");
const referenceRoot = referenceIndex >= 0 ? resolve(process.argv[referenceIndex + 1]) : null;
const referenceNames = referenceRoot
  ? (await readdir(referenceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];
const artifacts = join(desktop, ".e2e-artifacts", `pet-parity-${Date.now()}`);
const out = join(artifacts, "app");
await mkdir(artifacts, { recursive: true });
await Promise.all([
  build({
    entryPoints: [join(here, "codex-pet.harness.ts")],
    outfile: join(out, "main", "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["electron", "sharp"],
    logLevel: "warning",
  }),
  build({
    entryPoints: {
      desktopPet: join(desktop, "src/preload/desktopPet.ts"),
      "pet-source": join(here, "pet-source.preload.ts"),
    },
    outdir: join(out, "preload"),
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
    logLevel: "warning",
  }),
]);
const cells = [];
for (let row = 0; row < 11; row++)
  for (let column = 0; column < 8; column++) {
    // 跳跃帧刻意改变轮廓，验证静止鼠标不会因逐帧 alpha 命中变化而反复退出 hover。
    const radius = row === 4 && column % 2 === 1 ? 28 : 65;
    const svg = `<svg width="192" height="208" xmlns="http://www.w3.org/2000/svg"><ellipse cx="96" cy="112" rx="${radius}" ry="70" fill="hsl(${row * 32},60%,60%)"/><circle cx="${64 + column * 8}" cy="92" r="10" fill="white"/></svg>`;
    cells.push({ input: Buffer.from(svg), left: column * 192, top: row * 208 });
  }
const image = await sharp({
  create: { width: 1536, height: 2288, channels: 4, background: "#0000" },
})
  .composite(cells)
  .png()
  .toBuffer();
for (const version of [1, 2]) {
  const pack = join(root, "pets", `test-v${version}`);
  await mkdir(pack, { recursive: true });
  await writeFile(
    join(pack, "pet.json"),
    JSON.stringify({
      displayName: `Test V${version}`,
      spriteVersionNumber: version,
      spritesheetPath: "sheet.png",
    }),
  );
  await sharp(image)
    .extract({ left: 0, top: 0, width: 1536, height: version === 1 ? 1872 : 2288 })
    .png()
    .toFile(join(pack, "sheet.png"));
}
const corruptPack = join(root, "pets", "corrupt");
for (const name of referenceNames) {
  assert.ok(
    !["test-v1", "test-v2", "corrupt"].includes(name),
    "Reference name collides with a fixture",
  );
  await cp(join(referenceRoot, name), join(root, "pets", name), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
await mkdir(corruptPack, { recursive: true });
await writeFile(
  join(corruptPack, "pet.json"),
  JSON.stringify({ spriteVersionNumber: 2, spritesheetPath: "sheet.png" }),
);
await writeFile(join(corruptPack, "sheet.png"), image.subarray(0, 33));
await writeFile(join(artifacts, "fixture.json"), JSON.stringify({ root, out }, null, 2));
if (process.argv.includes("--prepare-only")) {
  console.log(JSON.stringify({ root, out, artifacts }));
  process.exit(0);
}
const require = createRequire(import.meta.url);
let launchEntry = join(out, "main", "index.mjs");
if (process.argv.includes("--packaged")) {
  const policy = createDesktopPetSharpPackaging(
    `${process.platform}-${process.arch}`,
    require("sharp/package.json").optionalDependencies,
  );
  const entries = policy.filterRuntimeModules(
    collectRuntimeModuleClosureEntries(["sharp"], [desktop, resolve(desktop, "../..")]),
  );
  for (const entry of entries)
    await cp(entry.sourceModulePath, join(out, "node_modules", entry.moduleName), {
      recursive: true,
      dereference: true,
    });
  await writeFile(
    join(out, "package.json"),
    JSON.stringify({ name: "drora-pet-packaged-fixture", main: "main/index.mjs", type: "module" }),
  );
  const { createPackageWithOptions } = require("@electron/asar");
  launchEntry = join(artifacts, "app.asar");
  const unpackDirs = policy.unpackPatterns.map((pattern) => pattern.replace(/\/\*\*$/, ""));
  await createPackageWithOptions(out, launchEntry, {
    unpack: "*.{node,dll,dylib,so,exe}",
    unpackDir: unpackDirs.length === 1 ? unpackDirs[0] : `{${unpackDirs.join(",")}}`,
  });
  await writeFile(
    join(artifacts, "packaged-runtime.json"),
    JSON.stringify(
      { modules: entries.map((entry) => entry.moduleName), unpack: policy.unpackPatterns },
      null,
      2,
    ),
  );
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  executablePath: require("electron"),
  args: [launchEntry, root],
  env,
  timeout: 30000,
});
let childOutput = "";
application.process().stderr?.on("data", (chunk) => {
  childOutput = (childOutput + String(chunk)).slice(-12000);
});
const reports = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const main = (fn, argument) => application.evaluate(fn, argument);
const state = () => main(() => globalThis.petParityHarness.state());
const setCursor = (point) =>
  main((_electron, value) => globalThis.petParityHarness.setCursor(value), point);
const publish = (value) =>
  main((_electron, value) => globalThis.petParityHarness.publish(value), value);
const update = (value) =>
  main((_electron, value) => globalThis.petParityHarness.update(value), value);
const until = async (fn, message) => {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await delay(40);
  }
  throw new Error(message);
};
const document = (type) =>
  until(async () => {
    for (const page of application.windows()) {
      try {
        if ((await page.locator("body").getAttribute("data-pet-document")) === type) return page;
      } catch {
        /* loading */
      }
    }
  }, `Missing ${type} window`);
const check = async (name, operation) => {
  await operation();
  reports.push({ name, passed: true });
  console.log(`PASS ${name}`);
};
const target = {
  workspacePath: "C:/fixture",
  workspaceIdentity: "ssh:fixture",
  remoteSessionId: "fixture-remote",
  sessionId: "fixture-session",
};
const snapshot = (revision = 1) => ({
  mode: "attention",
  activeCount: 0,
  attentionCount: 1,
  target,
  activities: [
    {
      target,
      title: "<img src=x onerror=alert(1)>",
      mode: "attention",
      preview: "Synthetic assistant preview",
      revision,
    },
  ],
});
try {
  let pet = await document("pet");
  await pet.locator('#pet[data-ready="true"]').waitFor();
  const bounds = async () =>
    (await state()).windows.find((window) => window.owned && window.title === "Drora — Pet").bounds;
  const clickPet = async (dx = 0, dy = 0) => {
    const b = await bounds();
    const point = { x: b.x + 64, y: b.y + 70 };
    await setCursor(point);
    await delay(70);
    await pet.mouse.move(64, 70);
    await pet.mouse.down();
    if (dx || dy) {
      await setCursor({ x: point.x + dx, y: point.y + dy });
      await pet.mouse.move(64 + dx, 70 + dy);
    }
    await pet.mouse.up();
  };
  await check("v2 decoded at native aspect ratio; no native drag handle", async () => {
    assert.equal(await pet.locator("#pet-art").getAttribute("data-pet-id"), "custom:test-v2");
    assert.equal(
      await pet.locator("#pet").evaluate((element) => element.offsetHeight),
      Math.ceil((112 * 208) / 192),
    );
    assert.ok(
      (await bounds()).height >= Math.ceil((112 * 208) / 192) + 8,
      "Native minimum tracking size must not clip the CSS sprite",
    );
    assert.equal(await pet.locator("#grab").count(), 0);
  });
  await check(
    "transparent pixels pass input through and opaque pixels restore interaction",
    async () => {
      const b = await bounds();
      await setCursor({ x: b.x + 12, y: b.y + 12 });
      await until(
        async () =>
          (await state()).windows.find((window) => window.title === "Drora — Pet").ignored === true,
        "Transparent pixels did not pass through",
      );
      await setCursor({ x: b.x + 64, y: b.y + 70 });
      await until(
        async () =>
          (await state()).windows.find((window) => window.title === "Drora — Pet").ignored ===
          false,
        "Opaque sprite stayed ignored",
      );
      await until(
        async () => (await pet.locator("#pet-art").getAttribute("data-state")) === "jumping",
        "Hover did not jump",
      );
    },
  );
  const art = pet.locator("#pet-art");
  const expectPose = async (animation, row) => {
    await until(
      async () =>
        (await art.getAttribute("data-state")) === animation &&
        (row == null || (await art.getAttribute("data-row")) === String(row)),
      `Expected ${animation}${row == null ? "" : ` on row ${row}`}`,
    );
  };
  const pointerAt = async (x, y) => {
    const b = await bounds();
    await setCursor({ x: b.x + x, y: b.y + y });
  };
  const modeProjection = (mode) => ({
    mode,
    activeCount: mode === "working" ? 1 : 0,
    attentionCount: mode === "attention" ? 1 : 0,
  });
  for (const version of [1, 2]) {
    await update({ desktopPetCharacter: `custom:test-v${version}` });
    await until(
      async () => (await art.getAttribute("data-pet-id")) === `custom:test-v${version}`,
      "Hover fixture version did not load",
    );
    await check(`v${version} hover enters and leaves every task animation`, async () => {
      for (const [mode, animation, row] of [
        ["idle", "idle", 0],
        ["working", "running", 7],
        ["attention", "waiting", 6],
        ["completed", "review", 8],
        ["error", "failed", 5],
      ]) {
        await pointerAt(-40, -40);
        await publish(modeProjection(mode));
        const lookAllowed = version === 2 && ["idle", "working"].includes(mode);
        await expectPose(animation, lookAllowed ? null : row);
        await pointerAt(64, 70);
        await expectPose("jumping", 4);
        await until(
          async () => Number(await art.getAttribute("data-column")) > 0,
          "Hover jump did not animate",
        );
        await pointerAt(-40, -40);
        await expectPose(animation, lookAllowed ? null : row);
        if (lookAllowed)
          await until(
            async () => Number(await art.getAttribute("data-row")) >= 9,
            "Leaving hover did not resume v2 pointer look",
          );
      }
    });
    await check(
      `v${version} hover survives silhouette/task changes and excludes badge`,
      async () => {
        await publish(modeProjection("attention"));
        await expectPose("waiting", 6);
        await pointerAt(33, 70);
        await expectPose("jumping", 4);
        await until(
          async () => (await art.getAttribute("data-column")) === "1",
          "Narrow silhouette frame did not render",
        );
        assert.equal(await art.getAttribute("data-state"), "jumping");
        await publish(modeProjection("error"));
        await until(
          async () => (await pet.locator("#pet").getAttribute("data-mode")) === "error",
          "Task update did not arrive during hover",
        );
        await expectPose("jumping", 4);
        await pointerAt(-40, -40);
        await expectPose("failed", 5);
        await pointerAt(64, 70);
        await expectPose("jumping", 4);
        await publish(modeProjection("attention"));
        const badge = await pet.locator("#badge").boundingBox();
        assert.ok(badge, "Attention badge must be visible");
        await pointerAt(badge.x + badge.width / 2, badge.y + badge.height / 2);
        await expectPose("waiting", 6);
      },
    );
    await check(
      `v${version} drag overrides hover; release and reduced motion restore jump`,
      async () => {
        for (const [dx, animation, row] of [
          [16, "running-right", 1],
          [-16, "running-left", 2],
        ]) {
          await pointerAt(64, 70);
          await expectPose("jumping", 4);
          await pet.mouse.move(64, 70);
          await pet.mouse.down();
          await pointerAt(64 + dx, 70);
          await pet.mouse.move(64 + dx, 70);
          await expectPose(animation, row);
          await pet.mouse.up();
          await expectPose("jumping", 4);
        }
        await pet.emulateMedia({ reducedMotion: "reduce" });
        await expectPose("jumping", 4);
        assert.equal(await art.getAttribute("data-column"), "0");
        await pointerAt(-40, -40);
        await expectPose("waiting", 6);
        await pointerAt(64, 70);
        await expectPose("jumping", 4);
        assert.equal(await art.getAttribute("data-column"), "0");
        await pet.emulateMedia({ reducedMotion: "no-preference" });
      },
    );
  }
  await publish(snapshot());
  await check("3px diagonal jitter remains a click and opens an escaped task tray", async () => {
    const before = await bounds();
    await clickPet(3, 3);
    assert.deepEqual(await bounds(), before);
    const tray = await document("tray");
    await tray.locator(".activity-title").waitFor();
    assert.equal(
      await tray.locator(".activity-title").textContent(),
      snapshot().activities[0].title,
    );
    assert.equal(await tray.locator("img").count(), 0);
    await tray.screenshot({ path: join(artifacts, "tray.png") });
  });
  const tray = await document("tray");
  await check(
    "row open preserves workspace and remote identity through the source renderer",
    async () => {
      await tray.locator(".open-task").click();
      await until(
        async () => (await state()).opened.length === 1,
        "Navigation did not reach source renderer",
      );
      assert.deepEqual((await state()).opened[0], target);
    },
  );
  await check(
    "dismiss is local to an activity revision; the next revision resurfaces",
    async () => {
      await clickPet();
      await tray.locator(".dismiss").click();
      await until(async () => (await tray.locator(".activity").count()) === 0, "Dismiss failed");
      await publish(snapshot(2));
      await tray.locator(".activity").waitFor();
      await tray.locator("#collapse").click();
      assert.equal(await tray.locator("#collapse").getAttribute("aria-expanded"), "false");
      await tray.locator("#close-tray").click();
    },
  );
  await check("native drag follows cursor and never opens a task on release", async () => {
    const before = await bounds();
    const opened = (await state()).opened.length;
    await clickPet(60, 40);
    await delay(100);
    const after = await bounds();
    assert.equal(after.x, before.x + 60);
    assert.equal(after.y, before.y + 40);
    assert.equal((await state()).opened.length, opened);
    assert.equal(
      (await state()).windows.find((window) => window.title === "Drora — Pet activity").visible,
      false,
    );
  });
  await check(
    "badge drag saves its corner without moving the pet or activating the tray",
    async () => {
      const before = await bounds();
      const box = await pet.locator("#badge").boundingBox();
      await setCursor({
        x: before.x + box.x + box.width / 2,
        y: before.y + box.y + box.height / 2,
      });
      await delay(70);
      await pet.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await pet.mouse.down();
      await setCursor({ x: before.x + 20, y: before.y + 120 });
      await pet.mouse.move(20, 120);
      await pet.mouse.up();
      await until(
        async () =>
          (await state()).saved.some((patch) => patch.desktopPetBadgeCorner === "bottom-start"),
        "Badge corner not persisted",
      );
      assert.deepEqual(await bounds(), before);
      assert.equal(
        (await state()).windows.find((window) => window.title === "Drora — Pet activity").visible,
        false,
      );
    },
  );
  await check(
    "Alt-release snaps the native window; Ctrl-click and cancellation never activate",
    async () => {
      await pet.keyboard.down("Alt");
      await clickPet(40, 20);
      await pet.keyboard.up("Alt");
      const snapped = await bounds();
      assert.ok(Math.abs(snapped.x - 16) <= 1 && Math.abs(snapped.y - 16) <= 1);
      await pet.keyboard.down("Control");
      await clickPet();
      await pet.keyboard.up("Control");
      assert.equal(
        (await state()).windows.find((window) => window.title === "Drora — Pet activity").visible,
        false,
      );
      await pet.mouse.move(64, 70);
      await pet.mouse.down();
      await pet.locator("#pet").dispatchEvent("pointercancel", {
        pointerId: 1,
        screenX: snapped.x + 64,
        screenY: snapped.y + 70,
      });
      await pet.mouse.up();
      assert.equal(
        (await state()).windows.find((window) => window.title === "Drora — Pet activity").visible,
        false,
      );
    },
  );
  await check(
    "badge ignores Ctrl/cancel/lost capture while keyboard activation still works",
    async () => {
      const badge = pet.locator("#badge");
      const box = await badge.boundingBox();
      const b = await bounds();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await setCursor({ x: b.x + x, y: b.y + y });
      await delay(70);
      await pet.mouse.move(x, y);
      await pet.keyboard.down("Control");
      await pet.mouse.down();
      await pet.mouse.up();
      await pet.keyboard.up("Control");
      const visible = async () =>
        (await state()).windows.find((window) => window.title === "Drora — Pet activity").visible;
      assert.equal(await visible(), false, "Ctrl badge click activated the tray");
      for (const event of ["pointercancel", "lostpointercapture"]) {
        await pet.mouse.down();
        await badge.dispatchEvent(event, { pointerId: 1, screenX: b.x + x, screenY: b.y + y });
        await pet.mouse.up();
        assert.equal(await visible(), false, `${event} activated the tray`);
      }
      await badge.press("Enter");
      await until(visible, "Keyboard Enter did not open tray");
      await badge.press("Space");
      await until(async () => !(await visible()), "Keyboard Space did not close tray");
      await pet.mouse.down();
      await pet.mouse.up();
      await until(visible, "Normal badge pointer click did not open tray");
      await tray.locator("#close-tray").click();
    },
  );
  await check("v2 global look, v1 fallback and reduced motion", async () => {
    const b = await bounds();
    await setCursor({ x: b.x + 300, y: b.y + 70 });
    await publish({ mode: "idle", activeCount: 0, attentionCount: 0, activities: [] });
    await until(
      async () => (await pet.locator("#pet-art").getAttribute("data-row")) === "9",
      "v2 look missing",
    );
    await update({ desktopPetCharacter: "custom:test-v1" });
    await until(
      async () => (await pet.locator("#pet-art").getAttribute("data-pet-id")) === "custom:test-v1",
      "v1 selection missing",
    );
    assert.equal(await pet.locator("#pet-art").getAttribute("data-row"), "0");
    await pet.emulateMedia({ reducedMotion: "reduce" });
    for (const [mode, row] of [
      ["attention", "6"],
      ["completed", "8"],
      ["error", "5"],
      ["working", "7"],
    ]) {
      await publish({
        mode,
        activeCount: mode === "working" ? 1 : 0,
        attentionCount: mode === "attention" ? 1 : 0,
      });
      await until(
        async () => (await pet.locator("#pet-art").getAttribute("data-row")) === row,
        `${mode} mapped to the wrong Codex row`,
      );
    }
    await delay(500);
    assert.equal(await pet.locator("#pet-art").getAttribute("data-column"), "0");
    await pet.emulateMedia({ reducedMotion: "no-preference" });
  });
  await check(
    "repeated projections preserve animation progress and three cycles return to idle",
    async () => {
      for (let i = 0; i < 5; i++) {
        await publish({ mode: "working", activeCount: 1, attentionCount: 0 });
        await delay(50);
      }
      assert.ok(
        Number(await pet.locator("#pet-art").getAttribute("data-column")) > 0,
        "Identical updates restarted the track",
      );
      await until(
        async () => (await pet.locator("#pet-art").getAttribute("data-row")) === "0",
        "Three cycles did not join idle playback",
      );
    },
  );
  await check("native context menu exposes selection, size, refresh, folder and hide", async () => {
    await pet.locator("#pet").dispatchEvent("contextmenu");
    await until(
      async () => (await state()).menu?.includes("Hide pet"),
      "Native context menu missing",
    );
    assert.ok((await state()).menu.includes("Choose pet"));
    await main(() => globalThis.petParityHarness.closeMenu());
  });
  await check("library IPC lists previews and rejects auxiliary-window callers", async () => {
    const source = await document("source");
    const result = await source.evaluate(() => window.petTest.manage({ action: "list" }));
    assert.equal(result.pets.length, 2 + referenceNames.length);
    assert.deepEqual(result.errors, ["corrupt"]);
    const preview = await source.evaluate(() =>
      window.petTest.manage({ action: "preview", id: "custom:test-v2" }),
    );
    assert.equal(preview.preview.rows, 11);
    const rejected = await main(async ({ ipcMain, BrowserWindow }) => {
      const auxiliary = BrowserWindow.getAllWindows().find(
        (window) => window.getTitle() === "Drora — Pet",
      );
      let error = null;
      const handler = ipcMain._invokeHandlers.get("drora:desktop-pet-library");
      try {
        await handler({ sender: auxiliary.webContents }, { action: "list" });
      } catch (cause) {
        error = String(cause);
      }
      return error;
    });
    assert.ok(rejected, "Pet must not expose main-window library privileges");
  });
  await check("upgrade IPC resolves owned v1 artwork and rejects built-ins and v2", async () => {
    const source = await document("source");
    const prepared = await source.evaluate(() =>
      window.petTest.manage({ action: "prepare-upgrade", id: "custom:test-v1" }),
    );
    assert.equal(prepared.upgrade.directoryPath, join(root, "pets", "test-v1"));
    for (const id of ["violet", "custom:test-v2", "custom:missing", "custom:../outside"])
      await assert.rejects(() =>
        source.evaluate((id) => window.petTest.manage({ action: "prepare-upgrade", id }), id),
      );
    assert.equal(await pet.locator("#pet-art").getAttribute("data-pet-id"), "custom:test-v1");
  });
  await check("rapid selection and size changes settle on the latest configuration", async () => {
    for (let i = 0; i < 8; i++)
      await update({
        desktopPetCharacter: i % 2 ? "custom:test-v2" : "custom:test-v1",
        desktopPetSize: 80 + i * 10,
      });
    await until(
      async () =>
        (await pet.locator("#pet-art").getAttribute("data-pet-id")) === "custom:test-v2" &&
        Math.abs((await bounds()).width - 166) <= 1,
      "Stale configuration won",
    );
    await pet.screenshot({ path: join(artifacts, "pet.png") });
  });
  await check(
    "all saved built-in selections and imported packs use the same Codex geometry and rows",
    async () => {
      await setCursor({ x: -10000, y: -10000 });
      await pet.emulateMedia({ reducedMotion: "reduce" });
      for (const id of ["violet", "noir", "snow", "ginger", "custom:test-v1", "custom:test-v2"]) {
        await update({ desktopPetCharacter: id, desktopPetSize: 112 });
        await until(
          async () => (await pet.locator("#pet-art").getAttribute("data-pet-id")) === id,
          `Pack ${id} did not load`,
        );
        assert.equal(await pet.locator("#pet").evaluate((element) => element.offsetHeight), 122);
        for (const [mode, row] of [
          ["working", "7"],
          ["attention", "6"],
          ["completed", "8"],
          ["error", "5"],
          ["idle", "0"],
        ]) {
          await publish({
            mode,
            activeCount: mode === "working" ? 1 : 0,
            attentionCount: mode === "attention" ? 1 : 0,
          });
          await until(
            async () => (await pet.locator("#pet-art").getAttribute("data-row")) === row,
            `${id} ${mode} did not use Codex row ${row}`,
          );
        }
        if (!id.startsWith("custom:"))
          await pet.screenshot({ path: join(artifacts, `builtin-${id}.png`) });
      }
      await pet.emulateMedia({ reducedMotion: "no-preference" });
    },
  );
  if (referenceNames.length)
    await check(
      "actual installed Codex WebP atlases render, hover-jump and restore through the production loader",
      async () => {
        await pet.emulateMedia({ reducedMotion: "reduce" });
        for (const name of referenceNames) {
          const id = `custom:${name}`;
          await update({ desktopPetCharacter: id });
          await until(
            async () => (await pet.locator("#pet-art").getAttribute("data-pet-id")) === id,
            `Original Codex pack ${name} did not decode`,
          );
          await publish({ mode: "attention", activeCount: 0, attentionCount: 1 });
          await until(
            async () => (await pet.locator("#pet-art").getAttribute("data-row")) === "6",
            `Original Codex pack ${name} did not render its waiting row`,
          );
          await pet.screenshot({ path: join(artifacts, `codex-reference-${name}.png`) });
          const pack = join(root, "pets", name);
          const manifest = JSON.parse(await readFile(join(pack, "pet.json"), "utf8"));
          const pixels = await sharp(join(pack, manifest.spritesheetPath ?? "spritesheet.webp"))
            .extract({ left: 0, top: 6 * 208, width: 192, height: 208 })
            .ensureAlpha()
            .raw()
            .toBuffer();
          // 原版宠物轮廓不同；从正在显示的 waiting 帧选择真实不透明点，避免硬编码命中空气。
          let hit = null;
          for (let y = 0; y < 208; y++)
            for (let x = 0; x < 192; x++) {
              if (pixels[(y * 192 + x) * 4 + 3] < 128) continue;
              const distance = (x - 96) ** 2 + (y - 104) ** 2;
              if (!hit || distance < hit.distance) hit = { x, y, distance };
            }
          assert.ok(hit, `Original Codex pack ${name} has no visible waiting sprite`);
          const size = await pet.locator("#pet").evaluate((element) => ({
            width: element.offsetWidth,
            height: element.offsetHeight,
          }));
          await pointerAt(
            8 + ((hit.x + 0.5) * size.width) / 192,
            8 + ((hit.y + 0.5) * size.height) / 208,
          );
          await expectPose("jumping", 4);
          await pet.screenshot({ path: join(artifacts, `codex-hover-${name}.png`) });
          await pointerAt(-40, -40);
          await expectPose("waiting", 6);
        }
        await update({ desktopPetCharacter: "custom:test-v2" });
        await pet.emulateMedia({ reducedMotion: "no-preference" });
      },
    );
  await check("multiple windows merge activities and navigate to the original owner", async () => {
    await publish(snapshot(5));
    const other = {
      ...snapshot(6),
      target: { ...target, workspaceIdentity: "ssh:other", remoteSessionId: "other-remote" },
    };
    other.activities = [{ ...other.activities[0], target: other.target, title: "Second window" }];
    const owner = await main(
      async (_electron, value) => globalThis.petParityHarness.publishSecondary(value),
      other,
    );
    await clickPet();
    await until(
      async () => (await tray.locator(".activity").count()) === 2,
      "Another source was overwritten",
    );
    await tray.getByRole("button", { name: /Second window/ }).click();
    await until(
      async () => (await state()).openedOwners.at(-1) === owner,
      "Task opened in the wrong source window",
    );
    assert.equal((await state()).opened.at(-1).workspaceIdentity, "ssh:other");
    await main(() => globalThis.petParityHarness.closeSecondary());
    await clickPet();
    await until(
      async () => (await tray.locator(".activity").count()) === 1,
      "Closing one source cleared other activity",
    );
    await tray.locator("#close-tray").click();
  });
  await check(
    "locale rebuild, light/dark tray and source close keep no stale activity",
    async () => {
      await main(() => globalThis.petParityHarness.setLocale("zh-CN"));
      pet = await document("pet");
      await pet.locator('#pet[data-ready="true"]').waitFor();
      assert.equal(await pet.locator("html").getAttribute("lang"), "zh");
      await publish(snapshot(3));
      await clickPet();
      const translatedTray = await document("tray");
      await translatedTray.locator(".activity").waitFor();
      for (const theme of ["light", "dark"]) {
        await main(({ nativeTheme }, value) => {
          nativeTheme.themeSource = value;
        }, theme);
        // Playwright 默认覆盖 renderer 的颜色模式；显式同步模拟值，验证真实托盘 CSS。
        await translatedTray.emulateMedia({ colorScheme: theme });
        await translatedTray.waitForFunction(
          (dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark,
          theme === "dark",
          { timeout: 5000 },
        );
        assert.equal(
          await translatedTray
            .locator("#tray")
            .evaluate((element) => getComputedStyle(element).backgroundColor),
          theme === "dark" ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
        );
        await translatedTray.screenshot({ path: join(artifacts, `tray-zh-${theme}.png`) });
      }
      await main(() => globalThis.petParityHarness.closeSource());
      await until(
        async () => (await translatedTray.locator(".activity").count()) === 0,
        "Closed source left stale tray rows",
      );
      assert.equal(await pet.locator("#pet").getAttribute("data-mode"), "idle");
    },
  );
  await check("disable closes both windows and disposal removes listeners", async () => {
    await update({ desktopPetEnabled: false });
    await until(
      async () => !(await state()).windows.some((window) => window.owned),
      "Pet window leaked",
    );
    await main(async () => globalThis.petParityHarness.dispose());
    assert.equal(
      await main(({ ipcMain }) => ipcMain.listenerCount("drora:desktop-pet-publish")),
      0,
    );
  });
} catch (error) {
  await writeFile(
    join(artifacts, "failure-process.json"),
    JSON.stringify(
      {
        exitCode: application.process().exitCode,
        signalCode: application.process().signalCode,
        stderr: childOutput,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifacts, "failure-state.json"),
    JSON.stringify(await state().catch(() => null), null, 2),
  );
  reports.push({ passed: false, error: String(error), stack: error.stack });
  for (const [index, page] of application.windows().entries())
    await page.screenshot({ path: join(artifacts, `failure-${index}.png`) }).catch(() => {});
  throw error;
} finally {
  await writeFile(join(artifacts, "report.json"), JSON.stringify({ root, reports }, null, 2));
  await application.close();
  console.log(`Artifacts: ${artifacts}`);
}
