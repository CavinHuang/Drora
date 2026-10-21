import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createDesktopPetSharpPackaging } from "../scripts/desktop-pet-sharp-packaging.mjs";
import { collectRuntimeModuleClosureEntries } from "../scripts/runtime-dependency-closure.mjs";

const require = createRequire(import.meta.url);
const optional = require("sharp/package.json").optionalDependencies;

test("Sharp native pruning retains only the selected platform and its libvips closure", () => {
  for (const target of [
    "win32-x64",
    "win32-arm64",
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
  ]) {
    const policy = createDesktopPetSharpPackaging(target, optional);
    const entries = ["sharp", "@img/colour", ...Object.keys(optional)].map((moduleName) => ({
      moduleName,
      sourceModulePath: "fixture",
    }));
    const selected = policy
      .filterRuntimeModules(entries)
      .filter((entry) => entry.moduleName.startsWith("@img/sharp-"));
    assert.deepEqual(
      selected.map((entry) => entry.moduleName).sort(),
      [
        `@img/sharp-${target}`,
        ...(target.startsWith("win32-") ? [] : [`@img/sharp-libvips-${target}`]),
      ].sort(),
    );
    for (const entry of selected) {
      assert.ok(policy.unpackPatterns.includes(`node_modules/${entry.moduleName}/**`));
      assert.ok(!policy.prunePatterns.includes(`!node_modules/${entry.moduleName}/**`));
    }
    assert.throws(() =>
      policy.filterRuntimeModules(entries.filter((entry) => !entry.moduleName.endsWith(target))),
    );
  }
});

test("installed decoder closure includes the actual target native package", () => {
  const target = `${process.platform}-${process.arch}`;
  const policy = createDesktopPetSharpPackaging(target, optional);
  const entries = collectRuntimeModuleClosureEntries(
    ["sharp"],
    [fileURLToPath(new URL("../", import.meta.url)), process.cwd()],
  );
  const selected = policy.filterRuntimeModules(entries);
  assert.ok(
    selected.find((entry) => entry.moduleName === `@img/sharp-${target}`)?.sourceModulePath,
  );
  assert.ok(selected.find((entry) => entry.moduleName === "detect-libc")?.sourceModulePath);
});
