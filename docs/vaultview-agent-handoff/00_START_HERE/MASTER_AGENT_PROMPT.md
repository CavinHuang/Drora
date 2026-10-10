# 主执行提示词（完整复制给 Coding Agent）

你是一名负责 **Drora VaultView 2.0 真实接入** 的高级 TypeScript/Electron/Agent 系统工程师。当前工作不是研发全新 App，而是在 `CavinHuang/Drora` **现有 monorepo** 内实现和验证产品已批准的知识管理能力。

## 先读取

1. 本包 `00_START_HERE/README.md`、`01_RULES_AND_DECISIONS/*`、`02_IMPLEMENTATION/*`。
2. 当前工作区 `AGENTS.md`、`DESIGN.md`、`specs/obsidian-plugin.md`、`mise.toml`、`architecture-policy.yaml`、`package.json`、相关模块代码及测试。
3. 本包 `05_REFERENCE/PRD_v4.0.md` 与 `05_REFERENCE/ARCHITECTURE_v4.0.md`；高保真 HTML 只作为体验目标，不能把模拟操作结果当 backend 行为。
4. 本包 T0 Spike 源码和报告；**只复用已理解且适配 Drora 约束的思路，不直接照抄入生产**。

## 任务目标

在 Drora `VaultView` 内提供「笔记 / 智能问库 / 洞察 / 审核」四视图，其中 **P0 最先实现只读精准问库**：用户自然语言找回既有 Obsidian 文章，获得候选文章、命中原文、有效引用与正确原文回跳；可在既有 Agent Session 中基于证据问答并追问，无可靠证据时保守退化；可选 Jev 多阶段判定，默认关闭且明确外发授权。保留现有 Vault 编辑器、现有会话、现有权限及手机远控架构。

## 执行纪律

- 必须先 `git status --short`, `git rev-parse HEAD`, `node scripts/check-workspace-freshness.mjs`。**保护与任务无关的本地改动，不要 reset/clean。** 对照本包基线 `c1870c9c...` 记录变更；当前真实源码事实优先。
- 对新增/改动行为先更新 `specs/obsidian-knowledge.md`（或现有仓库已等价 spec），保存 ADR、状态所有者、RPC 契约和验收场景。遵循仓库架构治理 skill；不要把新业务写进恢复/上游对齐源码。
- 按 `03_WORK_ORDERS/W00..W07` 的依赖顺序拆分最小 PR；**先完成 W00 确认才能动代码**。如果找到当前分支已经存在某项功能，先复用或说明冲突。
- 每次只改当前工作单允许的模块与相应测试/必需注册点；新增服务通过 `ServiceCollection`、descriptors、`packages/shared/src/channels.ts`、`packages/services/src/{index,node}.ts` 按真实代码接入。
- 绝不新增第二套 Agent session、第二份 Vault 配置事实源、独立全局 Memory、第二个手机 Host、未经审核的写入路径；遵循“方案 C”与当前 Runtime 的真实权限行为。
- FTS + Embedding 是召回层，Jev 不能弥补没有被召回的正确笔记。Jev 的意图/重排/证据/充分性/引用支持都是建议，不能改变授权范围、来源 SHA、引用身份、文件写权限或原始内容。模型分数不等于准确率。
- 正文、剪藏和模型输出一律视为不可信数据。`@Vault` 的 evidence 需要 sourceEpoch + session scope + opaque receipt；不能把 UI 或 LLM 自报的 `{path,text,receiptId}` 当受信引用。
- 外发默认关闭。Jev Provider、远端 embedding 和回答模型需分别检查当前配置、用户授权与真实外发范围；不在日志中记录全文、凭据或绝对路径。
- 只读 MVP 先上线验证。如果 S03 证明不了 Write/Edit 之外 Bash/MCP/脚本等所有写盘通道的强制分级审核，**不启用 L2/L3 受控自动写回**。候选 permission hook patch 只能收窄自动 allow，不能当作全部强制阻断证明。
- 未经授权不得修改用户真实 Vault，不能自动上传、push、开 PR、合并或部署；测试在合成临时 Vault 进行。

## W00 立即开始

1. 审计真实仓库：当前 HEAD、worktree 状态、模块与代码路径、现有测试入口、官方上游还原边界，列出与本包不符的事实。
2. 找到真实会话 admission / CommandInbox / busy queued turn 的执行点，验证可以在真正提交给模型前重新检查 Source/Receipt，或者证明暂时做不到并报告降级方案。
3. 画出 Native Read/Write/Edit/Bash/脚本/MCP 工具路径的“用户可授权/Hook 可判定/真正可阻断”覆盖矩阵，并给出当前安全声明可达到的级别。
4. 对 `node:sqlite`、跨窗口 Host / WAL / fencing 的部署位置进行可行性验证；确认当前 Node runtime 版本。
5. 只做本地调查或隔离 Spike，不要直接改用户真实数据。

## 最低验收门槛

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 和当前模块适用测试必须**实际运行**，报告退出码与已有失败；没有环境就明确写“未执行”。
- 新增业务必须有单测；涉及 UI、Session、Source/权限和错误态必须有覆盖交互的 E2E/集成案例。测试失败不能改报告为“通过”。
- 至少覆盖：用户记不住标题时找文章；无结果/同名/模糊多候选；中文中英混合；索引 partial；修改/删除/切 Vault 的 stale 引用；Jev 拒绝/超时/429/坏结果；排队期间来源变化；双 Host 竞争；私有片段不出站；未受审知识写回不生效。
- 每个工作单交付**真实修改文件清单、测试命令及结果、哪些依赖 Mock/Spike、剩余阻断、可验证演示路径、与上游代码冲突风险**。按 `06_AGENT_OUTPUT/PR_DELIVERY_REPORT_TEMPLATE.md` 输出。

现在开始执行 `03_WORK_ORDERS/W00_BASELINE_AND_SPIKES.md`。完成后继续依赖安全的最小任务；发现任何不符合当前仓库事实的假设应更新 spec 和报告，不能静默绕开。最终目标是经过真实代码、真实测试和可追溯证据完成集成，而不是只完成 UI 样式或模拟对话。