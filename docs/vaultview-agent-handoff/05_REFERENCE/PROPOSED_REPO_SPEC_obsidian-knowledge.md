# Obsidian Knowledge / VaultView 2.0 — 实施规格草案

本规范为用户明确批准的目标方案，提交本交接分支 **不代表功能已在代码中实现**。Coding Agent 按 `AGENTS.md` 在自己实现分支先确认 Spec 后修改代码。

范围：一个活动 Vault 的精确文章找回、问库/比较、来源验证及原文回跳；后续阶段扩展 Jev 可选决策与审核写入。

UI：唯一入口 VaultView；四视图笔记、智能问库、洞察、审核；不新增 Knowledge 顶级导航，不重建编辑器。

查询：FIND_ARTICLE 首先返回 3–5 篇候选及可核验证据；ANSWER/COMPARE 只在有权威来源时经已有 Agent Session 生成；索引 partial、语义不可用、无答案都必须显式呈现。

后端：现有 Vault 配置唯一事实源；按 Profile/Source/Epoch 隔离可重建索引；当前文件 SHA + quote selector 提供服务端绑定 session 的 receipt；原文永不被索引覆盖。

Jev：默认关闭；有明确出站许可才对少量片段执行候选和证据判断；失败回退本地排序；保留阶段 trace 但不显示虚假的准确率百分比。

写入：方案 C L0–L3；L2 必须经 Proposal + 人工批准 + 版本校验和持久账本；所有可旁路工具在真实 Runtime 验证前不能开放强制写入承诺。

测试：独立 T0 15/15 不是主仓验收。详见 `04_ACCEPTANCE/ACCEPTANCE_MATRIX.md`、`03_WORK_ORDERS/W00_BASELINE_AND_SPIKES.md`，必须跑真实 typecheck/lint/architecture 与 E2E。