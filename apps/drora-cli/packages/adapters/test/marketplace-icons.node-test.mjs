// 第41轮对齐测试：claude-plugins-official 内置市场补录 + icon-sources 图标索引
// （官方 hdn/wJr 同构）。import 自 src（@drora/shared 以 TS 源码导出，需经 tsx）。
// 第46轮合并注：icon 实现已按「唯一写者」统一到本仓原版对照实现
// （parsePluginIconSources / applyClaudePluginIcons），本文件符号名随之改写，
// 用例语义（含官方 cdn() 的可选字段语义）逐条保留。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ensureDefaultPluginMarketplaces,
  applyClaudePluginIcons,
  parsePluginIconSources,
} from "../src/plugins/marketplace.js";

const ASSETS_BASE = "https://cdn-zcode.z.ai/zcode/official-plugin/assets";

test("parsePluginIconSources 归一化合法条目为 assets 基址绝对 URL", () => {
  const icons = parsePluginIconSources([
    { name: "adobe-for-creativity", icon: "adobe-for-creativity/icon.png", mimeType: "image/png" },
    { name: "with-sha", icon: "with-sha/icon.png", sha256: "a".repeat(64) },
    // sha256 缺省合法、mimeType 缺省合法（官方 cdn() 同款可选语义）
    { name: "minimal", icon: "minimal/icon.png" },
  ]);
  assert.equal(icons.size, 3);
  assert.equal(icons.get("adobe-for-creativity"), `${ASSETS_BASE}/adobe-for-creativity/icon.png`);
  assert.equal(icons.get("minimal"), `${ASSETS_BASE}/minimal/icon.png`);
});

test("parsePluginIconSources 逐条丢弃非法条目", () => {
  const icons = parsePluginIconSources([
    { name: "Upper-Case", icon: "a/icon.png" }, // name 不满足 ^[a-z0-9][a-z0-9._-]{0,127}$
    { name: "no-icon" }, // icon 缺失
    { name: "abs", icon: "/abs/icon.png" }, // 绝对路径
    { name: "back", icon: "a\\b.png" }, // 反斜杠
    { name: "one-seg", icon: "icon.png" }, // 少于两段
    { name: "traverse", icon: "a/../b/icon.png" }, // ".." 段不满足段正则
    { name: "webp", icon: "a/icon.webp" }, // 非 png
    { name: "bad-mime", icon: "a/icon.png", mimeType: "image/jpeg" },
    { name: "bad-sha", icon: "a/icon.png", sha256: "xyz" },
    { name: "ok", icon: "ok/icon.png" },
  ]);
  assert.equal(icons.size, 1);
  assert.ok(icons.has("ok"));
});

test("parsePluginIconSources 非数组输入返回空索引", () => {
  assert.equal(parsePluginIconSources(undefined).size, 0);
  assert.equal(parsePluginIconSources({}).size, 0);
  assert.equal(parsePluginIconSources("nope").size, 0);
});

test("applyClaudePluginIcons 只补缺失/空白 icon，无变更返回原引用", () => {
  const icons = new Map([
    ["a", `${ASSETS_BASE}/a/icon.png`],
    ["b", `${ASSETS_BASE}/b/icon.png`],
  ]);
  const raw = {
    name: "claude-plugins-official",
    plugins: [
      { name: "a" },
      { name: "b", icon: "" },
      { name: "c", icon: "existing.png" },
      { name: "d" },
    ],
  };
  const merged = applyClaudePluginIcons(raw, icons);
  assert.equal(merged.plugins[0].icon, `${ASSETS_BASE}/a/icon.png`);
  assert.equal(merged.plugins[1].icon, `${ASSETS_BASE}/b/icon.png`); // 空白 + 索引命中 → 补
  assert.equal(merged.plugins[2].icon, "existing.png"); // 已有不覆盖
  assert.equal(merged.plugins[3].icon, undefined); // 索引无命中 → 保持缺失

  // 空索引与无命中场景返回原对象引用
  assert.equal(applyClaudePluginIcons(raw, new Map()), raw);
  const noHitRaw = { name: "claude-plugins-official", plugins: [{ name: "zzz" }] };
  assert.equal(applyClaudePluginIcons(noHitRaw, icons), noHitRaw);
});

test("ensureDefaultPluginMarketplaces 补录两个内置市场且幂等", () => {
  const root = mkdtempSync(join(tmpdir(), "marketplace-icons-test-"));
  try {
    const first = ensureDefaultPluginMarketplaces(root);
    const ids = first.map((record) => record.id).sort();
    assert.deepEqual(ids, ["claude-plugins-official", "drora-plugins-official"]);

    const claude = first.find((record) => record.id === "claude-plugins-official");
    assert.equal(claude.source.source, "github");
    assert.equal(claude.source.repo, "anthropics/claude-plugins-official");

    const persisted = JSON.parse(readFileSync(join(root, "known_marketplaces.json"), "utf8"));
    assert.equal(persisted.version, 1);
    assert.equal(persisted.marketplaces.length, 2);

    // 幂等：第二次调用不重复追加
    const second = ensureDefaultPluginMarketplaces(root);
    assert.equal(second.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
