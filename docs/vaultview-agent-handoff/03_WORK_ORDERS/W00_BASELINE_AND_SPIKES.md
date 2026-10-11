# W00 — 真实仓库基线与安全阻断 Spike

**依赖：** 无。**这是首要任务，禁止跳过开始大规模 UI 开发。**

## 执行
1. 运行 `git status --short`、`git rev-parse HEAD`、`node scripts/check-workspace-freshness.mjs`；核对 `AGENTS.md`、`DESIGN.md`、`mise.toml`、`specs/obsidian-plugin.md`、架构约束。
2. 顺着 `VaultView → Composer/SessionPane → Host Service → CLI Runtime/CommandInbox` 找到真实发送、排队、admission 时机；确认来源在执行前重新验证的可用扩展点。
3. 建立 Native Read/Write/Edit/Bash/脚本/MCP/插件工具的写入边界矩阵；明确 PermissionRequest matcher 不能覆盖的路径。
4. 在两个独立 Electron window-scoped Host 中测试 SQLite WAL、`BEGIN IMMEDIATE`、跨进程 lease/fence、崩溃后接管。
5. 验证活动 Vault/DRORA_PLUGIN_DATA/Source Identity/远端 Workspace Identity 的现有真实映射；审查候选 Hook Patch 而不盲目应用。

## 交付
- `W00_EVIDENCE_REPORT.md`：实际 HEAD、路径+函数/行号、运行命令 exit code、真实/假设划分。
- `W00_TOOL_WRITE_MATRIX.md`：各工具写盘、硬门禁、用户批准与测试证据。
- `W00_ADMISSION_SEQUENCE.md`：原生 Runtime 入队/执行时序与过期来源证据处理。
- `W00_DB_HOST_SPIKE.md`：两个 Host 同库竞争、崩溃恢复日志。

## 完成门槛
真实运行/记录 typecheck、lint、architecture 基线，明确 S02 admission 与 S03 全写入门控各自 GO/NO-GO。若无法 GO，只能进入诚实标注限制的只读分支，不允许开放自动知识写回。