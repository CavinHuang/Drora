#!/usr/bin/env node
// D01：生成 Drora 保留测试双清单（specs/upstream-v3.17.1-migration.md §6.1）。
//
// drora-test-files.json = 当前仍在执行的全部业务回归（旧 unit 工程语义：
// packages/*/test/**、模块 contract.test.ts、显式登记项），减去上游本轮
// 已退役且本地未修改者（ledger D 行 delete-review 且 ours==T(B)，将由各段
// 随上游删除）。
// drora-isolated-test-files.json = 旧 fork-isolated 工程清单（真实进程/发布类
// 串行隔离语义保持不变，drora 侧第二工程）。
// 各段删除测试后重跑本脚本收敛；S6 冻结终态。

import { globSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";

const root = process.cwd();
const LEDGER = "docs/upstream-sync/2026-10-31-v3.17.1/upstream-ledger.tsv";

// 上游退役且本地未改 → 不进保留清单（保留集只含自研/本地修改过的回归）。
const retiring = new Set();
if (existsSync(LEDGER)) {
  const [header, ...lines] = readFileSync(LEDGER, "utf8").split("\n");
  const col = Object.fromEntries(header.split("\t").map((h, i) => [h, i]));
  for (const line of lines.filter((l) => l.trim())) {
    const c = line.split("\t");
    if (c[col.change] === "D" && c[col.current_main_dryrun] === "delete-review") {
      retiring.add(c[col.drora_path].replaceAll("\\", "/"));
    }
  }
}

const norm = (files) => [...new Set(files.map((f) => f.replaceAll("\\", "/")))].filter(Boolean).sort();

const forkIsolated = norm([
  "packages/services/test/processTreeTerminator.test.ts",
  "packages/services/test/droraAgentService.test.ts",
  "packages/services/test/droraAgentService.v4.test.ts",
  "packages/services/test/droraAgentProcessManager.test.ts",
  "packages/services/test/droraStdioTransport.test.ts",
  "packages/desktop/test/r3RemoteProcess.test.ts",
  "packages/provider-node/test/personal-config-read-lock.test.ts",
  "packages/services/src/gen-ui/adapters/stateStorage.test.ts",
  "packages/desktop/test/windowsInstallerCompile.test.ts",
  "packages/desktop/test/cdnPreloadScript.test.ts",
  "packages/desktop/test/desktopRuntimeEnv.test.ts",
  "packages/desktop/test/e2eDesktopBuildCache.test.ts",
  "packages/desktop/test/e2eSummarySpecCoverage.test.ts",
  "packages/desktop/test/migrateStableFeedScript.test.ts",
  "packages/desktop/test/pluginE2EAdmissionScripts.test.ts",
  "packages/desktop/test/uploadOssScript.test.ts",
  "packages/desktop/test/notarizeMacosScript.test.ts",
  "packages/desktop/test/publishReleaseScript.test.ts",
  "packages/web/test/remoteFrontendBuildSource.test.ts",
  "packages/desktop/test/dev-cua-plugin-runtime.test.ts",
  "packages/desktop/test/webRemoteControlTransport.test.ts",
  "packages/web/test/webRemoteControlTransport.test.ts",
  "packages/provider-node/test/builtin-provider-build.test.ts",
  "packages/provider-node/test/builtin-provider-test-config-sync.test.ts",
  "packages/server/test/remoteDeploy.test.ts",
  "packages/services/test/gitService.test.ts",
  "packages/services/test/gitCheckpointService.test.ts",
  "packages/services/test/mcpSyncService.test.ts",
  "packages/services/test/providerRuntimeResolver.test.ts",
  "packages/services/test/runtimeToolResolver.test.ts",
  "packages/drora-server-cli/test/runtimeUpdateIntegration.test.ts",
  "packages/ui/test/pdfJsCMapSupport.test.ts",
]).filter((f) => existsSync(resolve(root, f)));

// node:test 用例由 test:unit:node（node --test）执行，vitest 不重复收录。
const isNodeTest = (file) =>
  /(?:from\s*|import\s*\()(["'])node:test\1/u.test(readFileSync(resolve(root, file), "utf8"));

const explicit = norm([
  "packages/shared/src/contracts/persona-contract.test.ts",
  "packages/shared/src/node/genUiPaths.test.ts",
  "packages/ui/src/voice/AnnouncementIndicator.test.tsx",
  "packages/ui/src/settings/VoiceSection.test.tsx",
  "packages/ui/src/drora-persona/PersonaSettingsSection.test.tsx",
  "packages/ui/src/drora-persona/usePersonaControlAvailability.test.tsx",
  "packages/ui/src/drora-persona/usePersonaPreferences.test.tsx",
  "packages/ui/src/drora-persona/usePersonaLearning.test.tsx",
  "packages/ui/src/web-remote-control/WebRemoteControlRelaySourceSection.test.tsx",
  "packages/ui/src/store/voiceSessionStore.test.ts",
  "packages/ui/src/v4/composer/composerTextAppend.test.ts",
  "packages/ui/src/v4/useComposerTextInsertApplied.test.ts",
  "packages/ui/src/v4/paneEscapeStopGeneration.test.ts",
  "packages/ui/src/prompt-editor/composerEscapePlan.test.ts",
  "scripts/assert-safe-cua-helper-zip.test.mjs",
  "scripts/ci/ci-telemetry-keyword-guard.test.mjs",
  "scripts/test/upstream-apply-ledger.test.mjs",
]).filter((f) => existsSync(resolve(root, f)));

const globbed = norm([
  ...globSync("packages/*/test/**/*.test.ts", { cwd: root }),
  ...globSync("packages/*/src/**/contract.test.ts", { cwd: root }),
  ...globSync("packages/services/src/gen-ui/**/*.test.ts", { cwd: root }),
  ...globSync("packages/ui/src/voice/**/*.test.{ts,tsx}", { cwd: root }),
]);

const droraFiles = [...globbed, ...explicit]
  .filter((f) => !f.startsWith("packages/desktop/test/e2e/"))
  .filter((f) => !f.startsWith("packages/zcode-cua/"))
  .filter((f) => !forkIsolated.includes(f))
  .filter((f) => !isNodeTest(f))
  .filter((f) => !retiring.has(f))
  .sort();

writeFileSync("scripts/drora-test-files.json", JSON.stringify(droraFiles, null, 2) + "\n", "utf8");
writeFileSync("scripts/drora-isolated-test-files.json", JSON.stringify(forkIsolated, null, 2) + "\n", "utf8");
console.log(
  JSON.stringify({ drora: droraFiles.length, isolated: forkIsolated.length, retiringTotal: retiring.size }, null, 1),
);
