# T0 Spike 源码附件说明

原始交接 ZIP 中包含一个独立的 `T0_SPIKE_SOURCE_AND_TESTS.zip`（SHA-256 `2adcc7de1bec1b46e154d2783fc4ac76785f65b2f14ab4acb2fbfe9fb7c518ed`）。

当前 GitHub 连接器无法直接从本会话的本地附件发送二进制 ZIP，因此**这份 ZIP 没有包含在本次仓库提交中**。原 ZIP 保留在用户与 ChatGPT 的交付对话附件中，必须单独交给后续 Coding Agent，或在真实仓库直接重做 Spike。

无需原始 ZIP 也可读：
- `T0_VALIDATION_REPORT.md`：15 项独立 Node 验证的范围及未验证点。
- `T0_INTEGRATION_ROADMAP.md`：与生产代码对接的工作建议。
- `CANDIDATE_PERMISSION_PATCH_DO_NOT_BLINDLY_APPLY.patch`：候选权限补丁，不等于完整 L2/L3 硬门控。

**禁止**将先前的独立 Node 测试视为 Drora Electron/CLI 集成结果。W00 必须重新做 Runtime admission、工具写入路径、双 Host 一致性与真实测试报告。