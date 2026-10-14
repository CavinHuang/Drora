# Obsidian Knowledge → Agent 第一轮验收（真实桌面门禁）

> 工作分支：`feat/obsidian-knowledge-e2e`。状态：**代码已接线；GUI 尚未在真实 Electron 中执行**。本文件是验收执行单，不是验收通过报告。

## 验收边界

- **必须使用独立测试 Vault**（示例 `drora-knowledge-e2e-fixture`），不得修改、索引或撤销用户生产 Vault。
- **必须启动真正的 Electron 桌面端**；单纯的 services test、模拟 hook、静态页面或 CI bundle 成功，不等于 GUI E2E 成功。
- Agent 端只允许使用已有会话的发送链路；`evidenceRefs` 由服务端签发、CLI admission / queue promotion 执行时复验。
- 已禁用的 L2 Review write path 继续关闭，本轮不启用。

## 环境与自动测试（执行并保存日志）

- Node.js ≥24（仓库要求），pnpm 10.33.2；用 macOS 和 Windows 分别验收。
- `pnpm install --frozen-lockfile`
- `pnpm typecheck && pnpm lint`
- `pnpm exec vitest run packages/ui/test/conversationSelectionReference.test.ts packages/ui/test/knowledgeAskModel.test.ts packages/ui/test/knowledgeEvidenceVerification.test.ts packages/ui/test/knowledgeAgentHandoff.test.ts`
- `node --import tsx --test packages/services/test/knowledgeE2EFullChain.test.ts packages/services/test/knowledgeIndexQuery.test.ts apps/drora-cli/packages/bootstrap/test/knowledge-evidence-gate.test.mjs`
- CLI 证据接线测试必须先完成 CLI workspace 依赖构建（CI `cli-build` 负责），然后执行 `node --import tsx --test apps/drora-cli/packages/bootstrap/test/evidence-session-wiring.test.mjs`。
- `pnpm dev:desktop:test`：打开真正的 Drora 桌面实例，必须确认使用测试环境，不触碰真实 Vault。

## GUI 实操验收矩阵

| ID | 操作 | 必须观察到的结果 | 执行记录 |
| --- | --- | --- | --- |
| G01 | 使用全新测试环境启动 Electron，连接临时 Obsidian Vault，建立索引 | `configured=true`；索引任务真实完成且覆盖文件数符合夹具 | 未执行 |
| G02 | 在 VaultView 智能问库里用中文检索唯一标题/句子 | 匹配对应真实文章；候选路径、引用片段和位置准确 | 未执行 |
| G03 | 在**已存在 Agent 会话**下点击「加入 Agent（可信证据）」 | 当前文件重新核验；Composer 出现引用；不会把 Receipt ID 拼入模型 prompt | 未执行 |
| G04 | 点击 Composer 发送，对真实 CLI admission 打日志/断点 | `sendText.payload.evidenceRefs=[{receiptId:'evr_…'}]`；CLI gate 接受当前证据；Agent 收到原文片段 | 未执行 |
| G05 | 先添加证据，**修改**原文，再发送 | CLI 返回 `guard.evidenceStale`，拒绝执行，Composer 保留待改输入 | 未执行 |
| G06 | 先添加证据，**删除**原文，再发送 | CLI 返回 `guard.evidenceMissing`；没有使用旧引用生成回答 | 未执行 |
| G07 | 先添加证据，断开 Vault / 撤销授权，再发送 | CLI 返回 `guard.evidenceForbidden`；原文不泄漏 | 未执行 |
| G08 | Busy Session 下加入队列，在队列提升前修改原文 | `sendQueuedNow` 再次验证并拒绝过期证据；不能静默降级 | 未执行 |
| G09 | 同一节选两次「加入 Agent」，第二次拿到新 Receipt | Composer 只保留一项；发送的是第二次签发的 ID | 未执行 |
| G10 | 查询 RPC/Host 断开后重试相同检索 | 复用原 clientRequestId，不产生重复 Run | 未执行 |
| G11 | 证据核验未完成时提交新的检索 | 旧结果不能污染新 Run，也不能被加入 Composer | 未执行 |
| G12 | 保存证据后重启 Electron，再打开源文件和已有会话 | 未出现旧 Receipt 被误判为 current；真实会话仍可正常发送 | 未执行 |
| G13 | ANSWER 模式选择两篇真实笔记后准备 Agent 问题并发送 | 两篇来源均被单独签发和复验；Agent 输入仅包含通过验证的两篇原文；回答能区分不同来源 | 未执行 |
| G14 | ANSWER / COMPARE 尝试选第六篇、取消一篇后重选 | 第六篇不能添加；取消后可以换选，COMPARE 最少两篇才能交接 | 未执行 |
| G15 | 正在搜索时点击取消，并让原搜索 RPC 延迟返回；再创建新搜索 | UI 不持续显示“检索中”；已取消请求和晚到结果不能覆盖新查询 | 未执行 |
| G16 | 在多篇 ANSWER 中修改其中一篇后点击准备交接 | 整批交接 fail-closed，不能只将另一篇可信材料送进 Agent | 未执行 |
| G17 | 完成两轮检索后展开上一轮，点击旧笔记 | 点击时重新 prepareEvidence + resolveCitation，仅在 current 时按新 quote 位置打开 | 未执行 |
| G18 | 在两轮检索之间修改/删除上一轮笔记或切换 Vault，再点击旧候选 | 拒绝历史路径直接回跳；显示结构化 stale/missing/forbidden，不打开错误文件 | 未执行 |
| G19 | 在同一 Agent Session 中将上一轮笔记重新「加入 Agent」后追问 | 重新签发当前 Receipt，Composer 收到原文与新 ID；发送及队列提升继续复验 | 未执行 |
| G20 | 旧笔记复验 RPC 挂起时切换会话或发起新检索 | 迟到引用不打开笔记，也不进入新 Session 的 Composer | 未执行 |

## 核验回执

每次验收至少保留：系统/版本、测试 Vault 夹具文件列表、执行命令的退出码、UI 截图、关键 ACK reasonCode、CI run URL。不得提交生产 Vault 内容或密钥。

**GO 条件**：CI 的 typecheck、lint、知识库相关测试全部通过；G01–G11、G13–G20 在 Windows/macOS 上通过；G12 没有生命周期回归。否则 Draft PR 继续保持未合并。

## 已知不在第一轮承诺范围

- FIND/ANSWER/COMPARE 的独立答案生成服务；当前跨文章回答仅完成“经用户选源 → 全部核验 → 交给现有 Agent”的交接，不能宣称已经完成模型回答质量评测。
- Jev 实际 Provider 调用与重排效果评测。
- Review L2 diff/approve/undo 写入和 S03 复审。
- 候选卡的「就此追问」侧会话仍走普通选区引用语义，不将其声称为 Receipt 可信链路。与此不同，「上一轮 → 加入 Agent」是同 Session 的显式可信证据重新核验流程。
