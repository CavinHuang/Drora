# Coding Agent 快速开始

工程目录位于 `docs/vaultview-agent-handoff/`。先读 `00_START_HERE/MASTER_AGENT_PROMPT.md`、`README.md`、当前仓库的 `AGENTS.md` 和 `DESIGN.md`。

1. 在真实工作区核对 `git status`、HEAD、`mise.toml` 和 `specs/obsidian-plugin.md`。
2. 从 `03_WORK_ORDERS/W00_BASELINE_AND_SPIKES.md` 开始，严禁跳过 Runtime admission、跨 Host 和写入路径审计。
3. 按 W00→W01→W02→W03→W04→W05→W06→W07 交付，每个阶段有单独报告和可核验测试。
4. 只使用临时测试 Vault。不要修改真实 Obsidian Vault、推送或合并实现分支（除非用户随后明确授权）。
5. Jev 联调仅在 W05、用户安全配置实际凭据并授权数据出站后开始。

查看 `00_START_HERE/REVIEW_CHECKPOINTS.md` 与 `04_ACCEPTANCE/ACCEPTANCE_MATRIX.md` 确认 GO / NO-GO。