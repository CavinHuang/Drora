# Drora VaultView 2.0 — Coding Agent 工程交接

> **状态：仅设计与工程交接资料；没有在本分支实现 VaultView / Knowledge Service / Jev。**
> **交接快照：2026-10-10；基于 main `c1870c9c730975a02117e93e025ae486eb757cf1`。**

## 从这里开始

打开 [`00_START_HERE/MASTER_AGENT_PROMPT.md`](00_START_HERE/MASTER_AGENT_PROMPT.md)，再阅读 [`00_START_HERE/README.md`](00_START_HERE/README.md)。执行前务必重新核对当前真实工作区 HEAD、`AGENTS.md`、`DESIGN.md`、`specs/obsidian-plugin.md`，不要机械套用快照路径。

## 目录索引

- [`00_START_HERE`](00_START_HERE/): 主提示词、快速启动、评审节点
- [`01_RULES_AND_DECISIONS`](01_RULES_AND_DECISIONS/): 已确定的方案 C / VaultView 唯一入口 / 来源与隐私不变量
- [`02_IMPLEMENTATION`](02_IMPLEMENTATION/): 数据流、Jev Decision Engine、RPC/状态机、文件级实施
- [`03_WORK_ORDERS`](03_WORK_ORDERS/): W00–W07、依赖图；第一个任务必须是 W00
- [`04_ACCEPTANCE`](04_ACCEPTANCE/): 验收矩阵与中文检索数据集规范
- [`05_REFERENCE`](05_REFERENCE/): PRD v4、架构、T0 报告、候选补丁、HTML 原型
- [`06_AGENT_OUTPUT`](06_AGENT_OUTPUT/): Coding Agent 阶段交付模板

## 必须注意

1. `05_REFERENCE/HIGH_FIDELITY_DESIGN.html` 与 `LOW_FIDELITY_DESIGN.html` 是**模拟交互原型**，不是可接真实 RPC 的 UI 代码。
2. `T0_VALIDATION_REPORT.md` 与 `T0_INTEGRATION_ROADMAP.md` 记录的是**独立 Spike**；不代表已在主仓跑过类型检查和 Electron E2E。
3. **当前分支只镜像可读文本与 HTML**。完整 37 文件原始交接 ZIP 和嵌套 T0 Spike 源码 ZIP 是本次对话中的独立下载附件，未随本分支提交。详情见 [`05_REFERENCE/T0_SPIKE_SOURCE_AND_TESTS.md`](05_REFERENCE/T0_SPIKE_SOURCE_AND_TESTS.md)。若需要复用原 Spike 代码，请先获取该附件；没有附件也可从 W00 按真实源码重新验证。
4. 安全策略：Jev 默认关闭且需出站许可；L2/L3 受审写入不在强制工具门禁验证前启用；不能更改用户真实 Vault。
5. 所有实施与测试由后续 Coding Agent 在其工作分支执行，**本交接分支不包含生产代码改动**。

## 资料来源与完整性

原始交接包名称：`Drora_VaultView_Coding_Agent_工程交接包_v1.0.zip`；SHA-256：`bd7d9234eda119c1fe7b42b2e6e78e44ff5109f418c0706e6b87e18e52b64ccf`。
仓库中的部分导读、实施图、工作单按仓库可阅读形式**重新排版和收敛**，不宣称与原 ZIP 字节一致；原 PRD / 架构文本和 HTML 以已有交付文件为依据。

**推荐流程：只先执行 W00 → 审核 C0 证据 → 再推进后续 W 工作单。**