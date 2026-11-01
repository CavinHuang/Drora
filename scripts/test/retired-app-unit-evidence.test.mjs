import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  inspectRetiredAppUnitEvidence,
  inspectCoverageMatrices,
  loadRetainedTestFiles,
} from "../lib/retired-app-unit-evidence.mjs";

const unit = "packages/ui/test/example.test.ts";
const e2e = "packages/desktop/test/e2e/conversation-session/example.test.ts";
const options = { engineeringTests: new Set(["packages/desktop/test/fixture.test.ts"]) };

test("retired evidence is rejected in prose, arbitrary aliases and extended case IDs", () => {
  for (const text of [
    `正文由 \`${unit}\` 覆盖`,
    `| \`LONG\` | \`${unit}\` |`,
    `| M06g | unit | \`${unit}\` | behavior |`,
  ])
    assert.ok(inspectRetiredAppUnitEvidence(text, options).length > 0, text);
});

test("retirement notes cannot keep a positive status backed only by retired evidence", () => {
  for (const status of ["unit", "covered", "partial", "covered-unit"]) {
    assert.ok(
      inspectRetiredAppUnitEvidence(
        `| M06g | ${status} | \`retired:${unit}\` | behavior |`,
        options,
      ).length > 0,
    );
    assert.ok(
      inspectRetiredAppUnitEvidence(
        `| \`LONG\` | \`retired:${unit}\` |\n| CASE-01 | ${status} | LONG | behavior |`,
        options,
      ).length > 0,
    );
  }
});

test("historical labels, planned E2E and retained CLI CUA browser engineering evidence remain valid", () => {
  const markdown = [
    `历史：\`retired:${unit}\`，2026-01-01 通过 3/3。`,
    `| M06g | unit-retired | \`retired:${unit}\` | 待补 E2E |`,
    `| M06o | partial | \`retired:${unit}\` + \`${e2e}\` | remaining E2E |`,
    `| \`LONG\` | \`${e2e}\`（planned） |`,
    "`apps/drora-cli/packages/core/tests/read-tool-contract.test.ts`",
    "`packages/zcode-cua/test/example.test.ts`",
    "`packages/ui/test/browser/manual-review/pending/example.test.mjs`",
    "`packages/desktop/test/fixture.test.ts`",
  ].join("\n");
  assert.deepEqual(inspectRetiredAppUnitEvidence(markdown, options), []);
});

test("all current coverage matrices stop claiming retired App evidence", async () => {
  const errors = await inspectCoverageMatrices();
  assert.deepEqual(errors, []);
});

test("planned prose cannot stand in for retained evidence", () => {
  assert.ok(
    inspectRetiredAppUnitEvidence(
      `| CASE-01 | covered | \`retired:${unit}\` + E2E 待补 | behavior |`,
      options,
    ).length > 0,
  );
});

test("retirement cannot relabel protected CLI CUA browser E2E or engineering evidence", () => {
  for (const path of [
    e2e,
    "apps/drora-cli/packages/core/tests/read-tool-contract.test.ts",
    "packages/zcode-cua/test/example.test.ts",
    "packages/ui/test/browser/example.test.mjs",
    "packages/desktop/test/fixture.test.ts",
  ]) {
    assert.ok(
      inspectRetiredAppUnitEvidence(
        `| CASE-01 | unit-retired | \`retired:${path}\` | behavior |`,
        options,
      ).length > 0,
      path,
    );
  }
});

// Drora 保留面（D01）：engineering/drora/drora-isolated 清单与 node:test 发现集
// 共同构成仍执行的证据面；上游退役项必须真的已删除，不能被保留面吸收。
test("drora retained surface is discoverable and upstream-retired files stay deleted", async () => {
  const retained = await loadRetainedTestFiles();
  // drora 显式保留清单成员（vitest drora 工程）可被发现。
  const droraManifest = JSON.parse(readFileSync("scripts/drora-test-files.json", "utf8"));
  for (const sample of [
    "packages/ui/test/thoughtLevelCycleControlSelectionValue.test.ts",
    "packages/desktop/test/desktopPetPersonaExpression.test.ts",
  ]) {
    assert.ok(droraManifest.includes(sample), `drora manifest should list ${sample}`);
    assert.ok(retained.has(sample), `retained surface should discover ${sample}`);
    assert.equal(
      inspectRetiredAppUnitEvidence(`| CASE-01 | unit | \`${sample}\` | behavior |`, {
        engineeringTests: retained,
      }).length,
      0,
      sample,
    );
  }
  // node:test 发现集成员（test:unit:node 执行）不在 vitest 清单内，也必须可被发现。
  const nodeTestSample = "packages/mobile-web/test/remoteFrame.test.ts";
  assert.ok(retained.has(nodeTestSample), `retained surface should discover ${nodeTestSample}`);
  assert.equal(
    inspectRetiredAppUnitEvidence(`| CASE-01 | unit | \`${nodeTestSample}\` | behavior |`, {
      engineeringTests: retained,
    }).length,
    0,
  );
  // 上游退役且本地未修改的 App 业务单测已随上游删除（文件不存在），引用必须标记 retired。
  for (const retiredPath of [
    "packages/ui/test/UnifiedBrowserView.test.ts",
    "packages/desktop/test/desktopNetworkPolicy.test.ts",
    "packages/desktop/test/browserGuestManager.test.ts",
    "packages/desktop/test/browserCommandExecutor.test.ts",
    "packages/ui/test/nodeReplToolCallBlockInteraction.test.ts",
    "packages/ui/test/markdownImageGallery.test.ts",
  ]) {
    assert.ok(!existsSync(retiredPath), `${retiredPath} should have been deleted with upstream`);
    assert.ok(!retained.has(retiredPath), `${retiredPath} must not be absorbed into retained set`);
    assert.ok(
      inspectRetiredAppUnitEvidence(`自动化：\`${retiredPath}\``, {
        engineeringTests: retained,
      }).length > 0,
      retiredPath,
    );
  }
});
