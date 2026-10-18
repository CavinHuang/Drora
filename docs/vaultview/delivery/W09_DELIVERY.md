> **Consolidated PR notice (2026-10-14):** All active Obsidian work is tracked in PR #23 (`feat/obsidian-knowledge-e2e`). This W09 report is historical evidence from the original stacked PR #15, not an independent integration branch. The old standalone Evidence attachment UI has been superseded by the unified Composer Markdown selection + opaque Receipt system in #23. The review service/UI and fail-closed L2 write-path controls are migrated into #23. CI and Electron GUI must be checked again against the consolidated branch; the historic green test counts below do not establish the new branch's status.

# W09 交付报告——Evidence 生产者、审核消费与 L2 开关

**日期：** 2026-10-11　**分支：** `feat/vaultview-w09-ui`（叠层基于 `feat/vaultview-s03`，PR #14）　**spec：** `specs/obsidian-knowledge.md` §5f（先行落盘）

## 1. 真实修改文件清单

**新增（5）**
- `packages/ui/src/lib/knowledgeEvidenceAttachment.ts`：附件区 scope 存储/事件/上限/去重/payload（镜像 selection 模式；append 纯函数导出供 node:test）
- `packages/ui/src/v4/composer/useKnowledgeEvidenceAttachments.ts`：composer 侧订阅 hook
- `packages/ui/src/v4/composer/KnowledgeEvidenceChip.tsx`：附件 chip（receiptId/路径/quote 摘要 + 「发送时复验」提示）
- `packages/ui/test/knowledgeEvidenceAttachment.test.ts`：WSG-UI-1/2（4 用例）
- `packages/services/test/knowledgeReviewWritePath.test.ts`：WSG-UI-3/4（3 用例）

**修改（13）**
- 发送链：`ConversationComposer.tsx`（附件区快照/提交/受理后清理/SendOptions.evidenceRefs）、`SessionPane.tsx`（两处 sendText payload 注入 evidenceRefs）
- 生产者入口：`KnowledgeCandidateCard.tsx`（「作为证据附给 Agent」，仅 verified 态可点，与 userselect「加入 Agent」并存且文案区分两种语义）
- 审核消费：`KnowledgeReviewView.tsx`（重写：真实 IKnowledgeReviewService 消费——提案列表/内容预览/批准/拒绝/应用（operationId=randomUUID 幂等键）/undo（apply 返回的账本 operationId）/L2 开关）、`VaultView.tsx`（传入 reviewService）
- L2 开关链：`obsidian-vault/config.ts`（`reviewWritePathEnabled?` 字段 + `setVaultReviewWritePathEnabled` 唯一持久化入口）、`reviewEngine.ts`（可变门 + 显式传参不读配置/未传参异步加载初值 + `isWritePathEnabled/setWritePathEnabled`）、`reviewService.ts`（接口两方法）、`knowledgeServices.ts`（**bug 修复：`=== true` 归一吞掉 undefined，生产路径永远到不了配置加载分支——改为原样透传**）
- i18n：zh-CN/en-US（新增 26 键、删除 3 个死键 `vault.review.unavailable/comingTitle/comingHint`）
- spec：`specs/obsidian-knowledge.md` §5f（先于代码）

## 2. 测试命令与真实退出码（win32 / node v24.1.0 / tsx）

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --test packages/ui/test/knowledgeEvidenceAttachment.test.ts packages/services/test/knowledgeReviewWritePath.test.ts packages/ui/test/knowledgeUiDiscipline.test.ts` | tests 11 / pass 11 / fail 0，EXIT=0 |
| `node --import tsx --test packages/services/test/knowledgeReview.test.ts packages/services/test/knowledgeE2EFullChain.test.ts`（W06/W07 回归） | 随 33 用例合并跑全绿（tests 33 / pass 33 / fail 0） |
| `pnpm typecheck`（全仓） | EXIT=0 |
| `pnpm lint` | EXIT=0；**388 warnings / 0 errors = 基线同值，零新增**（开发中发现并修掉 1 个自引 error（max-lines，按 reviewEngine.ts 同先例文件顶 disable+理由）与 1 个自引 warning） |
| `pnpm architecture:check --changed` | `new: 0`，EXIT=0 |
| 全量 node:test（11 目录） | tests 541 / pass 534 / fail 7，失败文件集 ⊆ 基线（`00135862` 干净检出采得的 6 文件；本轮 7 败 = catgirl×3 + 红名单×4，relayControl 未触发），**零新增失败** |

**未执行（如实）：** Electron 进程内点击级 GUI E2E（同 W04/W07 边界：原生对话框 + 真实 Vault 扫描面风险）；真实模型下的 evidenceRefs 端到端（发送链 UI→payload 已由编排锁定，CLI gate 复验由 W03 的 15 用例锁定）。

## 3. Mock/Spike 依赖

无新增 mock。审核视图全链依赖 W06 已建的账本机制（其测试为真实 sqlite + 合成 Vault）；证据附件区的复验事实在服务端账本（W03），UI 只携带 opaque receiptId。

## 4. 剩余阻断

- **提案生产者入口仍不存在**（如实边界，spec §5f.4）：审核视图可走通批准→应用→undo 全链，但提案只能由测试创建；「知识治理写回」生产入口归后续工作单。
- composer 附件区为会话内易失状态（与 selection 同级），不跨 Host 同步。

## 5. 可验证演示路径

> **失效提示（2026-10-17 增量评审 A-8）：** 本节第 2/3 条演示路径基于已废弃的旧
> 「证据附件 chip」UI 与生产不可达的 L2 开启态，仅供历史参考。现行演示入口：
> 可信引用经知识面板「加入 Agent（可信证据）」→ Composer Markdown 引用（无独立
> chip）；L2 apply/undo 在 S03 NO-GO 撤销前生产禁用（spec §5e.12），仅账本级
> 提案/审批可演示。第 1 条的 knowledgeEvidenceAttachment 测试已随旧实现移除。

1. `pnpm --filter @drora/core typecheck && node --import tsx --test packages/ui/test/knowledgeEvidenceAttachment.test.ts packages/services/test/knowledgeReviewWritePath.test.ts`（开关持久化 + 附件区契约）
2. GUI：问库 → 核验候选 → 「作为证据附给 Agent」→ 会话 composer 出现证据 chip → 发送 → CLI admission 复验（可拔掉笔记文件再发送观察 stale 拒绝）
3. GUI：审核 tab → L2 开关（缺省关）→ 关闭态 apply 报 `write_path_disabled` → 开启后已批准提案可应用/撤销（需先有提案：现由测试造）

## 6. 上游冲突风险

低。改动集中在 W04 后新增的 knowledge 面与 W06 的 review 引擎；`config.ts`/`knowledgeServices.ts` 与 main 无并行改动方。`vault-config.json` 新增字段为 additive，W03 CLI gate 与 W01 hook 均按「缺省关闭」判定，旧文件兼容。
