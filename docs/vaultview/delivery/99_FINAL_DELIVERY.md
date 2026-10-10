# VaultView 2.0（W00–W07）最终交付报告

**日期：** 2026-10-10　**实现分支：** `feat/vaultview-impl`　**基线 HEAD：** `c39ce3712275bbc570865b37fe9f0f4cb42b8ecb`　**最终 HEAD：** `ee12dd95dfd16e2283389b06da5a0ba22bf8a705`
**提交范围：** 基线起 8 个提交；区间去重后 104 个唯一文件（新增 76 / 修改 28），净变化 +17,909 / −46（本会话 `git diff --stat c39ce371..HEAD`、`git diff --name-status --diff-filter=A/M` 实测）；工作树干净（`git status --porcelain` 为空）。
**环境：** Windows 11 桌面（win32 10.0.26200 x64，有桌面会话）、本地 node v24.1.0（mise.toml 钉 24.14 未激活）、pnpm 10.x。

> **撰写人：** 最终交付报告撰写员。本文整合 `docs/vaultview/delivery/` 下 W00 四份审计文档、W01–W07 七份阶段交付报告与 `WRITE_SAFETY_NO_GO.md`。
> **证据规则（本修订版）：** ① 交付流水线形态如实说明：W00–W07 由编排脚本逐阶段派发子会话执行，每阶段记录含 commit 哈希、summary 与 `gatesOk` 标志；**该标志未附带命令与输出，本报告不将其作为任何结论的证据引用**。② 各阶段报告内的命令与退出码由该阶段会话真实执行（其中 W00/W01/W03 阶段会话未跑仓库根门禁，W01 报告已明写；W02/W04/W05/W06/W07 报告记录了全量三件套 exit 0）。③ **关键门禁与承重数字已由本会话在最终 HEAD 亲自复跑补齐**，命令与退出码逐一列于 §2「独立复核记录」；凡本会话未复跑的项目（全量 `node --test`、`pnpm fmt:check`、`pnpm knip`、手机远控/远端隔离回归、GUI/真机、A24/A28）一律标注「未执行」及原因，不引用任何不可查的替代判定。④「既有失败基线三文件」（desktopRendererPlatformMobileFace / computerUseSettingsNavigation / nonCliAcpRetirement）的说法出自交接纪律文本，本会话未跑全量测试，无法复核，按未验证登记。

---

## 0. 术语与缩略语（判定词不悬空）

| 术语 | 定义与出处 |
| --- | --- |
| **Jev** | 远程重排/决策服务的内部工作单命名：检索候选产生后，把有界片段发往 TypeSafe 的 systemOne Noul 接口做相关性+证据性打分并重排。默认关闭，生产装配不注入 provider（W05）。 |
| **TypeSafe（@typesafe-ai）** | 上述远程服务提供商。HTTP API `POST {baseURL}/v1/systemone` + Bearer（按 2026-10-10 当日官方文档验证，W05 报告 §3）；npm SDK `@typesafe-ai/sdk` **未引入**（有意分歧，`specs/obsidian-knowledge.md` §5d.3）。 |
| **方案 C / L0–L3** | `specs/obsidian-knowledge.md` §2 的分级写入方案（ADR #8，以 W00 P0/P1/P2 分级为准绳）：**L0** 只读（原生 Read/Glob/Grep 读授权根内，已实现）；**L1** 经授权编辑（`allowAgentWrites=true` 时 hook 对根内普通 Markdown 的 Write/Edit 询问自动放行，W01 收窄后实现）；**L2** 知识治理写（结构性/批量治理必须 Proposal→人工批准→版本校验和持久账本，机制 W06 已实现但写路径默认关闭）；**L3** 高风险（Bash/MCP/js 可旁路通道的强制写承诺，永久默认关闭除非真实 Runtime 审计通过，ADR #10）。 |
| **S02** | 交接包定义的安全判定项：busy/queued 输入在真正执行（提升/发送给模型）前，对携带的 Source/Receipt（来源身份、文件版本、授权）重新验证。 |
| **S03** | 交接包定义的安全判定项：对全部写盘通道（模型工具 + 运行时自动写盘）实施强制分级门控。W06 阶段门禁即 `TASK_GRAPH` 的 `tasks[6].gate = "S03 Hard Write Safety GO"`。 |
| **三洞（3 洞 ↔ 5 文件映射）** | W00_TOOL_WRITE_MATRIX §6.1 实证的、S03 GO 前必须先修的三个权限判定洞：**洞 1「plan 模式打洞」**（2 文件）——`apps/drora-cli/packages/core/src/permission/service.ts:415-422`（未声明 `destructiveHint` 的 MCP 工具在 plan 模式直接 allow）+ `apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts:38-46`（memory md 免确认覆盖 plan deny）；关联证据 `apps/drora-cli/packages/core/src/mcp/index.ts:108-109`（destructive/readOnly 全凭 server 自报 hint，直通判定所依赖，`WRITE_SAFETY_NO_GO.md` §3 要求一并收口）。**洞 2「内容规则粒度缺失」**（2 文件）——`apps/drora-cli/packages/core/src/tool/executor/permission-suggestions.ts:24-36`（取不到内容键时默认建议整工具 allow，一次「总是允许」=持久化全权）+ `apps/drora-cli/packages/core/src/permission/service.ts:292`（规则 subjects 键集仅 6 键，无 `code`，node_repl 内容规则永不命中）。**洞 3「Bash 整工具短路」**（1 文件）——`apps/drora-cli/packages/core/src/tool/handlers/bash-command-rule-evaluator.ts:14`（无 ruleContent 的整工具 allow 规则短路含重定向在内的一切命令）。 |
| **plan 模式 MCP 直通 vs MCP server 进程内写盘** | 不是同一处。前者是**权限判定洞**：permission service 对未声明 destructive 的 MCP 工具调用直接放行（须修，洞 1）；后者是**可见性极限**：工具执行后 server 在自己进程内落盘，宿主只见调用不见落盘、无法逐路径门控（W00 收窄口径将其与宿主自动写、yolo 直通并列为三项「有意分歧」，改审计+receipt 口径）。 |
| **EvidenceReceipt / evidenceRefs** | 服务端签发的 opaque 引用凭证（`evr_` 前缀），绑定 session/run/vaultId/sourceEpoch/fileSha/quote 切片 sha，持久化于 knowledge-index.sqlite v2 `evidence_receipts` 表；`evidenceRefs` 是输入命令携带 receipt 引用的可选契约字段（≤8 条，`packages/shared/src/knowledge-evidence.ts` 单一出处）。 |
| **fence / lease** | 跨 Host 写互斥原语：租约行 `epoch` 单调递增作 fence token，每个写事务内校验 owner+epoch+未过期三条件（列戳 CAS 不设防，W00 spike3 反例）。 |
| **T0** | 交接包内的先前 spike 资产（`docs/vaultview-agent-handoff/05_REFERENCE/` 下 T0_SPIKE_SOURCE_AND_TESTS / T0_VALIDATION_REPORT / CANDIDATE_PERMISSION_PATCH），即 W01 对照的「候选 Hook Patch」来源。 |
| **TASK_GRAPH** | `docs/vaultview-agent-handoff/03_WORK_ORDERS/TASK_GRAPH.json`，定义 W00–W07 任务依赖与每阶段门禁；W06 的门禁为 `tasks[6].gate = "S03 Hard Write Safety GO"`（NO-GO 裁定的规定出处）。 |
| **工作单九态** | W04 工作单要求逐一呈现的九种 UI 状态：无 Vault / 索引 partial / semantic unavailable / Jev 关闭（W05 前为「未启用」常态提示）/ 无答案 / 多候选 / 过期撤权 / 模型不可用 / Host 重连。 |
| **owner** | 交接工作流中对 GO/NO-GO 有最终裁定权的工作单归属人；W00 判定 JSON 即 owner 对四项审计的复核结论。 |
| **「统一脚本」的替代** | 原报告以「统一脚本将运行根门禁」作未执行项的兜底。本修订版删除该表述：根门禁已由本会话实跑（§2），不再存在黑箱。 |

---

## 1. 执行摘要（S02 / S03 判定与影响）

### 1.1 判定结论

| 判定项 | W00 审计结论（owner 复核确认） | 本分支落地状态 | 最终影响 |
| --- | --- | --- | --- |
| **S02** admission 前重验 Source/Receipt | **有条件 GO**——三层扩展点实证存在（`CommandInboxHost.guard` 类型预留、`sendQueuedNow` 唯一漏斗、UserPromptSubmit hook 可阻断），但缺 Receipt 协议载体、漏斗复验与 guide 通道处置 | **机制层前提已满足**：契约字段 `evidenceRefs`（`packages/shared/src/knowledge-evidence.ts` 单一出处）+ `sendQueuedNow` reserve 前复验 + 证据输入禁用 guide；含修复轮 1 投影漏映射修复（`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/product-projection.ts:3380-3383`）。复验管线由测试驱动（真 handler+真投影用例，本会话复跑 15/15） | **机制就绪，但当前产品路径无生产者**（见 §1.3）：没有任何 UI 入口发送 `evidenceRefs`，三层复验是已接线但未被真实输入触发的安全管线。排队期间改文件/撤权/切库后旧 evidence 不被当作 current 的保证，对「携带 receipt 的输入」成立 |
| **S03** 全写盘通道强制分级门控 | **有条件 GO（收窄口径）**——前提=「先修三洞 + P0 分级门控」；hook-only 路线 = NO-GO；有意分歧集合仅限 MCP server 进程内写/宿主自动写/yolo 直通三项 | **前提未实施**：`git log --oneline c39ce371..HEAD -- <三洞 5 文件>` 输出为空（本会话实测，零提交触碰），P0 门控未实现 | **W06 门禁 `S03 Hard Write Safety GO` 未通过，正式裁定 NO-GO**（`WRITE_SAFETY_NO_GO.md`）。L2 审核写路径 fail-closed：`writePathEnabled` 缺省 false（`packages/services/src/knowledge/knowledgeServices.ts:139`），apply/undo 一律返回 `write_path_disabled`，文件零触碰；生产装配不传使能（`packages/services/src/node.ts:2612`） |

### 1.2 一句话结论（修订：与验收表严格一致）

已交付并经证据核验：spec 先行的行为契约、三个 Knowledge 服务（Index/Query/Review）、本地索引与检索、Evidence 机制层（签发/解析/CLI 三层复验管线）、VaultView 四视图 UI、Jev 决策框架（默认关闭）、L2 审核机制。本会话在最终 HEAD 实跑：`pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 全 exit 0，knowledge 13 文件 110/110、CLI evidence 15/15、obsidian-plugin 套件 exit 0（§2）。**三项例外如实登记：A31 未通过（S03 门禁 NO-GO——三洞与 P0 门控未在 runtime 层实施，L2 写路径保持关闭）；A24/A28 未执行（缺凭据/缺标注集）；A16/A20/A21/A37 的 GUI/真机半边未执行。** 在 S03 门禁通过前，任何代码/UI/文档不得宣称「审核写入已生效」。

### 1.3 两个必须正面回答的产品状态问题

**① 谁在真实产品路径上发送 `evidenceRefs`？——当前没有。** W03 交付的是契约载体与 CLI 复验管线；其报告承诺的「UI Composer 呈现归 W04」在 W04 未交付——W04 的「加入 Agent」按钮走既有 selection 引用（`# userselect` 语义，仅 `{path,text}`，不获执行时复验），composer 附件化 `evidenceRefs` 被列为「留给后续工作单」（`W04_DELIVERY.md` §3）。因此：**本分支产品内不存在任何发送带 receipt 输入的操作**；A17 的通过证据是测试喂参（真 handler + 真投影用例构造 refs），不是用户可达路径。三层复验属于「已建成待接线的安全能力」。已列入 §7.1 已知限制。

**② 交付时点「审核」视图到底连没连 review 服务？——没连。** VaultView 第四个 tab 渲染 `packages/ui/src/v4/vault/knowledge/KnowledgeReviewView.tsx`，该组件只调用 `IObsidianVaultService.getSummary()` 展示真实 `allowAgentWrites` 授权状态 + hook 能力边界说明 + 「L2 提案审核属 W06 未开放」空态卡（本会话读源码核实：`:5-6` 文件头注释、`:28` getSummary 调用、`:83` allowAgentWrites 分支；**全文件不引用 `knowledgeReviewService`**）。W06 交付的 review RPC 只到 accessor/remoteServiceAccess 代理层（`packages/services/src/accessor.ts`、`packages/client/src/remoteServiceAccess.ts:108,244-247`），无任何 UI 消费方。**叠加 `writePathEnabled=false` 总门：用户在 UI 上无法完成提案→批准→应用的任何一步**；即便绕过 UI 直调 RPC，apply/undo 也被总门以 `write_path_disabled` 结构化拒绝（有专项测试断言默认装配全拒）。「九态全部有真实 UI 态」指的是智能问库视图的状态机，不含审核写操作——两处表述在原文中易误读，此处消歧。

### 1.4 两层「硬门槛」的关系（消歧）

- **W07 工作单内的「硬门槛四项」**（发布前质量门槛，全部通过，其中第③项以「保持关闭」方式通过）：① 本地检索不因 Jev/模型不可用而失效（E2E 用例①：无 provider/无 embedding 下 `decision=off` 且检索 ready）；② 出站默认关（E2E 全链 `telemetry.outboundCountTotal===0` + A23 + 生产装配不注入 provider）；③ L2/L3 仅在 S03 GO 后开放（`knowledgeServices.ts:139` 缺省关 + `node.ts:2612` 不传使能 + `knowledgeReview.test.ts` 默认装配全拒断言）；④ 洞察未完成不出现假成功（`packages/ui/src/v4/vault/knowledge/KnowledgeInsightsView.tsx:58,124-127` 唯一数据源是真实 getStatus 快照）。
- **TASK_GRAPH 的 W06 门禁 `S03 Hard Write Safety GO`**：另一层、**仍未满足**（§1.1）。两门不是同一件事：W07 四项全部通过 ≠ S03 达标。原报告「整分支发布受约束的唯一硬门槛」措辞不准确，已更正为：**当前未决的发布约束是 S03 一项；W07 自身四项发布前质量门槛全部通过**。

---

## 2. 独立复核记录（本会话在最终 HEAD ee12dd95 实跑，2026-10-10）

环境：Windows 11（win32 10.0.26200 x64）、node v24.1.0、仓库根 `D:/workspace/projects/Drora-vaultview-handoff`、工作树干净。以下每条命令均为本会话执行，退出码为真实值。

| # | 命令 | 结果 | 用途 |
| --- | --- | --- | --- |
| 1 | `git rev-parse HEAD` | `ee12dd95dfd16e2283389b06da5a0ba22bf8a705` | 确认复核对象 |
| 2 | `git status --porcelain` | 空 | 工作树干净 |
| 3 | `git diff --stat c39ce371..HEAD`（尾行） | `104 files changed, 17909 insertions(+), 46 deletions(-)` | 区间唯一文件口径 |
| 4 | `git log --name-only --format="" c39ce371..HEAD \| sort -u \| wc -l` | 104 | 与上行互证；逐提交合计 132 文件槽位的口径差见 §4 |
| 5 | `git diff --name-status --diff-filter=A` / `--diff-filter=M` | A=76，M=28 | 新增/修改拆分（§7.2） |
| 6 | `git log --oneline c39ce371..HEAD -- apps/drora-cli/packages/core/src/permission/service.ts apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts apps/drora-cli/packages/core/src/tool/executor/permission-suggestions.ts apps/drora-cli/packages/core/src/tool/handlers/bash-command-rule-evaluator.ts apps/drora-cli/packages/core/src/mcp/index.ts` | **输出为空** | 三洞 5 文件零改动（S03 NO-GO 的可复核命令，复现 `WRITE_SAFETY_NO_GO.md` §1） |
| 7 | `git merge-base --is-ancestor eff2ee71 c39ce371` | exit 0 | `eff2ee71`（「feat(host): 第49轮 server 远程五项偏离全部收口…」）是基线之前的 HEAD 祖先，见 §4 口径说明 |
| 8 | `git rev-list --count c39ce371..HEAD` / `git rev-list --count origin/main..HEAD` | 8 / 338 | 「基线起 8 个提交」指基线增量；分支全历史 338 个提交 |
| 9 | `pnpm typecheck`（`tsc -b` 14 个包） | **exit 0** | 全仓类型检查 |
| 10 | `pnpm lint` | **exit 0**，`Found 387 warnings and 0 errors. Finished in 173ms on 3027 files` | 387 warnings 与 W02–W07 各阶段记录的存量基线同值 |
| 11 | `pnpm architecture:check --changed` | **exit 0**，`violations: 0 / baseline: 0 / new: 0` | 架构治理 |
| 12 | `node --import tsx --test packages/services/test/knowledgeIndexQuery.test.ts packages/services/test/knowledgeChunkerTokenizer.test.ts packages/services/test/knowledgeLeaseFencing.test.ts packages/services/test/knowledgeEvidence.test.ts packages/services/test/knowledgeAskUiFlow.test.ts packages/services/test/knowledgeDecisionPolicy.test.ts packages/services/test/knowledgeJevAdapter.test.ts packages/services/test/knowledgeDecisionPipeline.test.ts packages/services/test/knowledgeEvaluationHarness.test.ts packages/services/test/knowledgeReview.test.ts packages/services/test/knowledgeE2EFullChain.test.ts packages/ui/test/knowledgeAskModel.test.ts packages/ui/test/knowledgeUiDiscipline.test.ts` | **tests 110 / pass 110 / fail 0，exit 0**（duration_ms 2951） | knowledge 全量回归；逐文件用例账目见 §5 末表 |
| 13 | `pnpm --dir apps/drora-cli/packages/obsidian-plugin run test` | **exit 0**（agent-access / permission-path-policy / hooks-e2e 三段全绿，尾部输出 `PermissionRequest：.. 穿越 → 静默，绝不 exit 2` 等 ok 行） | A29/A30 承重回归 |
| 14 | `node --import tsx --test apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs apps/drora-cli/packages/bootstrap/test/knowledge-evidence-gate.test.mjs` | **pass 15 / fail 0，exit 0**（duration 622ms） | S02 三层接线承重测试 |
| 15 | `printenv \| grep -icE "typesafe\|jev"` | 0 命中（grep exit 1） | A24 未执行的环境前提（无凭据）复核成立 |
| 16 | 13 个测试文件逐一 `grep -cE "^[^a-zA-Z]*\btest\("` | 见 §5 末表（合计 110） | 用例账目可复核 |
| 17 | 28 个修改文件逐一 `grep -lq "还原自"` | **零命中** | 分支未修改任何带还原注释的文件（§7.2） |
| 18 | 读 `packages/ui/src/v4/vault/knowledge/KnowledgeReviewView.tsx` | 仅 `getSummary`（`:28`），无 `knowledgeReviewService` 引用 | §1.3② 审核视图状态的源码依据 |

**本会话未执行（如实登记，不引用替代判定）：** 全量 `node --test`（范围大，未跑——故「既有失败基线三文件」无法由本会话证实或证伪）；`pnpm fmt:check`（W02 已实测本仓 oxfmt 对存量文件本就不过、`verify:pre-push` 不含 fmt）；`pnpm knip`（非工作单门禁）；手机远控 51/51 与远端隔离 20/20（引自 W07 会话记录，本会话未复跑）；GUI/真机与 A24/A28（原因见 §7.1）。

---

## 3. 每阶段交付（做了什么 / 提交了什么 / 测试真实结果 / 风险与未执行项）

各阶段「根门禁」列只记录该阶段会话**实际执行**的结果；未跑者写「未跑（阶段分工）」，最终以 §2 本会话实跑为准。

### W00 — 真实源码审计与安全 Spike（commit `2df17a2c`，4 files，+499）

**做了什么：** 四项只读审计+临时目录 Spike（仓库零改动）：① admission/重放时序追通；② 工具写入边界矩阵（含 8 类不经 PermissionRequest 的内置自动写盘清单）；③ DB 双 Host spike（WAL/跨进程 BEGIN IMMEDIATE 互斥/lease-fencing/硬杀崩溃恢复，四个 spike 全部 exit 0，Electron 41 main probe 实测 node:sqlite 可用）；④ 基线与身份映射核实 + 候选 Hook Patch 评审（未应用：CRLF 损坏 + spec 超前 + realRoot 拼写错位三缺陷）。

**判定产出：** S02 有条件 GO（三层接线建议 (a)(b)(c)）；S03 有条件 GO（收窄口径），三洞实证（§0 术语表「三洞」行，5 文件映射）。

**测试真实结果：** freshness exit 0（W00 撰写员复核）；admission spike `node --import tsx --test …admission-seq-spike.test.ts` 3/3 exit 0；matrix-probe（P1–P10）与 bash-policy-probe（B1–B8/W1–W3）exit 0（审计员执行）；DB spike1–4 + Electron probe exit 0（审计员执行）。根门禁：阶段会话未跑（引自交付素材的 exit 0 不作证据；最终以 §2 实跑为准）。

**风险与未执行项：** T0 Spike 源码 ZIP 未随交接包提交；候选 patch 需 LF 重导出；node:sqlite 属全新依赖面；renderer/utilityProcess 与真实双窗口并发未验证；9 项偏差全部记录（`W00_EVIDENCE_REPORT.md` §3）。**另注（本修订新增）**：三个安全 spike 的脚本与合成库在 `C:/Users/A/AppData/Local/Temp/vaultview-w00-spike/`，Temp 目录易被清理——动态复跑路径可能已失效；审计结论的持久可复核性依赖 W00 文档内逐条 `path:line` 静态主张（owner 复核抽查约 35 处全部命中，可随时对当前源码复核）+ 各 spike 文档 §2/§7 的命令与断言描述（可按清单重建脚本）。建议后续将 spike 脚本归档入仓库。

### W01 — 规格落地与 Obsidian 自动授权最小收窄（commit `0d543db0`，10 files，+723/−7）

**做了什么：** 新增 `specs/obsidian-knowledge.md`（状态所有者、方案 C L0–L3、权限策略、查询/Evidence 语义、验收矩阵）；修订 `specs/obsidian-plugin.md`（收窄章节 + L1/L2 对照 + matcher 真实边界）。代码：`isPlainVaultMarkdownPath`（`apps/drora-cli/packages/obsidian-plugin/src/lib/paths.ts:63`）纯形状策略 + `resolveAuthorizedVaultWritePath`（`apps/drora-cli/packages/obsidian-plugin/src/lib/agent-access.ts:83`）——realpath 根内 + 逐段 lstat 拒软链/junction + 非隐藏目录普通 .md + 已存在目标须普通文件，异常一律静默交回 Runtime 问询；返回相对 realpath 根的 relativePath（结构性修复 W00 §3.9 realRoot 缺陷）；SessionStart 注入文案同步收窄并明示「不能约束 Bash、MCP」。T0 patch 仅对照未 apply（按工作单要求）。

**测试真实结果：** 包内 `build`/`typecheck`/`test` 链全 exit 0（agent-access 17 ok、permission-path-policy 18 pass、hooks-e2e 11 ok）；软链/junction 探针真实创建成功。根门禁：**阶段会话未跑**（W01 报告原文明写；且 obsidian-plugin 在 pnpm workspace 与根 lint 之外，`.oxlintrc.json:78` 忽略 `apps/drora-cli`，根门禁本就不覆盖该包）——该包最终状态由 §2 复核 #13 的套件实跑覆盖。

**风险与未执行项：** win32 专属用例以平台门控，POSIX 未实测；桌面打包态 hook 运行未重跑；相对路径缺 cwd 改静默为行为收窄（Runtime 契约 cwd 必发，生产不回归）。**GO**。

### W02 — Source / Index / 文章召回服务（commit `9695b680`，25 files，+3606/−5）

**做了什么：** `IKnowledgeIndexService`/`IKnowledgeQueryService` 真实 RPC 接入（channel 字面量入 `packages/shared/src/channels.ts:170,172` 单一出处、descriptor 同形、dispose 入关闭链）；node:sqlite 单文件库（WAL + busy_timeout=5000 + migration v1 + FTS5 rowid===chunks.id + BEGIN IMMEDIATE 短事务 + 事务内 fence 校验租约）；SourceRegistry 每次重读 vault-config.json，指纹变化 epoch+1 并清旧缓存；扫描不变量与面板门面同源；中文 bigram + 英文 BM25 + MATCH 严格参数化（词元构造+转义+形状守卫，用户输入永不原样进查询串）；Embedding 端口默认缺失显式 `semantic_unavailable` 零出站；runGeneration+seq 防迟到覆盖。

**测试真实结果（账目更正）：** 阶段报告摘要写「22 项」，**经本会话逐文件实数核对为 21**（chunker/tokenizer 9 + index/query 10 + 双 OS 进程 lease/fencing 2；该报告自己的三文件联合运行记录也是 `tests 21`——摘要「22」系笔误，正确总数不受影响：13 文件合计仍为 110，见 §5 末表）。含 SIGKILL 硬杀→TTL 接管（A05）。全量 `pnpm typecheck` 0、`pnpm lint` 0（387 warnings 存量）、`architecture:check --changed` 0（阶段会话实跑）；`oxfmt --check` exit 1 如实报告（存量文件同样不过，本仓不强制）。

**风险与未执行项：** Electron main 全链 `createLocalServices` 启动未复测（惰性开库降低启动期风险）；`excludedOverQuota` 计数未被测试触发（需 >5001 文件）；A07 检索质量归 W05；开发中修复两处自引入缺陷（`packages/services/src/index.ts` 误删导出、chunker 弹栈层级）。**GO**。

### W03 — Evidence 链与真实 Session 引用回跳（commit `a441352a`，29 files，+2622/−34）

**做了什么：** ① 服务端 opaque EvidenceReceipt：migration v2 `evidence_receipts`，DDL/指纹/quote 口径/guard 词表下沉 `packages/shared/src/knowledge-evidence.ts` 单一出处；`prepareEvidence`（run/候选→源身份→文件 sha→quote 切片 sha 四重复验后签发）与 `resolveCitation`（伪造 id=forbidden/unknown_receipt）。② 契约载体：`sendText` payload 与 `ConversationInputIntent`/`TurnInputIntentMetadata` 新增可选 `evidenceRefs`（仅 opaque receiptId，≤8）。③ CLI Runtime 三层接线（未改队列语义）：`sendText` admission 前复验 + `sendQueuedNow`（`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/queue.ts:186-190`）reserve 前复验（手动提升与 auto-drain 同汇）+ 证据输入禁用 guide（回退 queue + `guard.evidenceGuideForbidden`）。**修复轮 1（评审 blocking）**：`ProductProjection.onTurnSteerQueued.nextItem` 漏映射 `evidenceRefs` 导致漏斗复验恒空放行——真投影探针复现后补映射（`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/product-projection.ts:3380-3383`）并加 3 个真投影回归用例。

**测试真实结果（修复轮后）：** services knowledgeEvidence 10/10、gate 5/5、wiring 10/10（联合 15/15）、W02 回归四文件 31/31，全部 exit 0；bootstrap/contracts/cli 三包 tsc 通过。**本会话复跑 wiring+gate：15/15 exit 0（§2 #14）。** 根门禁：阶段会话未跑（分工）；最终以 §2 实跑为准。

**风险与未执行项：** 真实 Electron Host 进程内带模型轮的端到端未验证；**UI Composer 呈现明确归 W04 但 W04 未交付**（→ §1.3① 无生产者问题）；gate 不可用 fail-closed 拒绝；bootstrap 包 lint 脚本在根 oxlintrc 下为 no-op（既有状态，CLI 质量门禁为 tsc）。**GO（机制层）**。

### W04 — VaultView 四视图真实 UI 接入（commit `92c8a719`，17 files，+2780/−27）

**做了什么：** 既有 VaultView 内整合「笔记（默认）/智能问库/洞察/审核」四视图；智能问库接真实 Query/Index/Citation RPC；九态 UI；证据 Inspector（current 才可跳原文，行号锚定 `packages/ui/src/v4/vault/vault-quote-reveal.ts:10`）。**17 文件构成（本会话 `git show --name-status 92c8a719` 实测）：6 修改**——`packages/client/src/remoteServiceAccess.ts`、`packages/services/src/accessor.ts`、`packages/ui/src/i18n/locales/{zh-CN,en-US}.ts`、`packages/ui/src/v4/VaultView.tsx`、`specs/obsidian-knowledge.md`；**11 新增**——`knowledge/` 目录 7 个组件/状态机文件、`vault-quote-reveal.ts`、2 个测试文件、本阶段交付报告。**修复一处阻塞验收的合并回归**：`RemoteServiceAccess` 丢失 `obsidianVaultService` getter（见 §4 eff2ee71 说明），已恢复（`packages/client/src/remoteServiceAccess.ts:97-101`）。**审核视图范围（§1.3② 的答案）**：本阶段交付的 `KnowledgeReviewView.tsx` 只展示 getSummary 授权状态与「未开放」空态，不消费 review RPC；review RPC 的 accessor/代理接入在本阶段一并加入，但 UI 接线留待后续。

**测试真实结果：** 新增 10 项全绿（ui 状态机 7 + 服务级集成 3）；六文件 knowledge 回归 41/41 exit 0；全量 typecheck/lint/architecture:check exit 0（阶段会话实跑）；i18n 键两语言齐全经脚本核对。

**风险与未执行项：** **GUI E2E/截图/点击级证据未执行**——真实原因（修订措辞）：① 连接临时 Vault 需原生目录选择对话框、无法可靠自动化，且自动扫描面有触碰用户真实 Vault 的风险（`W04_DELIVERY.md` §3① 原论证）；② 本工作流为无人值守 agent 会话，未构建/排期 GUI 自动化（Electron driver）环境——**并非操作系统无显示能力**（W07 报告「无显示服务器」的表述在 Windows 桌面机上不准确，本报告统一更正为上述两条实质原因）。浅/深色、390px、跨平台渲染未实测（A21 静态面后由 W07 补）。「加入 Agent」走 selection 引用而非 `sendText.evidenceRefs`（→ §1.3①）。**GO（有条件）**。

### W05 — Jev 决策引擎与评估框架（默认关闭）（commit `f7044879`，25 files，+3926/−60）

**做了什么：** 独立决策层（DecisionProvider 端口/LocalFallback/JevAdapter/DecisionPipeline/授权账本/进程内缓存/telemetry）+ 离线评测框架（Recall@K/MRR/No-answer FP/Evidence Precision/P50·P95 + 走真实检索路径的三变体 harness）。全部默认关闭：生产装配不注入 provider，授权账本空，`grantDecisionConsent` 恒 disabled，不存在可被数据触发的出站路径（A23）。TypeSafe 契约按当日官方文档验证；未引入 SDK 硬依赖（有意分歧，spec §5d.3）。开发中修复 EXPAND_ONCE 不可达的裁决顺序缺陷。

**测试真实结果：** 43 项新测试（policy 14 + adapter 15 + pipeline 10 + harness 4，逐文件实数见 §5 末表）+ 41 项回归 = 84/84 exit 0；全量 typecheck/lint/architecture:check exit 0（阶段会话实跑）。

**风险与未执行项：** **A24 真实 Jev 出站未实测**——本会话复核环境确无凭据（§2 #15：`printenv | grep -icE "typesafe|jev"` 0 命中）；仅本地假服务器逐字段线格式证据。**A28 未实测**（无标注集）。不存在且不做出任何改善声明。UI 未接决策态。**GO（有条件）**。

### W06 — 风险分级审核与安全写回（commit `f60ed123`，18 files，+3235/−10）— **正式裁定 NO-GO**

**做了什么：** spec 先行（§5e）后实现审核写入服务（`packages/services/src/knowledge/review/` 五文件）：Proposal 绑定 vaultId/来源证据/base SHA/proposalRevision/精确内容；批准绑定 revision+changesHash+sourceEpoch+TTL；Operation ledger 以 operationId PRIMARY KEY 唯一约束走 prepared→applying→applied/conflict/uncertain；写盘全经 `createVaultFileSystem` 门面 CAS；reconcile 只读证据落定；Undo 带当前 SHA 验证。migration v3（review_* 四表）。**评审修复轮 1：门禁核对发现 W00 GO 前提（三洞+P0 门控）在 runtime 层零改动（本会话 §2 #6 复现该核对命令：输出为空）→ 按 `TASK_GRAPH` `tasks[6].gate` 规定提交 `WRITE_SAFETY_NO_GO.md` 正式裁定 NO-GO；`writePathEnabled` 缺省 false（`knowledgeServices.ts:139`），apply/undo 返回 `write_path_disabled`，生产装配不传使能（`node.ts:2612`）**；首版「GO（收窄口径下）」宣布作废。

**测试真实结果：** `packages/services/test/knowledgeReview.test.ts` **19/19 通过**（本会话 grep 实数 19 个 test()，第 19 例为修复轮 1 新增的 S03 总门用例 `:74`「S03 门禁未满足（默认装配）：apply/undo 一律 write_path_disabled，文件零触碰」；阶段记录中的 18/18 为修复轮前过程数字）；9 个相邻知识库测试文件无回归全 exit 0；typecheck/lint/architecture:check exit 0（阶段会话实跑）。本会话复跑该文件含在 §2 #12 的 110/110 内。

**风险与未执行项：** read-SHA+atomic rename 非严格线性化 CAS（spec §5e.8 声明）；A31 旁路通道无硬阻断——按更正后口径属「未满足的 W00 GO 前提」而非有意分歧；**审核视图 UI 接线未做**（§1.3②）；重启/断线用白盒裸连接构造（未起真实第二 OS 进程）。**NO-GO（机制保留，写路径 fail-closed）**。

### W07 — 集成联调与发布前质量门槛（commit `ee12dd95`，4 files，+617/−2）

**做了什么：** 零产品代码改动：`packages/services/test/knowledgeE2EFullChain.test.ts`（3 用例：临时 Vault 全链路、managed Vault+撤权重授权、提示词注入只被当作数据/零出站/有界出站）+ `packages/ui/test/knowledgeUiDiscipline.test.ts`（4 用例：A21 静态面）+ spec 证据指针。**回归范围依据（修订新增）**：手机远控 51/51、远端隔离 20/20 等回归并非顺手全跑——W07 工作单第 3 项「兼容性回归」明确列举了普通会话/窗口切换/远端工作区隔离/手机重连等场景（`W07_DELIVERY.md` §1.2 第 3 项），且 W03 修改了共享的 v4 投影/桥接层（`product-projection.ts`、`apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-bridge.ts`），手机远控与远端链路复用该层，属「工作单清单 ∩ 影响面」的并集。（注：这两组回归本会话未复跑，引自 W07 会话记录。）

**测试真实结果：** knowledge 13 文件 110/110、手机远控 51/51、远端隔离 20/20、CLI wiring 15/15、obsidian-plugin 套件、`git diff --check`/typecheck/lint/architecture:check 全 exit 0（阶段会话实跑）；其中 110/110、15/15、obsidian-plugin 套件与三件套已由本会话在最终 HEAD 复跑证实（§2 #9–#14）。硬门槛四项见 §1.4。

**风险与未执行项：** A24/A28 未执行（无凭据/标注集）；GUI/真机半边未执行（实质原因见 W04 段修订措辞）；全量 `node --test` 与 `pnpm fmt:check` 未由任何会话执行、无运行记录（§2）。**GO（发布受 S03 未决约束）**。

---

## 4. 总提交清单（基线 `c39ce371` 起）

**口径说明（修订新增）**：下表 files 与 +/− 来自逐提交 `git log --stat`，**合计（132 文件槽位、+18,008/−145）≠ 区间合计（104 唯一文件、+17,909/−46）**，原因是：① 同一文件被多个提交触碰则逐提交重复计数——`specs/obsidian-knowledge.md` 被 7 个提交触碰、`packages/services/src/knowledge/knowledgeServices.ts` 与 `packages/services/src/index.ts` 各 4 次（本会话 `git log --name-only` 计数实测）；② 行数同理，后提交会改动先前提交新增的行，区间 `git diff --stat` 只计净额。两套数字口径不同、各自内部一致，读者可分别复现。

| # | commit | 主题 | files | +/− | 核心内容 |
| --- | --- | --- | --- | --- | --- |
| 1 | `2df17a2c` | w00(vaultview): 真实源码审计与安全 Spike 证据 | 4 | +499 | W00 四份审计文档 |
| 2 | `0d543db0` | w01(vaultview): 规格落地与 Obsidian 自动授权最小收窄 | 10 | +723/−7 | spec 新增/修订、hook 收窄、路径策略测试 |
| 3 | `9695b680` | w02(vaultview): Source/Index/文章召回服务 | 25 | +3606/−5 | 两个 Knowledge 服务、node:sqlite 索引层、bigram/BM25、lease/fencing |
| 4 | `a441352a` | w03(vaultview): Evidence 链与真实 Session 引用回跳 | 29 | +2622/−34 | Receipt 账本（v2）、契约载体、CLI 三层接线、投影漏映射修复 |
| 5 | `92c8a719` | w04(vaultview): VaultView 四视图真实 UI 接入 | 17 | +2780/−27 | 四视图、智能问库编排、九态、getter 合并回归修复 |
| 6 | `f7044879` | w05(vaultview): Jev 决策引擎与评估框架（默认关闭） | 25 | +3926/−60 | 决策层八模块、评测 harness、TypeSafe 契约验证、零出站默认 |
| 7 | `f60ed123` | w06(vaultview): 风险分级审核与安全写回（或 NO-GO 记录） | 18 | +3235/−10 | L2 审核机制、migration v3、`WRITE_SAFETY_NO_GO.md`、写路径 fail-closed |
| 8 | `ee12dd95` | w07(vaultview): 集成联调与发布前质量门槛 | 4 | +617/−2 | E2E 全链路 3 用例、UI 纪律 4 用例、spec 证据指针 |
| **区间合计（唯一文件口径）** | | | **104** | **+17,909/−46** | 新增 76 / 修改 28（§2 #5） |

**关于分支历史与 `eff2ee71`（修订新增）**：「基线起 8 个提交」指工作基线 `c39ce371` 之后的增量；分支自 `origin/main` 起共 **338** 个提交（本会话 `git rev-list --count` 实测），基线前历史很长。`eff2ee71`（主题「feat(host): 第49轮 server 远程五项偏离全部收口——share 禁用门禁/dispose/快照/workspaces UI」）是**基线之前的 HEAD 祖先**（`git merge-base --is-ancestor eff2ee71 c39ce371` exit 0，本会话实测）：该提交的 `packages/client/src/remoteServiceAccess.ts` 曾含 `obsidianVaultService` getter，其后一次合并（W04 报告记「两提交互不为祖先」，即两条线各自演进的版本合并）使工作副本丢失该 getter，W04 以 `git show` 对照发现并恢复。**具体是哪次合并丢的，W04 报告未给出合并哈希，本报告未再深挖**（恢复后行为有 ui 邻接测试与全量 typecheck 锁定，不影响交付判定）。

未做 git push（按纪律）；分支无远端跟踪（freshness 检查跳过 behind-remote，各阶段如实记录）。

---

## 5. 测试账目（13 文件 110 用例，逐文件可复核）

本会话逐一 `grep -cE "^[^a-zA-Z]*\btest\("` 实数（§2 #16），并与 §2 #12 的实跑总数（tests 110）精确吻合；「首次交付」指该文件随哪个阶段提交进入仓库：

| # | 测试文件 | 用例数 | 首次交付 |
| --- | --- | ---: | --- |
| 1 | `packages/services/test/knowledgeIndexQuery.test.ts` | 10 | W02 |
| 2 | `packages/services/test/knowledgeChunkerTokenizer.test.ts` | 9 | W02 |
| 3 | `packages/services/test/knowledgeLeaseFencing.test.ts` | 2 | W02 |
| 4 | `packages/services/test/knowledgeEvidence.test.ts` | 10 | W03 |
| 5 | `packages/services/test/knowledgeAskUiFlow.test.ts` | 3 | W04 |
| 6 | `packages/services/test/knowledgeDecisionPolicy.test.ts` | 14 | W05 |
| 7 | `packages/services/test/knowledgeJevAdapter.test.ts` | 15 | W05 |
| 8 | `packages/services/test/knowledgeDecisionPipeline.test.ts` | 10 | W05 |
| 9 | `packages/services/test/knowledgeEvaluationHarness.test.ts` | 4 | W05 |
| 10 | `packages/services/test/knowledgeReview.test.ts` | 19 | W06（第 19 例为修复轮 1 的 S03 门禁用例） |
| 11 | `packages/services/test/knowledgeE2EFullChain.test.ts` | 3 | W07 |
| 12 | `packages/ui/test/knowledgeAskModel.test.ts` | 7 | W04 |
| 13 | `packages/ui/test/knowledgeUiDiscipline.test.ts` | 4 | W07 |
| | **合计（13 文件）** | **110** | 本会话实跑 110/110 exit 0 |

**W02「22 项」勘误**：W02 报告摘要写「22 项 node:test 全绿」，其实际构成 9+10+2=**21**（其三文件联合运行记录 `tests 21` 亦为 21）；「22」系该报告摘要笔误。另有不入 13 文件账的 CLI 侧用例：`evidence-session-wiring.test.mjs` 10 + `knowledge-evidence-gate.test.mjs` 5 = **15**（本会话实跑 15/15，§2 #14）。W02 之后的「41/84/110」各聚合数字与逐文件实数一致，不受该笔误影响。

---

## 6. 验收对照

通过=有真实执行的测试证据（阶段会话或本会话复跑）；条件=部分覆盖或前提性通过；未执行=如实声明原因。标「本会话复跑」者见 §2。

| 验收 ID | 场景 | 状态 | 承载阶段与证据 |
| --- | --- | --- | --- |
| A01 | 无源→连接→建索引 | ✅ 通过 | W02 A02；W04 UI 编排用例（110 内，本会话复跑） |
| A02/A03/A04 | coverage 准确 / 修改删除重命名失效 / 排除+partial | ✅ 通过 | W02（110 内；配额级 >5000 文件用例未构造，如实声明） |
| A05 | 双 Host 写竞争、旧 fence 拒绝、重启恢复 | ✅ 通过 | W02：两个真实 OS 进程 SIGKILL→TTL 接管（110 内） |
| A06/A10 | 找回与不编造（负例 empty） | ✅ 通过 | W02 + W04 UI 面 + W07 E2E 负例查询（110 内） |
| A07 | 检索质量（简繁/同义词/Recall@30） | ⚠️ 条件 | 工具面 harness 就绪（W05）；真实标注集未建——A28 未实测，无任何指标声明 |
| A08/A09 | 多候选并列不强选 | ✅ 通过 | W04 状态机用例（110 内） |
| A11 | 扩搜上限一次 | ✅ 通过 | W02 OR 降级 + W05 policy EXPAND_ONCE（110 内） |
| A12/A13/A14/A15 | 改文 stale/删除 missing、切库撤权 forbidden、伪造 id 拒绝、quote 校验 | ✅ 通过 | W03 services+gate 双侧；W07 E2E 四态重锁（110 内） |
| A16 | @Vault→检索→预览→Session 问答→回跳 | ⚠️ 条件 | **服务面全链通过**（W07 E2E 用例①，含会话绑定 receipt）；模型生成与 GUI 点击级半边**未执行**（§7.1 #3）；且「提问带证据引用」当前无 UI 生产者（§1.3①） |
| A17 | busy 队列提升前复验 | ✅ 通过 | W03 真 handler+真投影用例（15/15，本会话复跑）；注意该验证由测试喂参驱动，生产路径暂无携带 refs 的输入（§1.3①） |
| A18 | 无模型/断网可检索可阅读 | ✅ 通过 | W03 零模型进程全链 + W07 硬门槛①（110 内） |
| A19 | 追问绑定文章、跨会话不串 | ✅ 通过 | W03 services A19（110 内） |
| A20 | 笔记编辑/选区/粘图零重构 | ⚠️ 条件 | **证据口径（修订）**：`packages/ui/src/v4/`（笔记编辑器所在目录）内改动仅 `VaultView.tsx`（+138/−25）与新增 `vault/knowledge/` 子目录、`vault-quote-reveal.ts`；`packages/ui/src/lib/conversationSelectionReference.ts` 区间零改动。**分支整体另修改了 W04 的 6 个既有文件**（含 `packages/client/remoteServiceAccess.ts`、`packages/services/src/accessor.ts`、两 i18n 词典——均为加法/accessor 接入，非编辑器路径），W04 提交 17 文件全清单见 §3 W04 段。点击级 GUI 未执行 |
| A21 | UI 渲染纪律（主题/窄屏/跨平台） | ⚠️ 条件 | **静态面通过**（W07 knowledgeUiDiscipline 4 用例，110 内）；跨平台真实渲染与 390px 未实测（win32 单机） |
| A22 | 迟到事件三重守卫 | ✅ 通过 | W04 runId+代数+seq 守卫用例（110 内） |
| A23 | 默认关闭零出站 | ✅ 通过 | W05 pipeline A23 + W07 E2E telemetry 断言（110 内） |
| A24 | 真实 Jev 出站联调 | ❌ 未执行 | 环境无凭据（§2 #15 复核成立）；替代证据=本地假服务器逐字段线格式断言 |
| A25/A26/A27 | 降级回退 / 重排不改事实+迟到丢弃 / 无答案不强选 | ✅ 通过 | W05（110 内） |
| A28 | 真实标注集 A/B | ❌ 未执行 | 无人工标注数据集；仅合成试点集锁定框架计算 |
| A29/A30 | hook 收窄防逃逸 / 合法 .md 编辑不回归 | ✅ 通过 | W01 e2e+单测双层（obsidian-plugin 套件，本会话复跑 exit 0） |
| A31 | 全写盘通道分级门控 | ❌ **未通过** | 三洞+P0 前提未在 runtime 层实施（§2 #6 复现：三洞 5 文件零提交）→ W06 门禁 NO-GO（`WRITE_SAFETY_NO_GO.md`） |
| A32/A33/A34 | 审核机制（提案/批准/账本/Undo/reconcile） | ✅ 通过（机制层） | W06 19/19（110 内；写路径被总门关闭，`write_path_disabled` 有专项断言）；UI 未接线（§1.3②） |
| A35 | 决策出站独立授权、日志无全文/凭据 | ✅ 通过 | W05 授权四态+凭证不进请求对象（110 内） |
| A36 | 仓库级门禁 | ✅ 通过 | typecheck/lint/architecture:check + `git diff --check` 全 exit 0（本会话复跑，§2 #9–#11） |
| A37 | 手机真机重连恢复同一 session | ⚠️ 条件 | 协议面通过（远控 51/51，W07 会话记录，本会话未复跑）；真机未执行（本环境无真实手机） |

---

## 7. 已知限制与回滚说明

### 7.1 已知限制（按影响排序）

1. **S03 硬门槛未满足（发布约束，最高优先）**：三洞（§0 术语表含 3 洞↔5 文件映射）与 P0 分级门控未在 runtime permission 层实施；L2/L3 写路径保持 fail-closed。GO 路径见 `WRITE_SAFETY_NO_GO.md` §3：runtime 层程序化修复（遵守还原目录纪律，ports/新模块接入）→ A31 覆盖报告 → 复评 S03 → 独立改动打开 `writePathEnabled`。在此之前任何代码/UI/文档不得宣称「审核写入已生效」。
2. **Evidence 复验管线无生产者（结构性，本修订新增）**：当前产品路径不存在发送 `evidenceRefs` 的入口——「加入 Agent」走 selection 引用（不获执行时复验），composer 附件化未交付。三层复验是已建成待接线的安全能力；在 composer 附件化落地前，S02 的执行前复验保证对用户实际操作不生效（对不携带 receipt 的输入本就无需复验，见 §7.1 #9 的精确规则）。
3. **GUI/真机验证缺口**：A16/A20/A21/A37 的点击级、跨平台渲染、真机重连半边未执行。**实质原因（修订）**：① 原生目录选择对话框无法可靠自动化，且自动扫描面有触碰用户真实 Vault 的风险；② 无人值守 agent 会话未构建/排期 GUI 自动化环境；③ A37 需真实手机，本环境无。并非操作系统缺显示能力（原 W07「无显示服务器」表述已更正）。已以服务级集成、协议级回归、静态纪律测试覆盖可执行面。
4. **桌面应用从未带新服务完整启动过（本修订新增）**：本分支的新 Knowledge 服务没有随真实 Electron 桌面应用完整启动并人工查看过——无任何阶段会话执行过 Electron 全链启动冒烟。现有证据=单元/服务级测试 + 注册点源码核对 + W00 Electron main 进程 node:sqlite probe（仅证明 SQLite 可用）。首次真实桌面启动存在未暴露问题的风险（服务已惰性开库以降低启动期风险，但这是缓解不是验证）。
5. **A24/A28 无真实数据**：真实 Jev 延迟/费用/限流行为与真实中文标注集收益均未知；全报告无任何检索质量或 Jev 改善声明。
6. **node:sqlite 全新依赖面**：node 24.1 加载打 ExperimentalWarning；Electron 41 main 可用性经 W00 probe 实测，但全链启动未复测（见 #4）；跨运行时 SQLite 3.49.1/3.51.2 版本混用（WAL 前向兼容）。
7. **CAS 语义边界**：审核写采用 read-SHA + atomic rename，非严格线性化——校验与 rename 窗口内的外部（Obsidian/旁路）保存会被覆盖且可能不可察觉（spec §5e.8 声明）；补偿控制=SHA 证据检测+结构化 conflict+账本快照留证（有测试）。
8. **POSIX 与真实双窗口未实测**：win32 单平台开发；路径判定用跨平台 API，软链用例按平台能力门控；真实 Electron 双窗口并发写同库未复测（DB lease 是第二道防线，Host 存活/路由归既有 owner/lease 机制）。
9. **`evidenceRefs` 的精确判定规则（修订，消除「fail-closed」歧义）**：字段为可选，规则分三种情形——① 输入**携带** receipt（idle 直发或队列提升）→ 必经 gate 复验，任何一项失败**含 gate 自身不可用**→ 拒绝并保留、绝不降级为 current：**「fail-closed」仅指此情形**（对证据主张宁可拒发不可错发）；② 输入**不携带** receipt → 按普通输入走既有链路，不触发复验；③ 旧 CLI/旧宿主「丢键」→ 输入退化为情形②的普通输入——**这不是「放行伪造证据」，而是该输入本就不携带证据主张**。原 §7.2（回滚）中「丢键=fail-closed 放行」的措辞有误，已更正；「additive fail-closed」的准确含义=新增字段对旧端兼容（additive），且携带者必被复验、失败即拒（fail-closed 限证据主张）。
10. **运行时行为细节**：决策授权为 Host 进程内存状态，重启后需重新授权（有意设计）；guard 账本 DB 损坏时对携带证据的输入 fail-closed 阻塞（保守语义）；`excludedOverQuota` 计数无测试触发（与其他排除计数同代码路径）；`KnowledgeResolveCitationResult` 失败分支 status 词表含 `current`（类型不可区分，建议 services 侧收窄）；`KnowledgeReviewView` 文案「将在 W06 阶段提供」阶段指称已过时（方向保守不违规）。
11. **工具链口径**：`oxfmt` 对新增与存量文件均不过且本仓不强制；bootstrap 包 lint 脚本在根 oxlintrc 下为 no-op（CLI 质量门禁为 tsc）；`pnpm knip` 未跑（非工作单门禁）；全量 `node --test` 与 `pnpm fmt:check` 无任何会话/脚本的运行记录（§2），「既有失败基线三文件」说法出自交接纪律文本、本会话未验证。
12. **W00 spike 资产易失（本修订新增）**：三个安全 spike 的可复跑脚本在 `%TEMP%/vaultview-w00-spike/`，Temp 可能已被或将被清理；持久可复核性依赖 W00 文档的 `path:line` 静态主张与命令/断言描述（§3 W00 段）。
13. **安全纪律**：全部测试使用 mkdtemp 合成临时 Vault，未触碰用户真实 Vault；全链零出站（Embedding/Jev 默认无端口）；日志只写元数据，无笔记全文/凭据/绝对路径。

### 7.2 修改文件的还原目录核对（修订：给依据，不只给结论）

104 个唯一文件中 **76 个新增（A）、28 个修改既有文件（M）**（§2 #5）。对 28 个修改文件逐一 `grep -lq "还原自"` **零命中**（§2 #17）——即本分支未修改任何带「还原自发行 bundle」头注释的还原文件（还原纪律按 AGENTS.md 以文件头标记判定，非按目录）。28 个修改文件的构成与性质：

- **apps/drora-cli（16 个）**：bootstrap 9（drora-protocol-entrypoint、queue.ts、session-flow.ts、input-intent.ts、commands/types.ts、product-projection.ts、server-types.ts、server.ts、v4-bridge.ts——全部为 additive 端口/字段透传或评审修复轮的漏映射修复）+ contracts 1（session.port.ts，additive 可选字段）+ obsidian-plugin 6（package.json、permission-request.ts、agent-access.ts、paths.ts、两个测试文件）。**其中 W01 对 obsidian-plugin hook 的修改是行为收窄而非 additive**——这不是还原文件（无还原标记），是工作单授权的 spec-first 变更（先改 `specs/obsidian-plugin.md` 后改代码，符合 AGENTS.md「行为改动先更新 spec」），本报告不再以「全部 additive」概括。该 16 文件位于 `.oxlintrc.json:78` 的 `apps/drora-cli` ignore 区——这是根 lint 的 CLI 隔离策略，与还原目录纪律是两回事。
- **根 packages（12 个）**：`packages/shared` 4（channels.ts、command.ts、input-intent.ts、index.ts——additive 常量/字段/导出）+ `packages/services` 3（node.ts、accessor.ts、index.ts——注册点/additive）+ `packages/client` 1（remoteServiceAccess.ts——恢复既有 getter + additive 代理）+ `packages/ui` 3（两 i18n 词典 additive 键、VaultView.tsx 条件布局）+ `specs/obsidian-plugin.md`（spec 修订）。
- **三洞 5 文件（`apps/drora-cli/packages/core/` 下）零提交触碰**（§2 #6）——它们是否属还原管制区不影响本分支（未触碰）；W06 GO 路径要求未来修复时遵守还原纪律并附原版 bundle 证据，该义务属后续工作。

### 7.3 回滚说明

- **整分支回滚**：`git revert` 或 reset 至基线 `c39ce371`；改动构成见 §7.2（76 新增 + 28 修改，未触碰还原标记文件）。
- **逐阶段回滚**已在各阶段报告 §4/§5 固化，要点：W01 还原 obsidian-plugin 源文件与 `specs/obsidian-plugin.md`、删 `specs/obsidian-knowledge.md` 与路径策略测试；W02–W05 checkout 前序 HEAD 修改文件并删相应 knowledge 子目录/测试（DB 文件在 Profile 数据根内，属可重建缓存，可直接删）；W06 migration v3 只增表（`CREATE TABLE IF NOT EXISTS` 自包含），回滚代码后旧读方不受影响、`review_*` 四表可保留；W07 删两个测试文件 + checkout spec 即完全回滚（零产品代码）。
- **契约兼容性**：`evidenceRefs` 为可选字段（判定规则见 §7.1 #9：不携带即普通输入，旧端行为不变）；三个 Knowledge channel 为新增注册，不移除既有通道。

---

## 8. 证据索引

- 阶段报告：`docs/vaultview/delivery/W01_DELIVERY.md` … `W07_DELIVERY.md`（各含命令/退出码表、偏差记录、回滚步骤）。
- W00 审计：`W00_EVIDENCE_REPORT.md`、`W00_ADMISSION_SEQUENCE.md`、`W00_TOOL_WRITE_MATRIX.md`、`W00_DB_HOST_SPIKE.md`（spike 脚本在 `%TEMP%/vaultview-w00-spike/`，易失，见 §7.1 #12）。
- 裁定文件：`docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md`（W06 正式交付裁定，含 GO 路径与可复核命令）。
- 行为契约：`specs/obsidian-knowledge.md`（§1 状态所有者、§2 方案 C L0–L3、§3–§5/§5b–§5e 各阶段落地记录）、`specs/obsidian-plugin.md`（W01 收窄章节）。
- 关键源码证据（本会话亲自核实）：`packages/services/src/knowledge/knowledgeServices.ts:139`、`packages/services/src/node.ts:2612`、`packages/shared/src/channels.ts:170-174`、`packages/services/test/knowledgeReview.test.ts:74`、`packages/ui/src/v4/vault/knowledge/KnowledgeReviewView.tsx:5-6,28,83`、`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/product-projection.ts:3380-3383`、`apps/drora-cli/packages/bootstrap/src/drora-protocol-v4/commands/handlers/queue.ts:186-190`、`apps/drora-cli/packages/obsidian-plugin/src/lib/agent-access.ts:83`、`apps/drora-cli/packages/obsidian-plugin/src/lib/paths.ts:63`、`packages/ui/src/v4/vault/vault-quote-reveal.ts:10`、`packages/client/src/remoteServiceAccess.ts:97-101,108,244-247`、三洞 5 文件（§0 术语表映射）。
