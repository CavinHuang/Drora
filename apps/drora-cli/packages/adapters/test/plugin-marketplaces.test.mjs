// 插件市场对齐单测：对 specs/plugin-marketplaces.md 验收场景逐条断言。
// 经 tsx 直接消费 src（@drora/shared 以 TS 源码导出，plain node 无法解析）。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addMarketplace,
  applyClaudePluginIcons,
  ensureDefaultPluginMarketplaces,
  enrichCachedClaudeMarketplaceIcons,
  isSafePluginIconPath,
  loadKnownMarketplacesSync,
  parsePluginIconSources,
} from "../src/plugins/marketplace.js";

const CDN_BASE = "https://cdn-zcode.z.ai/zcode/official-plugin/assets/";

function withTempStorage(test) {
  return async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), "drora-plugin-marketplaces-"));
    try {
      await test(storageRoot);
    } finally {
      rmSync(storageRoot, { recursive: true, force: true });
    }
  };
}

function writeMarketplaceFixture(directory, manifest) {
  mkdirSync(join(directory, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(directory, ".claude-plugin", "marketplace.json"),
    JSON.stringify(manifest, null, 2),
  );
}

// 场景 1：全新 storageRoot 种出 drora + claude 两条 known 记录，claude 走 GitHub shorthand。
const testSeedsTwoDefaultMarketplaces = withTempStorage(async (storageRoot) => {
  const seeded = ensureDefaultPluginMarketplaces(storageRoot);
  assert.deepEqual(
    seeded.map((record) => record.id).sort(),
    ["claude-plugins-official", "drora-plugins-official"],
  );
  const claude = seeded.find((record) => record.id === "claude-plugins-official");
  assert.ok(claude, "claude marketplace record missing");
  assert.equal(claude.source.source, "github");
  assert.equal(claude.source.repo, "anthropics/claude-plugins-official");
  assert.equal(claude.pluginCount, 0);
  // 幂等：再次调用不重复种。
  ensureDefaultPluginMarketplaces(storageRoot);
  assert.equal(loadKnownMarketplacesSync(storageRoot).length, 2);
});

// 场景 2/3：用户侧新增声明任一官方保留 id（canonical/上游别名/claude）一律拒绝，
// 不产生平行官方市场；普通市场名正常通过。
const testReservedMarketplaceIds = withTempStorage(async (storageRoot) => {
  for (const reservedName of [
    "zcode-plugins-official",
    "claude-plugins-official",
    "drora-plugins-official",
  ]) {
    const sourceDirectory = mkdtempSync(join(tmpdir(), "drora-marketplace-src-"));
    try {
      writeMarketplaceFixture(sourceDirectory, { name: reservedName, plugins: [] });
      await assert.rejects(
        addMarketplace({
          source: { source: "directory", path: sourceDirectory },
          storageRoot,
        }),
        (error) =>
          error instanceof Error &&
          error.message.includes("reserved for the official marketplace"),
        `adding a marketplace named ${reservedName} must be rejected`,
      );
    } finally {
      rmSync(sourceDirectory, { recursive: true, force: true });
    }
  }
  assert.deepEqual(loadKnownMarketplacesSync(storageRoot), [], "rejected adds must not persist");

  const benignDirectory = mkdtempSync(join(tmpdir(), "drora-marketplace-src-"));
  try {
    writeMarketplaceFixture(benignDirectory, { name: "acme-market", plugins: [] });
    const record = await addMarketplace({
      source: { source: "directory", path: benignDirectory },
      storageRoot,
    });
    assert.equal(record.id, "acme-market");
    assert.equal(record.pluginCount, 0);
  } finally {
    rmSync(benignDirectory, { recursive: true, force: true });
  }
});

// icon-sources 条目校验：非法字段整条丢弃，合法条目解析为 CDN 绝对 URL。
const testParsePluginIconSources = () => {
  const icons = parsePluginIconSources([
    { name: "good-plugin", icon: "icons/good-plugin.png" },
    { name: "with-sha", icon: "icons/with-sha.png", mimeType: "image/png", sha256: "a".repeat(64) },
    { name: "Bad-Name", icon: "icons/bad.png" },
    { name: "bad-mime", icon: "icons/bad-mime.png", mimeType: "image/jpeg" },
    { name: "bad-sha", icon: "icons/bad-sha.png", sha256: "xyz" },
    { name: "abs-icon", icon: "/etc/passwd.png" },
    { name: "single-segment", icon: "plugin.png" },
    "not-an-object",
  ]);
  assert.deepEqual([...icons.keys()].sort(), ["good-plugin", "with-sha"]);
  assert.equal(icons.get("good-plugin"), `${CDN_BASE}icons/good-plugin.png`);
  assert.equal(parsePluginIconSources(undefined).size, 0);
  assert.equal(parsePluginIconSources({}).size, 0);
};

const testIsSafePluginIconPath = () => {
  assert.equal(isSafePluginIconPath("icons/foo.png"), true);
  assert.equal(isSafePluginIconPath("a/b/c/foo.png"), true);
  assert.equal(isSafePluginIconPath("foo.png"), false, "single segment");
  assert.equal(isSafePluginIconPath("/abs/foo.png"), false, "absolute path");
  assert.equal(isSafePluginIconPath("icons\\foo.png"), false, "backslash");
  assert.equal(isSafePluginIconPath("icons/foo.txt"), false, "not png");
  assert.equal(isSafePluginIconPath("icons/.hidden/foo.png"), false, "dot segment");
};

// icon 注入语义：只补缺失、不覆盖已有、无变化保持引用。
const testApplyClaudePluginIcons = () => {
  const raw = {
    name: "claude-plugins-official",
    plugins: [
      { name: "no-icon", version: "1.0.0" },
      { name: "has-icon", version: "1.0.0", icon: "custom.png" },
      { name: "not-in-map", version: "1.0.0" },
    ],
  };
  const icons = new Map([["no-icon", `${CDN_BASE}icons/no-icon.png`]]);
  const enriched = applyClaudePluginIcons(raw, icons);
  assert.equal(enriched.plugins[0].icon, `${CDN_BASE}icons/no-icon.png`);
  assert.equal(enriched.plugins[1].icon, "custom.png", "existing icon must not be overwritten");
  assert.equal(enriched.plugins[2].icon, undefined);
  assert.equal(enriched.name, raw.name);
  // 无可补条目时返回原对象引用；空 map 直通。
  assert.equal(applyClaudePluginIcons(enriched, icons), enriched);
  assert.equal(applyClaudePluginIcons(raw, new Map()), raw);
};

// 场景 5 前半：claude 市场 manifest 未缓存时启动修补直接跳过（无网络、无写盘）。
const testEnrichSkipsUncachedClaudeMarketplace = withTempStorage(async (storageRoot) => {
  ensureDefaultPluginMarketplaces(storageRoot);
  await enrichCachedClaudeMarketplaceIcons(storageRoot);
  assert.equal(loadKnownMarketplacesSync(storageRoot).length, 2, "enrich must not mutate known");
});

const tests = [
  ["seeds two default marketplaces", testSeedsTwoDefaultMarketplaces],
  ["reserved marketplace ids rejected", testReservedMarketplaceIds],
  ["parsePluginIconSources validation", testParsePluginIconSources],
  ["isSafePluginIconPath validation", testIsSafePluginIconPath],
  ["applyClaudePluginIcons semantics", testApplyClaudePluginIcons],
  ["enrich skips uncached claude marketplace", testEnrichSkipsUncachedClaudeMarketplace],
];

let failed = 0;
for (const [name, test] of tests) {
  try {
    await test();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail - ${name}`);
    console.error(error);
  }
}
if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log(`${tests.length} tests passed`);
