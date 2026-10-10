# W06 交付报告 — 风险分级审核、提案与安全写回

**工作单：** W06　**日期：** 2026-10-10（含评审修复轮 1）　**实现分支/commit：** `feat/vaultview-impl`（工作树未提交，脚本统一提交）　**基线 HEAD：** `f7044879`（w05）

> **正式裁定（评审修复轮 1 更正）：NO-GO。** W06 门禁为 TASK_GRAPH `tasks[6].gate =
> "S03 Hard Write Safety GO"`；W00 对 S03 的判定是**有条件 GO**，前提=「先修三洞 + P0 分级门控」
> （`W00_EVIDENCE_REPORT.md` §7，有意分歧集合仅限 MCP server 进程内写/宿主自动写/yolo 直通）。
> 截至本阶段，三洞与 P0 门控在 runtime 层零改动——门禁未满足，按工作单规定提交
> `WRITE_SAFETY_NO_GO.md`。本阶段机制交付保持**写路径 fail-closed**（`writePathEnabled`
> 缺省 false，apply/undo 返回 `write_path_disabled`）；首版报告「GO（收窄口径下）」的宣布
> 与「把 Bash/js 扩进分歧集」均系对 W00 条件的引用不完整，已在本文与 spec §5e 更正。

## 1. 完成内容与真实代码证据

### 1.1 文件及作用

**新增（自研模块，不触碰还原/上游对齐目录）：**

| 文件 | 作用 |
| --- | --- |
| `packages/services/src/knowledge/review/reviewTypes.ts` | RPC DTO 与状态机词表唯一定义处（Operation 状态 `prepared→applying→applied/conflict/uncertain`、per-file 状态、结构化拒绝码） |
| `packages/services/src/knowledge/review/reviewService.ts` | `IKnowledgeReviewService` 接口 + descriptor（browser-safe；channel 字面量在 `@drora/shared` channels.ts） |
| `packages/services/src/knowledge/review/reviewLedgerRows.ts` | 账本行类型、SQLite 行映射、`canonicalizeChangesJson`/`sha256Hex`（changesHash 唯一口径：canonical 4 权威字段 kind/relativePath/baseSha256/content） |
| `packages/services/src/knowledge/review/reviewStore.ts` | `ReviewLedgerStore` CRUD：proposal/approval/operation/operation-files；operationId PRIMARY KEY 唯一约束；`transitionOperationToApplying` 单赢家转移（BEGIN IMMEDIATE + `WHERE status='prepared'`） |
| `packages/services/src/knowledge/review/reviewEngine.ts` | 服务实现（文件顶 `eslint-disable max-lines` 附理由，与 host registry 同先例）：提案生命周期、批准绑定、执行管线（快照→单赢家转移→门面 CAS 写→冲突即停）、reconcile（只读证据核验）、undo（当前 SHA 验证逆操作）；**S03 总门 `writePathEnabled` 缺省 false → apply/undo 一律 `write_path_disabled`**（修复轮 1） |
| `packages/services/test/knowledgeReview.test.ts` | 18 条主场景测试（必测清单全覆盖，见 §2） |

**修改：**

| 文件 | 作用 |
| --- | --- |
| `specs/obsidian-knowledge.md` | §0/§1/§2 状态更新为【已实现，W06】；新增 §5e（9 小节：模块构成/状态所有者/RPC 面/Proposal 契约/批准绑定/ledger 与双 Host 串行/Undo/覆盖边界与有意分歧/验收映射）；K-W06 验证表更新 |
| `packages/shared/src/channels.ts` | `ServiceChannels.KnowledgeReview = "knowledge-review"`（契约字面量单一出处） |
| `packages/services/src/knowledge/store/migrations.ts` | migration **v3**：`review_proposals / review_approvals / review_operations / review_operation_files`（review_* 四表不在任何索引清除路径上，注释同步） |
| `packages/services/src/knowledge/knowledgeServices.ts` | 工厂装配 `reviewService`（共享同一 DB 连接与 dispose 链）；`reviewWritePathEnabled` 选项**生产装配不传**（总门保持关闭，修复轮 1） |
| `packages/services/src/knowledge/{knowledgeIndex,source/sourceRegistry}.ts` | 注释收口：「审核账本不存在」→「review_* 四表同库共存且不在清除路径上」 |
| `packages/services/src/index.ts` | browser-safe 导出接口 + descriptor + 纯类型 |
| `packages/services/src/node.ts` | `createLocalServices` 注册 `IKnowledgeReviewService`（:2779-2780） |
| `packages/services/src/accessor.ts` | `IServiceAccessor.knowledgeReviewService?`（host-local 故可选，与 Knowledge 同形） |
| `packages/client/src/remoteServiceAccess.ts` | renderer 侧 RPC 代理（:108, :244-247；host 未注册频道时调用期失败由 UI 错误态呈现） |

### 1.2 逐项完成情况

| 工作单要求 | 状态 | 证据（path:line 为 reviewEngine.ts 除注明外） |
| --- | --- | --- |
| Proposal 保存目标源/来源证据/目标 base SHA/proposalRevision/精确 Diff | ✅ | 创建绑定 `vaultId`（`resolveSource`）；evidence 原样入账；write/delete 强制 baseSha256 且创建期与磁盘对齐（`materializeChanges`，base 不命中即拒）；revision 从 1 单调递增；changes_json 存精确目标内容（≤2MB） |
| 批准绑定 sourceEpoch + revision + hash | ✅ | `approveProposal` 写 `(proposalId, revision, changesHash, sourceEpoch, approvedAtMs, expiresAtMs)`，TTL 默认 10min |
| Diff 改变必须重审 | ✅ | `reviseProposal` 任何字段修订 → revision+1 + hash 重算；apply 只认**当前 revision** 的批准（`checkApproval`：revision/hash/epoch/expire 四重校验） |
| 未批准/过期批准绝不写文件 | ✅ | apply 在任何文件 IO 前置校验；blocked 返回 `not_approved`/`approval_expired`，operation 为 null。另：S03 总门缺省关闭时 apply/undo 直接返回 `write_path_disabled`（先于一切校验，文件零触碰，专项测试断言） |
| Operation ledger operationId 唯一约束 | ✅ | DDL PRIMARY KEY（migrations.ts v3）+ `insertOperation` INSERT OR IGNORE + `resolveExistingOperation` 幂等回放（重复提交返回账本记录，不二次执行） |
| prepared→applying→applied/conflict/uncertain | ✅ | 状态机词表 reviewTypes.ts；单赢家转移 `transitionOperationToApplying`（reviewStore.ts，跨进程 BEGIN IMMEDIATE 串行）；uncertain 仅由「证据不可得」产生，等待再次 reconcile |
| 先保护快照 | ✅ | 执行阶段 1 把每个文件的当前内容+sha 写入 `review_operation_files` 快照列（`executeOperation`），之后才进入写入阶段 |
| 结果未知走 reconcile 不自动重放 | ✅ | `reconcileOperation` 只读文件证据（sha==next→applied；==snapshot→not_landed；否则 conflict）+ 账本落定，**零文件写**；not_landed 回 prepared，重放必须显式新 operationId 调用 apply |
| Undo 带当前 SHA 验证的逆操作 | ✅ | `undoOperation`：write→CAS 写回快照（expectedSha=nextSha）；create→CAS 删除；delete→createOnly 重建；当前 sha 不符 → `undo_conflict` 且文件原样保留 |
| 双 Host 同文件串行 | ✅ | 同 operationId：账本单赢家转移；不同 operationId 同文件：门面 read-SHA CAS（后写者 conflict）；同进程：per-vault 异步互斥（`withVaultLock`） |
| 不绕过 Vault 安全门面 | ✅ | 全部写经 `createVaultFileSystem(...).writeFile/deleteFile`（CAS+原子写+逐段 lstat），无任何直接 fs.writeFile 写 vault 路径 |
| 真实覆盖 Write/Edit/Bash/脚本/MCP 写盘路径 | ✅（含如实边界与门禁裁定） | 见 §3.1 覆盖表与本报告 §4：Bash/js/MCP 为未满足的 W00 GO 前提（P0 门控必须修）→ 门禁未满足，正式裁定 WRITE_SAFETY_NO_GO.md，写路径 fail-closed；旁路写盘测试固化「本层不构成硬阻断但 SHA 检测绝不静默覆盖」 |
| read-SHA+atomic rename 线性化限制的测试与描述 | ✅ | spec §5e.8 明确「校验与 rename 之间存在窗口，不承诺外部并发编辑零丢失」；并发测试按「最终内容必为目标内容 + 账本自洽」断言（不冒充严格 CAS） |

### 1.3 实际调用链

```
UI/RPC → IKnowledgeReviewService.applyProposal（channel "knowledge-review"）
  → resolveKnowledgeSource（vault-config.json 唯一事实源 → vaultId/sourceEpoch）
  → checkApproval（revision+changesHash+sourceEpoch+expiresAt+allowAgentWrites）
  → insertOperation(prepared) [operationId 唯一] → transitionOperationToApplying [单赢家]
  → 阶段1 逐文件读现状 + 快照入账（base 失配即 conflict，零写盘）
  → 阶段2 门面 CAS 写（冲突即停）→ 账本 applied/conflict
断线/崩溃 → 账本停 applying → reconcileOperation（只读核验落定）→ 显式重放
```

## 2. 测试

**环境**：Windows 11（win32 10.0.26200）、node v24.1.0（本地实际版本；mise 钉 24.14 未激活）、
tsx 直跑 node:test。测试全部使用 mkdtemp 合成临时 Vault，零模型/零网络。

| 命令/场景 | 环境 | exit code | 证据 |
| --- | --- | ---: | --- |
| `pnpm typecheck`（全仓 tsc -b） | node 24.1 / win32 | 0 | 通过（首次失败 33 处均为本阶段新文件类型错误，已修复后复跑通过） |
| `pnpm lint`（oxlint 全仓） | 同上 | 0 | **0 errors**（修复前 2 errors 均为本阶段新文件 max-lines：reviewStore 502 行已拆分、reviewEngine 1077 行按仓库先例文件顶豁免附理由）；warnings 387 全部为基线存量，`knowledge/review` 命中数 0 |
| `pnpm architecture:check --changed` | 同上 | 0 | `architecture: OK / violations: 0 / baseline: 0 / new: 0` |
| `node --import tsx --test packages/services/test/knowledgeReview.test.ts` | 同上 | 0 | 19/19 pass（覆盖：S03 总门默认关闭（apply/undo 全拒+文件不变）、正常批准、未批准/过期拒绝、审批后改稿、创建期现实对齐、拒绝提案、外部并发 conflict、重复 operationId、断线未知结果+reconcile 不重放、重启 reconcile、撤权（apply/undo）、切库、双 Host 串行 CAS、双 Host 并发、Undo 正常/冲突、create/delete 逆操作、旁路写盘、L3 结构排除（.obsidian/非 md/`..`/重复路径）、混合提案快照） |
| `node --import tsx --test packages/services/test/{knowledgeEvidence,knowledgeIndexQuery,knowledgeChunkerTokenizer,knowledgeDecisionPolicy,knowledgeDecisionPipeline,knowledgeJevAdapter,knowledgeEvaluationHarness,knowledgeAskUiFlow,knowledgeLeaseFencing}.test.ts`（逐文件） | 同上 | 全部 0 | 9 个相邻文件全部通过（migration v3 无回归） |

**未执行（如实说明）：**
- 全仓 `node --test` 全量与既有失败基线（desktopRendererPlatformMobileFace / computerUseSettingsNavigation / nonCliAcpRetirement）：按验证分工由统一脚本执行，本阶段未运行。
- 真实双进程（两个 OS 进程级 Host）并发：测试内以两个独立服务实例共享同一 sqlite 文件模拟（WAL + BEGIN IMMEDIATE 跨进程语义与真实进程一致），未额外起真实第二进程。
- Electron/renderer 链路 E2E（审核视图 UI 消费）：本阶段交付到 RPC 面 + accessor，UI 接线属后续工作单，未执行。
- 外部 Obsidian 真实应用并发编辑：以直接 fs 写模拟（等价最终形态），未安装/驱动真实 Obsidian。

**Mock/Spike 依赖**：「断线未知结果」「重启 reconcile」两条测试用第二个裸 `DatabaseSync` 连接
手工构造崩溃现场（operation 停 applying、部分文件已落盘、账本未更新）——白盒但与真实进程死亡
的账本/磁盘状态一致，未 mock 被测对象本身。

## 3. 评估和安全

### 3.1 写盘路径覆盖表（A31；修复轮 1 更正口径）

| 路径 | 硬阻断 | 证据/说明 |
| --- | --- | --- |
| L2 审核写（本服务，总门开启后） | **有**：未批准/过期/换 revision/换 epoch/撤权/冲突一律结构化拒绝，文件零触碰 | `checkApproval` + 测试；**当前总门缺省关闭**（`write_path_disabled`，WRITE_SAFETY_NO_GO.md §2） |
| L1 Write/Edit（runtime ask 集合） | 有（W01 已交付）：hook 仅对根内非隐藏 `.md` 的 ask 询问自动放行，其余逐次询问 | `specs/obsidian-plugin.md`「W01 自动 allow 收窄」、既有 permission-path-policy/hooks-e2e 测试 |
| Bash / node_repl(js) / 未声明 destructive 的 MCP | **无硬阻断——属「未满足的 W00 GO 前提」（P0 分级门控必须修），不是有意分歧** | W00_TOOL_WRITE_MATRIX §3/§4 实证（yolo/整工具 allow 在 hook 之前短路、subjects 键集无 `code`、`bash-command-rule-evaluator.ts:14` 整工具短路）；`c39ce371..HEAD` 对三洞文件零改动 → 门禁未满足，正式裁定 WRITE_SAFETY_NO_GO.md |
| MCP server 进程内写 / 宿主自动写盘（8 类）/ yolo 直通 | 无硬阻断——**有意分歧（W00 收窄口径允许的三项）**：改审计+receipt，属后续 runtime 工作 | W00_EVIDENCE_REPORT §7 分歧集原文；本阶段以账本快照 + SHA 证据检测作为本门面范围内的补偿控制 |
| **补偿控制（本阶段已落地）** | 旁路写入必然改变文件 SHA → 后续 apply/提案 base 校验/undo 结构化 conflict + 账本快照留证，绝不静默覆盖 | 旁路写盘测试、外部并发 conflict 测试、Undo 冲突测试 |

### 3.2 Source 权限与数据出站检查

- 审核链零出站：无任何网络/模型调用；提案内容、快照、sha 全部落本地 knowledge-index.sqlite。
- 日志（`createServiceLogger("knowledge-review")`）只记 proposalId/operationId/revision/计数，
  不写笔记全文、路径、凭据（测试运行日志已抽查确认）。
- `allowAgentWrites` 是执行与撤销的唯一许可标志（apply 与 undo 双侧检查）；切库（vaultId 失配）
  与撤权重授（sourceEpoch 失配）使批准失效但不清除账本（审计历史保留）。

### 3.3 跨 Host / 并发

- 双 Host 同 operationId：sqlite 唯一约束 + prepared→applying 单赢家转移（败者按
  `idempotent_replay`/`reconcile_required` 语义返回）。
- 双 Host 不同 operationId 同文件：门面 CAS 后写者 conflict。
- **如实限制（spec §5e.8 已声明，未夸大）**：read-SHA + atomic rename 不是严格线性化 CAS——
  校验与 rename 之间存在窗口，外部进程在该窗口内的保存会被覆盖且可能不可察觉；本服务不承诺
  对外部并发编辑零丢失，只承诺窗口最小化、账本快照留证、自身并发经账本串行。并发测试因此按
  「最终内容必为提案目标内容 + 账本状态自洽」断言，不冒充「恰好一个 applied」的强断言。

### 3.4 Jev 与数据集

不涉及（W06 无决策/出站面；ADR #5/#11 不受影响）。

## 4. 结果与门槛

- **通过的验收 ID**：A32、A33、A34（机制层面测试实证，19/19；写路径当前被总门关闭）。
- **未通过的验收 ID**：A31——P0 通道（Bash/js/未声明 destructive 的 MCP）硬阻断未实现，
  W00 有条件 GO 的前提（三洞 + P0 分级门控）未满足 → **门禁 `S03 Hard Write Safety GO`
  未通过**。
- **GO/NO-GO**：**NO-GO**（评审修复轮 1 更正，首版「GO（收窄口径下）」作废）。按工作单
  「没有强硬阻断的真实证据，只提交 `WRITE_SAFETY_NO_GO.md`」执行：
  1. 正式裁定文件：`docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md`（未满足前提逐条引用、
     可复核命令、GO 路径）；
  2. 审核写路径 fail-closed：`writePathEnabled` 缺省 false，apply/undo 返回
     `write_path_disabled`（含幂等回放），文件零触碰；生产装配（node.ts）不传使能；
     专项测试断言默认装配全拒；
  3. L2 机制（Proposal/批准/账本/Undo/reconcile）保留并测试通过，供门禁通过后启用；
     门禁通过前不得宣称「审核写入已生效」（spec §5e 引言同步约束）。
- **回滚步骤**：本阶段全部改动位于新模块 + additive 注册点；回滚 = 还原修改文件并删除
  `packages/services/src/knowledge/review/` 与测试文件。migration v3 只增表不破坏 v1/v2
  （旧代码读库不受影响），无需数据回滚。
- **下一阶段建议**：① **P0 门控与三洞修复为最高优先**（W00 GO 前提，见 WRITE_SAFETY_NO_GO.md
  §3 GO 路径：runtime permission 层程序化实现，遵守还原目录纪律，以 ports/新模块接入）；
  ② S03 复评通过后再做 VaultView「审核」视图接真实 RPC（列表/Diff 预览/批准/执行/撤销/
  reconcile 状态呈现）；③ 审核账本运维面（体积展示、显式清理策略）。

## 5. 上游冲突风险

- 低：`channels.ts` / `node.ts` / `accessor.ts` / `remoteServiceAccess.ts` / `index.ts` 均为
  additive 行级插入，且本仓已大幅领先上游（ahead 336）。
- 中：`migrations.ts` 若上游同步时同样新增 v3 迁移会产生版本号冲突——本仓 v3 语句自包含
  （CREATE TABLE IF NOT EXISTS），冲突解决时保留双方语句即可，无数据风险。
