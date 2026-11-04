# ZCode v3.17.2 合并方案与保真合同

- 日期：2026-11-04（差分理清 + 方案定稿待审）
- 状态：**方案待用户裁定**（§6 五项裁定）；未开始实施。
- 上游范围：`upstream/main = a9fe401ee`（`chore: sync ZCode source v3.17.2`，Source-Commit 84aed26c，Source-Sync `zcode-open-source-v1`）；含前一笔 `a60ba6a7e`（tag `v3.17.1` 所指）。
- 上文：本仓 v3.17.1 集成实际基线 = `3c5b2276`（merge-base，早于 tag v3.17.1 一笔）；本轮待合并 = `3c5b22764..a9fe401ee` 共 2 个 sync 提交。

## 1. 增量画像（已实证，三方对比法）

方法：`transform-upstream-tree.mjs` 分别变换 base（3c5b2276）与 theirs（a9fe401ee）为 Drora 命名树（已生成 `/tmp/upstream-base-3c5b2276-tree`、`/tmp/upstream-v3.17.2-tree`），文件级三方对比剥离改名伪影。产物清单：`/tmp/v3172-upstream-{changed,added,deleted}.txt`、`/tmp/v3172-conflict.txt`。

| 维度 | 规模 | 说明 |
|---|---|---|
| 上游内容变化 | 1967 文件 | desktop 559 / CLI 642 / ui 253 / services 70 / shared 60 / docs 若干 |
| 上游新增 | 1275 文件 | **desktop/test/e2e 613**（81 为 manual-review/pending 转正 + 532 真新增）/ desktop src 33 / CLI 283 / ui 103 / docs/issues 64 |
| 上游删除 | 2304 文件 | **packages 单测大裁**（ui/test 1146→115、services/test 291→5、provider-node/server/provider 系全删）；rename 配对仅 367（e2e pending 转正为主） |
| 本仓真实冲突面 | **41 文件** | 36 changed + 1 added + 4 deleted（详见 §4） |

**主题判读**：
1. **远程链路大修**（本轮主线）：docs/issues 新增全为 remote-*（remote-performance-3-16、remote-daemon-lifecycle、remote-e2e-stability、remote-connection-ux…）+ E2E 大扩（SSH 靶 env：E2E_SSH_GARBLED_SHELL/RISCV64/WINDOWS_SHELL/SECOND_FACTOR_TARGET）+ `DRORA_REMOTE_INPUT_PREDICTION` 新键。
2. **协议 v4 面演进**：drora-protocol-v4 12 文件全动（apply/command/delta/index/input-intent/rows/snapshot/telemetry/transport/workflow-row-meta）+ drora-protocol/index + legacy-types。
3. **node-fallback 新机制**：`adapters/src/mcp/node-fallback.ts` + 新模块 `provider-builtin-tool-compat/`（四件套）+ env `DRORA_NODE_FALLBACK_EXEC_PATH/NPM_ROOT`。
4. **project-sidebar 续演进**（26 文件，台账 5 触点第三轮）+ **plugin-ui 面扩充**（22 文件）+ settings 商店/MCP/插件区改版（含 model-provider-section 3 文件：InlineEditableProviderCard/ProviderCardSections/ProviderLogo——**未触及台账 13 登记的 useModelProviderNavigation/Detail/Navigation/constants**，回植压力低）。
5. **开源策略变化**（Source-Sync `zcode-open-source-v1`）：官方开源仓裁掉 packages 单测、保留 desktop E2E——对本仓测试体系是重大分歧裁定项（§6-D1）。

## 2. env 键对账（源码级；bundle 级待原版包后跑 check-bundle-key-parity）

- 新增 12：`DRORA_E2E_REMOTE_RELEASE_SCOPE`、`DRORA_E2E_SSH_{GARBLED_SHELL,RISCV64,WINDOWS_SHELL,SECOND_FACTOR}_TARGET`（E2E 测试靶，5）、`DRORA_NODE_FALLBACK_{EXEC_PATH,NPM_ROOT}`（node-fallback）、`DRORA_REACT_SCAN`、`DRORA_REMOTE_INPUT_PREDICTION`、`DRORA_PLUGIN_NAME`、`DRORA_OFFICIAL_ENDPOINT(_TOKEN)`（后三疑为搬移重现，合并时逐键核实是否真新增）。
- 删除 8：`DRORA_AGENT_SERVER_{ARGS_JSON,COMMAND,CWD}`、`DRORA_CONVERSATION_SHARE_WEB_URL`、`DRORA_DESKTOP_AGENT_BYTECODE`、`DRORA_E2E_RUNTIME_LOG_DIR`、`DRORA_FEEDBACK_API_BASE`、`DRORA_SERVER_RELEASE_ID`（逐键全链 grep 后再删，防误删本仓消费方）。

## 3. 工具与既有资产（复用）

- 两棵变换树已生成于 /tmp（重建命令：`node scripts/upstream/transform-upstream-tree.mjs --ref <ref> --out <dir>`）。
- 合并引擎：`merge-dryrun.mjs`（喂 base/theirs 变换树出三方预演）、`apply-segment.mjs`（分段应用）、`classify-preservation.mjs`、`apply-ledger.mjs`。
- 逐常量/逐字段校验纪律照 AGENTS.md：还原代码验证单位=常量/键名/文案/阈值，bundle 级等原版发行包到位后补 `check-bundle-key-parity.mjs`。

## 4. 本仓真实冲突面（41 文件，逐个三方合并）

**A. 本役 model-capabilities 接线（26 文件，`b0094ed4b` 刚推送）**——上游同文件有改动，需把上游语义改动手工并入并保住本役行为：
- CLI：`bootstrap/src/app/{create-app,types}.ts`、`bootstrap/src/drora-protocol/server-operations.ts`、`core/src/runtime/{deps,types}.ts`、`core/src/runtime/helpers/runtime-tools.ts`、`core/src/tool/executor/{call-runner,impl,types}.ts`、`core/src/tool/handlers/index.ts`、`core/src/tool/types.ts`
- 服务/共享：`services/src/{accessor,index,node}.ts`、`services/src/drora-agent/droraAgentService.ts`、`services/src/setting/settingService.ts`、`shared/src/{channels,index,protocol}.ts`、`shared/src/drora-protocol/index.ts`、`shared/src/{test-ids,validationAppSettings}.ts`
- client/desktop：`client/src/{messageport,remoteServiceAccess}.ts`、`desktop/src/host/index.ts`、`desktop/src/renderer/src/main.tsx`
- UI：`PermissionDialog.tsx`、`SettingsPage.tsx`、`ToolCallBlocks/resolveRenderer.ts`、`lib/settingsNavigation.ts`、`settings/settingsPageConfig.ts`、`i18n/locales/{zh-CN,en-US}.ts`（i18n 走「上游键全集合并 + 本役键保留」，重跑双语 parity）
- `architecture-policy.yaml`（上游改了 policy 基线，需重放本役 adopt/例外登记——可跑 `architecture:baseline:update` 或手工并）

**B. persona 未提交撞名（1 文件）**：`docs/ui/settings-personalization.md`——上游 v3.17.2 新增同名文档，persona 批有未提交修改。处置见 §6-D2。

**C. 测试保留裁定（4 文件）**：`client/test/remoteServiceAccess.test.ts`、`desktop/test/hostRemoteStartupIntegration.test.ts`、`ui/test/{settingsPageConfig,userActionTraceCatalog}.test.ts`——上游裁测与本仓新测试撞路径，按 §6-D1 一律保留本仓版。

## 5. 分阶段执行（每段退出条件）

| 批次 | 内容 | 退出条件 |
|---|---|---|
| 0 | **persona 前置落位**（§6-D2 裁定后执行）：40 项未提交按用户选择独立 commit 或存分支；`.persona-eval-artifacts/` 已在 info/exclude 无碍 | 工作区净（仅剩可丢弃构建噪音） |
| 1 | shared + services + provider 系：协议 v4 面 12 文件语义合并、env 键迁移（§2 逐键）、node-fallback 服务侧 | typecheck 0 + drora 清单内 shared/services 定向测试绿 |
| 2 | CLI（drora-cli 642 changed + 283 added）：core/bootstrap/adapters/contracts 分包消化，node-fallback 新模块 + provider-builtin-tool-compat 四件套 adopt；core/tests 103 个上游测试更新逐个核对（CLI 测试上游保留） | CLI 四包 typecheck+build 全 0 + CLI 测试（handler/parity/port 等定向）绿 |
| 3 | desktop：src/main 22 + src/host 4 + src/renderer 5 + e2e 613 新增（81 转正 + 532 新增全量吸收，入 e2e 分片门控） | desktop 三 tsconfig typecheck 0 + e2e tsconfig 0 |
| 4 | ui：253 changed 分主题（v4 47 / project-sidebar 26 / settings 23 / plugin-ui 22 / lib 17 / hooks 12）+ §4-A 的 10 个 UI 冲突文件三方合并 + i18n 双语 parity 复跑 | typecheck 0 + ui 定向测试（模型能力 20/深链/V4/voice 系）绿 + parity 差集空 |
| 5 | docs + scripts + root 文件：docs/issues 64 与 electron 377 变更全量吸收；AGENTS.md/README/.husky/.oxlintrc/.vscode 语义合并（上游权威 + 本仓自研节保留） | 文档 stale-phrases 检查过 |
| 6 | 收口：`pnpm verify:pre-push` 全链 + test:drora 全量（预期 4610+ 用例不回归）+ CLI build + architecture:check + **bundle 级 key parity（若原版 v3.17.2 包已下载）** + 台账 5/13 复核回植 + 本 spec 状态更新 | §8 验收标准全绿 |

分支策略：照 v3.17.1 先例开 `codex/upstream-v3.17.2-integration` 分支，PR 合并 main；祖先记录（merge-base 已在 git 史，无需手工）。

## 6. 待用户裁定（阻塞批次 0/1）

- **D1 测试体系（最大分歧）**：上游开源仓裁掉 packages 单测（−2000+ 文件）。建议：**本仓保留全部测试体系不跟随删除**（4610 用例回归网是本仓质量底线），上游删除清单中与本仓无关者不删、登记分歧台账 14；仅当上游某测试对应的源文件已删除时随删。
- **D2 persona 未提交 40 项**：建议先独立 commit 进 main（其自身已多轮验证全绿、含 .gitignore 规则），再开合并分支；或存 `persona-wip` 分支后清工作区。二选一。
- **D3 E2E 613 新增全量吸收**：desktop E2E 是上游保留区且是远程大修的验收面，建议全量吸收（并入既有 e2e 分片与 coverage 机制）；如需节制可先吸收转正 81 + 与 remote 主题相关的子集，其余登记待吸收。
- **D4 docs/issues 镜像与 electron 文档**：纯文档低风险，建议全量吸收。
- **D5 bundle 校验时机**：若你能提供官方 v3.17.2 原版发行包，收口批补 `check-bundle-key-parity`；否则源码级对账为准并在 spec 记录缺口。

## 7. 风险面排序

1. 协议 v4 面（12 文件全动）× 本仓 desktop-continuous/web-remote-replayable 双语义（AGENTS.md 进程节）——两链路都要验证。
2. 本役 41 冲突文件中 CLI runtime/executor 系列——上游 core/src 163 文件变化可能重构 executor 接线面，本役 signal 透传/端口注入需逐一重放。
3. settingsPageConfig/settingsNavigation/PermissionDialog——上游 settings 改版 23 文件与 D-2 完全合并后的 persona 分区 + 本役能力分组的分区注册表竞争。
4. architecture-policy 上游基线变化 × 本役 adopt/例外重放。
5. i18n 双文件大合并（上游 ui 253 changed 多含文案）× 双语 parity 门禁。

## 8. 验收标准

- `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` = 0
- `pnpm test:drora` 全量 ≥ 4610 用例零回归（CLI 测试另跑定向）
- CLI contracts/core/bootstrap/adapters typecheck+build 全 0；desktop 四 tsconfig 0
- env 键/权限键/诊断码三族对账表落 spec（源码级，bundle 级视 D5）
- 台账 5（project-sidebar 第三轮）与台账 13（model-provider-section 回植三件事）复核完毕并在台账记录结论
- 双语 i18n parity 差集空；e2e（吸收的 613）至少 tsconfig + 分片登记完成

---

## 9. 实施记录（2026-11-04 当日完成，方案 §6 裁定执行版）

- **裁定执行**：D1 跟随上游全删（packages 单测 −2000+，本仓自研路径保留：drora 清单 542→276、isolated 9→4、engineering 158 随上游）；D2 persona 43 文件先独立提交（7f30c5c63）；D3 E2E 613 全量吸收；D4 docs 全量吸收。执行方式按用户指令：按功能域分段合并、中途不跑测试、全完统一审查。
- **分段应用**：merge-dryrun（BASE_REF 已更新 3c5b2276）→ inventory 5546 条 → apply-segment S1-S6 逐段（决策 429 条：delete-decision×362 按 D1、new-collision×47 take-theirs/1 keep-ours、zone×19）→ 171 真冲突全解（启发式：单向/格式/无自研标记块取 theirs；含 persona/knowledge/model-capabilities 标记块人工逐块——persona 路由与包装、Knowledge 协议段、能力深链、双清单 vitest/AGENTS 描述、「自定义指令」改名裁定全部保 ours）。
- **统一审查修复**：typecheck 初跑 17 错+链式共 40+ 处全修——channels 重复键、node.ts token 三符号丢失、desktop main imports 丢失、WorkspaceShellLayout 重建（JSX 断裂）、bigmodel getForceUpdateConfig 取 theirs、message.tsx 重复声明、posixPath import、session.port barrel 时序；**autoUpdater manifest 链按本仓 spec update-feed-github.md 裁决删除**（上游恢复被拒，台账既有分歧）；windowsCuaHelperHostSupport v3.17.1 中间态回切 producer 导入。
- **zcode-cua 冻结区（R3）保卫**：zone take-theirs 曾把 Helper 身份常量覆盖回 ZCode 名（HELPER_APP_NAME 等 5 值）→ 15 文件恢复 HEAD，仅补上游新增 HELPER_GHOST_CURSOR_OVERLAY_ARG（值一致）与 broker re-export 三处增量；**@drora/drora-cua 包名统一**（上游引擎名 @drora/zcode-cua 与本仓名分歧，全仓 58 文件收敛回本仓名）。
- **architecture 收口**：上游模块段与本仓 adopt 段重复 8 id 去重（保内容最全版）；快照按 a9fe401ee 重生成（regenerate-architecture-snapshot --write）+ 1 个误判例外（windowHostAttachmentRpcPolicy 既有文件）。
- **依赖**：pnpm install 三次收敛（cua 包名修复后 Done）；package-lock version 同步 3.17.2。
- **env 对账（修正）**：新增 12 键（E2E_SSH×5/NODE_FALLBACK×2/REMOTE_INPUT_PREDICTION/REACT_SCAN 为上游 vite dev 注入/OFFICIAL_ENDPOINT 族搬移重现）；初判 8「删除」经实证全为本仓本地接口字段误算，**真删除 0**。
- **验证终态（2026-11-04）**：typecheck=0；architecture:check violations 0；lint=0（0 errors）；test:drora **1881 过/7 跳**（D1 收缩后基线，较合并前 4610 收缩——上游裁测的直接后果）；drora-fork-isolated 24/24；CLI contracts/core/bootstrap/adapters typecheck+build 全 0；fmt 安全集（ts/tsx/yaml/json）全绿，**md 67 个上游文档格式基线红不门禁**（CI fmt 被注释+oxfmt 0.41 markdown 篡改缺陷在案，等升级后统一收口）。
- **遗留**：GUI 手工验收、原版 v3.17.2 bundle key-parity（D5 缺）、E2E 新吸收 613 的分片门禁登记待后续。
