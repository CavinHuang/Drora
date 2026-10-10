# 项目负责人验收节点

| 节点 | 必须提供的证据 | NO-GO 条件 |
|---|---|---|
| C0/W00 | HEAD、真实代码调用链、S01/S02/S03 阻断验证、执行路径矩阵 | 未定位真正 Runtime admission 与旁路写入 |
| C1/W01 | 更新的 spec/ADR、Hook 真实测试、旧权限语义回归 | 高风险路径仍声称可强制拦截 |
| C2/W02 | 临时 Vault 的新增/更新/删除索引、中文召回、跨 Host lease/fence | 索引和源版本不一致 |
| C3/W03 | `@Vault → Evidence → 现有 Drora Session → 回答 → 引用回跳` 真 E2E，含 busy queue | 仅模拟 Agent 输入和回答 |
| C4/W04 | 真实 VaultView 四视图及原编辑器回归 | 重建第二套会话，或破坏现有 Vault |
| C5/W05 | Jev 官方 API 真联调、许可/降级、离线 A/B 结果 | 无法证明中文排序提升或出站边界 |
| C6/W06 | Proposal 账本/版本冲突/Undo、Bash/MCP 等写入边界实测 | 无硬门禁却启用 L2/L3 自动写入 |
| C7/W07 | typecheck/lint/architecture/E2E 实测、发布开关、回滚步骤 | 不符合验收矩阵中的阻断项 |

每阶段由 Coding Agent 按 `06_AGENT_OUTPUT/PR_DELIVERY_REPORT_TEMPLATE.md` 报告。