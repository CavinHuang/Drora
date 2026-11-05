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

const norm = (files) =>
  [...new Set(files.map((f) => f.replaceAll("\\", "/")))].filter(Boolean).sort();

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
  // Drora Mate P2（2026-11-05 门禁平移）：host 内核与 Surface 批次的回归自 drora 并发组
  // 移入串行隔离组（forks pool；node:sqlite 台账与 desktop host overlay 在重隔离下更稳，
  // mate 纯函数单测随批平移保持单组语义一致——门禁统一以 --project drora-fork-isolated
  // 定向执行）。原 P1 先例登记 drora 组，门禁第 1 轮要求 fork-isolated 可跑后平移。
  "packages/services/test/assistantP2Flows.test.ts",
  "packages/services/test/assistantRouterDecision.test.ts",
  "packages/services/test/assistantWriteDomain.test.ts",
  "packages/services/test/assistantTicketsService.test.ts",
  "packages/shared/test/sessionMateActivity.test.ts",
  "packages/desktop/test/windowHostControllerMateOverlay.test.ts",
  "packages/ui/src/mate/view-model.test.ts",
  // Drora Mate P3（2026-11-05）：Source 注册表/统一入口/直通回归随批入串行隔离组
  // （node:sqlite 台账 + 模块级端口 set*，与既有 mate 回归同组语义，门禁以
  // --project drora-fork-isolated 定向执行）。
  "packages/services/test/assistantSourceIngest.test.ts",
  "packages/services/test/assistantSourceRegistry.test.ts",
  // Drora Mate P3 接缝批（2026-11-05）：桌宠桥路由纯核 + tray 速览 DOM 与投影/气泡
  // 纯函数随 mate 回归同组（view-model.test.ts 先例；门禁以 --project drora-fork-isolated
  // 定向执行）。
  "packages/desktop/test/desktopPetMateSeam.test.ts",
  "packages/ui/src/mate/petProjection.test.ts",
  "packages/drora-server-cli/test/runtimeUpdateIntegration.test.ts",
  "packages/ui/test/pdfJsCMapSupport.test.ts",
]).filter((f) => existsSync(resolve(root, f)));

// node:test 用例由 test:unit:node（node --test）执行，vitest 不重复收录。
const isNodeTest = (file) =>
  /(?:from\s*|import\s*\()(["'])node:test\1/u.test(readFileSync(resolve(root, file), "utf8"));

const explicit = norm([
  "packages/shared/src/contracts/persona-contract.test.ts",
  "packages/shared/src/node/genUiPaths.test.ts",
  // packages/*/test 的 glob 只收 .ts；ui/test 下的 .tsx 用例若不显式登记会落出
  // 所有执行通道（baseline-gap#3，RG03 Team 分阶段审批回归）。
  "packages/ui/test/teamConversationSummaryStagedApproval.test.tsx",
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
  // ui/test 下的 .tsx 组件测试：上游 v3.17.1 删除 packages/ui/vitest.config.ts
  // （UP05372）后失去本地执行通道，且 test/ glob 只收 .ts——显式登记防再孤儿化
  // （完成度审查 2026-11-01 发现：knowledgeReviewView 曾因之全通道失执行）。
  "packages/ui/test/knowledgeReviewView.test.tsx",
  "packages/ui/test/teamApprovalDock.test.tsx",
  "packages/ui/test/teamCardInlineFlow.test.tsx",
  "packages/ui/test/teamStatusPanelHalt.test.tsx",
  "scripts/assert-safe-cua-helper-zip.test.mjs",
  "scripts/ci/ci-telemetry-keyword-guard.test.mjs",
  "scripts/test/upstream-apply-ledger.test.mjs",
  // 历史手登条目收敛进生成器（2026-11-05，mate P2 门禁平移时发现）：此前这些文件只手改
  // drora-test-files.json、不在 glob/explicit 覆盖内，重跑生成器会静默丢失执行通道。
  // glob 只收 packages/*/test/** 与 */src/**/contract.test.ts，src 深层与 .tsx 组件测试
  // 需显式登记（同上方 ui/test .tsx 防孤儿化先例）。
  // 注：packages/client/test/remoteServiceAccess.test.ts 同为历史手登，但不在此登记——
  // ledger（2026-10-31 v3.17.1）将其标为 D+delete-review（retiring 过滤优先），而 P1
  // （feat/mate-p1 b454c29d3）在分支上补了 assistantTicketService 能力位断言，静态
  // current_main_dryrun 列不感知分支修改。该条的退役/保留属上游同步战役裁决，不在本批
  // 擅改；JSON 保持手登现状（重跑生成器会移除，需先收敛 ledger）。
  "packages/ui/src/drora-persona/personaPreferencesExportI18n.test.tsx",
  "packages/ui/src/drora-persona/personaSettingsEntryGate.test.tsx",
  "packages/ui/src/drora-persona/usePersonaPresets.test.tsx",
  "packages/ui/src/settings/model-capabilities/ModelCapabilityDetail.test.tsx",
  "packages/ui/src/settings/model-capabilities/capabilityNav.test.tsx",
  "packages/ui/src/mate/i18n.test.ts",
  "packages/ui/src/store/mateStore.test.ts",
]).filter((f) => existsSync(resolve(root, f)));

const globbed = norm([
  ...globSync("packages/*/test/**/*.test.{ts,tsx}", { cwd: root }),
  ...globSync("packages/*/src/**/contract.test.ts", { cwd: root }),
  ...globSync("packages/services/src/gen-ui/**/*.test.ts", { cwd: root }),
  ...globSync("packages/ui/src/voice/**/*.test.{ts,tsx}", { cwd: root }),
]);

const droraFiles = [...new Set([...globbed, ...explicit])]
  .filter((f) => !f.startsWith("packages/desktop/test/e2e/"))
  .filter((f) => !f.startsWith("packages/zcode-cua/"))
  .filter((f) => !forkIsolated.includes(f))
  .filter((f) => !isNodeTest(f))
  .filter((f) => !retiring.has(f))
  .sort();

writeFileSync("scripts/drora-test-files.json", JSON.stringify(droraFiles, null, 2) + "\n", "utf8");
writeFileSync(
  "scripts/drora-isolated-test-files.json",
  JSON.stringify(forkIsolated, null, 2) + "\n",
  "utf8",
);
console.log(
  JSON.stringify(
    { drora: droraFiles.length, isolated: forkIsolated.length, retiringTotal: retiring.size },
    null,
    1,
  ),
);
