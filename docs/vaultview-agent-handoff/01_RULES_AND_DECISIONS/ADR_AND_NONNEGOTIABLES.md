# 不可自行变更的产品与架构决定

1. Drora 是唯一产品主体；Obsidian 是第一个深度知识源。不新建独立桌面 Agent。
2. 所有 Obsidian 专属 UI 收敛到 `VaultView` 内的「笔记 / 智能问库 / 洞察 / 审核」。
3. P0 是凭模糊线索找回正确文章；找文章时先展示候选和证据，不默认写冗长总结。
4. 原 Markdown 是唯一事实源；Knowledge 索引可重建，不得改写笔记冒充事实。
5. Jev 是可选 Decision Provider，默认关闭、独立授权出站；分数不是正确率。
6. 检索来源身份、权限、原文 hash、quote selector、session-bound opaque receipt 均由服务端控制。
7. 复用现有 Drora Session、CommandInbox 队列、Memory 和手机远控，不能复制状态。
8. 已批准风险方案 C：L0 只读、L1 经授权编辑、L2 知识治理必须人工审核、L3 高风险默认不自动执行。
9. 共享 SQLite 状态按 Profile + Source + Epoch 隔离，跨 Host lease/fencing 防止迟到提交。
10. 不用 Prompt、Jev 或前端按钮代替实际工具执行权限。Bash/MCP 等路径未审计通过则不得宣称写入审核强制生效。
11. 本地检索默认可用，未经授权不能把笔记正文或片段送到 Jev、Embedding 或回答模型。
12. 自研新增模块独立于 Drora 上游还原代码；先 Spec 后代码；仅以当前检出版本为准。

**如与真实源码、当前 `AGENTS.md` 或 `DESIGN.md` 冲突，应记录差异并保守实现，不能私自降低安全范围。**