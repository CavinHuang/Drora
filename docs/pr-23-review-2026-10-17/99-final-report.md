# PR #23 增量独立评审报告（2026-10-17）

- 被审对象：PR #23（feat/obsidian-knowledge-e2e → main，repo CavinHuang/Drora）
- 本轮增量范围：`ce86499fa0cf6ae7238898e6a6966dccf16a0720..672714920661a412e31d6b71bce5cd34d082499c`（本会话亲验：`git log --oneline ce86499..6727149 | wc -l` = **100 提交**；`git diff --stat ce86499 6727149` = **42 files changed, 2002 insertions(+), 182 deletions(-)**）
- 上轮基线：2026-10-16 全量评审（NO-GO，`docs/pr-23-review-2026-10-16/99-final-report.md`，B1–B9 阻塞项）
- 评审方式：8 路独立审查员增量审查 + 评审主席去重复核；全程仅用只读命令（`git show`/`git diff`/`git ls-tree`/`git log` + `gh api`/`gh pr view`），未 checkout、未修改任何工作区文件
- **判定：维持 NO-GO**

---

## 一、结论速览

**判定：维持 NO-GO。**

本轮增量（100 提交）在工程质量上是上轮评审以来最好的一批：L2 写路径安全收口完整（生产总门 `node.ts:2609` 显式 `reviewWriteSafetyGatePassed: false`，8 条安全不变量经攻击性证伪全部成立）、G67 真 Electron 验收落地并在双平台 CI 执行、上轮 B8/B9 已修复、MCP 自报 `readOnlyHint` 不可信化 fail-closed、交付文档诚实度明显提升。但是：**上轮 NO-GO 的流程门禁（B1 人工验收零回执、B2 正式 review=0、B3 S03 NO-GO 未撤销、B5 Ready 纪律）一条也未真正关闭**——这些门禁按规则不得由代码审查替代放行；normative spec 的五处矛盾仅修复 §5f.4 一处（B7①③④⑤ 原样、B7② 同文件残留自相矛盾，本轮逐条亲验）；且本轮发现一个新的 **high/security** 问题：`e70019d1` 曾修复「全局 allowedTools 绕过 P0 逐次确认」，**2 分 26 秒后被 `d70baea5` 整体回退**，head 上该洞敞开且可经项目配置文件（`drora.json` / `.drora/config.json`）持久注入——一个不受信工作区随仓库提交配置文件即可静默放行 Bash/js/任意 `mcp__*`。另新增 spec-first 硬规则违反（L2 大量新状态机/RPC 零回写 spec）。此外 PR head 在本轮评审期间已前移至 `3a7f4fe`（本地未 fetch、内容未经任何独立评审），漂移模式延续。

CI 实查（本会话 `gh api runs?head_sha=6727149…`）：四工作流（CI 38993958274 / Cross-platform 38993958263 / Provenance 38993958311 / Pages 38993958266）全部 **completed/success**——上轮 B4/B6「同 SHA 全绿缺失」在 6727149 上已实质解除（评审启动时点的 in_progress 快照已过时）；新 head 3a7f4fe 四工作流亦全绿（run 38994987940 等）。**但这不构成放行依据**：流程门禁与 spec 矛盾仍在，且漂移使「同 SHA」持续失效。

---

## 二、判定与阻塞项/条件（更新后的完整清单）

### 阻塞项（blockers，7 项）

| # | 阻塞项 | 相对上轮 | 一句话 + 证据 |
|---|---|---|---|
| 1 | **B1 人工验收零回执** | 未变 | G01–G55 人工验收与 R1–R9 裁剪包批准仍无任何维护者回执：`gh api repos/CavinHuang/Drora/issues/23/comments` 实查 19 条评论作者 unique = `["CavinHuang"]`（全为作者本人）；PR body 新增 "No manual acceptance is being requested, per maintainer instruction" 仅为作者单方声称，无维护者在 PR 中的书面确认，不能替代门禁。 |
| 2 | **B2 正式 review = 0** | 未变 | `gh pr view 23 --json reviews,reviewRequests,isDraft` 实查：`reviews=0`、`reviewRequests=0`、`isDraft=false`，正式代码评审仍为零。 |
| 3 | **B3 S03 正式 NO-GO 未撤销** | 未变 | `git show 6727149:docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md` 头部状态更新（2026-10-17）自述「只有独立审核人基于当前 HEAD 明确复评并撤销裁定，才可改变此状态」——该独立复评未发生，安全签署仍缺。 |
| 4 | **B5 Ready 纪律 + head 漂移** | 未变且评审期间再漂移 | PR 处于 Ready（isDraft=false）而正式 review=0 的违纪状态延续；本轮评审期间 `gh pr view` 实查 headRefOid 已从评审基线 6727149 前移至 `3a7f4fe1313e708a9fae4b1a763ce99b6f822a1d`（本地 `git log` 报 bad object，未 fetch），该 head 的代码内容**未经本轮任何独立评审**。改善面：PR body 速览已更新至 3a7f4fe（不再引用过期 SHA）。 |
| 5 | **[新·high/security] allowedTools 持久放行 P0 工具且可经项目配置文件注入** | 新发现（洞在上轮基线已存在，上轮漏检；本轮曾修复又被回退） | head `service.ts:257-263` 的 `allowedTools` 命中即无条件 `allow(rule.allowedTools)`，无 P0 守卫，先于 edit/build 门控；`e70019d1`（09:37:03，加 `isP0WriteTarget` 守卫+ask 测试）被 `d70baea5`（09:39:29）整体回退（本会话亲验两提交 stat 与 head 代码）；且 allowedTools 并非注释自称的「CLI 启动参数」——`adapters/src/config/schema.ts:15` 接受 `permission.allowedTools`、`packages/shared/src/workspace-hook-config.ts:176-177` 项目候选文件 `drora.json`/`.drora/config.json`、`project-config.adapter.ts:123-125` normalize 仅剥 hooks（hooks 有 `config_project_hooks_pending_trust` 信任诊断 :63-68，allowedTools 无任何信任门）、`create-app.ts:371` 装配进 PermissionService。 |
| 6 | **B7 spec 矛盾（①③④⑤ 未修 + ② 残留）** | 仅 §5f.4 一处修复 | 本轮逐条亲验 head spec：`:152`「宿主未注入 gate → 不复验（additive）」vs 实现 fail-closed 抛 `gate_unavailable`（①）；`:481-482`「不是 Receipt、不获执行时复验」vs 实现全链复验（③）；`:1043-1044`「G01–G30 为最终人工验收矩阵」vs 全库 G01–G55 口径（④）；`:999`/`:1057` 双 `## 5f` 及成对 5f.1/5f.2/5f.3（⑤）；`:1017`「当前无提案生产者入口」与改写后 `:1031`「人工作业提案创建入口已实现（G67）」同文件自相矛盾（② 残留）。 |
| 7 | **[新·medium/standard] spec-first 缺口：L2 新状态机零回写 spec** | 新发现 | 增量为 L2 新增 durable undoing、claimUndoFiles、vault 级栅栏、settleUndoClaim CAS、TTL 拒绝、listRecentOperations RPC 等持久行为，而 `git diff --stat ce86499 6727149 -- specs/obsidian-knowledge.md` 仅 5+/2-（§5f.4 一段）；本会话亲验 head spec grep `undoing\|listRecentOperations\|claimUndo` 命中 **0**，代码侧 `reviewTypes.ts:99`、`reviewStore.ts:240-314` 均已落地。违反 AGENTS.md「新增或修改行为前，先更新对应 spec」。 |

### GO 前应处理条件（非新阻塞，但 S03 解禁后即成用户可达缺陷）

- **D-1** reconcile 无产品内入口（apply 返回 `reconcile_required` 或账本出现 undoing 卡点后 UI/装配零解铃路径，本轮新增 vault 级栅栏使其后果加重）——四组交叉复核成立；
- **E-1** vault-config.json 三条读-改-写路径（configureVaultAt / setVaultReviewWritePathEnabled / 新增 setVaultAgentWritesEnabled）无共享锁无版本比对，并发可回滚 `allowAgentWrites` 撤权并回退 epoch——两组复核成立，因新增第三条路径且其 UI 开关不受 gate 禁用而上调；
- **D-2/C-1/C-3**（knowledgeTurnCitations.ts:56/59/61，本轮主席亲验原样）、**D-3**（提案表单 7+2 条英文硬编码错误，本轮亲验 7 条 input.ts 原样 + 复核确认 Composer 新增 2 条）、**D-4**（草稿 receipt 仅内存，文件零改动）；
- **ui-review-1**（本轮新发现，已复核成立）：批准前强制预览门禁存在 fail-open 竞态（refresh 清空缓存后迟到的在途预览响应把键写回新 map，`previewsReviewed` 变真、批准按钮解禁而内容从未渲染）；
- **B-2 半闭合**：Electron workflow paths 仍缺 evidence-admission.ts、transcript-hydration.ts、ConversationComposer.tsx、conversationSelectionReference.ts、knowledge 非 review 子树（详见 §五 A1）。

### 相对上轮已解除的阻塞项

- **B4（同 SHA 全绿）/ B6（typecheck/lint）**：本会话 `gh api "…/actions/runs?head_sha=6727149…"` 实查四工作流全部 completed/success；3a7f4fe 亦四工作流 success。"Typecheck / Lint (ubuntu)" 在 gh pr checks 摘录（run 38993958274 = 6727149）为 pass。**因 head 已漂移至 3a7f4fe，merge 前须对最终 merge SHA 重新确认全绿。**

---

## 三、上轮 B1–B9 与 medium 发现现状核对表

### B1–B9 阻塞项

| 上轮项 | 现状 | 证据（本轮亲验/实查） |
|---|---|---|
| B1 人工验收/R1–R9 零回执 | **未变** | 19 条评论全为 CavinHuang（gh api 实查）；L2_WRITE_CLOSEOUT.md 自认 G01–G55 更广人工验收未做；body "per maintainer instruction" 无书面佐证 |
| B2 正式 review=0 | **未变** | gh pr view：reviews=0、reviewRequests=0 |
| B3 S03 NO-GO 未撤销/无签署 | **未变** | NO_GO 文档状态更新仅要求独立复评，复评未发生 |
| B4 同 SHA 全绿 | **已解除（6727149）** | gh api 按 head_sha 实查：CI/Cross-platform/Provenance/Pages 全 success；3a7f4fe 亦全绿。漂移后需对最终 SHA 重验 |
| B5 Ready 纪律/body 漂移 | **未变（纪律）+ 改善（body）** | isDraft=false 且 reviews=0 延续；body 速览已更新至 3a7f4fe（不再过期）；但 head 又漂移，且新 head 零评审 |
| B6 typecheck/lint | **已解除** | run 38993958274（6727149）workflow success，checks 摘录 Typecheck/Lint pass；本会话未在本地重跑（工作区非 PR head） |
| B7① spec:152 additive vs fail-closed | **未修** | 本轮亲验 `git show 6727149:specs/obsidian-knowledge.md` 第 152 行原样 |
| B7② 提案生产者自相矛盾 | **部分修复 → 残留** | §5f.4(:1031) 已改写「已实现（G67）」，但 :1017「当前无提案生产者入口」未同步，同文件冲突（亲验） |
| B7③ spec:481 旧 Receipt 语义 | **未修** | 亲验 :481-482 原样；实现（useKnowledgeAgentActions 等）全链复验 |
| B7④ spec:1043 G01–G30 | **未修** | 亲验 :1043-1044 原样；SMOKE.md/PR body/L2_WRITE_CLOSEOUT 均 G01–G55 口径，少认 25 例 |
| B7⑤ 双 ## 5f 章节冲突 | **未修** | 亲验 grep `^## 5f\|^### 5f`：999/1001/1010/1020/1029/1041 与 1057/1064/1080/1099 成对 |
| B8 G67 缺失 | **已修复** | obsidian-knowledge-positive.test.ts 在树、断言完整（三开关 disabled + 文件不变）；acceptance 组拉取两平台 job 日志逐条核验 G65/G67 ✓ 执行 |
| B9 「已 GO」文案 | **已修复** | writePathToggleHint 改中性文案、s03GateBlocked 与 NO-GO 现实一致；write-safety-gating.md 假引用全库清除（两组复核一致） |

### 上轮 medium/low 代码/文档项

| 上轮项 | 现状 | 证据 |
|---|---|---|
| B-2 Electron workflow paths 缺口 | **部分修复** | e1731157 为 cross-platform 新增 `obsidian-vault/**` 与 `knowledge/review/**`；仍缺 evidence-admission.ts、transcript-hydration.ts、ConversationComposer.tsx、conversationSelectionReference.ts、knowledge 非 review 子树（两组交叉复核 + acceptance 组逐文件 git ls-tree 对照） |
| B-4 G66 无 SEND_FAILED/guard 码断言 | **未修** | head 文件 grep `pause(` 两命中，本增量对该文件零改动（acceptance 组） |
| B-5 G64 pause(1800) 一次性负向 | **未修** | 同上 |
| C-1 手写 "evr_" 字面量 | **未修** | 本轮主席亲验 `git show 6727149:packages/ui/src/v4/knowledgeTurnCitations.ts` :61 原样 |
| C-3 上限 5 vs 契约 8 | **未修** | 同文件 :56 `receipts.length > 5` 原样（亲验） |
| D-1 reconcile 无 UI 入口 | **未修且加重** | 四组交叉复核：生产代码仅 reviewService.ts:78/84 与 reviewEngine.ts 定义/实现，UI/装配零调用；本轮新增 vault 栅栏 + durable undoing 使卡点后果加重（undoing 唯一落定点 settleUndoClaim 仅 reconcileOperation 内被调用） |
| D-2 完成态引用静默消失（等长计数门） | **未修** | 主席亲验 :59 `if (input.conversationQuotes?.length !== receipts.length) return [];` 原样（文件不在 42 文件增量清单） |
| D-3 提案错误英文直出 | **未修且加重** | 主席亲验 knowledgeReviewProposalInput.ts :26/30/33/36/40/44/53 共 7 条英文 throw 原样；复核确认 Composer 新增 "Configure a Vault before editing"/"Vault or source changed during the read" 2 条（violate spec :1055 WSG-UI-5） |
| D-4 草稿 receipt 仅内存 | **未修（推定）** | ConversationComposer.tsx 不在增量清单、基线与 6727149 字节一致（多组确认），按文件不变沿用上轮证据 |
| E-1 config 读改写竞态 | **未修且加重** | 两组复核：setVaultReviewWritePathEnabled 与基线逐字节相同；新增 setVaultAgentWritesEnabled 引入第三条同模式路径（config.ts:168-196，主席亲读）；UI Switch 不受 gate 禁用 |
| A-8 W09_DELIVERY.md 演示路径过期 | **未修** | 文件不在增量 42 文件清单（blockers 组） |
| A-10/services-2 knowledgeServices 注释矛盾 | **未修** | head :209-210 注释与生产永不执行的异步加载分支矛盾（l2-engine 组；本轮同文件仅新增 108-120 正确说明，未触及该段） |

---

## 四、增量安全审查结论

### 4.1 L2 写路径安全不变量（8 条，全部成立）

L2 安全专项组在临时只读 worktree 通读 reviewEngine.ts（1382 行）/reviewStore.ts/config.ts/atomic.ts/node.ts 装配/两个 SIGKILL fixtures，逐条攻击性证伪，l2-engine 组与 vault 组交叉验证，**未发现 high 级安全旁路**：

1. **undo 单赢家**：claimUndoFiles 单事务（BEGIN IMMEDIATE）fence+认领（reviewStore.ts:264-314，主席抽验 :264/:280-289 命中）；真双进程竞速测试（knowledgeReview.test.ts:991-1024）。
2. **CAS reconcile 防 stale recoverer**：settleUndoClaim WHERE status='undoing'（reviewStore.ts:418-434）；第二次 settle 返回 false 有测试。
3. **vault 级写栅栏**：transition/claim 双入口事务内检查同 vault applying/uncertain/undoing（reviewStore.ts:240-249，主席抽验 :240/:244/:249 命中）；非参与外部写者不参与栅栏的 limitation 被 09558a17 文档如实披露。
4. **授权重验**：锁等待后与逐文件边界的 gate/epoch 重验（reviewEngine.ts:750-777/:873-877/:1152-1202）。
5. **崩溃恢复**：4 个真 SIGKILL 用例（真子进程 + 真 ledger/marker 边界 + signal 断言）；partial crashed apply 显式 conflict 化（reviewEngine.ts:1064-1075）；恢复零 vault 写。
6. **TTL 严格校验**：非法 TTL 先拒后入账（reviewEngine.ts:541-547），测试覆盖 NaN/±Infinity/1.5/MAX+1/null。
7. **生产总门**：node.ts:2609 显式 `reviewWriteSafetyGatePassed: false`（主席复核组内多路确认），全库无第二处 true 注入；新 RPC `setAgentWritesEnabled` 只翻 L1 字段（allowAgentWrites+reviewWritePathEnabled=false+epoch 推进），不触 gate；`setWritePathEnabled(true)` 在 gate=false 时被 reviewEngine.ts:1362-1366 拒绝。
8. **reconcile 只读无自动落定**：生产代码零自动触发点（同时构成 D-1 缺口，见 §三）。

### 4.2 中间态 gate 洞史实（非上轮漏检，head 已闭合）

增量中间提交 9828f8fb 曾将 gate 写为 `!isDesktopAttachedRemote && knowledgeAutoIndex === true`（把后台索引选项当授权信号），17 分钟后 9356f3e8 改为 `serviceAuthorityMode === "desktop-local"`，最终 a89aa8e4 收敛为显式 false。基线 ce86499 的 node.ts 不传 gate（上轮「三处不传」证实），故该洞**非上轮漏检**，仅存在于增量中间态；head 闭合，G67 E2E 断言三开关 disabled + 文件零写佐证。

### 4.3 P0 权限修复评估

- **MCP 自报 readOnlyHint 不可信化（0c0a29ff）：成立且 fail-closed。** 两组独立确认五处收口：P0 分级忽略 readOnly（write-tier-policy.ts:47-53，`mcp`/`mcp__*` 一律 P0）；plan/build 只读快路径须 Host 验证的 OfficialCua（isTrustedReadOnlyTool :57-61）；整工具 allow 评估过滤、建议侧与 UI 风险展示同步；permissionCapabilityGroup 仅 Host 注册注入（provenance 而非 runtime/model 可控）；destructiveHint 只能收紧。残余自报面仅 low（§五 B4/B5）。
- **allowedTools 例外：敞开（本轮 blockers #5，high）。** `e70019d1` 曾以 `isP0WriteTarget` 守卫修复，`d70baea5` 于 2 分 26 秒后以「spec §1 已文档化操作员豁免」整体回退（代码+测试+spec 增补全翻回，本会话亲验两提交 stat 与 head service.ts 代码）。回退后的 spec 豁免口径（「CLI 启动参数、session-level」）与实现数据流不符：allowedTools 实际来自 System<User<Project<Env<Cli 五层合并，项目配置文件即可携带——构成 S03 不变量 2（「P0 工具不存在一次确认、永久放行的通道」）明令禁止、且项目*规则*路径已被封死的持久放行通道。head 上回归测试（permission-service-write-tier.test.ts:137-145 断言 allow）已把旁路固化为预期行为（cli-p0-3，medium/test）。

### 4.4 上轮漏检回溯

allowedTools 无条件放行洞在上轮基线 `ce86499:service.ts:253` 已存在（本会话未直接 diff 基线该行，CLI 组亲验 `git show ce86499` 证实同位置无条件放行），上轮 13 路评审均未发现（上轮 99-final-report.md grep「allowedTools」零命中）。漏检原因分析：该分支语义伪装成无害的「操作员显式配置」快路径，且上轮权限组聚焦 S03 三洞清单内文件。教训已在本轮以 high 采信补录。

---

## 五、本轮新发现明细（按领域分组，已去重）

严重度格式：`严重度/类别`；「复核状态」标注：**主席亲验**（本会话亲手跑命令/读代码）、**交叉复核**（≥2 组独立审查+复核成立）、**未复核**（沿用原审查员证据，低严重度未逐一亲验）。

### A. 测试与 CI 覆盖

- **A1 [medium/test] B-2 仅半闭合**（=acceptance-1/l2-security-4/blockers-15，交叉复核+主席核对 paths 结论）：
  `obsidian-electron-cross-platform.yml:7-18` 的 paths 本增量仅新增 `packages/services/src/obsidian-vault/**`(:17) 与 `knowledge/review/**`(:18)；evidence-admission.ts、transcript-hydration.ts（drora-protocol-v4/）、ConversationComposer.tsx、conversationSelectionReference.ts 及 knowledge 非 review 子树（knowledgeServices.ts 本增量被 9939df61+3ddae0be 改动约 9 行）均不匹配任一 glob；provenance 工作流 paths 无任何 packages/services 条目。缓解：ci.yml pull_request 无 paths 过滤，单测/接线级防线仍在。
- **A2 [medium/test] SIGKILL fixture 在 Windows 必假**（=acceptance-2/l2-engine-3，交叉复核，两组各自本机实验一致）：
  knowledgeReview.test.ts:1185/:1240 断言 `error.signal === "SIGKILL"`；两组在 win32 临时目录独立最小实验（worker 自 `process.kill(process.pid,"SIGKILL")`，父进程 execFile 捕获）均得 `{"code":1,"signal":null,"killed":false}`。4 例（:1158-1209 undo 两例、:1212-1285 apply 两例）无平台守卫；该套件仅 ci.yml verify/cli-build 两个 ubuntu-latest job 执行，Windows/macOS CI 从未验证，Windows 本地跑必红 4 例。测试为本轮增量新增（基线零命中）。
- **A3 [low/test] B-4/B-5 未修**（acceptance-3，未复核沿用）：G64 `pause(1800)`、G66 `pause(2000)` 一次性负向检查、无 SEND_FAILED/guard 码断言；本增量未重犯该模式（G67 为真实 WebDriver 键入 + waitUntil 显式条件 + deepEqual 全状态断言 + 磁盘不变断言，方法学显著优于上轮）。

### B. CLI 权限与写层安全

- **B1 [high/security] allowedTools 无条件放行且修复被回退**（=cli-p0-1，交叉复核+主席亲验 head 代码与两提交）：见 blockers #5 与 §4.3。plan 模式不受影响（planEnabled 分支先于 allowedTools 返回）。
- **B2 [high/security] 项目配置文件注入通道**（=cli-p0-2，交叉复核+主席亲验 schema:15、workspace-hook-config.ts:176-177、project-config.adapter.ts:63-68/123-125、create-app.ts:371）：见 blockers #5。归因：放行链路与 spec 豁免段在基线已存在，非本 PR 引入；本 PR 增量以注释把该分支定性固化为「session-level CLI 启动参数」而未修正矛盾。
- **B3 [medium/test] 回归测试固化旁路语义**（=cli-p0-3，交叉复核）：permission-service-write-tier.test.ts:137-138/:144-145 对 build 模式 js/readOnly-MCP 断言 allow/rule.allowedTools，与 e70019d1 原测试（断言 ask）方向相反；日后重新应用守卫此测试必红。
- **B4 [low/bug] 建议侧 app__* P0 识别退化**（cli-p0-4，未复核）：permission-flow.ts:186-190 调 buildDefaultPermissionUpdates 只传 3 参，app__* 工具（permissionName="mcp" 但名无 mcp__ 前缀）在无内容键输入时产出整工具 allow 建议；评估侧按 capability 过滤使其成为永不匹配的死规则，无放行旁路，但与「建议/评估/持久化三层一致」设计意图不符。
- **B5 [low/security] readOnlyHint 仍随 ToolCallStarted 外发**（cli-p0-5，未复核）：call-runner.ts:360-367 经 resolveToolCallCapabilityFlags 透传 capability.readOnly（信号源 mcp/index.ts:129 第三方自报、app-tools.ts:51 沙箱页面自报），消费者为 dynamic-workflow driver 的导入缓存关门判定；不影响 allow/deny，driver 下游不在本轮审读范围。

### C. L2 评审引擎 / 写路径安全

- **C1 [medium/standard] spec-first 缺口**（=l2-engine-1/blockers-6，交叉复核+主席 grep 亲验）：见 blockers #7。复核修正两点：①「specs/ 增量为空」不实——specs/ 增量共 38 行（agent-write-safety.md 31 行 MCP 口径 + obsidian-knowledge.md 7 行 §5f.4），只是均与 L2 状态机无关；②TTL 无 30s 下限为基线既有漂移，非本增量引入。
- **C2 [medium/completeness] D-1 未修且后果加重**（=l2-engine-4/ui-review-2/l2-security-5/blockers-11，四组交叉复核）：reconcileOperation/reconcileStuckOperations 生产代码仅定义/实现（reviewService.ts:78/84、reviewEngine.ts:1003/1095），UI/desktop/web/server/apps 装配零调用；crash 遗留 applying/uncertain/undoing 后同 Vault apply 被 reconcile_required 全拒、undo 被 operation_busy 全拒，undoing 唯一落定点仅存于 reconcileOperation 内部（reviewEngine.ts:1043）；spec :1016/:1026 仍声明 UI 有 reconcile 动作。缓解：生产 gate=false 使当前不可达；S03 GO 后即成产品内死锁面。
- **C3 [low/doc] A-10 注释矛盾未修**（l2-engine-2，未复核）：knowledgeServices.ts:209-210 注释称生产形态透传 undefined 由引擎异步加载初值，实际生产 gate 显式 false 使该分支永不执行。
- **C4 [low/bug] undo 全拒 message 文案失真**（l2-engine-5，未复核）：reviewEngine.ts:1306 顶层 message 固定「文件已相对本操作发生变化」，撤权/切库场景（文件并未外部变化）下失真；结构化字段可区分，仅提示语问题。

### D. 审核 UI

- **D1 [medium/bug] 强制预览门禁 fail-open 竞态（新发现）**（ui-review-1，交叉复核成立）：KnowledgeReviewView.tsx toggleExpanded（:259-266）的预览请求无取消/序号防护，仅以服务端 `content.revision===revision` 守卫；refresh 在 :126-127 执行 `setExpanded(new Set())/setChangeContents(new Map())` 后，迟到的在途响应经函数式 setState 写回重置后的空 map → :415-419 `previewsReviewed` 变真 → :444/:488 批准/重新批准按钮解禁，而该内容因面板被强制收起从未渲染给用户。变更行按钮（:532-536）无 disabled，扩大窗口。触发需预览 RPC 慢于 refresh 且用户恰在窗口内操作；服务端仍有 revision/changesHash 防线，故 medium。
- **D2 [medium/standard] D-3 未修且加重**（=ui-review-3/l2-security-7/blockers-12，交叉复核+主席亲验 input.ts 7 条 throw）：见 §三表；新增 Composer loadCurrentMarkdown 两条英文 throw 经 :55/:76→:145 同通道直出中文 UI，违反 spec :1055 WSG-UI-5；同增量已为预览做 intl 映射（zh-CN.ts:7399/7400），证明映射路径可行。
- **D3 [low/bug] undo 按钮对未 applied 提案可点**（ui-review-4，未复核）：:503 disabled 不含 `appliedOperations.has(...)`，点击必现 noUndoTarget 报错，与 spec :1015「undo（applied）」边界不符（D-6 仅部分改善：目标派生已改持久账本）。
- **D4 [low/bug] approvalExpired 时 previewRequired 说明不渲染**（ui-review-5，未复核）：:512 条件 `phase === "pending"` 不含 approvalExpired，过期批准场景用户只见灰按钮无原因。
- **D5 [low/standard] 操作状态行英文枚举直出**（ui-review-6，未复核）：:519-520 把 operation/file status 英文枚举原样插入双语 UI，locale 无对应键。
- **D6 [low/standard] loadCurrentMarkdown 无 loading 态**（ui-review-7，未复核）：读取期间按钮无 spinner、文案仍显示指令式 proposalLoadRequired，无法区分「读取中」与「未加载」。

### E. Vault 存储层

- **E1 [medium/bug] E-1 未修且竞态面加宽**（=vault-io-1/l2-security-8/blockers-18，交叉复核+主席亲读 config.ts:168-200）：三条写路径均为裸读-改-整文件写，无共享锁/版本比对；并发交叉可把已撤销的 `allowAgentWrites=false` 回滚为 true（使 obsidian-plugin permission-request.ts:32 恢复 Vault 内 Write/Edit 自动放行）。复核修正：epoch fencing 实际经 DB current_epoch 单调计数（sourceRegistry.ts:40,78-104）而非直接比 configuredAt，「旧 epoch 提案重新通过校验」仅在窄前提下成立，但撤权回滚危害独立成立。L2 apply/undo 仍被生产 gate=false 兜底。UI busy 互斥仅单窗口（:303），跨窗口/RPC 直达无互斥。
- **E2 [medium/standard] setVaultAgentWritesEnabled 推进 epoch 与明文声明矛盾**（=vault-io-2/l2-security-9，交叉复核+主席亲验 config.ts:178）：每次调用（含同值重复调用）`configuredAt: Math.max(Date.now(), config.configuredAt+1)`，经指纹 `${vaultId}:${configuredAt}`（sourceRegistry.ts:39-40）必然触发 sourceEpoch+1 并清除旧 epoch 知识索引缓存行——与 sourceRegistry.ts:12 头注释「allowAgentWrites 翻转不换 epoch：它门控写入，不改变读取范围」及 spec :203-204 直接矛盾；spec 全篇无 setAgentWritesEnabled 记录。测试已固化 configuredAt 推进（obsidianVaultConfig.test.ts:57,67），说明是有意实现而 spec/注释未同步；用户每次拨 L1 开关都触发索引缓存全量失效重建。
- **E3 [low/doc] 「唯一写入口」契约陈述失效**（vault-io-3，主席亲验）：config.ts:197-199 注释自称 reviewWritePathEnabled「唯一持久化入口…除本函数外不得写该字段」，同文件 :180 新函数已写该字段（方向安全侧 false，但契约已断）；spec :1024 同口径未同步。
- **E4 [low/test] 授权持久化测试无并发用例**（vault-io-4，未复核）：obsidianVaultConfig.test.ts:48-69 纯顺序 await 断言，E-1 竞态场景自上轮指出至今无并发测试锁定。

### F. UI 认证与根组件

- **F1 [low/bug] JWT-invalid 门启动窗口吞真实过期广播**（ui-auth-1，未复核）：useRootOAuthEffects.ts:221 以 renderer store `user!==null` 为唯一判据，restore 完成前到达的真实过期广播被静默吞掉且 401 处理器已 clearActiveSession，用户被无提示登出；桌面窗口毫秒级、Web restore 走 RPC 窗口更宽，Root.tsx:338 挂载即发起携带 JWT 的请求提供触发源。方向与修复目标（防误吞）相反，但可手动重登，low。
- **F2 [low/test] 门函数测试为恒真断言**（ui-auth-2，未复核）：oauthCachedSessionRestore.test.ts:42-49 断言 `return hasAuthenticatedUser` 的实现；真正风险点（Root.tsx:927→useRootOAuthEffects.ts:221 接线）在全 UI 测试零覆盖，传参回归为常量 CI 仍绿。
- 认证门主体方向（已登出时忽略全局 JWT-invalid 广播）经 UI 组推演成立：广播生产侧只在 active 凭据 401 且会话队列复核通过时广播、手动登出不发此广播，无重复弹窗路径；citation 测试（G45）绑定生产常量 KNOWLEDGE_CITATION_OPEN_TIMEOUT_MS，静态推演各回归路径均有效。CI 证据：job 117282219997（Typecheck/Lint，含两测试文件的 ci.yml:36 回归步）head_sha=67271492 success。

### G. 文档与流程（新观察）

- **G1 [low/doc] agent-write-safety spec 滞后一提交**（blockers-20，未复核）：MCP readOnlyHint 收口先落代码（0c0a29ff）后补 spec §6（039a8749），非「先更新 spec」；但回退事件表明后续把 spec 条款当作了真实契约。
- **G2 [low/doc] A-8 未顺带修复**（blockers-19，未复核）：W09_DELIVERY.md 演示路径仍指旧 UI 入口，文件不在增量。
- 五份 delivery 文档（L2_WRITE_CLOSEOUT / WRITE_SAFETY_NO_GO 状态更新 / S03_RUNTIME_COVERAGE §6-8 / MERGE_READINESS / RELEASE_SCOPE 重命名）与新 spec 关键声称经 blockers 组对码验证**一致、无夸大**；e830c57 历史 gate 违规被如实降级为 implementation evidence——文档诚实度较上轮明显提升。
- PR body 更新（本会话 gh pr view 实查）：速览已指向 3a7f4fe 且 CI 8/8（run 38994987940）与我实查一致；新增「per maintainer instruction 不请求人工验收」的说法——无论其真伪，均不构成 B1/B2 门禁的书面关闭（无维护者 PR 内回执）。

---

## 六、未覆盖与残留风险

1. **head 漂移至 3a7f4fe：零评审覆盖。** 本轮全部代码结论仅对 6727149 成立；3a7f4fe 本地未 fetch（`git log` 报 bad object），其内容未经任何独立评审，仅有 workflow 级全绿（本会话 gh api 实查 4 run success）。merge 前必须对最终 SHA 重跑增量评审，否则本报告结论不可延续。
2. **未重跑任何测试套件**（任务禁止）。所有测试结论基于：CI workflow/job 级实查（gh api）、静态审读、两组审查员的本机最小探针实验（SIGKILL Windows 行为）。G65/G67 在两平台 job 日志的逐条执行核验来自 acceptance 组（run 38993958311 两 job 日志），主席未重复拉取。
3. **pnpm typecheck / pnpm lint 未在本地运行**：工作区检出为 main 系（实际 HEAD=7ced6f89，分支 feat/virtual-pet-management，约 40 个脏文件），非 PR head 且禁止 checkout；以 CI「Typecheck / Lint (ubuntu)」（run 38993958274，head_sha=6727149）workflow success 作为替代证据，本会话未逐 job 拉日志核对步骤名。
4. **低严重度未复核项**（沿用原审查员证据，主席未逐一亲验）：A3、B4、B5、C3、C4、D3–D6、E4、F1、F2、G1、G2。它们不改变判定，但采纳时请注明来源。
5. **未覆盖面**：dynamic-workflow driver 对 readOnly 旗标的下游消费（B5 上游止步）；ui-review-1 竞态未做动态复现（静态推演+两组复核闭合）；多窗口/远程 Host 下 config 竞态的实际触发频率未量化。
6. **CI 时点差异说明**：评审启动快照中 CI/Cross-platform 为 in_progress，blockers 组当时实查亦 in_progress；本会话（评审后期）实查已全部 success。B4/B6 的解除判定以本会话最后一次实查为准，属时点事实而非矛盾。

---

## 七、附录：审查方法与覆盖

### 7.1 主席亲验记录（本会话实际执行的命令与结果）

| 命令 | 结果 |
|---|---|
| `git log --oneline ce86499..6727149 \| wc -l` | 100（增量提交数） |
| `git diff --stat ce86499 6727149` | 42 files changed, 2002 insertions(+), 182 deletions(-) |
| `gh pr view 23 --json reviews,reviewRequests,isDraft,headRefOid` | headRefOid=3a7f4fe…、isDraft=false、reviews=0、reviewRequests=0 |
| `gh api "…/actions/runs?head_sha=6727149…"` | CI/Cross-platform/Provenance/Pages 全 completed/success |
| `gh api "…/actions/runs?head_sha=3a7f4fe…"` | 四工作流全 completed/success（38994987940 等） |
| `gh api "…/issues/23/comments?per_page=100"` | total=19, authors unique=["CavinHuang"] |
| `git log --format … -1 3a7f4fe` | fatal: bad object（本地未 fetch，如实记录） |
| `git show 6727149:apps/drora-cli/packages/core/src/permission/service.ts`（245-275 行） | allowedTools 无守卫无条件 allow，先于 edit/build 门控（blockers #5） |
| `git show e70019d1 --stat` / `git show d70baea5 --stat` | 09:37:03 加守卫+测试+spec vs 09:39:29 整体回退（-18/+5 service.ts、测试翻转、spec -4） |
| `git show 6727149:apps/drora-cli/packages/adapters/src/config/schema.ts \| grep allowedTools` | :15 `allowedTools: z.array(z.string()).optional()` |
| `git show 6727149:packages/shared/src/workspace-hook-config.ts \| grep drora.json` | :176-177 候选 `drora.json`/`.drora/config.json` |
| `git show 6727149:apps/drora-cli/packages/adapters/src/config/project-config.adapter.ts` | :63-68 hooks pending-trust 诊断、:123-125 normalize 仅剥 hooks |
| `git show 6727149:apps/drora-cli/packages/bootstrap/src/app/create-app.ts \| grep -n allowedTools` | :371 装配 |
| `git show 6727149:packages/ui/src/v4/knowledgeTurnCitations.ts`（50-70 行） | :56 上限 5、:59 等长计数门、:61 "evr_" 字面量全部原样（D-2/C-1/C-3 未修） |
| `git show 6727149:packages/ui/src/v4/vault/knowledge/knowledgeReviewProposalInput.ts \| grep "throw new Error"` | :26/30/33/36/40/44/53 共 7 条英文 throw（D-3 未修） |
| `git show 6727149:specs/obsidian-knowledge.md`（grep additive/G01–G30/不是 Receipt/无提案生产者/唯一写入口；grep `^## 5f\|^### 5f`） | :152/:1043-1044/:481-482/:1017/:1024 原样；双 ## 5f（999/1057）及成对子节（B7①②③④⑤ 全部确认） |
| `git show 6727149:docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md`（头部） | NO-GO 未撤销，状态更新仅要求独立复评（B3） |
| `git show 6727149:packages/services/src/knowledge/review/reviewTypes.ts \| grep undoing` + `reviewStore.ts` grep claimUndoFiles/activeApply/activeUndo + spec grep undoing\|listRecentOperations\|claimUndo | 代码 :99/:264/:240-249 命中、spec 命中 0（spec-first 缺口确认） |
| `git show 6727149:packages/services/src/obsidian-vault/config.ts`（168-200 行） | setVaultAgentWritesEnabled 每次推进 configuredAt、:180 写 reviewWritePathEnabled、:197-199 唯一入口注释（E2/E3 确认） |

### 7.2 各审查组覆盖

- **测试与 CI 验收**：ci.yml/cross-platform/provenance 三工作流接线、G65/G67 spec 方法学、SIGKILL/undo 竞速/屏障/receipt isolation 测试真实性、两平台 job 日志逐条核验（G65/G67/G61-G64/G66/G06/G07/G12 ✓）、CI 按 head_sha 实查。
- **CLI 权限**：0c0a29ff 五处收口逐面验证、e70019d1→d70baea5 回退链、allowedTools 五层数据流（config-factory/workspace-hook-config/schema/adapter/merger/create-app）、AGENTS.md 合规（契约常量/挂点/ignorePatterns）。
- **L2 评审引擎**：11 文件状态机咬合验证、生产装配演进（9828f8fb→9356f3e8→a89aa8e4）、测试真实性、spec diff。
- **UI 认证**：JWT 门三提交链、广播生产/消费两侧推演、citation 测试绑定生产常量验证。
- **审核 UI**：write grant Switch、预览门禁、缓存键、i18n 双语 63 键 diff、DESIGN typography、B9/D-6 复核。
- **Vault 存储**：atomic.ts 重试边界、栅栏与文档一致性、epoch fencing、RPC 面、E-1/A-10 回访。
- **L2 写路径安全专项**：临时只读 worktree 通读 1382 行引擎 + 8 条不变量攻击性证伪 + spec/delivery 文档 diff。
- **门禁文档核查**：B1–B9 逐项现状、五份 delivery 文档对码、PR body/评论/CI 时点核查。

### 7.3 判定规则引用

- CI 按 PR 自身规则「缺少证据即未通过」处理；本会话实查 6727149 与 3a7f4fe 均全绿，故 B4/B6 解除，但因漂移需对最终 merge SHA 重验。
- G01–G55 人工验收与正式 Review 属流程门禁，不得由代码审查替代放行（任务规则）。
- 上轮 NO-GO 未被独立复评撤销前，S03 相关写路径保持 fail-closed 现状（生产 gate=false），本报告不重开该裁定。
