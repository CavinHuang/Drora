# Drora VaultView 2.0 — Coding Agent 工程交接包 v1.0

**用途**：将已完成的 VaultView v4.0 设计和 T0 独立技术验证，安全、准确地接入 `https://github.com/CavinHuang/Drora` 的真实仓库。**这是交给 Coding Agent 的工程任务材料，不是已经完成的代码或已合并 PR。**

**准备日期**：2026-10-10；**远端基线**：仓库 `main` Git tree `c1870c9c730975a02117e93e025ae486eb757cf1`（只用于本包核对；执行时必须重新确认真实工作区 HEAD）。

## 0. 先读什么、执行什么

1. **直接把** `00_START_HERE/MASTER_AGENT_PROMPT.md` **完整发给 Coding Agent**，同时把整个交接包解压到它能够访问的本地路径。
2. 让 Agent 在本地 Drora 仓库先执行 `03_WORK_ORDERS/W00_BASELINE_AND_SPIKES.md`，交付真实源码与环境的审计，不要跳过。
3. 按 `03_WORK_ORDERS/` W01 → W07 逐阶段实施，每阶段完成测试与报告后才进入下一个阶段；因环境阻断而不能完成时报告阻断，不宣称通过。
4. 产品真值以 `05_REFERENCE/PRD_v4.0.md` 为准；技术预期以本包 `01_RULES_AND_DECISIONS/` + `02_IMPLEMENTATION/` 为准；**如与当前仓库实际源码冲突，以当前仓库 `AGENTS.md`、`DESIGN.md`、`specs/`、类型与测试事实为准，记录差异并调整实现**，不可默默臆造。
5. 使用 `06_AGENT_OUTPUT/PR_DELIVERY_REPORT_TEMPLATE.md` 为每个阶段留下可追溯交付报告。

## 1. 成品用户体验（验收北极星）

用户收藏数千篇 Obsidian Markdown 笔记后，只记得「有篇讲长上下文不能替代长期记忆」：在 Drora 的 **Vault → 智能问库** 输入自然语言，能找回候选文章、看到与描述真正吻合的原文、准确跳转至所在笔记，能追问、比较；无可靠证据时不编造。带来源回答有可复核的引文。Jev 只是可选、默认关闭的辅助决策，离线时本地检索持续可用。

**界面要求**：仅 Drora 的 `VaultView` 作为 Obsidian 知识管理入口；内部「笔记 / 智能问库 / 洞察 / 审核」四视图；原本 Drora Session、Memory、Workspace、远控逻辑继续复用。**首阶段只读问库闭环必须先真实落地，后阶段才允许考虑受审写回**。

## 2. 冻结的产品决策

- Obsidian 是 Drora 的知识源，**不是独立产品、不是第二个 Agent Runtime**。
- 操作权限采用 **方案 C：风险分级审核**。L0 只读，L1 明确范围的普通 Markdown 编辑沿用已有 Runtime 权限，L2 长期知识沉淀必须提案人工审核，L3 批量删除/重组等默认不自动执行。
- **Jev 默认关闭**；任一远端 Jev/Embedding/回答模型发送 Vault 原文片段，都须遵守各自的显式授权/提供商设置与出站边界。
- 精准找文章优先于冗长总结：`FIND_ARTICLE` 返回候选、证据、回跳；`ANSWER`/`COMPARE` 才使用现有 Agent 生成回答。
- 没有证据不等于回答：`Recall@30` 与重排后的 `Hit@1/5` 分开衡量，强制实现来源真值检查和证据状态。
- Drora 的每个窗口有 window-scoped Local Host；跨窗口必须协调持久化索引和会话所有者，不创造隐藏的全局内存单例。

## 3. 目录导航

| 文件 | 作用 |
|---|---|
| `00_START_HERE/MASTER_AGENT_PROMPT.md` | 可直接复制粘贴的总执行指令，含不可越过的停止条件 |
| `00_START_HERE/QUICK_START.md` | 人类负责人最短启动流程 |
| `01_RULES_AND_DECISIONS/REPO_FACTS_AND_GAPS.md` | 当前源码已确认 / T0 已试验 / 尚未验证的事实表 |
| `01_RULES_AND_DECISIONS/ADR_AND_NONNEGOTIABLES.md` | 不容自作主张改变的产品/权限/数据边界 |
| `02_IMPLEMENTATION/ARCHITECTURE_AND_DATA_FLOW.md` | 模块所有者、查询和写回时序、跨 Host 故障策略 |
| `02_IMPLEMENTATION/RPC_AND_STATE_CONTRACTS.md` | 推荐的 DTO、状态机、版本与引用协议；**建议契约，非既有 API** |
| `02_IMPLEMENTATION/DECISION_ENGINE_AND_JEV.md` | Jev 多阶段决策、调用策略、成本、隐私、回退与评估 |
| `02_IMPLEMENTATION/FILE_LEVEL_MAP.md` | 真实文件路径和建议新增路径；避免覆盖上游还原代码 |
| `03_WORK_ORDERS/W00..W07` | 分阶段可执行任务，包含输入、修改范围、退出标准 |
| `04_ACCEPTANCE/ACCEPTANCE_MATRIX.md` | E2E/安全/时序/性能/回归验证矩阵 |
| `04_ACCEPTANCE/EVAL_DATASET_SPEC.md` | 中文收藏文章检索评测与 Jet/本地 A/B 方法 |
| `06_AGENT_OUTPUT/PR_DELIVERY_REPORT_TEMPLATE.md` | 每阶段提交必填报告 |
| `05_REFERENCE/*` | 上轮 PRD/架构/ADR/HTML 高保真及 T0 源码、补丁、测试证据 |

## 4. 交付范围分层

**M1/首个可发布闭环**：现有 Vault 连接、可重建本地索引、准确候选、文章原文和引用核验、`@Vault` Agent 问答接入、UI 的四视图壳、失败/部分覆盖状态；模型/语义不可用时本地可用。

**M2/增强**：真实 Jev Provider（默认关、可授权、可缓存/超时/降级），查询意图、候选与证据、充分性、引用支持性多阶段决策；与本地/其他 reranker 做真实离线评估。

**M3/受控写入**：L2 Proposal/Diff/审批/Apply/Undo 和对全工具写盘边界的验证；未经安全覆盖验证不启用。洞察、Memory 关联、手机远控属于后续明确验收，不得代替 M1。

## 5. 重要免责声明

本包附带 T0 **独立 Spike**：2026-10-10 在 Linux Node 22.16.0 重新执行 `npm test` 得到 15/15；它不能证明真实 Electron 多窗口、跨平台、Agent admission、TypeSafe API、Bash/MCP 权限或 UI 集成。附带 `.patch` 为**候选补丁**，不应直接合并；必须对照当前代码重审再编写测试。

**本包尚未更改或提交 Drora GitHub 仓库。**