# WRITE_SAFETY_NO_GO（W06 正式交付裁定）

**工作单：** W06　**日期：** 2026-10-10（评审修复轮 1）　**分支：** `feat/vaultview-impl`　**基线 HEAD：** `f7044879`
**门禁：** `docs/vaultview-agent-handoff/03_WORK_ORDERS/TASK_GRAPH.json` `tasks[6].gate = "S03 Hard Write Safety GO"`
**裁定：** **NO-GO**——按工作单规定「没有强硬阻断的真实证据，只提交 `WRITE_SAFETY_NO_GO.md`」执行本分支。

## 1. 为什么 NO-GO（门禁前提未满足，完整引用 W00 条件）

W00 对 S03 的判定是**有条件 GO**，GO 前提见 `docs/vaultview/delivery/W00_EVIDENCE_REPORT.md` §7
「S03 有条件 GO（收窄口径）」。逐项核对当前 HEAD：

| W00 GO 前提 | 当前状态 | 证据 |
| --- | --- | --- |
| 三洞 (1)：plan 模式两处打洞——无 `destructiveHint` 的 MCP 直通（`apps/drora-cli/packages/core/src/permission/service.ts:415-422`）+ memory md 覆盖 plan deny（`apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts:38-46`） | **未修** | `git log c39ce371..HEAD -- <两文件>` 零提交；本仓 diff 亦未触及 |
| 三洞 (2)：node_repl/MCP 无内容规则粒度，一次「总是允许」= 持久化整工具 allow（`core/src/tool/executor/permission-suggestions.ts:24-36` + `permission/service.ts:292`） | **未修** | 同上，两文件零改动 |
| 三洞 (3)：Bash 整工具 allow 规则短路含重定向在内的一切命令（`core/src/tool/handlers/bash-command-rule-evaluator.ts:14`） | **未修** | 同上，文件零改动 |
| P0 分级门控：任意路径写（Bash/js/未声明 destructive 的 MCP）强制逐次确认 + 禁整工具持久 allow；统一挂点 `resolveToolCallCapabilityFlags`（`permission-capability.ts:28-39`）随 `ToolCallStarted` 广播 | **未实现** | 「P0 门控/三洞」在 W00 两份文档之外的 `specs/` 与 `docs/vaultview/` 零命中；runtime permission 层无对应改动 |
| 门控实现必须在 permission service/runtime 层程序化完成，不依赖插件 hook | **未实现** | 同上 |

复述可复核命令：`git log --oneline c39ce371..HEAD -- apps/drora-cli/packages/core/src/permission/service.ts apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts apps/drora-cli/packages/core/src/tool/executor/permission-suggestions.ts apps/drora-cli/packages/core/src/tool/handlers/bash-command-rule-evaluator.ts apps/drora-cli/packages/core/src/mcp/index.ts`（输出为空 = 零改动）。

**重要更正（评审指出）**：Bash 与 node_repl(js) 属于上述 **P0 门控前提的范围**，必须修复而非
豁免；W00 有条件 GO 允许的**有意分歧集合仅限三项**——MCP server 进程内写盘、宿主自动写盘、
yolo 直通（改审计+receipt）。首版交付报告把 Bash/js 列入分歧集是对 W00 结论的引用不完整，
本文件与 `specs/obsidian-knowledge.md` §5e.8 已更正。

## 2. 本阶段实际交付物（NO-GO 分支下的形态）

1. **机制面（已落地，供门禁通过后启用）**：L2 审核写入机制——Proposal（目标源/来源证据/
   base SHA/proposalRevision/精确内容）、批准绑定（revision+changesHash+sourceEpoch+TTL）、
   Operation ledger（operationId 唯一约束，prepared→applying→applied/conflict/uncertain，
   先保护快照）、带当前 SHA 验证的 Undo、只读 reconcile。行为契约 `specs/obsidian-knowledge.md`
   §5e；测试 `packages/services/test/knowledgeReview.test.ts`（19/19 通过）。
2. **写路径 fail-closed（本修复轮新增）**：`createKnowledgeReviewService` 的
   `writePathEnabled` 缺省 **false**——`applyProposal`/`undoOperation` 返回结构化
   `write_path_disabled`（`packages/services/src/knowledge/review/reviewEngine.ts`，
   拒绝码定义 `reviewTypes.ts`），文件零触碰；生产装配（`node.ts` 经
   `createKnowledgeServices`）不传使能，仅测试显式开启，并有专门测试断言默认装配
   「apply/undo 全拒 + 文件不变」。提案/批准/账本/只读 reconcile 面保持可用，供审计与
   门禁复验。服务仍注册于 `createLocalServices`（`packages/services/src/node.ts:2779-2780`），
   但其唯一文件写入口在总门后不可达——注册是账本/审批只读面与未来门禁翻转的载体，
   不构成可执行写路径。
3. **缓解项（现状，如实记录）**：`allowAgentWrites` 默认 false
   （`packages/services/src/obsidian-vault/config.ts:118`）；VaultView「审核」视图未接
   apply/undo（本阶段交付到 RPC 面，UI 属后续工作单）；旁路通道不阻断这一点在 spec
   §5e.8 如实披露，不伪装覆盖。

## 3. GO 路径（解除本 NO-GO 的充分条件）

1. 在 runtime permission 层程序化修复三洞（清单见 §1，含 `mcp/index.ts` 的
   destructive/readOnly 自报信任问题收口）；遵守仓库纪律：还原/上游对齐文件内不改新逻辑，
   以 ports/新模块接入；
2. 实现 P0 分级门控：Bash/js/未声明 destructive 的 MCP 强制逐次确认 + 禁整工具持久 allow，
   挂 `resolveToolCallCapabilityFlags` → `ToolCallStarted` 广播链；
3. 按工作单 A31 出具真实覆盖报告（含上述通道的逐路径阻断证据）后复评 S03；
4. S03 硬门禁通过后，以独立改动把 `writePathEnabled` 打开（生产装配 + spec §5e 引言同步更新），
   本文件的 NO-GO 裁定随之撤销并归档。

在此之前：**不得**在代码、UI、文档中宣称「审核写入已生效」或「L2 强制写入审核可用」；
`W06_DELIVERY.md` §4 已同步改为 NO-GO 裁定。
