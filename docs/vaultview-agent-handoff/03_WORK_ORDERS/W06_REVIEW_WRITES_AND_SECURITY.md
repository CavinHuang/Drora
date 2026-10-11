# W06 — 风险分级审核、提案与安全写回

**依赖：W00/S03、W01、W02、W03。S03 未证明硬门控则本阶段为 NO-GO：只能完成只读提案预览。**

| 等级 | 示例 | 执行方式 |
|---|---|---|
| L0 | 查询、读文档 | 只读 |
| L1 | 用户明确授权的局部 Markdown 编辑 | 既有 Runtime 权限 |
| L2 | 知识提炼/跨笔记修改 | Proposal + Diff + 人工批准 |
| L3 | 批量重构、删除、修改 `.obsidian` | 默认不自动执行 |

- Proposal 保存目标源、来源证据、目标 base SHA、proposalRevision、精确 Diff；批准绑定 sourceEpoch + revision + hash。Diff 改变必须重审。
- Operation ledger 对 operationId 唯一约束：prepared→applying→applied/conflict/uncertain；先保护快照，结果未知要 reconcile，不能自动重放。
- Undo 是带当前 SHA 验证的逆操作；双 Host 对同文件必须串行；绝不自行调用不安全的 fs.writeFile 绕过 Vault 安全门面。
- 必须真实覆盖 Write/Edit/Bash/脚本/MCP 等可写盘路径；仅 Hook matcher 不构成完整阻断。
- 现有 read-SHA + atomic rename 不能保证对外部 Obsidian 并发编辑的严格线性化 CAS，必须测试并准确描述限制。

**必测：** 普通批准、冲突、审批后改稿、重复 operationId、断线未知结果、重启 reconcile、撤权、双 Host、外部并发、Undo 冲突、旁路工具写盘。没有强硬阻断的真实证据，只提交 `WRITE_SAFETY_NO_GO.md`。