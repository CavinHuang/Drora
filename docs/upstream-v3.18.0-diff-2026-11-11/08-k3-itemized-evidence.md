# K3『等价形态』逐件证据（v3.18.2 对齐复验残差 1,164 件）

- **发布目的**：06-final-acceptance §6.2#5 / 07-three-version-acceptance §5④ 的开口项——『逐件证据未发布即不可验收为已证等价』。本文件把 2026-11-14 对齐复验（`final-alignment-after.tsv`，全树 18,680 件中不等价 1,164 件=DIFF 面）的逐件度量随仓发布。
- **数据来源**：`D:/workspace/tmp/upstream-v3.18.2/residual-audit/`（审计中间产物，脚本同目录）：`audit-metrics.tsv`（1,164 行全量度量）、`sidediff.tsv`（695 词元差件方向行统计）、`brand-ratio.tsv`（695 件品牌词元占比）、`sample.json`（139 件分层抽样人工核验样本，种子 20261114 可复现）。本文件由上述 TSV **汇编**生成（未重跑度量脚本；06 §3.3 已注明终审采信该脚本集口径并标注）。
- **判据定义**（与 residual-audit 脚本逐字对应）：
  - `asymLines`：EOL/BOM 归一后行 multiset 不对称数（audit-metrics col3）——≥真实 diff 行数下界，重排不敏感。
  - `TOKEN_EQ`：`[\p{L}\p{N}]+` 词元序列逐位相等（台账 38 同款方法论）——判『等价形态（K3）』的充分判据（格式化器不增删调序词元）。
  - `TOKEN_DIFF` + 品牌 `ratio`：词元 multiset 差中含 `drora|zcode`（不区分大小写）的占比（brand-ratio col4）。`≥90%`=冻结字面量/改名双轨族（K3 向，待逐字面量仲裁=台账 38 A 类同族）；`<50%`=含实质内容差异（K1/K2 向，需按在案裁定或台账归属核）。
  - `ours-only/theirs-only`：行 multiset 方向统计（sidediff）；theirs-only 多=本仓缺失上游内容候选。
- **等价性结论口径**：`TOKEN_EQ` 469 件计为『已证等价（词元级）』；`TOKEN_DIFF` 695 件中品牌 `≥90%` 层计为『等价性待逐字面量仲裁（冻结面双轨）』，`<50%` 层为『实质差异面（在案裁定的保留域，见逐件行判据列）』。docs 域 65 件已与台账 38（A 类 53+B 类 12）双向核对，互为同集。

## 1. 汇总

| 域             | TOKEN_EQ | TOKEN_DIFF |     合计 |
| -------------- | -------: | ---------: | -------: |
| (根/其他)      |        4 |         43 |       47 |
| .agents        |      126 |          1 |      127 |
| apps/dev-docs  |       11 |          0 |       11 |
| apps/drora-cli |        2 |        266 |      268 |
| docs           |        0 |         65 |       65 |
| packages       |      316 |        309 |      625 |
| scripts        |       10 |         11 |       21 |
| **合计**       |  **469** |    **695** | **1164** |

TOKEN_DIFF 695 件品牌占比分层：≥90%（冻结双轨向）90 件｜50–90%（混合）1 件｜<50%（实质差异向）604 件。

抽样核验样本（sample.json，分层随机、种子 20261114）：packages 词元差 47 / packages 词元等 47 / drora-cli 词元差 35 / drora-cli 词元等 2（该层全查）/ .agents 词元差 1 / .agents 词元等 3 / scripts 2 / apps/dev-docs 2 = **139 件**（分层实际落位数，以 sample.json 为准），逐件表中以 `★sample:<层>` 标注。

## 2. TOKEN_EQ（词元序列逐位相等，469 件）——已证等价（K3）

| 路径                                                                                                                        | asymLines | 抽样           |
| --------------------------------------------------------------------------------------------------------------------------- | --------: | -------------- |
| `.agents/skills/ai-elements/references/agent.md`                                                                            |        63 |                |
| `.agents/skills/ai-elements/references/artifact.md`                                                                         |        54 |                |
| `.agents/skills/ai-elements/references/attachments.md`                                                                      |        72 |                |
| `.agents/skills/ai-elements/references/audio-player.md`                                                                     |        76 |                |
| `.agents/skills/ai-elements/references/canvas.md`                                                                           |        10 |                |
| `.agents/skills/ai-elements/references/chain-of-thought.md`                                                                 |        60 |                |
| `.agents/skills/ai-elements/references/checkpoint.md`                                                                       |        61 |                |
| `.agents/skills/ai-elements/references/code-block.md`                                                                       |        88 |                |
| `.agents/skills/ai-elements/references/commit.md`                                                                           |       156 |                |
| `.agents/skills/ai-elements/references/confirmation.md`                                                                     |        59 |                |
| `.agents/skills/ai-elements/references/connection.md`                                                                       |        14 |                |
| `.agents/skills/ai-elements/references/context.md`                                                                          |        64 |                |
| `.agents/skills/ai-elements/references/controls.md`                                                                         |        10 |                |
| `.agents/skills/ai-elements/references/conversation.md`                                                                     |        65 |                |
| `.agents/skills/ai-elements/references/edge.md`                                                                             |        28 |                |
| `.agents/skills/ai-elements/references/environment-variables.md`                                                            |        92 |                |
| `.agents/skills/ai-elements/references/file-tree.md`                                                                        |        38 |                |
| `.agents/skills/ai-elements/references/image.md`                                                                            |        15 | `★sample:agEq` |
| `.agents/skills/ai-elements/references/inline-citation.md`                                                                  |       106 |                |
| `.agents/skills/ai-elements/references/jsx-preview.md`                                                                      |        37 |                |
| `.agents/skills/ai-elements/references/message.md`                                                                          |       125 |                |
| `.agents/skills/ai-elements/references/mic-selector.md`                                                                     |        97 |                |
| `.agents/skills/ai-elements/references/model-selector.md`                                                                   |        88 |                |
| `.agents/skills/ai-elements/references/node.md`                                                                             |        54 |                |
| `.agents/skills/ai-elements/references/open-in-chat.md`                                                                     |        30 |                |
| `.agents/skills/ai-elements/references/package-info.md`                                                                     |        72 |                |
| `.agents/skills/ai-elements/references/panel.md`                                                                            |        12 |                |
| `.agents/skills/ai-elements/references/persona.md`                                                                          |        28 |                |
| `.agents/skills/ai-elements/references/plan.md`                                                                             |        56 |                |
| `.agents/skills/ai-elements/references/prompt-input.md`                                                                     |       266 |                |
| `.agents/skills/ai-elements/references/queue.md`                                                                            |       104 |                |
| `.agents/skills/ai-elements/references/reasoning.md`                                                                        |        77 |                |
| `.agents/skills/ai-elements/references/sandbox.md`                                                                          |        57 |                |
| `.agents/skills/ai-elements/references/schema-display.md`                                                                   |        16 |                |
| `.agents/skills/ai-elements/references/shimmer.md`                                                                          |        14 |                |
| `.agents/skills/ai-elements/references/snippet.md`                                                                          |        42 |                |
| `.agents/skills/ai-elements/references/sources.md`                                                                          |        50 |                |
| `.agents/skills/ai-elements/references/speech-input.md`                                                                     |        29 |                |
| `.agents/skills/ai-elements/references/stack-trace.md`                                                                      |       126 |                |
| `.agents/skills/ai-elements/references/suggestion.md`                                                                       |        21 |                |
| `.agents/skills/ai-elements/references/task.md`                                                                             |        47 |                |
| `.agents/skills/ai-elements/references/terminal.md`                                                                         |        60 |                |
| `.agents/skills/ai-elements/references/test-results.md`                                                                     |       118 |                |
| `.agents/skills/ai-elements/references/tool.md`                                                                             |        66 |                |
| `.agents/skills/ai-elements/references/toolbar.md`                                                                          |        10 |                |
| `.agents/skills/ai-elements/references/transcription.md`                                                                    |        24 |                |
| `.agents/skills/ai-elements/references/voice-selector.md`                                                                   |       188 |                |
| `.agents/skills/ai-elements/references/web-preview.md`                                                                      |        51 | `★sample:agEq` |
| `.agents/skills/ai-elements/SKILL.md`                                                                                       |        20 |                |
| `.agents/skills/drora-large-task-fixture/scripts/generate-large-task-fixture.mjs`                                           |       694 |                |
| `.agents/skills/drora-large-task-fixture/SKILL.md`                                                                          |         1 |                |
| `.agents/skills/feature-boundary-planner/references/case-planning-template.md`                                              |        76 |                |
| `.agents/skills/feature-boundary-planner/references/drora-domain-cross-products.md`                                         |        84 |                |
| `.agents/skills/feature-boundary-planner/references/impact-brief-template.md`                                               |        88 |                |
| `.agents/skills/react-best-practices/AGENTS.md`                                                                             |      1577 |                |
| `.agents/skills/react-best-practices/README.md`                                                                             |        10 |                |
| `.agents/skills/react-best-practices/rules/_template.md`                                                                    |         4 |                |
| `.agents/skills/react-best-practices/rules/advanced-effect-event-deps.md`                                                   |        38 |                |
| `.agents/skills/react-best-practices/rules/advanced-event-handler-refs.md`                                                  |        30 |                |
| `.agents/skills/react-best-practices/rules/advanced-init-once.md`                                                           |        18 |                |
| `.agents/skills/react-best-practices/rules/advanced-use-latest.md`                                                          |        20 | `★sample:agEq` |
| `.agents/skills/react-best-practices/rules/async-api-routes.md`                                                             |        21 |                |
| `.agents/skills/react-best-practices/rules/async-cheap-condition-before-await.md`                                           |         4 |                |
| `.agents/skills/react-best-practices/rules/async-defer-await.md`                                                            |        52 |                |
| `.agents/skills/react-best-practices/rules/async-dependencies.md`                                                           |        33 |                |
| `.agents/skills/react-best-practices/rules/async-parallel.md`                                                               |        12 |                |
| `.agents/skills/react-best-practices/rules/async-suspense-boundaries.md`                                                    |        26 |                |
| `.agents/skills/react-best-practices/rules/bundle-analyzable-paths.md`                                                      |        23 |                |
| `.agents/skills/react-best-practices/rules/bundle-barrel-imports.md`                                                        |        16 |                |
| `.agents/skills/react-best-practices/rules/bundle-conditional.md`                                                           |        24 |                |
| `.agents/skills/react-best-practices/rules/bundle-defer-third-party.md`                                                     |        15 |                |
| `.agents/skills/react-best-practices/rules/bundle-dynamic-imports.md`                                                       |        15 |                |
| `.agents/skills/react-best-practices/rules/bundle-preload.md`                                                               |        24 |                |
| `.agents/skills/react-best-practices/rules/client-event-listeners.md`                                                       |        48 |                |
| `.agents/skills/react-best-practices/rules/client-localstorage-schema.md`                                                   |        33 |                |
| `.agents/skills/react-best-practices/rules/client-passive-event-listeners.md`                                               |        40 |                |
| `.agents/skills/react-best-practices/rules/client-swr-dedup.md`                                                             |        24 |                |
| `.agents/skills/react-best-practices/rules/js-batch-dom-css.md`                                                             |        75 |                |
| `.agents/skills/react-best-practices/rules/js-cache-function-results.md`                                                    |        16 |                |
| `.agents/skills/react-best-practices/rules/js-cache-property-access.md`                                                     |         8 |                |
| `.agents/skills/react-best-practices/rules/js-cache-storage.md`                                                             |        34 |                |
| `.agents/skills/react-best-practices/rules/js-combine-iterations.md`                                                        |        18 |                |
| `.agents/skills/react-best-practices/rules/js-early-exit.md`                                                                |        24 |                |
| `.agents/skills/react-best-practices/rules/js-flatmap-filter.md`                                                            |        29 |                |
| `.agents/skills/react-best-practices/rules/js-hoist-regexp.md`                                                              |         6 |                |
| `.agents/skills/react-best-practices/rules/js-index-maps.md`                                                                |        14 |                |
| `.agents/skills/react-best-practices/rules/js-length-check-first.md`                                                        |        13 |                |
| `.agents/skills/react-best-practices/rules/js-min-max-loop.md`                                                              |        52 |                |
| `.agents/skills/react-best-practices/rules/js-request-idle-callback.md`                                                     |        47 |                |
| `.agents/skills/react-best-practices/rules/js-tosorted-immutable.md`                                                        |         2 |                |
| `.agents/skills/react-best-practices/rules/rendering-activity.md`                                                           |         6 |                |
| `.agents/skills/react-best-practices/rules/rendering-animate-svg-wrapper.md`                                                |        17 |                |
| `.agents/skills/react-best-practices/rules/rendering-conditional-render.md`                                                 |        12 |                |
| `.agents/skills/react-best-practices/rules/rendering-content-visibility.md`                                                 |         4 |                |
| `.agents/skills/react-best-practices/rules/rendering-hoist-jsx.md`                                                          |        18 |                |
| `.agents/skills/react-best-practices/rules/rendering-hydration-no-flicker.md`                                               |        34 |                |
| `.agents/skills/react-best-practices/rules/rendering-hydration-suppress-warning.md`                                         |        10 |                |
| `.agents/skills/react-best-practices/rules/rendering-resource-hints.md`                                                     |        40 |                |
| `.agents/skills/react-best-practices/rules/rendering-script-defer-async.md`                                                 |         8 |                |
| `.agents/skills/react-best-practices/rules/rendering-usetransition-loading.md`                                              |        42 |                |
| `.agents/skills/react-best-practices/rules/rerender-defer-reads.md`                                                         |        20 |                |
| `.agents/skills/react-best-practices/rules/rerender-dependencies.md`                                                        |        18 |                |
| `.agents/skills/react-best-practices/rules/rerender-derived-state-no-effect.md`                                             |        20 |                |
| `.agents/skills/react-best-practices/rules/rerender-derived-state.md`                                                       |        10 |                |
| `.agents/skills/react-best-practices/rules/rerender-functional-setstate.md`                                                 |        41 |                |
| `.agents/skills/react-best-practices/rules/rerender-lazy-state-init.md`                                                     |        34 |                |
| `.agents/skills/react-best-practices/rules/rerender-memo-with-default-value.md`                                             |         2 |                |
| `.agents/skills/react-best-practices/rules/rerender-memo.md`                                                                |        20 |                |
| `.agents/skills/react-best-practices/rules/rerender-move-effect-to-event.md`                                                |        20 |                |
| `.agents/skills/react-best-practices/rules/rerender-no-inline-components.md`                                                |        23 |                |
| `.agents/skills/react-best-practices/rules/rerender-simple-expression-in-memo.md`                                           |        10 |                |
| `.agents/skills/react-best-practices/rules/rerender-split-combined-hooks.md`                                                |        34 |                |
| `.agents/skills/react-best-practices/rules/rerender-transitions.md`                                                         |        24 |                |
| `.agents/skills/react-best-practices/rules/rerender-use-deferred-value.md`                                                  |        24 |                |
| `.agents/skills/react-best-practices/rules/rerender-use-ref-transient-values.md`                                            |        42 |                |
| `.agents/skills/react-best-practices/rules/server-after-nonblocking.md`                                                     |        46 |                |
| `.agents/skills/react-best-practices/rules/server-auth-actions.md`                                                          |        64 |                |
| `.agents/skills/react-best-practices/rules/server-cache-lru.md`                                                             |        16 |                |
| `.agents/skills/react-best-practices/rules/server-cache-react.md`                                                           |        34 |                |
| `.agents/skills/react-best-practices/rules/server-dedup-props.md`                                                           |         6 |                |
| `.agents/skills/react-best-practices/rules/server-hoist-static-io.md`                                                       |        25 |                |
| `.agents/skills/react-best-practices/rules/server-no-shared-module-state.md`                                                |        14 |                |
| `.agents/skills/react-best-practices/rules/server-parallel-fetching.md`                                                     |        30 |                |
| `.agents/skills/react-best-practices/rules/server-parallel-nested-fetching.md`                                              |        12 |                |
| `.agents/skills/react-best-practices/rules/server-serialization.md`                                                         |        16 |                |
| `.agents/skills/react-best-practices/SKILL.md`                                                                              |        22 |                |
| `.vscode/extensions.json`                                                                                                   |         1 |                |
| `.vscode/launch.json`                                                                                                       |        29 |                |
| `.vscode/tasks.json`                                                                                                        |        30 |                |
| `apps/dev-docs/src/capability-map/CapabilityMapDetail.tsx`                                                                  |        31 |                |
| `apps/dev-docs/src/capability-map/CapabilityMapFlowElements.tsx`                                                            |        41 |                |
| `apps/dev-docs/src/capability-map/capabilityMapGroupOrder.ts`                                                               |        61 | `★sample:dd`   |
| `apps/dev-docs/src/capability-map/capabilityMapLayout.ts`                                                                   |        41 | `★sample:dd`   |
| `apps/dev-docs/src/capability-map/capabilityMapSystemPlacement.ts`                                                          |        30 |                |
| `apps/dev-docs/src/capability-map/CapabilityMapToolbar.tsx`                                                                 |        17 |                |
| `apps/dev-docs/src/capability-map/capabilityMapTypes.ts`                                                                    |        32 |                |
| `apps/dev-docs/src/capability-map/CapabilityMapView.tsx`                                                                    |       138 |                |
| `apps/dev-docs/src/capability-map/useCapabilityMapHighlight.ts`                                                             |        10 |                |
| `apps/dev-docs/test/capabilityMapNoPersonnelOwnership.test.ts`                                                              |         9 |                |
| `apps/dev-docs/test/capabilityMapSystemPlacement.test.ts`                                                                   |         5 |                |
| `apps/drora-cli/packages/android-emulator-plugin/tsconfig.json`                                                             |        13 | `★sample:clEq` |
| `apps/drora-cli/packages/ios-simulator-plugin/tsconfig.json`                                                                |        13 | `★sample:clEq` |
| `packages/client/src/webRemoteControlAcknowledgedRelayDeadline.ts`                                                          |        11 |                |
| `packages/client/src/webRemoteControlRelayProtocol.ts`                                                                      |         6 |                |
| `packages/desktop/scripts/browser-screenshot-surface-smoke.mjs`                                                             |         8 |                |
| `packages/desktop/scripts/browser-webm-recording-smoke.mjs`                                                                 |        13 | `★sample:pkEq` |
| `packages/desktop/scripts/build-metadata.mjs`                                                                               |         3 |                |
| `packages/desktop/scripts/lib/conversation-telemetry-parity.mjs`                                                            |         4 |                |
| `packages/desktop/src/host/cronRunLifecycle.ts`                                                                             |        11 |                |
| `packages/desktop/src/host/electronPort.js`                                                                                 |        37 |                |
| `packages/desktop/src/main/armsUserIdentity.ts`                                                                             |         4 |                |
| `packages/desktop/src/main/browserDataManager.ts`                                                                           |         5 |                |
| `packages/desktop/src/main/browserView/browserPlaywrightLocatorExecutor.ts`                                                 |       210 |                |
| `packages/desktop/src/main/browserView/browserVirtualClipboard.ts`                                                          |        46 |                |
| `packages/desktop/src/main/browserView/electronBrowserWebmRecorder.ts`                                                      |         6 |                |
| `packages/desktop/src/main/chromeExecutableDiscovery.ts`                                                                    |        52 | `★sample:pkEq` |
| `packages/desktop/src/main/cuaPipFocusRouter.ts`                                                                            |         4 |                |
| `packages/desktop/src/main/desktopArchitectureGuard.ts`                                                                     |         6 |                |
| `packages/desktop/src/main/desktopBrowserDataIpc.ts`                                                                        |         5 |                |
| `packages/desktop/src/main/desktopDeviceMid.ts`                                                                             |        20 |                |
| `packages/desktop/src/main/desktopElectronApp.ts`                                                                           |         4 |                |
| `packages/desktop/src/main/desktopRemoteUsageArmsTelemetry.ts`                                                              |        35 |                |
| `packages/desktop/src/main/desktopWslTargetResolver.ts`                                                                     |         3 |                |
| `packages/desktop/src/main/embeddedBrowserJavaScriptDialog.ts`                                                              |         5 |                |
| `packages/desktop/src/main/embeddedBrowserPermissionUiBridge.ts`                                                            |        20 | `★sample:pkEq` |
| `packages/desktop/src/main/embeddedBrowserSitePermissionStore.ts`                                                           |        14 | `★sample:pkEq` |
| `packages/desktop/src/main/logRetention.ts`                                                                                 |         5 | `★sample:pkEq` |
| `packages/desktop/src/main/longTaskAttributionSummary.ts`                                                                   |         4 |                |
| `packages/desktop/src/main/mcpUserDirectory/claude.ts`                                                                      |        33 | `★sample:pkEq` |
| `packages/desktop/src/main/mcpUserDirectory/toml.ts`                                                                        |         6 |                |
| `packages/desktop/src/main/webRemoteControlFeatureGate.ts`                                                                  |         4 |                |
| `packages/desktop/src/main/webRemoteControlStatusEvents.ts`                                                                 |         6 |                |
| `packages/desktop/src/main/windowsChromeAppBoundKey.ts`                                                                     |         5 |                |
| `packages/desktop/src/main/windowsInstallResourceLocks.ts`                                                                  |        21 | `★sample:pkEq` |
| `packages/desktop/src/scheduler/manualClaimRelease.ts`                                                                      |         4 |                |
| `packages/desktop/src/scheduler/schedulerProtocol.js`                                                                       |         1 | `★sample:pkEq` |
| `packages/desktop/test/build-native-search-tools.test.ts`                                                                   |        16 |                |
| `packages/desktop/test/conversationSessionChatRootSnapshot.test.ts`                                                         |        14 |                |
| `packages/desktop/test/conversationTelemetryParity.test.ts`                                                                 |        34 |                |
| `packages/desktop/test/e2e/fixtures/mcp/dual-era-version-server.mjs`                                                        |         4 |                |
| `packages/desktop/test/e2e/fixtures/mcp/plan-mode-mcp-permission-server.mjs`                                                |        13 |                |
| `packages/desktop/test/e2e/fixtures/upstream/common.json`                                                                   |         5 |                |
| `packages/desktop/test/e2e/fixtures/upstream/plugin-mcp-skill/conversation-session-plugin-mcp-skill-baselines.json`         |        10 |                |
| `packages/desktop/test/e2e/fixtures/upstream/plugin-mcp-skill/conversation-session-plugin-mcp-skill-installed-enabled.json` |        10 |                |
| `packages/desktop/test/e2e/fixtures/upstream/provider-basic.json`                                                           |       185 |                |
| `packages/desktop/test/e2e/helpers/conversation-session-chat-root-snapshot-script.ts`                                       |        13 |                |
| `packages/desktop/test/e2e/helpers/conversation-session-compact.ts`                                                         |       136 |                |
| `packages/desktop/test/e2e/helpers/conversation-session-composer-prefill.ts`                                                |         3 | `★sample:pkEq` |
| `packages/desktop/test/e2e/helpers/conversation-session-edit.ts`                                                            |        77 |                |
| `packages/desktop/test/e2e/helpers/conversation-session-fork.ts`                                                            |        16 |                |
| `packages/desktop/test/e2e/helpers/conversation-session-queue.ts`                                                           |        69 |                |
| `packages/desktop/test/e2e/helpers/conversation-session-toast.ts`                                                           |         4 |                |
| `packages/desktop/test/e2e/helpers/conversation-session.ts`                                                                 |       177 |                |
| `packages/desktop/test/e2e/helpers/e2e-electron-service.ts`                                                                 |         5 |                |
| `packages/desktop/test/e2e/helpers/e2e-lifecycle-measurement.ts`                                                            |         5 |                |
| `packages/desktop/test/e2e/helpers/e2e-spec-resolution.ts`                                                                  |         7 |                |
| `packages/desktop/test/e2e/helpers/e2e-worker-isolation.ts`                                                                 |         4 |                |
| `packages/desktop/test/e2e/helpers/hook-trust-fixture.ts`                                                                   |         7 | `★sample:pkEq` |
| `packages/desktop/test/e2e/helpers/hooks-lifecycle-fixture.ts`                                                              |        57 |                |
| `packages/desktop/test/e2e/helpers/model-provider-replay.ts`                                                                |        21 |                |
| `packages/desktop/test/e2e/helpers/permission-hook-race-fixture.ts`                                                         |        43 |                |
| `packages/desktop/test/e2e/helpers/plugin-runtime-env-agent.ts`                                                             |        24 |                |
| `packages/desktop/test/e2e/helpers/source-server-update-disconnect.ts`                                                      |        54 |                |
| `packages/desktop/test/e2e/helpers/upstream-capture.ts`                                                                     |        39 |                |
| `packages/desktop/test/e2e/reporting/e2e-coverage-heatmap.ts`                                                               |        50 |                |
| `packages/desktop/test/e2e/reporting/e2e-node-coverage.ts`                                                                  |        40 |                |
| `packages/desktop/test/e2e/reporting/e2e-reporting-coverage.ts`                                                             |         4 |                |
| `packages/desktop/test/e2e/reporting/e2e-reporting-stats.ts`                                                                |         5 |                |
| `packages/desktop/test/e2e/reporting/e2e-reporting-summary.ts`                                                              |         4 |                |
| `packages/desktop/test/e2e/reporting/e2e-ui-coverage.ts`                                                                    |        56 |                |
| `packages/desktop/test/e2e/reporting/istanbul-reporting.d.ts`                                                               |         5 |                |
| `packages/desktop/test/e2eElectronServiceLifecycle.test.ts`                                                                 |        17 | `★sample:pkEq` |
| `packages/desktop/test/e2eInfrastructureLifecycle.test.ts`                                                                  |         4 | `★sample:pkEq` |
| `packages/desktop/test/e2eNetworkCaptureRedaction.test.ts`                                                                  |        61 |                |
| `packages/desktop/test/e2eNodeCoverageNormalization.test.ts`                                                                |        39 |                |
| `packages/desktop/test/e2eRendererBridgeRootHook.test.ts`                                                                   |         5 |                |
| `packages/desktop/test/e2eUICoverageCollector.test.ts`                                                                      |         6 |                |
| `packages/desktop/test/e2eV4TurnCompletion.test.ts`                                                                         |         4 |                |
| `packages/desktop/test/releaseChangelogWriter.test.ts`                                                                      |         4 |                |
| `packages/desktop/test/sharpComputerUseRequirement.test.ts`                                                                 |         5 |                |
| `packages/desktop/test/windowsInstallerNshSmoke.test.ts`                                                                    |        28 |                |
| `packages/desktop/tsconfig.scheduler.json`                                                                                  |        24 |                |
| `packages/drora-server-cli/src/packaging/stageArchives.ts`                                                                  |         4 | `★sample:pkEq` |
| `packages/drora-server-cli/src/runtime/immutableRelease.ts`                                                                 |         6 | `★sample:pkEq` |
| `packages/drora-server-cli/src/runtime/installationOwnership.ts`                                                            |        36 | `★sample:pkEq` |
| `packages/drora-server-cli/src/runtime/releaseDownload.ts`                                                                  |        32 |                |
| `packages/drora-server-cli/src/runtime/releaseInstaller.ts`                                                                 |        45 |                |
| `packages/drora-server-cli/src/runtime/serviceInstallation.ts`                                                              |        63 |                |
| `packages/drora-server-cli/src/runtime/stableLauncher.ts`                                                                   |         2 |                |
| `packages/drora-server-cli/src/runtime/updatePreparation.ts`                                                                |        46 |                |
| `packages/drora-server-cli/src/server-core/core.ts`                                                                         |         1 |                |
| `packages/drora-server-cli/src/server-core/taskActivityTracker.ts`                                                          |         4 |                |
| `packages/drora-server-cli/test/verifyRemoteSshTarget.test.ts`                                                              |         9 |                |
| `packages/drora-server-cli/tsconfig.json`                                                                                   |         6 |                |
| `packages/e2e-report/src/node/index.ts`                                                                                     |        17 |                |
| `packages/e2e-report/src/viewer/App.tsx`                                                                                    |        38 |                |
| `packages/e2e-report/src/viewer/ChartPanels.tsx`                                                                            |        35 |                |
| `packages/e2e-report/src/viewer/CoveragePanel.tsx`                                                                          |        16 | `★sample:pkEq` |
| `packages/e2e-report/src/viewer/reportData.ts`                                                                              |         4 |                |
| `packages/e2e-report/src/viewer/styles.css`                                                                                 |         8 |                |
| `packages/e2e-report/src/viewer/trendData.ts`                                                                               |        31 |                |
| `packages/formal-proof/src/styles.css`                                                                                      |         7 |                |
| `packages/server/build-remote.ts`                                                                                           |         1 |                |
| `packages/server/src/remote/create-backend.ts`                                                                              |         4 |                |
| `packages/server/src/source-server/sourceServerTransportRuntime.ts`                                                         |        10 |                |
| `packages/services/src/bots/channelRuntime.ts`                                                                              |         9 |                |
| `packages/services/src/bots/commandOrder.ts`                                                                                |         6 |                |
| `packages/services/src/bots/modelSelectionHelpers.ts`                                                                       |         4 |                |
| `packages/services/src/bots/providers/feishuAppRegistration.ts`                                                             |         5 |                |
| `packages/services/src/bots/providers/weixinProvider.ts`                                                                    |       190 |                |
| `packages/services/src/bots/providers/weixinRegistration.ts`                                                                |        30 |                |
| `packages/services/src/bots/replyFormatter.ts`                                                                              |        48 |                |
| `packages/services/src/bots/statusFormatting.ts`                                                                            |        39 |                |
| `packages/services/src/bots/telegramChannelRuntime.ts`                                                                      |       105 |                |
| `packages/services/src/bots/weixinChannelRuntime.ts`                                                                        |        25 | `★sample:pkEq` |
| `packages/services/src/drora-agent/agentTelemetryEnv.ts`                                                                    |         4 | `★sample:pkEq` |
| `packages/services/src/drora-agent/droraSessionEventCoalescer.ts`                                                           |         2 | `★sample:pkEq` |
| `packages/services/src/file/workspaceFileIgnore.ts`                                                                         |        34 |                |
| `packages/services/src/fs/fsFaultInjection.ts`                                                                              |        20 |                |
| `packages/services/src/memory/index.ts`                                                                                     |         5 |                |
| `packages/services/src/memory/memory.ts`                                                                                    |        12 |                |
| `packages/services/src/memory/memoryService.ts`                                                                             |        62 | `★sample:pkEq` |
| `packages/services/src/output-style/outputStyleService.ts`                                                                  |        14 |                |
| `packages/services/src/plugin-sync/pluginSyncArchive.ts`                                                                    |        32 |                |
| `packages/services/src/plugins/installedPluginRoots.ts`                                                                     |         6 |                |
| `packages/services/src/providers/codexConfigToml.ts`                                                                        |        10 |                |
| `packages/services/src/runtime-tools/runtimeToolResolver.ts`                                                                |        22 |                |
| `packages/services/src/session/claude-native/claudeNativeSessionImportParser.ts`                                            |        13 |                |
| `packages/services/src/session/claude-native/importedClaudeHistoryRepair.ts`                                                |         9 |                |
| `packages/services/src/session/continuousStreamCoalescer.ts`                                                                |        16 |                |
| `packages/services/src/session/fileChangeTracker.ts`                                                                        |         3 |                |
| `packages/services/src/setting/settingsWriteQueue.ts`                                                                       |        12 |                |
| `packages/services/src/settings-sync/types.ts`                                                                              |         5 |                |
| `packages/services/src/skill-sync/skillSyncArchive.ts`                                                                      |        28 | `★sample:pkEq` |
| `packages/services/src/skill-sync/skillSyncErrors.ts`                                                                       |         5 |                |
| `packages/services/src/source-server-workspace/sourceServerWorkspace.ts`                                                    |         8 |                |
| `packages/services/src/usage-stats/usageStatsConfig.ts`                                                                     |        12 |                |
| `packages/services/test/fixtures/share-content-blocks.json`                                                                 |        49 |                |
| `packages/shared/src/drora-protocol-v4/apply.ts`                                                                            |        18 |                |
| `packages/shared/src/drora-protocol-v4/coalesce.ts`                                                                         |         5 |                |
| `packages/shared/src/drora-protocol-v4/wire-reassembly.ts`                                                                  |        10 | `★sample:pkEq` |
| `packages/shared/src/memory.ts`                                                                                             |         8 |                |
| `packages/shared/src/output-style.ts`                                                                                       |        24 |                |
| `packages/shared/src/platformUpdate.ts`                                                                                     |         4 |                |
| `packages/shared/src/sqlite-migrations/runner.ts`                                                                           |         3 |                |
| `packages/stream-animate/src/App.tsx`                                                                                       |         5 |                |
| `packages/stream-animate/src/client/FrameChart.tsx`                                                                         |        16 |                |
| `packages/stream-animate/src/client/RunForm.tsx`                                                                            |         5 |                |
| `packages/stream-animate/src/server/dataStore.ts`                                                                           |         9 |                |
| `packages/stream-animate/src/server/deepseekRunner.ts`                                                                      |         4 |                |
| `packages/stream-animate/src/server/http.ts`                                                                                |        23 | `★sample:pkEq` |
| `packages/stream-animate/src/styles.css`                                                                                    |         8 |                |
| `packages/ui/src/app-shell/workflowRunThrottle.ts`                                                                          |         7 |                |
| `packages/ui/src/app-shell/workflowWorkspaceTranscript.ts`                                                                  |         8 |                |
| `packages/ui/src/AssistantPreviewCards.tsx`                                                                                 |         3 |                |
| `packages/ui/src/BotsDialog/BotSummaryCard.tsx`                                                                             |        49 |                |
| `packages/ui/src/BotsDialog/shared.tsx`                                                                                     |        27 |                |
| `packages/ui/src/browser-use/BrowserSitePermissionsPage.tsx`                                                                |        26 |                |
| `packages/ui/src/browser-use/EmbeddedBrowserPermissionPrompts.tsx`                                                          |       148 | `★sample:pkEq` |
| `packages/ui/src/chat-input-toolbar/ChatModeSwitchControl.tsx`                                                              |         8 |                |
| `packages/ui/src/chat-input-toolbar/display.tsx`                                                                            |       116 |                |
| `packages/ui/src/chat-input-toolbar/modelSelection.ts`                                                                      |        11 |                |
| `packages/ui/src/CodingPlanBillingDiscount.tsx`                                                                             |        45 |                |
| `packages/ui/src/components/ai-elements/audio-player.tsx`                                                                   |        78 |                |
| `packages/ui/src/components/ai-elements/chain-of-thought.tsx`                                                               |        65 |                |
| `packages/ui/src/components/ai-elements/environment-variables.tsx`                                                          |        58 |                |
| `packages/ui/src/components/ai-elements/file-tree.tsx`                                                                      |        71 |                |
| `packages/ui/src/components/ai-elements/inline-citation.tsx`                                                                |        67 |                |
| `packages/ui/src/components/ai-elements/jsx-preview.tsx`                                                                    |       169 |                |
| `packages/ui/src/components/ai-elements/mic-selector.tsx`                                                                   |        76 |                |
| `packages/ui/src/components/ai-elements/model-selector.tsx`                                                                 |        68 |                |
| `packages/ui/src/components/ai-elements/open-in-chat.tsx`                                                                   |        46 | `★sample:pkEq` |
| `packages/ui/src/components/ai-elements/package-info.tsx`                                                                   |        60 |                |
| `packages/ui/src/components/ai-elements/schema-display.tsx`                                                                 |        97 |                |
| `packages/ui/src/components/ai-elements/speech-input.tsx`                                                                   |        29 | `★sample:pkEq` |
| `packages/ui/src/components/ai-elements/stack-trace.tsx`                                                                    |       190 | `★sample:pkEq` |
| `packages/ui/src/components/ai-elements/transcription.tsx`                                                                  |        22 |                |
| `packages/ui/src/components/ai-elements/voice-selector.tsx`                                                                 |        99 |                |
| `packages/ui/src/components/ui/radio-group.tsx`                                                                             |        10 |                |
| `packages/ui/src/components/ui/README.md`                                                                                   |         1 |                |
| `packages/ui/src/components/ui/smooth-metric-value.tsx`                                                                     |         3 |                |
| `packages/ui/src/feedback/FeatureRequestDialog.tsx`                                                                         |        23 |                |
| `packages/ui/src/feedback/feedbackContactPreference.ts`                                                                     |         8 |                |
| `packages/ui/src/feedback/feedbackMeta.ts`                                                                                  |        37 |                |
| `packages/ui/src/feedback/FeedbackProcessView.tsx`                                                                          |         6 |                |
| `packages/ui/src/feedback/feedbackProgress.tsx`                                                                             |         4 | `★sample:pkEq` |
| `packages/ui/src/feedback/feedbackTimeline.tsx`                                                                             |        61 |                |
| `packages/ui/src/feedback/feedbackTimelineSummary.ts`                                                                       |        44 |                |
| `packages/ui/src/feedback/feedbackUserView.ts`                                                                              |        18 |                |
| `packages/ui/src/feedback/TicketDetail.tsx`                                                                                 |        11 |                |
| `packages/ui/src/git-action-menu/commitConversationContext.ts`                                                              |         5 |                |
| `packages/ui/src/git-graph/GitGraphCommitDetail.tsx`                                                                        |        17 |                |
| `packages/ui/src/git-graph/GitGraphPane.tsx`                                                                                |        37 | `★sample:pkEq` |
| `packages/ui/src/git-graph/layout.ts`                                                                                       |        29 | `★sample:pkEq` |
| `packages/ui/src/git-graph/layoutAlgorithm.ts`                                                                              |         8 |                |
| `packages/ui/src/GitPane/helpers.ts`                                                                                        |        11 |                |
| `packages/ui/src/global-notice/GlobalNoticeSurface.tsx`                                                                     |         5 | `★sample:pkEq` |
| `packages/ui/src/highspeed/highspeedShareDiagnostics.ts`                                                                    |         3 |                |
| `packages/ui/src/hooks/useBuiltinAgentCli.ts`                                                                               |        63 |                |
| `packages/ui/src/hooks/useClaudeSessionMigration.ts`                                                                        |       134 |                |
| `packages/ui/src/hooks/useDroraTaskService.ts`                                                                              |        18 | `★sample:pkEq` |
| `packages/ui/src/hooks/usePptxFileWatch.ts`                                                                                 |        24 |                |
| `packages/ui/src/hooks/useRemoteConnectionLogs.ts`                                                                          |        30 |                |
| `packages/ui/src/hooks/useSessionSubagents.ts`                                                                              |         4 |                |
| `packages/ui/src/hooks/useSkills.ts`                                                                                        |         7 |                |
| `packages/ui/src/hooks/useSourceServerManagementSnapshot.ts`                                                                |         7 |                |
| `packages/ui/src/hooks/useSystemService.ts`                                                                                 |         9 |                |
| `packages/ui/src/hooks/useWorkspaceOpenInEditorTarget.ts`                                                                   |        33 |                |
| `packages/ui/src/hooks/useWorkspaceProviderConfigFile.ts`                                                                   |         3 |                |
| `packages/ui/src/lib/askUserQuestion.ts`                                                                                    |        17 |                |
| `packages/ui/src/lib/browserEnvironment.ts`                                                                                 |         4 |                |
| `packages/ui/src/lib/builtinAgentCli.ts`                                                                                    |        10 |                |
| `packages/ui/src/lib/builtinSkillI18n.ts`                                                                                   |       128 |                |
| `packages/ui/src/lib/chatPrepareError.ts`                                                                                   |        22 |                |
| `packages/ui/src/lib/cuaPermissionStatusCache.ts`                                                                           |         7 |                |
| `packages/ui/src/lib/cuaPermissionStatusStore.ts`                                                                           |         5 |                |
| `packages/ui/src/lib/droraProviderPreference.ts`                                                                            |         4 |                |
| `packages/ui/src/lib/droraTimelineIdentity.ts`                                                                              |        48 |                |
| `packages/ui/src/lib/droraTimelineRuntime.ts`                                                                               |        15 |                |
| `packages/ui/src/lib/gitAutoRefresh.ts`                                                                                     |         4 |                |
| `packages/ui/src/lib/mcpStatusProbe.ts`                                                                                     |         5 |                |
| `packages/ui/src/lib/mermaidLanguage.ts`                                                                                    |        10 |                |
| `packages/ui/src/lib/mobileTextInput.ts`                                                                                    |         4 |                |
| `packages/ui/src/lib/modeConfigUpdateGuard.ts`                                                                              |        25 |                |
| `packages/ui/src/lib/pptxElementReference.ts`                                                                               |        64 | `★sample:pkEq` |
| `packages/ui/src/lib/pptxElementReferencePreview.ts`                                                                        |        13 |                |
| `packages/ui/src/lib/promptHistoryStorage.ts`                                                                               |         5 |                |
| `packages/ui/src/lib/promptInputTriggers.ts`                                                                                |         7 |                |
| `packages/ui/src/lib/remoteConnectionDialogState.ts`                                                                        |         9 |                |
| `packages/ui/src/lib/remoteConnectionDockerOptions.ts`                                                                      |         8 |                |
| `packages/ui/src/lib/rootStartupGate.ts`                                                                                    |        22 |                |
| `packages/ui/src/lib/shikiHighlighter.ts`                                                                                   |         6 |                |
| `packages/ui/src/lib/sidebarPurposeSectionPreferences.ts`                                                                   |        31 |                |
| `packages/ui/src/lib/sidebarUsageCodingPlanProviderPreference.ts`                                                           |        20 |                |
| `packages/ui/src/lib/taskChangeSummary.ts`                                                                                  |        32 |                |
| `packages/ui/src/lib/taskModelRecovery.ts`                                                                                  |        14 |                |
| `packages/ui/src/lib/taskNavigationHistory.ts`                                                                              |        20 |                |
| `packages/ui/src/lib/taskOrderPreference.ts`                                                                                |        15 |                |
| `packages/ui/src/lib/taskQueryCache.ts`                                                                                     |         7 |                |
| `packages/ui/src/lib/taskRestoreRuntime.ts`                                                                                 |         9 | `★sample:pkEq` |
| `packages/ui/src/lib/teamPlanDisplayName.ts`                                                                                |         4 |                |
| `packages/ui/src/lib/toolError.ts`                                                                                          |         4 | `★sample:pkEq` |
| `packages/ui/src/lib/workflowRunLine.ts`                                                                                    |         4 |                |
| `packages/ui/src/lib/workspaceEditorSelection.ts`                                                                           |         2 |                |
| `packages/ui/src/lib/workspaceExpansionPreference.ts`                                                                       |         7 |                |
| `packages/ui/src/lib/workspacePrepareReason.ts`                                                                             |         5 |                |
| `packages/ui/src/lib/workspaceRpcAvailability.ts`                                                                           |        17 |                |
| `packages/ui/src/lib/workspaceSessionReloadPlan.ts`                                                                         |         4 |                |
| `packages/ui/src/MessageChangeSummaryPanel.tsx`                                                                             |       318 |                |
| `packages/ui/src/messageChangeSummaryPreview.ts`                                                                            |        12 |                |
| `packages/ui/src/OpenSplitButton.tsx`                                                                                       |         4 |                |
| `packages/ui/src/presentation/presentationElementModel.ts`                                                                  |        62 |                |
| `packages/ui/src/presentation/types.ts`                                                                                     |         7 |                |
| `packages/ui/src/previewPaneCodeReview.ts`                                                                                  |         5 |                |
| `packages/ui/src/project-sidebar/useProjectUnreadSignals.ts`                                                                |         5 |                |
| `packages/ui/src/quickpick/QuickPickCommandDialog.tsx`                                                                      |         5 |                |
| `packages/ui/src/quickpick/taskFindSearch.ts`                                                                               |         2 |                |
| `packages/ui/src/rewards/RewardsProvider.tsx`                                                                               |         8 |                |
| `packages/ui/src/root/botsTaskBroadcast.ts`                                                                                 |        10 |                |
| `packages/ui/src/root/botsTaskStreamBroadcast.ts`                                                                           |         6 |                |
| `packages/ui/src/root/PostUpdateReleaseNotesDialog.tsx`                                                                     |         6 |                |
| `packages/ui/src/root/useBotBroadcastEffects.ts`                                                                            |        60 | `★sample:pkEq` |
| `packages/ui/src/root/useRemoteWorkspaceTabLifecycle.ts`                                                                    |        58 | `★sample:pkEq` |
| `packages/ui/src/root/useRootProviderStateRefresh.ts`                                                                       |        18 |                |
| `packages/ui/src/settings/AutomationDesignPrimitives.tsx`                                                                   |        22 | `★sample:pkEq` |
| `packages/ui/src/settings/codingPlanUpgradeLoginRecovery.ts`                                                                |         5 |                |
| `packages/ui/src/settings/EnabledStatusFilterSelect.tsx`                                                                    |         5 |                |
| `packages/ui/src/settings/HooksList.tsx`                                                                                    |        20 |                |
| `packages/ui/src/settings/model-provider-section/codingPlanProductPresentation.ts`                                          |        62 |                |
| `packages/ui/src/settings/model-provider-section/StartPlanCard.tsx`                                                         |         9 | `★sample:pkEq` |
| `packages/ui/src/settings/model-provider-section/useStartPlanPreview.ts`                                                    |         4 |                |
| `packages/ui/src/settings/OffPeakHistoryTab.tsx`                                                                            |        24 |                |
| `packages/ui/src/settings/offPeakUiPresentation.ts`                                                                         |        22 |                |
| `packages/ui/src/settings/saved-workflows/globalWorkflowGroupHelpers.ts`                                                    |         3 |                |
| `packages/ui/src/settings/saved-workflows/useSavedWorkflowProjectTargets.ts`                                                |        30 |                |
| `packages/ui/src/settings/SettingsBackButton.tsx`                                                                           |         8 | `★sample:pkEq` |
| `packages/ui/src/settings/SourceServerMigrationReportPanel.tsx`                                                             |        23 |                |
| `packages/ui/src/settings/usage-stats/AppUsagePanel.tsx`                                                                    |         4 |                |
| `packages/ui/src/settings/usage-stats/usageStatsUiParts.tsx`                                                                |        28 | `★sample:pkEq` |
| `packages/ui/src/store/codeCommentPreviewStore.ts`                                                                          |       175 |                |
| `packages/ui/src/store/droraSessionStoreSelectors.ts`                                                                       |        24 |                |
| `packages/ui/src/store/mcpStoreHelpers.ts`                                                                                  |        24 |                |
| `packages/ui/src/store/sourceServerDisplayNameRegistry.ts`                                                                  |        10 |                |
| `packages/ui/src/store/workspaceHookReviewStore.ts`                                                                         |        13 |                |
| `packages/ui/src/TaskSearchDialog.tsx`                                                                                      |        21 |                |
| `packages/ui/src/ToolCallBlocks/renderers/cron-create.tsx`                                                                  |        16 |                |
| `packages/ui/src/ToolCallBlocks/toolResultDisplay.ts`                                                                       |         3 | `★sample:pkEq` |
| `packages/ui/src/updateStatusModel.ts`                                                                                      |        33 |                |
| `packages/ui/src/useTaskListItemContextActions.ts`                                                                          |        74 |                |
| `packages/ui/src/v4/agentSessionsIndexTransport.ts`                                                                         |        30 |                |
| `packages/ui/src/v4/composer/useCodeCommentContexts.ts`                                                                     |        56 |                |
| `packages/ui/src/v4/configCommandBarrier.ts`                                                                                |        54 | `★sample:pkEq` |
| `packages/ui/src/v4/ConversationBackgroundWorks.tsx`                                                                        |        17 |                |
| `packages/ui/src/v4/conversationGoalSummaryModel.ts`                                                                        |         6 | `★sample:pkEq` |
| `packages/ui/src/v4/conversationLayout.ts`                                                                                  |         4 |                |
| `packages/ui/src/v4/draftSuggestedPromptPrefill.ts`                                                                         |         4 |                |
| `packages/ui/src/v4/index.ts`                                                                                               |        21 |                |
| `packages/ui/src/v4/paneLayoutPersistence.ts`                                                                               |        38 |                |
| `packages/ui/src/v4/paneLayoutStore.ts`                                                                                     |        17 |                |
| `packages/ui/src/v4/paneLayoutTree.ts`                                                                                      |        33 |                |
| `packages/ui/src/v4/pendingGuideProjection.ts`                                                                              |         8 |                |
| `packages/ui/src/v4/SubagentDrilldown.tsx`                                                                                  |        14 | `★sample:pkEq` |
| `packages/ui/src/v4/taskListMembershipVersion.ts`                                                                           |         9 |                |
| `packages/ui/src/v4/telemetry/useSessionSubscriptionErrorTelemetry.ts`                                                      |        12 |                |
| `packages/ui/src/v4/timelineRowHeightCache.ts`                                                                              |         4 |                |
| `packages/ui/src/v4/timelineScrollAnchor.ts`                                                                                |        54 | `★sample:pkEq` |
| `packages/ui/src/v4/useSessionsIndex.ts`                                                                                    |         5 |                |
| `packages/ui/src/v4/useTreemappingConversationMessage.ts`                                                                   |        15 | `★sample:pkEq` |
| `packages/ui/src/v4/V4ConversationContext.tsx`                                                                              |         4 |                |
| `packages/ui/src/v4/workbenchGroupStore.ts`                                                                                 |        12 |                |
| `packages/ui/src/v4/WorkbenchSplitDivider.tsx`                                                                              |         8 |                |
| `packages/ui/src/WebRemoteControlFeatureProvider.tsx`                                                                       |         4 |                |
| `packages/ui/src/WebRemoteControlThemeMenu.tsx`                                                                             |         6 |                |
| `packages/ui/src/windowCaptionControls.ts`                                                                                  |         3 |                |
| `packages/ui/src/workspace-file-search/workspaceFileSearchFilterBackend.ts`                                                 |         5 |                |
| `packages/ui/src/workspace-file-tree/useWorkspaceFileTreeStickyFolders.ts`                                                  |        13 |                |
| `packages/ui/src/WorkspaceSidebar/RemoteProjectDetailsPopover.tsx`                                                          |         5 |                |
| `packages/zcode-cua/broker.d.ts`                                                                                            |         1 |                |
| `scripts/audit-conversation-session-case-coverage.mjs`                                                                      |       577 |                |
| `scripts/audit-drora-agent-remnants.mjs`                                                                                    |        25 |                |
| `scripts/check-workspace-freshness.mjs`                                                                                     |        11 |                |
| `scripts/dep-refs.mjs`                                                                                                      |        46 |                |
| `scripts/dev-official-mcp-server.mjs`                                                                                       |        12 |                |
| `scripts/lib/conversation-session-formal-admission-ledger.mjs`                                                              |        50 |                |
| `scripts/lib/conversation-session-formal-admission-paths.mjs`                                                               |        19 |                |
| `scripts/mcp-image-payload-test-server.mjs`                                                                                 |         6 |                |
| `scripts/test-web-app-gateway-reset.mjs`                                                                                    |         9 |                |
| `scripts/test/arms-patch-install-contract.test.mjs`                                                                         |         5 |                |
| `vitest.setup.ts`                                                                                                           |         3 |                |

## 3. TOKEN_DIFF（词元差，695 件）——按品牌占比分层

列：`asymLines`（行不对称数）｜`ours→theirs`（行方向：ours-only / theirs-only）｜`Δtok`（词元 multiset 差总数）｜`brand`（其中品牌词元数）｜`ratio`（品牌占比）｜`判据`（≥90% / 50–90% / <50%）。

| 路径                                                                                                                 | asymLines | ours-only | theirs-only |   Δtok | brand | ratio | 判据   | 抽样            |
| -------------------------------------------------------------------------------------------------------------------- | --------: | --------: | ----------: | -----: | ----: | ----: | ------ | --------------- |
| — **≥90% 层开始（冻结字面量/改名双轨向，等价性待逐字面量仲裁（台账 38 A 类同族））** —                               |           |           |             |        |       |       |        |                 |
| `.env.example`                                                                                                       |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/adapters/src/model/model-execution.ts`                                                      |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/adapters/src/model/provider-finish-business-error.ts`                                       |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/adapters/src/model/runner-options.ts`                                                       |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/adapters/tests/model-query-source-wire.test.ts`                                             |        10 |         5 |           5 |     10 |    10 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/adapters/tests/model-request-headers.test.ts`                                               |         8 |         4 |           4 |      8 |     8 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/adapters/tests/opencode-go-wire.test.ts`                                                    |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/adapters/tests/provider-endpoint-routing-fetch.test.ts`                                     |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/provider-runtime-headers.ts`                                   |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/bootstrap/src/model-config.ts`                                                              |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/model-config.test.ts`                                                       |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/provider-endpoint-routing-source-headers.test.ts`                           |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/core/src/runtime/helpers/model-errors.ts`                                                   |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `apps/drora-cli/packages/core/src/runtime/methods/model.ts`                                                          |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `config/provider/drora-builtin.json`                                                                                 |        10 |         5 |           5 |     10 |    10 |  1.00 | ≥90%   |                 |
| `config/provider/drora-builtin.test.json`                                                                            |        20 |        10 |          10 |     20 |    20 |  1.00 | ≥90%   |                 |
| `docs/analysis/credentials-json-code-audit.md`                                                                       |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/architecture/intranet-probe.md`                                                                                |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/builtin-plugin-icons.md`                                                                                       |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/conversation-share-v1.md`                                                                                      |         6 |         3 |           3 |      6 |     6 |  1.00 | ≥90%   |                 |
| `docs/cua-permission-broker/2026-09-21-cua-helper-lazy-startup-spec.md`                                              |        50 |        25 |          25 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/cua-permission-broker/cua-dev-mcp-runtime-assets.md`                                                           |        28 |        14 |          14 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/cua-permission-broker/cua-helper-installation.md`                                                              |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/cua-permission-broker/local-dev-helper-runbook.md`                                                             |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/cua/2026-09-14-windows-cua-indicator-repair-spec.md`                                                           |        42 |        21 |          21 |      6 |     6 |  1.00 | ≥90%   |                 |
| `docs/cua/windows-source-development.md`                                                                             |         8 |         4 |           4 |      8 |     8 |  1.00 | ≥90%   |                 |
| `docs/desktop-bundle-size-architecture.md`                                                                           |         6 |         3 |           3 |      6 |     6 |  1.00 | ≥90%   |                 |
| `docs/desktop-ci-cd.md`                                                                                              |        16 |         8 |           8 |      8 |     8 |  1.00 | ≥90%   |                 |
| `docs/desktop/auto-update-service-manifest.md`                                                                       |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `docs/desktop/dev-deep-link.md`                                                                                      |        12 |         6 |           6 |     12 |    12 |  1.00 | ≥90%   |                 |
| `docs/desktop/drora-preview-packaging.md`                                                                            |       154 |        77 |          77 |     20 |    20 |  1.00 | ≥90%   |                 |
| `docs/desktop/finder-open-folder-deep-link.md`                                                                       |         8 |         4 |           4 |      8 |     8 |  1.00 | ≥90%   |                 |
| `docs/desktop/linux-appimage-deep-link.md`                                                                           |         4 |         2 |           2 |      6 |     6 |  1.00 | ≥90%   |                 |
| `docs/desktop/linux-pacman-package.md`                                                                               |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/development-mise-runtime.md`                                                                                   |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/highspeed/highspeed-access-mode-migration.md`                                                                  |         4 |         2 |           2 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/linux-appimage-desktop-icon-integration.md`                                                                    |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `docs/mobile-remote-control-android.md`                                                                              |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/oauth/oauth-multi-provider-final-plan.md`                                                                      |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `docs/oauth/oauth-multi-provider-implementation.md`                                                                  |         4 |         2 |           2 |      6 |     6 |  1.00 | ≥90%   |                 |
| `docs/off-peak-task/mr-1466-complete-change-walkthrough.md`                                                          |       351 |       175 |         176 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/security/deep-link-project-trust-boundary.md`                                                                  |         6 |         3 |           3 |      6 |     6 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-03-31-bigmodel-oauth-login.md`                                                          |       289 |       177 |         112 |     12 |    12 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-04-27-zai-backend-oauth-token.md`                                                       |        14 |         9 |           5 |     10 |    10 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-07-28-windows-cua-development-runtime.md`                                               |         8 |         4 |           4 |      8 |     8 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-07-29-windows-cua-native-clipboard.md`                                                  |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-07-29-windows-cua-pointer-foundation.md`                                                |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-07-29-windows-cua-product-runtime.md`                                                   |         6 |         3 |           3 |      6 |     6 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-07-29-windows-cua-tool-call-and-app-launch-reliability.md`                              |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-07-29-windows-cua-wgc-visual-capture.md`                                                |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-08-04-windows-cua-upstream-main-forward-port.md`                                        |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-08-07-dev-cua-sharp-reseed.md`                                                          |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/plans/2026-09-21-cua-helper-lazy-startup.md`                                                       |       268 |       153 |         115 |      8 |     8 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-03-31-bigmodel-oauth-login-design.md`                                                   |       372 |       190 |         182 |     10 |    10 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-04-27-zai-backend-oauth-token-design.md`                                                |         8 |         4 |           4 |      8 |     8 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-04-28-web-remote-login-design.md`                                                       |        61 |        31 |          30 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-04-28-window-level-web-remote-control-design.md`                                        |        14 |         6 |           8 |     10 |    10 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-06-09-agent-model-request-session-header-design.md`                                     |        24 |        12 |          12 |     10 |    10 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-07-28-windows-cua-development-runtime-design.md`                                        |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-08-04-windows-cua-upstream-main-forward-port-design.md`                                 |        18 |         9 |           9 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-08-07-dev-cua-sharp-reseed-design.md`                                                   |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `docs/superpowers/specs/2026-08-18-windows-cua-runtime-diagnostics.md`                                               |        15 |         7 |           8 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/testing/conversation-telemetry-differential-regression-plan.md`                                                |       142 |        71 |          71 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/ui/workspace-file-tree.md`                                                                                     |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/v4-refactor/01-topology.md`                                                                                    |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/v4-refactor/05-transport-and-backpressure.md`                                                                  |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `docs/v4-refactor/10-protocol-spec.md`                                                                               |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `docs/web-remote-control-relay-message-logging.md`                                                                   |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/working-memory/provider-refactor/design/registry/request-compatibility-and-access-protocols.md`                |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `docs/working-memory/provider-refactor/research/todo103-staging-source-inventory.json`                               |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/android/app/src/main/AndroidManifest.xml`                                                                  |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   | `★sample:pkTok` |
| `packages/android/app/src/main/java/com/example/drora_mobile/remote/RemoteControlUrlPolicy.kt`                       |         6 |         3 |           3 |      6 |     6 |  1.00 | ≥90%   |                 |
| `packages/desktop/scripts/desktop-product-identity.mjs`                                                              |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   | `★sample:pkTok` |
| `packages/desktop/scripts/dev.mjs`                                                                                   |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/desktop/src/main/desktopFinderOpenFolderWorkflow.ts`                                                       |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   |                 |
| `packages/desktop/src/main/networkTelemetryAggregator.ts`                                                            |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/desktop/test/cdnPreloadScript.test.ts`                                                                     |        22 |        11 |          11 |     22 |    22 |  1.00 | ≥90%   |                 |
| `packages/desktop/test/codingPlanUpgradeMockServer.test.ts`                                                          |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/desktop/test/desktopProductIdentity.test.ts`                                                               |         4 |         2 |           2 |      4 |     4 |  1.00 | ≥90%   | `★sample:pkTok` |
| `packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts`                           |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/services/src/marketing-touch/marketingTouchService.ts`                                                     |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/shared/src/drora-source-headers.ts`                                                                        |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/shared/src/mcp.ts`                                                                                         |         6 |         3 |           3 |      8 |     8 |  1.00 | ≥90%   |                 |
| `packages/ui/src/hooks/useWorkflowRunNodeResult.ts`                                                                  |         2 |         1 |           1 |      4 |     4 |  1.00 | ≥90%   | `★sample:pkTok` |
| `packages/ui/src/lib/droraSessionProjection.ts`                                                                      |         3 |         2 |           1 |      2 |     2 |  1.00 | ≥90%   | `★sample:pkTok` |
| `packages/ui/src/v4/officeSuggestedPrompts.ts`                                                                       |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/web/src/share/conversationSharePreviewClient.ts`                                                           |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `packages/zcode-cua/README.md`                                                                                       |         2 |         1 |           1 |      2 |     2 |  1.00 | ≥90%   |                 |
| `UI_PLUGIN.en.md`                                                                                                    |         6 |         3 |           3 |     10 |    10 |  1.00 | ≥90%   |                 |
| `UI_PLUGIN.md`                                                                                                       |         6 |         3 |           3 |     10 |    10 |  1.00 | ≥90%   |                 |
| — **50–90% 层开始（品牌+实质混合，按在案裁定归属核）** —                                                             |           |           |             |        |       |       |        |                 |
| `third-party/copied-components.json`                                                                                 |       148 |        82 |          66 |    245 |   134 |  0.55 | 50–90% |                 |
| — **<50% 层开始（实质差异向，在案裁定保留域（台账 38 B 类/K1/K2/CLI 拆分拓扑））** —                                 |           |           |             |        |       |       |        |                 |
| `.agents/skills/feature-boundary-planner/references/drora-feature-graph.yaml`                                        |        79 |        76 |           3 |    524 |    19 |  0.04 | <50%   | `★sample:ag`    |
| `.dockerignore`                                                                                                      |         6 |         6 |           0 |     32 |     1 |  0.03 | <50%   |                 |
| `.gitattributes`                                                                                                     |        48 |        46 |           2 |    376 |     9 |  0.02 | <50%   |                 |
| `.gitignore`                                                                                                         |        59 |        48 |          11 |    281 |     8 |  0.03 | <50%   |                 |
| `.npmrc`                                                                                                             |         2 |         1 |           1 |      4 |     0 |  0.00 | <50%   |                 |
| `.oxfmtrc.json`                                                                                                      |       171 |       170 |           1 |   1062 |    14 |  0.01 | <50%   |                 |
| `.oxlintrc.json`                                                                                                     |        66 |        63 |           3 |    355 |    26 |  0.07 | <50%   |                 |
| `.prettierignore`                                                                                                    |         4 |         4 |           0 |     17 |     0 |  0.00 | <50%   |                 |
| `AGENTS.md`                                                                                                          |        14 |        13 |           1 |    211 |     7 |  0.03 | <50%   |                 |
| `apps/drora-cli/.gitignore`                                                                                          |         7 |         7 |           0 |     30 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/AGENTS.md`                                                                                           |        22 |        13 |           9 |    191 |     6 |  0.03 | <50%   |                 |
| `apps/drora-cli/docs/design/v2/plugin-compat.md`                                                                     |         1 |         1 |           0 |      6 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/package.json`                                                                                        |         8 |         7 |           1 |     32 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/package.json`                                                                      |        17 |        11 |           6 |     72 |     1 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/auth/bigmodel-oauth.ts`                                                        |         4 |         3 |           1 |     30 |     1 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/config/file-config.adapter.ts`                                                 |        43 |        41 |           2 |    146 |     7 |  0.05 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/config/index.ts`                                                               |         2 |         2 |           0 |      3 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/config/schema.ts`                                                              |        36 |        24 |          12 |    152 |     3 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/exec/bash-startup-script.ts`                                                   |        18 |        17 |           1 |     59 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/exec/cwd-capture.ts`                                                           |        44 |        36 |           8 |    170 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/exec/execution-utils.ts`                                                       |         5 |         4 |           1 |     34 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/exec/shell-init-snapshot.ts`                                                   |        49 |        37 |          12 |    221 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/fs/index.ts`                                                                   |        30 |        23 |           7 |     68 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/adapters/src/http/index.ts`                                                                 |         1 |         1 |           0 |     13 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/mcp/descriptor.ts`                                                             |         4 |         4 |           0 |     28 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/mcp/index.ts`                                                                  |         9 |         6 |           3 |     28 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/mcp/node-fallback.ts`                                                          |         6 |         6 |           0 |     44 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/model/runner-attribution.ts`                                                   |         3 |         3 |           0 |     34 |     2 |  0.06 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/network/subprocess-env.ts`                                                     |        33 |        23 |          10 |     64 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/plugins/marketplace.ts`                                                        |         4 |         4 |           0 |     20 |     3 |  0.15 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/plugins/mcp.ts`                                                                |        41 |        41 |           0 |    194 |     1 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/plugins/ui-surfaces.ts`                                                        |        19 |        15 |           4 |     72 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/adapters/src/storage/session-store/schema.baseline.sql`                                     |         0 |         0 |           0 |      0 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/src/workflow/index.ts`                                                             |         5 |         4 |           1 |     23 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/auth.test.ts`                                                                |         1 |         1 |           0 |     15 |     3 |  0.20 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/credential-security-linux-fallback.test.ts`                                  |        10 |         8 |           2 |     62 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/exec.test.ts`                                                                |       141 |        86 |          55 |    220 |     3 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/fixtures/mcp-oauth-child-driver.ts`                                          |        15 |        14 |           1 |     57 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/adapters/tests/fs-context.test.ts`                                                          |        17 |        12 |           5 |     42 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/logging.test.ts`                                                             |         4 |         2 |           2 |      2 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/mcp-network.test.ts`                                                         |         6 |         4 |           2 |     27 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/mcp-oauth-cross-process.e2e.test.ts`                                         |         8 |         7 |           1 |     27 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/mcp-oauth-lease.test.ts`                                                     |         7 |         4 |           3 |     10 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/mcp-process-lifecycle.test.ts`                                               |        11 |        11 |           0 |     47 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/adapters/tests/mcp-resource-telemetry.test.ts`                                              |        20 |        17 |           3 |     84 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/pdf.test.ts`                                                                 |         3 |         2 |           1 |      9 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/plugins.test.ts`                                                             |        22 |        20 |           2 |    101 |     2 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/provider-builtin-tool-rounds.test.ts`                                        |         7 |         6 |           1 |     54 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/session-model-selection-migration.test.ts`                                   |        34 |        27 |           7 |     97 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/session-store-permanent-deletion.test.ts`                                    |        10 |         8 |           2 |     67 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/shell-init-snapshot.test.ts`                                                 |        28 |        20 |           8 |     71 |     1 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/workspace-hook-trust-phase1.test.ts`                                         |        18 |        17 |           1 |     66 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/adapters/tests/workspace-hook-trust-store.test.ts`                                          |         9 |         7 |           2 |     25 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/package.json`                                                                     |        12 |         6 |           6 |     23 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/app/built-in-node-repl.ts`                                                    |         9 |         8 |           1 |     25 |     3 |  0.12 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/app/create-app.ts`                                                            |       155 |       127 |          28 |    521 |    10 |  0.02 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/src/app/official-plugin-definitions.ts`                                           |       212 |       209 |           3 |   1128 |     9 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/app/official-plugin-runtime.ts`                                               |       257 |       217 |          40 |    788 |    30 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/app/plugin-runtime-features.ts`                                               |        12 |        11 |           1 |     49 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/app/types.ts`                                                                 |         3 |         3 |           0 |     12 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/app/workflow-world-read.ts`                                                   |        25 |        20 |           5 |    119 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/builtin-prompt-command.ts`                                                    |        29 |        29 |           0 |    144 |     3 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-entrypoint.ts`                                                 |        10 |        10 |           0 |     59 |     1 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/canonical-intent-replay.ts`               |         5 |         5 |           0 |     46 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/fork-edit-retry.ts`                       |         6 |         6 |           0 |     35 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/index.ts`                                 |         2 |         2 |           0 |      6 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/queue.ts`                                 |         7 |         6 |           1 |     46 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/session-flow.ts`                          |        24 |        19 |           5 |     80 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/input-intent.ts`                                   |         9 |         8 |           1 |     65 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/types.ts`                                          |         4 |         4 |           0 |     34 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/event-normalizer.ts`                                        |         3 |         3 |           0 |     17 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/product-projection.ts`                                      |        90 |        90 |           0 |    502 |     2 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/projection-rows.ts`                                         |         4 |         4 |           0 |     22 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/sessions-index-projection.ts`                               |         3 |         3 |           0 |     18 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/transcript-hydration.ts`                                    |        22 |        20 |           2 |    108 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/v4-gateway.ts`                                              |        34 |        34 |           0 |    157 |     1 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/plugin-reference-catalog.ts`                                   |         4 |         4 |           0 |     14 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/plugin-ui-surfaces.ts`                                         |        15 |        12 |           3 |     37 |     1 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/plugins.ts`                                                    |        43 |        29 |          14 |     63 |     7 |  0.11 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/server-operations.ts`                                          |       259 |       258 |           1 |    946 |    73 |  0.08 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/server-types.ts`                                               |        13 |        13 |           0 |     65 |     1 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/server.ts`                                                     |        64 |        63 |           1 |    249 |    16 |  0.06 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/session-mapper.ts`                                             |         1 |         1 |           0 |      8 |     1 |  0.13 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/slash-commands.ts`                                             |        10 |         9 |           1 |     42 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-bridge.ts`                                                  |        37 |        31 |           6 |    128 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-workspace-config.ts`                                        |         6 |         6 |           0 |     44 |     1 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/drora-protocol/workspace-model-runtime.ts`                                    |         7 |         7 |           0 |     39 |     1 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/mcp-config.ts`                                                                |         5 |         0 |           5 |     13 |     1 |  0.08 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/official-command-endpoint/endpoint.ts`                                        |         6 |         5 |           1 |     46 |     4 |  0.09 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/plugins.ts`                                                                   |        77 |        74 |           3 |    261 |     9 |  0.03 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/src/skills.ts`                                                                    |        24 |        16 |           8 |     56 |     2 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/src/slash-command-surface.ts`                                                     |         5 |         3 |           2 |      7 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/drora-builtin-model-runtime-integration.test.ts`                            |         4 |         2 |           2 |      5 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/drora-protocol.test.ts`                                                     |        29 |        20 |           9 |     47 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/dynamic-workflow-report-reads.test.ts`                                      |         4 |         2 |           2 |     18 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/dynamic-workflow-run-service.test.ts`                                       |        18 |        15 |           3 |     51 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/guarded-workflow.test.ts`                                                   |        11 |        11 |           0 |     40 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/legacy-cli-personal-provider-config-importer.test.ts`                       |        22 |        22 |           0 |     41 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/paths.test.ts`                                                              |        20 |        15 |           5 |     36 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/plugin-runtime-features.test.ts`                                            |        13 |        10 |           3 |     42 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/plugin-secrets.test.ts`                                                     |        18 |        12 |           6 |     44 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/plugins.test.ts`                                                            |        48 |        45 |           3 |    198 |     3 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/protocol-slash-commands.test.ts`                                            |        83 |        71 |          12 |    395 |    12 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/protocol-unbound-resume.test.ts`                                            |         6 |         4 |           2 |     20 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/tests/script-workflow-child-runtime.test.ts`                                      |         9 |         7 |           2 |     62 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/script-workflow.test.ts`                                                    |         7 |         6 |           1 |     29 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/session-control/standalone-process.e2e.test.ts`                             |         6 |         5 |           1 |     45 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/session-control/standalone-tui-approval.e2e.test.ts`                        |        19 |        16 |           3 |    110 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/bootstrap/tests/session-persistence.test.ts`                                                |        74 |        45 |          29 |    310 |     3 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/bootstrap/tests/v4-gateway.test.ts`                                                         |         5 |         4 |           1 |     24 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/browser-use-plugin/docs/api.json`                                                           |        62 |        48 |          14 |      2 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/browser-use-plugin/docs/overview.md`                                                        |         2 |         1 |           1 |      2 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/browser-use-plugin/docs/playwright.md`                                                      |         6 |         3 |           3 |     11 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/browser-use-plugin/docs/workflow.md`                                                        |         2 |         1 |           1 |      2 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/browser-use-plugin/package.json`                                                            |         2 |         1 |           1 |      4 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/browser-use-plugin/scripts/build.mjs`                                                       |         1 |         1 |           0 |      9 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/browser-use-plugin/skills/control-browser/SKILL.md`                                         |         8 |         4 |           4 |     13 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/bundled-skills/README.md`                                                                   |        10 |         7 |           3 |     83 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/package.json`                                                                           |         8 |         6 |           2 |     22 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/scripts/build.mjs`                                                                      |        38 |        37 |           1 |    210 |     9 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/cli/src/command-center/handlers/model.ts`                                                   |        12 |        11 |           1 |     59 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/src/main.ts`                                                                            |         6 |         6 |           0 |     29 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/src/plugin-host-command.ts`                                                             |        27 |        19 |           8 |    107 |     3 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/cli/src/run.ts`                                                                             |         7 |         7 |           0 |     41 |     1 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/cli/src/sea-runtime-tools.ts`                                                               |        20 |        18 |           2 |    110 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/src/tui-command.ts`                                                                     |        17 |        16 |           1 |     58 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/src/tui-runtime-loader.ts`                                                              |        51 |        51 |           0 |    199 |     2 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/build-sea.test.mjs`                                                               |        12 |        12 |           0 |     45 |     2 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/build.test.mjs`                                                                   |        74 |        74 |           0 |    280 |     2 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/cli.unit.test.ts`                                                                 |        75 |        43 |          32 |    229 |     7 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/clipboard-image.test.ts`                                                          |         5 |         4 |           1 |     17 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/hooks-trust-command.test.ts`                                                      |         9 |         6 |           3 |     34 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/plugin-host-entry.test.mjs`                                                       |        23 |        16 |           7 |     90 |     6 |  0.07 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/sea-runtime-tools.test.ts`                                                        |        12 |        10 |           2 |     42 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/tui-login-polling.test.ts`                                                        |        13 |        12 |           1 |     21 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/cli/tests/upload-sea-smb.test.mjs`                                                          |         4 |         3 |           1 |     17 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/contracts/package.json`                                                                     |         2 |         1 |           1 |      4 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/config/index.ts`                                                              |         6 |         6 |           0 |     24 |     1 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/events/session.events.ts`                                                     |         3 |         3 |           0 |     24 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/hooks/index.ts`                                                               |         9 |         9 |           0 |     74 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/index.ts`                                                                     |         4 |         4 |           0 |     33 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/interfaces/index.ts`                                                          |         4 |         4 |           0 |     26 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/interfaces/mcp.port.ts`                                                       |        33 |        33 |           0 |    196 |     7 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/interfaces/session.port.ts`                                                   |        15 |        15 |           0 |    100 |     4 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/plugins/index.ts`                                                             |        57 |        53 |           4 |    295 |    14 |  0.05 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/skills/index.ts`                                                              |         1 |         1 |           0 |      6 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/contracts/src/tools/index.ts`                                                               |         6 |         6 |           0 |     52 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/package.json`                                                                          |        10 |         7 |           3 |     26 |     1 |  0.04 | <50%   |                 |
| `apps/drora-cli/packages/core/src/browser-client/documentation.ts`                                                   |        11 |         6 |           5 |     16 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/browser-client/facade.ts`                                                          |         1 |         1 |           0 |      9 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/context/sections/request-user-context.ts`                                          |         5 |         4 |           1 |     22 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/hooks/configured-runner-callback.ts`                                               |        14 |        12 |           2 |      4 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/hooks/configured-runner-input.ts`                                                  |        11 |         8 |           3 |     27 |     2 |  0.07 | <50%   |                 |
| `apps/drora-cli/packages/core/src/index.ts`                                                                          |        56 |        56 |           0 |    201 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/mcp/index.ts`                                                                      |        18 |        16 |           2 |     97 |     1 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/core/src/memory/memory-file-path.ts`                                                        |         5 |         4 |           1 |     17 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/memory/project-root.ts`                                                            |         8 |         7 |           1 |     23 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/permission/service.ts`                                                             |        89 |        82 |           7 |    260 |     2 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/core/src/repl/node-repl-session.ts`                                                         |        12 |         7 |           5 |     45 |     3 |  0.07 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/runtime/agent-runtime.ts`                                                          |        12 |        12 |           0 |     43 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/runtime/deps.ts`                                                                   |         1 |         1 |           0 |      1 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/helpers/conversation-quotes.ts`                                            |        35 |        34 |           1 |    104 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/helpers/runtime-provider-request-messages.ts`                              |        23 |        18 |           5 |     61 |     1 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/helpers/runtime-tools.ts`                                                  |         3 |         3 |           0 |     15 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/runtime/helpers/turn-errors.ts`                                                    |         4 |         4 |           0 |     39 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/internal-methods.ts`                                                       |         3 |         3 |           0 |     21 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/runtime/internal.ts`                                                               |        18 |        18 |           0 |     50 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/runtime/methods/context.ts`                                                        |         7 |         6 |           1 |     43 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/methods/index.ts`                                                          |         3 |         3 |           0 |     18 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/methods/input-intent-persistence.ts`                                       |         3 |         3 |           0 |     24 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/methods/streaming-tool-coordinator.ts`                                     |         4 |         4 |           0 |     37 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/methods/turn-loop-state.ts`                                                |         7 |         7 |           0 |     31 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/methods/turn-loop.ts`                                                      |       102 |       102 |           0 |    383 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/runtime/methods/turn.ts`                                                           |        46 |        46 |           0 |    161 |     1 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/core/src/runtime/types.ts`                                                                  |        27 |        27 |           0 |     98 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/subagent/persistent-memory-prompt.ts`                                              |         5 |         3 |           2 |     17 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/subagent/persistent-memory.ts`                                                     |        27 |        19 |           8 |     65 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/subagent/runner.ts`                                                                |         4 |         4 |           0 |     35 |     2 |  0.06 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/call-runner.ts`                                                      |         3 |         2 |           1 |      5 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/impl.ts`                                                             |         3 |         3 |           0 |     15 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts`                                           |         5 |         4 |           1 |     32 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/permission-capability.ts`                                            |        23 |        22 |           1 |     81 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/src/tool/executor/permission-flow.ts`                                                  |        10 |        10 |           0 |     42 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/permission-response.ts`                                              |         2 |         1 |           1 |      4 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/permission-rules-persistence.ts`                                     |        32 |        30 |           2 |    116 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/permission-suggestions.ts`                                           |         9 |         9 |           0 |     55 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/result-display.ts`                                                   |        12 |        11 |           1 |     39 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/executor/types.ts`                                                            |        13 |        12 |           1 |     38 |     1 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/bash-command-rule-evaluator.ts`                                      |         3 |         3 |           0 |     39 |     1 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/bash-cwd-policy.ts`                                                  |        11 |        11 |           0 |     43 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/bash-readonly-policy-argv.ts`                                        |         4 |         3 |           1 |     28 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/index.ts`                                                            |         9 |         9 |           0 |     60 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/node-repl.ts`                                                        |        12 |         7 |           5 |     44 |     3 |  0.07 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/read-pdf.ts`                                                         |        21 |        14 |           7 |     30 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/read-text.ts`                                                        |        14 |        11 |           3 |     56 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/reply-to-channel.ts`                                                 |         8 |         6 |           2 |     20 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/skill.ts`                                                            |         6 |         5 |           1 |     10 |     3 |  0.30 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/handlers/workflow-script-path.ts`                                             |         4 |         3 |           1 |     15 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/path-normalization.ts`                                                        |         5 |         4 |           1 |     28 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/src/tool/types.ts`                                                                     |         6 |         6 |           0 |     17 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/bash-handler.test.ts`                                                            |        45 |        27 |          18 |     69 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/bash-permission.test.ts`                                                         |         9 |         8 |           1 |     69 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/context-builder.test.ts`                                                         |         3 |         2 |           1 |      5 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/edit-tool-contract.test.ts`                                                      |        11 |         8 |           3 |     30 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/file-tool-port.test.ts`                                                          |        19 |        13 |           6 |     47 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/fill-workflow-hole-tool.test.ts`                                                 |         8 |         5 |           3 |      9 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/guarded-approval.test.ts`                                                        |        18 |        16 |           2 |    100 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/mcp-runtime.test.ts`                                                             |        84 |         8 |          76 |    219 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/mcp-tool-bridge.test.ts`                                                         |        56 |        54 |           2 |    276 |    12 |  0.04 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/memory-test-utils.ts`                                                            |        40 |        27 |          13 |     71 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/node-repl-browser-injection.test.ts`                                             |         8 |         7 |           1 |     27 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/permission-logging.test.ts`                                                      |        31 |        26 |           5 |     72 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/permission-service.test.ts`                                                      |        32 |        32 |           0 |     99 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/persistent-agent-memory.test.ts`                                                 |         6 |         4 |           2 |     16 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/plan-file-continuity.test.ts`                                                    |         4 |         3 |           1 |     15 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/post-compact-file-restore.test.ts`                                               |         6 |         5 |           1 |     33 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/prompt-attachments.test.ts`                                                      |        14 |         8 |           6 |     57 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/read-tool-contract.test.ts`                                                      |        10 |         7 |           3 |     24 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/runtime-compact.test.ts`                                                         |        27 |        21 |           6 |     88 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/runtime-context-announcements.test.ts`                                           |         6 |         5 |           1 |     30 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/runtime-memory-dream.test.ts`                                                    |         5 |         3 |           2 |      8 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/runtime-memory-permission.test.ts`                                               |         4 |         2 |           2 |     12 |     1 |  0.08 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/runtime-memory.test.ts`                                                          |        20 |         9 |          11 |      8 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/runtime-persistence.test.ts`                                                     |         6 |         4 |           2 |     17 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/runtime-tool-loop.test.ts`                                                       |        53 |        31 |          22 |    165 |     1 |  0.01 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/saved-workflow-tools.test.ts`                                                    |         3 |         2 |           1 |      4 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/subagent-background.test.ts`                                                     |        76 |        76 |           0 |    252 |     1 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/subagent-explore-permission-mode.test.ts`                                        |         9 |         8 |           1 |     45 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/subagent-explore.test.ts`                                                        |        30 |        29 |           1 |    122 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/subagent-tool-events.test.ts`                                                    |        12 |        10 |           2 |     56 |     1 |  0.02 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/tool-call-started-capability.test.ts`                                            |        30 |        30 |           0 |    142 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/tool-contracts.test.ts`                                                          |        11 |        11 |           0 |     71 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/tool-executor-read-deny-probe.test.ts`                                           |        11 |         8 |           3 |     34 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/tool-executor-trace.test.ts`                                                     |         3 |         3 |           0 |     39 |     3 |  0.08 | <50%   |                 |
| `apps/drora-cli/packages/core/tests/workflow-script-file-sources.test.ts`                                            |        10 |         5 |           5 |      5 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/core/tests/workflow-script-path.test.ts`                                                    |        11 |         6 |           5 |     30 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/debug/package.json`                                                                         |         2 |         1 |           1 |      4 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/debug/server/index.ts`                                                                      |        20 |        19 |           1 |     96 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/debug/server/network-capture.ts`                                                            |         8 |         7 |           1 |     30 |     1 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/debug/server/sources.ts`                                                                    |        22 |        18 |           4 |     73 |     6 |  0.08 | <50%   |                 |
| `apps/drora-cli/packages/debug/tests/analyzer.test.ts`                                                               |         1 |         1 |           0 |      5 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/debug/tests/api.test.ts`                                                                    |         4 |         3 |           1 |     13 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/debug/tests/observation-events.test.ts`                                                     |         9 |         7 |           2 |     37 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/design-plugin/test/design-plugin.test.ts`                                                   |        54 |        45 |           9 |    287 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/drora-site-plugin/package.json`                                                             |         2 |         1 |           1 |      4 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/dynamic-workflow-runtime/tests/child-entry-file.test.ts`                                    |         7 |         6 |           1 |     36 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/dynamic-workflow-runtime/tests/child-source-bundled.test.ts`                                |        13 |        10 |           3 |     54 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/dynamic-workflow-runtime/tests/child-spawn-args.test.ts`                                    |         7 |         6 |           1 |     36 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/node-repl-host/package.json`                                                                |         4 |         2 |           2 |      9 |     1 |  0.11 | <50%   |                 |
| `apps/drora-cli/packages/node-repl-host/scripts/build.mjs`                                                           |        28 |        24 |           4 |    158 |    12 |  0.08 | <50%   |                 |
| `apps/drora-cli/packages/node-repl-host/src/browser-bridge.ts`                                                       |        16 |         8 |           8 |     69 |     4 |  0.06 | <50%   | `★sample:clTok` |
| `apps/drora-cli/packages/node-repl-host/src/cua-bridge.ts`                                                           |         5 |         4 |           1 |     29 |     2 |  0.07 | <50%   |                 |
| `apps/drora-cli/packages/node-repl-host/src/server.ts`                                                               |         5 |         3 |           2 |     28 |     5 |  0.18 | <50%   |                 |
| `apps/drora-cli/packages/node-repl-host/test/computer-use-onboarding.test.ts`                                        |         3 |         2 |           1 |     22 |     1 |  0.05 | <50%   |                 |
| `apps/drora-cli/packages/node-repl-host/test/mcp-server.test.ts`                                                     |         8 |         5 |           3 |     21 |     2 |  0.10 | <50%   |                 |
| `apps/drora-cli/packages/tui/package.json`                                                                           |         2 |         1 |           1 |      4 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/visualize-plugin/skills/visualize/assets/runtime-manifest.json`                             |         4 |         2 |           2 |      4 |     0 |  0.00 | <50%   |                 |
| `apps/drora-cli/packages/zcode-cua-plugin/package.json`                                                              |        10 |         8 |           2 |     65 |     2 |  0.03 | <50%   |                 |
| `apps/drora-cli/packages/zcode-cua-plugin/scripts/sync-cache.mjs`                                                    |         2 |         1 |           1 |      5 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `apps/drora-cli/pnpm-lock.yaml`                                                                                      |      5504 |      3635 |        1869 |  12262 |    80 |  0.01 | <50%   |                 |
| `apps/drora-cli/pnpm-workspace.yaml`                                                                                 |        10 |        10 |           0 |     37 |     2 |  0.05 | <50%   |                 |
| `apps/drora-cli/tools/provider-regression/package.json`                                                              |         6 |         3 |           3 |     15 |     0 |  0.00 | <50%   | `★sample:clTok` |
| `architecture-policy.yaml`                                                                                           |       753 |       590 |         163 |   3469 |    99 |  0.03 | <50%   |                 |
| `CONTEXT.md`                                                                                                         |        21 |        21 |           0 |    175 |     5 |  0.03 | <50%   |                 |
| `DESIGN.md`                                                                                                          |        16 |        16 |           0 |    125 |     0 |  0.00 | <50%   |                 |
| `docs/bots.md`                                                                                                       |         8 |         8 |           0 |     55 |     4 |  0.07 | <50%   |                 |
| `docs/ci/affected-unit-test-baseline.md`                                                                             |         7 |         7 |           0 |     56 |     3 |  0.05 | <50%   |                 |
| `docs/conversation-session-case-catalog.md`                                                                          |        73 |        73 |           0 |    652 |     2 |  0.00 | <50%   |                 |
| `docs/desktop/oss-cdn-multi-target-migration.md`                                                                     |        10 |         9 |           1 |     39 |     4 |  0.10 | <50%   |                 |
| `docs/monitoring/process-resource-telemetry.md`                                                                      |         2 |         1 |           1 |      1 |     0 |  0.00 | <50%   |                 |
| `docs/plugins/2026-09-17-official-plugin-version-sync-spec.md`                                                       |        31 |        16 |          15 |     22 |     3 |  0.14 | <50%   |                 |
| `docs/testing/conversation-session-e2e-coverage-matrix.md`                                                           |        95 |        95 |           0 |    783 |     4 |  0.01 | <50%   |                 |
| `docs/testing/pre-push-hook.md`                                                                                      |         9 |         9 |           0 |    108 |     9 |  0.08 | <50%   |                 |
| `docs/ui/settings-personalization.md`                                                                                |        10 |         6 |           4 |     27 |     1 |  0.04 | <50%   |                 |
| `docs/web-remote-control/web-remote-control-architecture.md`                                                         |        12 |         6 |           6 |     47 |     4 |  0.09 | <50%   |                 |
| `docs/windows-test-compatibility.md`                                                                                 |        50 |        35 |          15 |    115 |     0 |  0.00 | <50%   |                 |
| `knip.json`                                                                                                          |        28 |        23 |           5 |     47 |     0 |  0.00 | <50%   |                 |
| `NOTICE.md`                                                                                                          |         2 |         1 |           1 |     17 |     1 |  0.06 | <50%   |                 |
| `package.json`                                                                                                       |        23 |        14 |           9 |    115 |     6 |  0.05 | <50%   |                 |
| `packages/client/src/globals.d.ts`                                                                                   |        47 |        47 |           0 |    181 |     9 |  0.05 | <50%   |                 |
| `packages/client/src/messageport.ts`                                                                                 |         2 |         2 |           0 |      4 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/client/src/remoteServiceAccess.ts`                                                                         |        20 |        19 |           1 |    106 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/dmg_background.png`                                                                          |       269 |       115 |         154 |   3087 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/dmg_background@2x.png`                                                                       |       379 |       116 |         263 |   6619 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icon_installer.icns`                                                                         |     12058 |       808 |       11250 | 297305 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/build/icon_installer.ico`                                                                          |      1312 |       933 |         379 |  10739 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icon_installer.png`                                                                          |      6564 |       289 |        6275 | 155088 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icon_windows.png`                                                                            |      2110 |       291 |        1819 |  44617 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icon.icns`                                                                                   |      5020 |       823 |        4197 | 109661 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icon.ico`                                                                                    |      1315 |       931 |         384 |   9486 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icon.png`                                                                                    |      1690 |       298 |        1392 |  34904 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icons/1024x1024.png`                                                                         |      2110 |       291 |        1819 |  44617 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icons/128x128.png`                                                                           |       104 |        45 |          59 |   1417 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/build/icons/16x16.png`                                                                             |        22 |         7 |          15 |    266 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icons/24x24.png`                                                                             |        27 |         5 |          22 |    299 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icons/256x256.png`                                                                           |       292 |        94 |         198 |   5270 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icons/32x32.png`                                                                             |        32 |         9 |          23 |    374 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icons/48x48.png`                                                                             |        41 |        16 |          25 |    498 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/build/icons/512x512.png`                                                                           |      1401 |       241 |        1160 |  29225 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/build/icons/64x64.png`                                                                             |        69 |        34 |          35 |    670 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/electron-builder.config.js`                                                                        |       229 |       213 |          16 |   1048 |    15 |  0.01 | <50%   |                 |
| `packages/desktop/package.json`                                                                                      |        13 |        10 |           3 |     90 |     2 |  0.02 | <50%   |                 |
| `packages/desktop/scripts/auto-update-source-security-smoke.mjs`                                                     |        96 |        73 |          23 |    478 |     8 |  0.02 | <50%   |                 |
| `packages/desktop/scripts/bundle.mjs`                                                                                |        16 |        13 |           3 |     48 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/computer-use-producer.mjs`                                                                 |         2 |         1 |           1 |     10 |     2 |  0.20 | <50%   | `★sample:pkTok` |
| `packages/desktop/scripts/devElectronAppBundle.mjs`                                                                  |        19 |        14 |           5 |     33 |     3 |  0.09 | <50%   |                 |
| `packages/desktop/scripts/ensure-local-runtime-assets.mjs`                                                           |         7 |         7 |           0 |     30 |     1 |  0.03 | <50%   | `★sample:pkTok` |
| `packages/desktop/scripts/gen-ui-e2e.mjs`                                                                            |        16 |        12 |           4 |      9 |     1 |  0.11 | <50%   |                 |
| `packages/desktop/scripts/koffi-package-assets.mjs`                                                                  |        46 |        42 |           4 |    155 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/mcp-apps-host-e2e.mjs`                                                                     |        66 |        44 |          22 |    170 |     5 |  0.03 | <50%   |                 |
| `packages/desktop/scripts/mcp-apps-host-fixture/agent.ts`                                                            |        22 |        19 |           3 |     60 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/mcp-apps-host-fixture/managed-checks.ts`                                                   |        46 |        46 |           0 |    230 |     2 |  0.01 | <50%   |                 |
| `packages/desktop/scripts/mcp-apps-host-fixture/managed-environment.ts`                                              |        18 |        17 |           1 |     75 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/mcp-apps-host-fixture/managed-renderer.tsx`                                                |        41 |        40 |           1 |    180 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/mcp-apps-host-fixture/pointer-input.ts`                                                    |         2 |         2 |           0 |      4 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/scripts/mcp-apps-host-fixture/widget.tsx`                                                          |        68 |        68 |           0 |    229 |     2 |  0.01 | <50%   |                 |
| `packages/desktop/scripts/mcp-apps-host-options.mjs`                                                                 |         3 |         3 |           0 |     30 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/powershell-command.mjs`                                                                    |         4 |         4 |           0 |     32 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/prepare-agent-node-bundle.mjs`                                                             |       286 |       251 |          35 |   1294 |    16 |  0.01 | <50%   |                 |
| `packages/desktop/scripts/prepare-runtime-assets.mjs`                                                                |        10 |         5 |           5 |     64 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/promote-plugin-e2e.mjs`                                                                    |         7 |         6 |           1 |     30 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/run-production-build.mjs`                                                                  |         3 |         3 |           0 |     22 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/sharp-package-assets.mjs`                                                                  |       435 |       164 |         271 |   1450 |     9 |  0.01 | <50%   |                 |
| `packages/desktop/scripts/test-installer-nsh-smoke.mjs`                                                              |         4 |         4 |           0 |     32 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/test-installer-preserve-files.mjs`                                                         |        16 |         8 |           8 |     40 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/scripts/windows-cua-helper-assets.mjs`                                                             |        60 |        48 |          12 |    162 |     2 |  0.01 | <50%   |                 |
| `packages/desktop/src/host/index.ts`                                                                                 |        74 |        74 |           0 |    273 |     4 |  0.01 | <50%   |                 |
| `packages/desktop/src/host/windowHostAttachmentRpcPolicy.ts`                                                         |         6 |         6 |           0 |     26 |     3 |  0.12 | <50%   |                 |
| `packages/desktop/src/host/windowHostControllerService.ts`                                                           |         1 |         1 |           0 |      5 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/host/windowRemoteConnectionRegistry.ts`                                                        |        11 |        11 |           0 |     59 |     1 |  0.02 | <50%   |                 |
| `packages/desktop/src/main/aboutWindow.ts`                                                                           |        25 |        10 |          15 |    109 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/main/autoUpdater.ts`                                                                           |       115 |        12 |         103 |    314 |    10 |  0.03 | <50%   |                 |
| `packages/desktop/src/main/cuaAccessibilitySettings.ts`                                                              |        18 |        11 |           7 |     43 |     2 |  0.05 | <50%   |                 |
| `packages/desktop/src/main/desktopCuaHelperInstaller.ts`                                                             |        18 |        18 |           0 |    103 |    14 |  0.14 | <50%   |                 |
| `packages/desktop/src/main/desktopDeepLinkUrl.ts`                                                                    |        19 |        13 |           6 |     57 |     7 |  0.12 | <50%   |                 |
| `packages/desktop/src/main/desktopHostProcess.ts`                                                                    |        74 |        68 |           6 |    290 |    23 |  0.08 | <50%   |                 |
| `packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts`                                                      |        38 |        23 |          15 |     80 |     5 |  0.06 | <50%   |                 |
| `packages/desktop/src/main/desktopMainIpcPlatform.ts`                                                                |       252 |       251 |           1 |    935 |     8 |  0.01 | <50%   |                 |
| `packages/desktop/src/main/desktopOAuthDeepLink.ts`                                                                  |        55 |        32 |          23 |     53 |     3 |  0.06 | <50%   |                 |
| `packages/desktop/src/main/desktopRemoteSessions.ts`                                                                 |        11 |        10 |           1 |     29 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/src/main/desktopRuntimeEnv.ts`                                                                     |        54 |        48 |           6 |    232 |    21 |  0.09 | <50%   |                 |
| `packages/desktop/src/main/desktopSecondInstanceDeepLink.ts`                                                         |        17 |         0 |          17 |     49 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/main/desktopWindowChrome.ts`                                                                   |         5 |         3 |           2 |     18 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/main/desktopWindowLifecycle.ts`                                                                |         9 |         9 |           0 |     22 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/main/embedded-browser-permission-contract/module.ts`                                           |         5 |         3 |           2 |     20 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/main/fileApplications.ts`                                                                      |         5 |         4 |           1 |     29 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/src/main/index.ts`                                                                                 |       224 |       148 |          76 |    808 |    23 |  0.03 | <50%   |                 |
| `packages/desktop/src/main/pluginSandbox/module.ts`                                                                  |         2 |         1 |           1 |     12 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/main/remoteCdn.ts`                                                                             |         1 |         1 |           0 |      9 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/main/web-remote-relay/index.ts`                                                                |         4 |         4 |           0 |     41 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/src/preload/index.ts`                                                                              |        73 |        73 |           0 |    372 |    18 |  0.05 | <50%   | `★sample:pkTok` |
| `packages/desktop/src/renderer/index.html`                                                                           |        19 |        10 |           9 |    109 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/src/renderer/src/desktopPlatform.ts`                                                               |        21 |        21 |           0 |    101 |    13 |  0.13 | <50%   |                 |
| `packages/desktop/src/renderer/src/main.tsx`                                                                         |         5 |         5 |           0 |     28 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/src/renderer/src/plugin-sandbox/aliasApi.ts`                                                       |        25 |        24 |           1 |     93 |     2 |  0.02 | <50%   |                 |
| `packages/desktop/src/renderer/src/plugin-sandbox/aliasRuntime.ts`                                                   |        84 |        83 |           1 |    255 |     5 |  0.02 | <50%   | `★sample:pkTok` |
| `packages/desktop/src/renderer/src/remoteWorkspaceServicePortBridge.ts`                                              |        12 |        11 |           1 |     54 |     1 |  0.02 | <50%   |                 |
| `packages/desktop/test/devElectronAppBundle.test.ts`                                                                 |         8 |         5 |           3 |     11 |     2 |  0.18 | <50%   |                 |
| `packages/desktop/test/e2e/feedback/upload/feedback-upload-privacy.test.ts`                                          |         4 |         3 |           1 |     15 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/test/e2e/remote-control/authentication/manual-review/pending/web-remote-control-auth-gate.test.ts` |        14 |        14 |           0 |     43 |     2 |  0.05 | <50%   |                 |
| `packages/desktop/test/ensureElectronRuntime.test.ts`                                                                |        11 |        10 |           1 |     63 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/test/powershell-command.test.ts`                                                                   |         9 |         8 |           1 |     54 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/test/run-production-build.test.ts`                                                                 |         1 |         1 |           0 |      5 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/desktop/test/telemetryFieldContract.test.ts`                                                               |         6 |         5 |           1 |     30 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/test/tsupChunkIsolation.test.ts`                                                                   |        27 |        24 |           3 |     75 |     6 |  0.08 | <50%   |                 |
| `packages/desktop/test/windowsInstallerCompile.test.ts`                                                              |         3 |         3 |           0 |     29 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/tsconfig.e2e.json`                                                                                 |         4 |         3 |           1 |      8 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/tsconfig.main.json`                                                                                |         4 |         3 |           1 |     26 |     3 |  0.12 | <50%   |                 |
| `packages/desktop/tsup.config.ts`                                                                                    |        22 |        21 |           1 |    138 |     4 |  0.03 | <50%   | `★sample:pkTok` |
| `packages/desktop/vite.config.ts`                                                                                    |         1 |         1 |           0 |      9 |     0 |  0.00 | <50%   |                 |
| `packages/desktop/wdio.conf.ts`                                                                                      |        20 |        20 |           0 |    116 |     5 |  0.04 | <50%   |                 |
| `packages/drora-server-cli/scripts/verify-remote-ssh.mjs`                                                            |         6 |         6 |           0 |     69 |     5 |  0.07 | <50%   |                 |
| `packages/drora-server-cli/test/packaging.test.ts`                                                                   |         0 |         0 |           0 |      0 |     0 |  0.00 | <50%   |                 |
| `packages/e2e-report/package.json`                                                                                   |         4 |         2 |           2 |      0 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/plugin-api/package.json`                                                                                   |         3 |         2 |           1 |      3 |     0 |  0.00 | <50%   |                 |
| `packages/provider-node/package.json`                                                                                |         1 |         0 |           1 |      5 |     0 |  0.00 | <50%   |                 |
| `packages/rpc/src/index.ts`                                                                                          |         1 |         1 |           0 |      1 |     0 |  0.00 | <50%   |                 |
| `packages/rpc/src/protocol.ts`                                                                                       |        30 |        29 |           1 |    136 |     0 |  0.00 | <50%   |                 |
| `packages/server/src/http.ts`                                                                                        |         8 |         6 |           2 |     22 |     3 |  0.14 | <50%   |                 |
| `packages/server/tsup.config.ts`                                                                                     |         2 |         2 |           0 |     18 |     1 |  0.06 | <50%   |                 |
| `packages/services/package.json`                                                                                     |         5 |         4 |           1 |     19 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/accessor.ts`                                                                                  |         7 |         7 |           0 |     58 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/bots/providers/webhookProvider.ts`                                                            |       102 |        27 |          75 |     24 |     3 |  0.13 | <50%   |                 |
| `packages/services/src/coding-plan-subscription/codingPlanSubscription.ts`                                           |         1 |         0 |           1 |      4 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/coding-plan-subscription/codingPlanSubscriptionService.ts`                                    |         1 |         0 |           1 |      3 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/collection.ts`                                                                                |        46 |        38 |           8 |    127 |     4 |  0.03 | <50%   |                 |
| `packages/services/src/cua-permission-broker/cuaPipSessionService.ts`                                                |         6 |         6 |           0 |     55 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/cua-permission-broker/index.ts`                                                               |        14 |        10 |           4 |     37 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/cua-permission-broker/windowsCuaDevHelperHost.ts`                                             |         7 |         7 |           0 |     25 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/cua-permission-broker/windowsCuaDevRuntime.ts`                                                |        61 |        53 |           8 |    231 |     5 |  0.02 | <50%   |                 |
| `packages/services/src/cua-permission-broker/windowsCuaHelperHostSupport.ts`                                         |         9 |         5 |           4 |     31 |     1 |  0.03 | <50%   | `★sample:pkTok` |
| `packages/services/src/drora-agent/droraAgent.ts`                                                                    |        71 |        71 |           0 |    206 |    32 |  0.16 | <50%   |                 |
| `packages/services/src/drora-agent/droraAgentConnectionScope.ts`                                                     |         5 |         5 |           0 |     46 |     1 |  0.02 | <50%   |                 |
| `packages/services/src/drora-agent/droraAgentPluginParams.ts`                                                        |         9 |         9 |           0 |     25 |     2 |  0.08 | <50%   |                 |
| `packages/services/src/drora-agent/droraAgentService.ts`                                                             |       359 |       357 |           2 |   1070 |    55 |  0.05 | <50%   |                 |
| `packages/services/src/drora-agent/droraTaskIndexSyncer.ts`                                                          |         6 |         5 |           1 |     31 |     4 |  0.13 | <50%   |                 |
| `packages/services/src/drora-agent/droraTaskServiceAdapter.ts`                                                       |        10 |         7 |           3 |     41 |     4 |  0.10 | <50%   |                 |
| `packages/services/src/drora-agent/independentPlanSupport.ts`                                                        |        55 |        54 |           1 |    194 |     4 |  0.02 | <50%   |                 |
| `packages/services/src/feedback/feedbackLogArchive.ts`                                                               |        14 |        13 |           1 |     91 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/services/src/gen-ui/adapters/files.ts`                                                                     |        13 |        12 |           1 |     89 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/index.ts`                                                                                     |        13 |        13 |           0 |     84 |     1 |  0.01 | <50%   | `★sample:pkTok` |
| `packages/services/src/memory/projectMemoryStableRead.ts`                                                            |        15 |        14 |           1 |    119 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/node.ts`                                                                                      |       491 |       450 |          41 |   2455 |    92 |  0.04 | <50%   |                 |
| `packages/services/src/oauth/providers/configUtils.ts`                                                               |         3 |         3 |           0 |     23 |     1 |  0.04 | <50%   |                 |
| `packages/services/src/oauth/providers/zaiProviderConfig.ts`                                                         |         1 |         1 |           0 |      5 |     1 |  0.20 | <50%   |                 |
| `packages/services/src/plugins/pluginManagement.ts`                                                                  |        15 |        15 |           0 |     67 |     4 |  0.06 | <50%   |                 |
| `packages/services/src/plugins/pluginManagementService.ts`                                                           |        10 |        10 |           0 |     48 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/process/processTreeWaiter.ts`                                                                 |        24 |        23 |           1 |     82 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/project-storage/module.ts`                                                                    |        11 |        10 |           1 |     16 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/project/index.ts`                                                                             |        23 |        19 |           4 |     86 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/services/src/session/sessionModeOptions.ts`                                                                |         7 |         7 |           0 |     31 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/services/src/setting/normalizeSettingsPatch.ts`                                                            |        13 |        13 |           0 |     41 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/services/src/setting/settingService.ts`                                                                    |        31 |        31 |           0 |    129 |     2 |  0.02 | <50%   | `★sample:pkTok` |
| `packages/services/src/subagents/subagentRuntimeConfig.ts`                                                           |        27 |        26 |           1 |    124 |     0 |  0.00 | <50%   |                 |
| `packages/services/src/task-groups/module.ts`                                                                        |         2 |         1 |           1 |      3 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/share-ui/package.json`                                                                                     |         0 |         0 |           0 |      0 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/shared/package.json`                                                                                       |         3 |         3 |           0 |     15 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/bots.ts`                                                                                        |         4 |         4 |           0 |     27 |     4 |  0.15 | <50%   |                 |
| `packages/shared/src/channels.ts`                                                                                    |       138 |       138 |           0 |    607 |    28 |  0.05 | <50%   |                 |
| `packages/shared/src/clientConfig.ts`                                                                                |        29 |        29 |           0 |    105 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/conversationSelection.ts`                                                                       |         7 |         7 |           0 |     30 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/desktopMenu.ts`                                                                                 |         8 |         8 |           0 |     43 |     2 |  0.05 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/command.ts`                                                                   |        35 |        21 |          14 |    174 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/controller.ts`                                                                |         5 |         5 |           0 |     18 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/core.ts`                                                                      |         4 |         4 |           0 |     39 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/delta.ts`                                                                     |         7 |         7 |           0 |     55 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/index.ts`                                                                     |         4 |         4 |           0 |     31 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/input-intent.ts`                                                              |        93 |        93 |           0 |    405 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/rows.ts`                                                                      |         4 |         3 |           1 |     17 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/sessions-index.ts`                                                            |         5 |         5 |           0 |     18 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/shared/src/drora-protocol-v4/snapshot.ts`                                                                  |         5 |         5 |           0 |     44 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/transport.ts`                                                                 |        14 |        14 |           0 |     90 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol-v4/wire-assembler.ts`                                                            |        32 |        26 |           6 |     90 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-protocol/index.ts`                                                                        |       566 |       565 |           1 |   1922 |    79 |  0.04 | <50%   | `★sample:pkTok` |
| `packages/shared/src/drora-slash-command-help.ts`                                                                    |       392 |       201 |         191 |     43 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/drora-task-types-core.ts`                                                                       |        31 |        28 |           3 |     83 |     8 |  0.10 | <50%   |                 |
| `packages/shared/src/droraEndpoint.ts`                                                                               |        16 |        16 |           0 |     68 |     5 |  0.07 | <50%   | `★sample:pkTok` |
| `packages/shared/src/index.ts`                                                                                       |        28 |        27 |           1 |    148 |     3 |  0.02 | <50%   |                 |
| `packages/shared/src/mcp-apps/index.ts`                                                                              |         1 |         1 |           0 |      4 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/mcp-apps/module.ts`                                                                             |         2 |         1 |           1 |      2 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/mcp-apps/schemas.ts`                                                                            |        32 |        32 |           0 |    135 |     4 |  0.03 | <50%   |                 |
| `packages/shared/src/platform.ts`                                                                                    |        77 |        74 |           3 |    291 |     2 |  0.01 | <50%   |                 |
| `packages/shared/src/plugin-marketplaces.ts`                                                                         |         8 |         6 |           2 |     36 |     2 |  0.06 | <50%   |                 |
| `packages/shared/src/protocol.ts`                                                                                    |        50 |        48 |           2 |    273 |     2 |  0.01 | <50%   |                 |
| `packages/shared/src/remote-workspace-identity.ts`                                                                   |         4 |         3 |           1 |     13 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/remoteAppConfig.ts`                                                                             |        17 |         0 |          17 |     38 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/remoteEnvironmentKey.ts`                                                                        |         4 |         3 |           1 |     17 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/runtimeEnv.ts`                                                                                  |        22 |        18 |           4 |    115 |     6 |  0.05 | <50%   |                 |
| `packages/shared/src/server-remote.ts`                                                                               |        89 |        89 |           0 |    328 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/test-ids.ts`                                                                                    |        38 |        38 |           0 |    270 |     0 |  0.00 | <50%   |                 |
| `packages/shared/src/tool-identity.ts`                                                                               |        53 |        53 |           0 |    219 |     2 |  0.01 | <50%   |                 |
| `packages/shared/src/validation.ts`                                                                                  |        69 |        69 |           0 |    229 |     2 |  0.01 | <50%   | `★sample:pkTok` |
| `packages/shared/src/validationAppSettings.ts`                                                                       |        77 |        77 |           0 |    505 |     4 |  0.01 | <50%   |                 |
| `packages/shared/src/web-remote-control.ts`                                                                          |        16 |        16 |           0 |     92 |     2 |  0.02 | <50%   |                 |
| `packages/ui/package.json`                                                                                           |        27 |        26 |           1 |    129 |     4 |  0.03 | <50%   |                 |
| `packages/ui/src/app-shell/AnimatedSidePanePanel.tsx`                                                                |        46 |        46 |           0 |    156 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/app-shell/sidePaneTabPresentation.ts`                                                               |        12 |        12 |           0 |     59 |     1 |  0.02 | <50%   |                 |
| `packages/ui/src/app-shell/SidePaneTabTrigger.tsx`                                                                   |        25 |        25 |           0 |    125 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/app-shell/types.ts`                                                                                 |        11 |        11 |           0 |     38 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/app-shell/WorkspaceShellLayout.tsx`                                                                 |       240 |       219 |          21 |    700 |     6 |  0.01 | <50%   |                 |
| `packages/ui/src/App.tsx`                                                                                            |        33 |        32 |           1 |     78 |     2 |  0.03 | <50%   |                 |
| `packages/ui/src/BotsDialog.tsx`                                                                                     |         3 |         2 |           1 |     16 |     2 |  0.13 | <50%   |                 |
| `packages/ui/src/chat-input-toolbar/contextUsage.tsx`                                                                |       193 |        58 |         135 |     20 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/components/ai-elements/message.tsx`                                                                 |       100 |        94 |           6 |    184 |     1 |  0.01 | <50%   |                 |
| `packages/ui/src/components/mobile-ui/DroraAppLogo.tsx`                                                              |         7 |         5 |           2 |     44 |     6 |  0.14 | <50%   |                 |
| `packages/ui/src/components/ui/DroraAboutLogo.tsx`                                                                   |        50 |        10 |          40 |    949 |     5 |  0.01 | <50%   | `★sample:pkTok` |
| `packages/ui/src/hooks/useAppPanels.ts`                                                                              |        50 |        50 |           0 |    116 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/hooks/usePluginStoreOrder.ts`                                                                       |         6 |         5 |           1 |     26 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/hooks/useSubagents.ts`                                                                              |        11 |         8 |           3 |     37 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/i18n/IntlProvider.tsx`                                                                              |        65 |        38 |          27 |     23 |     1 |  0.04 | <50%   |                 |
| `packages/ui/src/i18n/locales/en-US.ts`                                                                              |       672 |       670 |           2 |   5845 |   193 |  0.03 | <50%   |                 |
| `packages/ui/src/i18n/locales/ja-JP.ts`                                                                              |        41 |         0 |          41 |    265 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/i18n/locales/ko-KR.ts`                                                                              |        40 |         0 |          40 |    316 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/i18n/locales/ru-RU.ts`                                                                              |        41 |         0 |          41 |    285 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/i18n/locales/zh-CN.ts`                                                                              |       616 |       614 |           2 |   3391 |   192 |  0.06 | <50%   |                 |
| `packages/ui/src/index.ts`                                                                                           |        24 |        24 |           0 |     43 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/lib/conversationSelectionReference.ts`                                                              |       260 |       256 |           4 |    984 |     4 |  0.00 | <50%   |                 |
| `packages/ui/src/lib/cuaPlatform.ts`                                                                                 |         6 |         4 |           2 |     19 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/lib/settingsNavigation.ts`                                                                          |        62 |        60 |           2 |    270 |     5 |  0.02 | <50%   |                 |
| `packages/ui/src/lib/toolDisplay.ts`                                                                                 |        19 |        19 |           0 |     59 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/lib/toolIdentity.ts`                                                                                |         4 |         3 |           1 |     16 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/lib/userActionTraceCatalog.ts`                                                                      |        46 |        46 |           0 |    176 |     4 |  0.02 | <50%   |                 |
| `packages/ui/src/lib/workspaceSidePane.ts`                                                                           |       147 |       145 |           2 |    466 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/marketing-touch-contract/module.ts`                                                                 |         6 |         4 |           2 |     25 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/PermissionDialog.tsx`                                                                               |        28 |        28 |           0 |    104 |     5 |  0.05 | <50%   |                 |
| `packages/ui/src/plugin-ui/adapters/pluginUiHostTypes.ts`                                                            |        20 |        18 |           2 |     38 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/adapters/pluginUiInteractions.ts`                                                         |        27 |        26 |           1 |    106 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/adapters/pluginUiManagedPage.ts`                                                          |        56 |        52 |           4 |    213 |     1 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/adapters/pluginUiPageRegistry.ts`                                                         |        45 |        45 |           0 |    169 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/adapters/useMarketPluginUi.ts`                                                            |         5 |         4 |           1 |     18 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/adapters/usePluginUiSidePaneModel.tsx`                                                    |       100 |        97 |           3 |    316 |     1 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/adapters/useRecommendedUiPlugins.ts`                                                      |        12 |        10 |           2 |     37 |     3 |  0.08 | <50%   |                 |
| `packages/ui/src/plugin-ui/app/pluginUiHostController.ts`                                                            |        20 |        20 |           0 |     78 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/app/pluginUiHostControllerContract.ts`                                                    |         6 |         6 |           0 |     31 |     1 |  0.03 | <50%   |                 |
| `packages/ui/src/plugin-ui/app/pluginUiInteractionPorts.ts`                                                          |        93 |        92 |           1 |    335 |     4 |  0.01 | <50%   |                 |
| `packages/ui/src/plugin-ui/CONTRACT.md`                                                                              |         1 |         1 |           0 |     82 |     8 |  0.10 | <50%   |                 |
| `packages/ui/src/plugin-ui/domain/buildPluginUiHostCapabilities.ts`                                                  |        12 |        12 |           0 |     58 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/plugin-ui/domain/buildPluginUiHostContext.ts`                                                       |         9 |         9 |           0 |     63 |     2 |  0.03 | <50%   |                 |
| `packages/ui/src/plugin-ui/module.ts`                                                                                |         2 |         2 |           0 |     15 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/project-sidebar/contract.ts`                                                                        |         3 |         3 |           0 |     24 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/project-sidebar/grouped/task-row.tsx`                                                               |        38 |        27 |          11 |     66 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/project-sidebar/module.ts`                                                                          |         1 |         1 |           0 |     12 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/prompt-editor/ChatPromptActionMenu.tsx`                                                             |        11 |        10 |           1 |     45 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/prompt-editor/ChatPromptEditor.tsx`                                                                 |        37 |        29 |           8 |    105 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/resource-manager/module.ts`                                                                         |         9 |         8 |           1 |     17 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/Root.tsx`                                                                                           |        31 |        20 |          11 |     82 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/root/oauthCachedSessionRestore.ts`                                                                  |        11 |        11 |           0 |     65 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/root/reconnectRemoteWorkspaceHistoryEntry.ts`                                                       |         6 |         6 |           0 |     25 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/root/RootStartupLoading.tsx`                                                                        |        11 |         3 |           8 |    109 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/root/useRootOAuthEffects.ts`                                                                        |        73 |        67 |           6 |    245 |     1 |  0.00 | <50%   |                 |
| `packages/ui/src/root/useRootPlatformEffects.ts`                                                                     |        39 |        38 |           1 |    108 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings-search/settingsSearchIndex.ts`                                                             |         8 |         8 |           0 |     32 |     1 |  0.03 | <50%   |                 |
| `packages/ui/src/settings/model-provider-section/constants.ts`                                                       |        10 |         9 |           1 |     23 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/model-provider-section/Detail.tsx`                                                         |         7 |         7 |           0 |     36 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/model-provider-section/Navigation.tsx`                                                     |        30 |        27 |           3 |     66 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/model-provider-section/useModelProviderNavigation.ts`                                      |        22 |        21 |           1 |     93 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/model-provider-section/utils.tsx`                                                          |        20 |        18 |           2 |     63 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/ModelProviderSection.tsx`                                                                  |        73 |        63 |          10 |    153 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/PluginsSection.tsx`                                                                        |         2 |         2 |           0 |      6 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/PluginStorePage.tsx`                                                                       |         1 |         1 |           0 |      3 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/PluginUninstallConfirmDialog.tsx`                                                          |        12 |        10 |           2 |     32 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/settings/settingsPageConfig.ts`                                                                     |        35 |        33 |           2 |    117 |    12 |  0.10 | <50%   |                 |
| `packages/ui/src/settings/usePluginUninstall.ts`                                                                     |        13 |        12 |           1 |     35 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/SettingsPage.tsx`                                                                                   |       163 |       159 |           4 |    455 |    20 |  0.04 | <50%   |                 |
| `packages/ui/src/settingsPageHelpers.tsx`                                                                            |        20 |        20 |           0 |     66 |     1 |  0.02 | <50%   |                 |
| `packages/ui/src/store/droraSessionStoreTypes.ts`                                                                    |        31 |        27 |           4 |    134 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/store/droraSessionStoreWorkspaceSlice.ts`                                                           |        57 |        47 |          10 |    192 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/store/remoteWorkspaceSessionStore.ts`                                                               |         5 |         4 |           1 |     15 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/styles.css`                                                                                         |        63 |        63 |           0 |    185 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/TaskListItem.tsx`                                                                                   |        35 |        24 |          11 |     25 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/ToolCallBlocks/renderers/agentHelpers.ts`                                                           |         4 |         3 |           1 |     18 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/ToolCallBlocks/resolveRenderer.ts`                                                                  |         5 |         5 |           0 |     32 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/composer/ConversationSelectionReferenceChip.tsx`                                                 |         7 |         7 |           0 |     33 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/composer/useDraftConfigControl.ts`                                                               |         8 |         8 |           0 |     15 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/ConversationComposer.tsx`                                                                        |        71 |        68 |           3 |    229 |     3 |  0.01 | <50%   |                 |
| `packages/ui/src/v4/ConversationDraftEmptyState.tsx`                                                                 |        78 |        49 |          29 |    303 |     9 |  0.03 | <50%   |                 |
| `packages/ui/src/v4/ConversationDraftSuggestedPromptsContainer.tsx`                                                  |         8 |         6 |           2 |     26 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/conversationRowContext.ts`                                                                       |        13 |        13 |           0 |     81 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/ConversationRowView.tsx`                                                                         |         9 |         9 |           0 |     21 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/ConversationStatusPanel.tsx`                                                                     |       272 |       271 |           1 |   1042 |     1 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/ui/src/v4/conversationStatusPanelModel.ts`                                                                 |        59 |        58 |           1 |    197 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/ConversationTimeline.tsx`                                                                        |        61 |        61 |           0 |    200 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/ConversationTurnGroup.tsx`                                                                       |       145 |       144 |           1 |    434 |     6 |  0.01 | <50%   |                 |
| `packages/ui/src/v4/mapSessionSummaryToTaskMeta.ts`                                                                  |        17 |         5 |          12 |      5 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/SessionPane.tsx`                                                                                 |       260 |       239 |          21 |    970 |     3 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/taskListRowActivity.ts`                                                                          |         2 |         2 |           0 |      3 |     0 |  0.00 | <50%   |                 |
| `packages/ui/src/v4/useComposerTextInsertApplied.ts`                                                                 |        46 |        31 |          15 |    145 |     1 |  0.01 | <50%   |                 |
| `packages/ui/src/web-remote-control/WebRemoteControlDialog.tsx`                                                      |        20 |        19 |           1 |     42 |     0 |  0.00 | <50%   |                 |
| `packages/ui/vite/pdfJsCMapsPlugin.ts`                                                                               |         7 |         7 |           0 |     41 |     0 |  0.00 | <50%   |                 |
| `packages/web/index.html`                                                                                            |        28 |         4 |          24 |    268 |     0 |  0.00 | <50%   |                 |
| `packages/web/package.json`                                                                                          |         3 |         3 |           0 |      6 |     0 |  0.00 | <50%   |                 |
| `packages/web/public/favicon.ico`                                                                                    |      1315 |       931 |         384 |   9486 |     0 |  0.00 | <50%   |                 |
| `packages/web/src/auth/webZaiOAuthConfig.ts`                                                                         |         6 |         4 |           2 |     25 |     2 |  0.08 | <50%   |                 |
| `packages/web/src/main.tsx`                                                                                          |        14 |        13 |           1 |     54 |     6 |  0.11 | <50%   |                 |
| `packages/web/test/e2e/remote-control/authentication/manual-review/pending/remote-login-v2.mjs`                      |         4 |         3 |           1 |     20 |     3 |  0.15 | <50%   | `★sample:pkTok` |
| `packages/zcode-cua/broker-helper-constants.js`                                                                      |        11 |         6 |           5 |     23 |    11 |  0.48 | <50%   |                 |
| `packages/zcode-cua/broker-helper-health.js`                                                                         |         2 |         1 |           1 |      1 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `packages/zcode-cua/broker-server.d.ts`                                                                              |        21 |        20 |           1 |    145 |     2 |  0.01 | <50%   |                 |
| `packages/zcode-cua/broker-server.js`                                                                                |       205 |         8 |         197 |    394 |     4 |  0.01 | <50%   |                 |
| `packages/zcode-cua/broker-socket-path.js`                                                                           |         2 |         1 |           1 |      2 |     0 |  0.00 | <50%   |                 |
| `packages/zcode-cua/broker.js`                                                                                       |       137 |        40 |          97 |    331 |     3 |  0.01 | <50%   |                 |
| `packages/zcode-cua/frame-contract.js`                                                                               |        40 |         3 |          37 |    103 |     1 |  0.01 | <50%   |                 |
| `packages/zcode-cua/index.d.ts`                                                                                      |        57 |        18 |          39 |    140 |     1 |  0.01 | <50%   |                 |
| `packages/zcode-cua/index.js`                                                                                        |        25 |        11 |          14 |     58 |     0 |  0.00 | <50%   |                 |
| `packages/zcode-cua/package.json`                                                                                    |        17 |        11 |           6 |    115 |     4 |  0.03 | <50%   |                 |
| `packages/zcode-cua/pip-session-node.d.ts`                                                                           |         2 |         2 |           0 |     11 |     0 |  0.00 | <50%   |                 |
| `packages/zcode-cua/pip-session-node.js`                                                                             |        22 |        13 |           9 |     69 |     0 |  0.00 | <50%   |                 |
| `packages/zcode-cua/request-access-contract.d.ts`                                                                    |         2 |         2 |           0 |     19 |     0 |  0.00 | <50%   |                 |
| `packages/zcode-cua/request-access-contract.js`                                                                      |        25 |        16 |           9 |    100 |     1 |  0.01 | <50%   |                 |
| `packages/zcode-cua/tsconfig.json`                                                                                   |        23 |        17 |           6 |     33 |     0 |  0.00 | <50%   | `★sample:pkTok` |
| `pnpm-lock.yaml`                                                                                                     |      6951 |      1718 |        5233 |  21046 |   220 |  0.01 | <50%   |                 |
| `pnpm-workspace.yaml`                                                                                                |        16 |        13 |           3 |     78 |     9 |  0.12 | <50%   |                 |
| `public/icon_512@2x.png`                                                                                             |      1690 |       298 |        1392 |  34904 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/1024x1024.png`                                                                                    |      2110 |       291 |        1819 |  44617 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/128x128.png`                                                                                      |       104 |        45 |          59 |   1417 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/16x16.png`                                                                                        |        22 |         7 |          15 |    266 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/24x24.png`                                                                                        |        27 |         5 |          22 |    299 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/256x256.png`                                                                                      |       292 |        94 |         198 |   5270 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/32x32.png`                                                                                        |        32 |         9 |          23 |    374 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/48x48.png`                                                                                        |        41 |        16 |          25 |    498 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/512x512.png`                                                                                      |      1401 |       241 |        1160 |  29225 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/64x64.png`                                                                                        |        69 |        34 |          35 |    670 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/icon.icns`                                                                                        |      5020 |       823 |        4197 | 109661 |     0 |  0.00 | <50%   |                 |
| `public/logo/icons/icon.ico`                                                                                         |      1315 |       931 |         384 |   9486 |     0 |  0.00 | <50%   |                 |
| `README.en.md`                                                                                                       |        23 |        18 |           5 |    236 |     9 |  0.04 | <50%   |                 |
| `README.md`                                                                                                          |        26 |        20 |           6 |    209 |    11 |  0.05 | <50%   |                 |
| `scripts/architecture/index.mjs`                                                                                     |        64 |        60 |           4 |    282 |     0 |  0.00 | <50%   |                 |
| `scripts/architecture/policy.mjs`                                                                                    |        10 |        10 |           0 |     42 |     0 |  0.00 | <50%   |                 |
| `scripts/architecture/upstream-snapshot.json`                                                                        |     34746 |     23659 |       11087 | 229222 |  1583 |  0.01 | <50%   |                 |
| `scripts/build-desktop-agent-cli.mjs`                                                                                |        43 |        34 |           9 |    186 |     1 |  0.01 | <50%   |                 |
| `scripts/build-drora.mjs`                                                                                            |         8 |         6 |           2 |     24 |     0 |  0.00 | <50%   |                 |
| `scripts/clean.mjs`                                                                                                  |        40 |        40 |           0 |    169 |     9 |  0.05 | <50%   | `★sample:sc`    |
| `scripts/engineering-tests/scope.mjs`                                                                                |         9 |         8 |           1 |     28 |     0 |  0.00 | <50%   | `★sample:sc`    |
| `scripts/generate-third-party-notices.mjs`                                                                           |         6 |         5 |           1 |     40 |     4 |  0.10 | <50%   |                 |
| `scripts/prebuilt-binary-extract.mjs`                                                                                |        12 |        11 |           1 |     63 |     0 |  0.00 | <50%   |                 |
| `scripts/test/architecture-governance.test.mjs`                                                                      |        67 |        67 |           0 |    346 |     0 |  0.00 | <50%   |                 |
| `scripts/test/react-hooks-lint.test.mjs`                                                                             |         9 |         6 |           3 |     34 |     0 |  0.00 | <50%   |                 |
| `THIRD-PARTY-NOTICES.md`                                                                                             |      5984 |      2330 |        3654 |  16293 |   111 |  0.01 | <50%   |                 |
| `third-party/embedded-components.json`                                                                               |       119 |         0 |         119 |    509 |     0 |  0.00 | <50%   |                 |
| `third-party/native-search/sources.json`                                                                             |       874 |       656 |         218 |      2 |     0 |  0.00 | <50%   |                 |
| `third-party/npm-overrides.json`                                                                                     |      1089 |       537 |         552 |    909 |     0 |  0.00 | <50%   |                 |
| `third-party/README.md`                                                                                              |        28 |        18 |          10 |    133 |     1 |  0.01 | <50%   |                 |
| `third-party/SPEC.md`                                                                                                |        35 |        18 |          17 |     26 |     0 |  0.00 | <50%   |                 |
| `vitest.config.ts`                                                                                                   |        35 |        34 |           1 |    166 |    17 |  0.10 | <50%   |                 |

## 4. 代表实体（06 §3.3#5 点名件，本表内行位）

- `packages/ui/src/v4/ConversationDraftEmptyState.tsx`：asymLines=78，TOKEN_DIFF，ours-only/theirs-only=49/29，Δtok/brand/ratio=303/9/0.03。
- `packages/ui/src/i18n/IntlProvider.tsx`：asymLines=65，TOKEN_DIFF，ours-only/theirs-only=38/27，Δtok/brand/ratio=23/1/0.04。

## 5. 复现说明

- 度量脚本：`residual-audit/{token-compare,sidediff,brandratio}.mjs`（universe=final-alignment-after.tsv 全 DIFF 件；EOL/BOM 归一口径与 05 对齐审计一致）。
- 本文件生成：三 TSV 汇编脚本一次生成后经 `oxfmt --write` 格式化入库（表格列对齐形态即格式化产物）；如后续重跑对齐审计，请以新 TSV 重生成本文件、保持判据列不变并再次格式化。
