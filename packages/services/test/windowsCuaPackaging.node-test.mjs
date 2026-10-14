import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  finalizePackagedWindowsCuaHelper,
  prepareWindowsCuaHelperAssets,
  resolveWindowsCuaHelperSourceRoot,
  verifyPackagedWindowsCuaHelper,
} from "../../desktop/scripts/windows-cua-helper-assets.mjs";
import { resolveWindowsCuaRuntime } from "../src/cua-permission-broker/windowsCuaDevRuntime.ts";

const WORKSPACE = resolve(import.meta.dirname, "../../..");
const RUNTIME = join(WORKSPACE, "packages/zcode-cua-helper/runtime/cua-helper");
const originalManifest = JSON.parse(await readFile(join(RUNTIME, "runtime-manifest.json"), "utf8"));
const targetPlatform = { os: "win32", arch: "x64", key: "win32-x64" };

test("Windows packaging defaults to the retained Helper rather than the SDK", async () => {
  const sourceRoot = await resolveWindowsCuaHelperSourceRoot({
    servicesPackageRoot: join(WORKSPACE, "packages/services"),
  });
  assert.equal(sourceRoot, RUNTIME);
});

test("retained Windows Helper stages into an install tree accepted by the actual Host resolver", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "drora-cua-packaging-"));
  try {
    const staged = await prepareWindowsCuaHelperAssets({
      sourceRoot: RUNTIME,
      outputRoot: join(temporaryRoot, "bundled-tools"),
      targetPlatform,
      electronVersion: originalManifest.electronVersion,
    });
    assert.equal(staged.status, "staged");
    assert.deepEqual(staged.manifest, originalManifest);
    const resourcesDir = join(temporaryRoot, "resources");
    const packagedRoot = join(resourcesDir, "tools/cua-helper");
    await cp(staged.outputDir, packagedRoot, { recursive: true });
    const options = {
      resourcesDir,
      targetPlatform,
      electronVersion: originalManifest.electronVersion,
    };
    assert.equal((await verifyPackagedWindowsCuaHelper(options)).status, "verified");
    const hostOptions = {
      platform: "win32",
      arch: "x64",
      resourcesPath: resourcesDir,
      electronVersion: originalManifest.electronVersion,
    };
    const runtime = await resolveWindowsCuaRuntime(hostOptions);
    assert.equal(runtime.root, packagedRoot);
    assert.equal(runtime.entryPath, join(packagedRoot, originalManifest.entry));

    const addonPath = join(packagedRoot, originalManifest.addon);
    const addonBytes = await readFile(addonPath);
    await writeFile(addonPath, Buffer.concat([addonBytes, Buffer.from("signature-fixture")]));
    await assert.rejects(verifyPackagedWindowsCuaHelper(options), /addon SHA-256 hash mismatch/);
    await assert.rejects(resolveWindowsCuaRuntime(hostOptions), {
      reason: "artifact-integrity-mismatch",
    });
    // 签名会改变 PE 字节；必须经正式 afterPack finalizer 刷新哈希后才能再被 Host 接受。
    assert.equal((await finalizePackagedWindowsCuaHelper(options)).status, "verified");
    assert.equal((await resolveWindowsCuaRuntime(hostOptions)).root, packagedRoot);

    await rm(join(packagedRoot, "node_modules/express"), { recursive: true });
    await assert.rejects(
      verifyPackagedWindowsCuaHelper(options),
      /missing runtime dependency: express/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("an explicit SDK without a Windows runtime contract cannot fall back to retained assets", async () => {
  const sdkRoot = join(WORKSPACE, "packages/zcode-cua");
  const sourceRoot = await resolveWindowsCuaHelperSourceRoot({
    runtimePackageDir: sdkRoot,
    devRoot: RUNTIME,
    servicesPackageRoot: join(WORKSPACE, "packages/services"),
  });
  assert.equal(sourceRoot, sdkRoot);
  await assert.rejects(
    prepareWindowsCuaHelperAssets({
      sourceRoot,
      outputRoot: join(tmpdir(), "drora-invalid-cua-must-not-stage"),
      targetPlatform,
      electronVersion: originalManifest.electronVersion,
    }),
    /droraCuaRuntime is missing/,
  );
});

test("retained x64 PE cannot be packaged as arm64", async () => {
  await assert.rejects(
    prepareWindowsCuaHelperAssets({
      sourceRoot: RUNTIME,
      outputRoot: join(tmpdir(), "drora-invalid-cua-must-not-stage"),
      targetPlatform: { os: "win32", arch: "arm64", key: "win32-arm64" },
      electronVersion: originalManifest.electronVersion,
    }),
    /PE machine mismatch/,
  );
});
