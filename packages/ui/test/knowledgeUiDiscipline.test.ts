/**
 * W07 发布前质量门槛：VaultView knowledge UI 的渲染纪律静态核查（A21 的可执行面）。
 *
 * DESIGN.md 强制约束：界面排版只允许 `text-ui-*` 令牌，禁止任意字号
 * （`text-[13px]`、行内 `fontSize`）、禁止改 `html` 根字号；颜色只用语义 token。
 * 本测试对 W04 新增的 knowledge UI 文件做源级回归：任意字号/行内字号/根字号突变/
 * 裸十六进制色值一旦引入即失败；并核查这些组件引用的 i18n 键在 zh-CN / en-US
 * 两语言字典齐全且两语言 `vault.*` 键集合对等（A21 的静态可验证部分；
 * 跨平台真实渲染仍需 GUI 环境，见 W07 交付报告的未执行说明）。
 * 运行：node --import tsx --test packages/ui/test/knowledgeUiDiscipline.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it as test } from "vitest";
import zhCN from "../src/i18n/locales/zh-CN.js";
import enUS from "../src/i18n/locales/en-US.js";
import { COVERAGE_EXCLUSION_FIELDS } from "../src/v4/vault/knowledge/knowledgeInsightsModel.js";

const here = dirname(fileURLToPath(import.meta.url));
const knowledgeDir = join(here, "../src/v4/vault/knowledge");
const knowledgeFiles: string[] = readdirSync(knowledgeDir)
  .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
  .map((name) => join(knowledgeDir, name));
knowledgeFiles.push(join(here, "../src/v4/vault/vault-quote-reveal.ts"));
// ui-know-a-5 修复（2026-10-18 终审）：回答来源面板与引用 Markdown 渲染层是 knowledge
// UI 的渲染纪律在产源码（含 i18n 键与字号/色值约束的适用面），此前不在扫描范围。
knowledgeFiles.push(join(here, "../src/v4/KnowledgeAnswerSources.tsx"));
knowledgeFiles.push(join(here, "../src/lib/knowledgeCitationMarkdown.ts"));

function readSource(file: string): string {
  assert.equal(statSync(file).isFile(), true, `被核查文件必须存在: ${file}`);
  return readFileSync(file, "utf-8");
}

test("A21：knowledge UI 不引入任意字号、行内字号、根字号突变或裸十六进制色值", () => {
  assert.ok(
    knowledgeFiles.length >= 8,
    `应核查全部 knowledge UI 源文件，实际 ${knowledgeFiles.length}`,
  );
  for (const file of knowledgeFiles) {
    const source = readSource(file);
    assert.equal(
      /text-\[\d+px\]/.test(source),
      false,
      `${file} 引入任意字号 text-[..px]（DESIGN.md 只允许 text-ui-* 令牌）`,
    );
    assert.equal(/fontSize\s*:/.test(source), false, `${file} 引入行内 fontSize（DESIGN.md 禁止）`);
    assert.equal(
      /documentElement\.style\.fontSize/.test(source),
      false,
      `${file} 试图改 html 根字号（DESIGN.md 只允许 --ui-font-size）`,
    );
    assert.equal(
      /#[0-9a-fA-F]{6}\b/.test(source),
      false,
      `${file} 引入裸十六进制色值（颜色只用语义 token）`,
    );
  }
});

test("A21：knowledge UI 静态 i18n 键在 zh-CN / en-US 两语言齐全", () => {
  const missing: string[] = [];
  for (const file of knowledgeFiles) {
    const source = readSource(file);
    for (const match of source.matchAll(/formatMessage\(\{\s*id: "([^"]+)"/g)) {
      const id = match[1]!;
      if (!(id in zhCN)) missing.push(`zh-CN 缺失 ${id} (${file})`);
      if (!(id in enUS)) missing.push(`en-US 缺失 ${id} (${file})`);
    }
  }
  assert.deepEqual(missing, [], "所有静态引用的 i18n 键必须两语言齐全");
});

test("A21：动态 i18n 键（意图×4 / 状态条×11 / 顶部 tab×4 / 洞察 exclude×7·jobKind×2·jobStatus×5）两语言齐全", () => {
  // 词表与 knowledgeAskModel.ts 的 KnowledgeAskIntentChoice / KnowledgeAskBannerCode、
  // VaultView.tsx 的 VaultViewTab、services knowledgeTypes 的 KnowledgeIndexJobKind /
  // KnowledgeIndexJobStatus 及 knowledgeInsightsModel.ts 的 COVERAGE_EXCLUSION_FIELDS
  // 一一对应；新增成员必须同步两语言字典（独立复核发现4：insights 动态键此前无门禁）。
  const insightExcludeKeys = COVERAGE_EXCLUSION_FIELDS.map(([key]) => key);
  const dynamicIds = [
    ...["auto", "find", "answer", "compare"].map((choice) => `vault.ask.intent.${choice}`),
    ...[
      "noVault",
      "indexing",
      "indexMissing",
      "indexPartial",
      "semanticUnavailable",
      "sourceStale",
      "noAnswer",
      "expandedSearch",
      "jevOff",
      "cancelled",
      "modelUnavailable",
    ].map((code) => `vault.ask.banner.${code}`),
    ...["notes", "ask", "insights", "review"].map((tab) => `vault.tabs.${tab}`),
    // 会话引用失败/打开反馈两个动态键族（SessionPane/ConversationComposer 模板串拼接，
    // B-8 补登记 2026-10-17；reason 词表须与生产拼接点一致）。
    ...["stale", "missing", "forbidden", "unavailable", "unknown"].map(
      (reason) => `chat.selections.evidenceSend.${reason}`,
    ),
    ...["stale", "missing", "forbidden", "unavailable", "failed"].map(
      (reason) => `chat.selections.evidenceOpen.${reason}`,
    ),
    // 洞察视图的三个动态键族（KnowledgeInsightsView.tsx 模板串拼接）。
    ...insightExcludeKeys.map((key) => `vault.insights.exclude.${key}`),
    ...["reconcile", "rebuild"].map((kind) => `vault.insights.jobKind.${kind}`),
    ...["running", "completed", "cancelled", "failed", "superseded"].map(
      (status) => `vault.insights.jobStatus.${status}`,
    ),
  ];
  const missing = dynamicIds.filter((id) => !(id in zhCN) || !(id in enUS));
  assert.deepEqual(missing, [], "动态模板键必须两语言齐全");
});

test("A21：zh-CN 与 en-US 的 vault.* 键集合对等（新增键不允许单语言落地）", () => {
  const zhVaultKeys = Object.keys(zhCN)
    .filter((id) => id.startsWith("vault."))
    .sort();
  const enVaultKeys = Object.keys(enUS)
    .filter((id) => id.startsWith("vault."))
    .sort();
  assert.ok(zhVaultKeys.length > 0, "vault.* 键必须存在");
  assert.deepEqual(enVaultKeys, zhVaultKeys, "两语言 vault.* 键集合必须一致");
});
