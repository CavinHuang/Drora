# PR #23 — 当前交付与合并标准

更新时间：2026-10-17。分支 `feat/obsidian-knowledge-e2e` → `main`。

## 当前交付决定

维护者明确要求助手自行 review，不再等待人工走查或额外独立 reviewer。
本轮按该委托完成 S03 代码复评并修复实际缺陷，候选范围扩展到**桌面本地 L2 opt-in Apply/Undo**。
这是助手的委托自审，不冒称外部独立安全签字；旧 A1/NO-GO 是历史基线，由本次明确交付决定更新。
**合并和部署尚未执行。候选能否交付以最终同一提交的 CI / Linux / Windows / macOS 结果为准。**

## 用户可获得的行为

- Vault 浏览、索引、Knowledge 检索、来源选择、Agent 交接、引用回跳和重启恢复。
- 桌面本地 L2：创建 create/write/delete 提案 → 精确预览 → 用户批准 → 显式启用两项写权限 → Apply → 带 SHA 校验的 Undo。
- L1 与 L2 用户开关默认关闭。remote/unspecified authority 不授予 L2 激活能力。
- 旧批准、已修订/拒绝/过期提案、关闭开关、撤权和切库均不能继续授权后续文件写入。
- 进程活跃时不能被另一个 Host reconcile；真实进程结束后只读恢复，不自动重放。

## 本轮真正补齐的缺口

| 缺陷                                        | 修复与证据                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| MCP/js 的 path/command 内容规则扩大持久授权 | 建议/评估/持久化三处阻断；P0 强制 user-once，Hook 不能代批或持久授权；`core/test/permission-*.test.ts` / `write-tier-policy.test.ts` |
| 等待期间旧提案与批准仍能写入                | 写前从账本重新读取 revision/rejection/hash/TTL；`knowledgeReviewFreshApproval.test.ts`（4 个旧版失败场景）                           |
| 跨进程 reconcile 抢占活跃写入               | SQLite v6 Vault owner PID/host/token，无超时抢占；`knowledgeReviewOwnership.test.ts`（4 个真实子进程场景）                           |
| createOnly 检查后 rename 覆盖竞争新文件     | 原子 hard-link 发布，EEXIST 零覆盖；`obsidianVaultAtomicCreate.test.ts`                                                              |
| 只验证 L2 永久关闭，无法证明功能可用        | G65/G67 改为真实生产 Host 默认关闭、批准仍不写、用户 opt-in 后 Apply/Undo，完成后恢复临时 Vault                                      |

## 最终完成标准与执行预期

1. 最终提交通过根 typecheck/lint、CLI 依赖闭包构建及 S03/服务/UI 回归。
2. 同一提交完成 Linux 真 Electron、Windows 2022 / macOS 14 真 Electron；G67 必须实际写回与 Undo，不能跳过。
3. 核对 PR 可合并、无未解决代码缺陷；更新 PR 中唯一当前状态，旧运行记录不再充当门槛。

代码与回归目标在本轮收尾；最终等待仅限实际自动化运行。三平台 CI 通常需约 15–35 分钟，
若失败只修复具体失败项，不另起无界的“下一阶段”。无失败证据时不重复扩大测试。

## 具体限制

- 本地进程所有权只协调共享同一 Profile/SQLite 的 Drora Host；不锁住外部编辑器或另一 Profile。
- 文件 SHA 是乐观冲突检测，不是 OS 级原子 CAS；无法声称任意恶意外部进程被完全隔离。
- 无法确认旧 PID 已死亡（权限错误、异机、PID 重用）时保守阻断，不以超时夺权。
- MCP server 自发写盘、宿主更新器和用户显式 YOLO/allowedTools 不属于 L2 治理隔离保证。
- 模型响应使用固定回放；测试证明接线和来源权限，不证明真实 Provider 的回答质量或 Jev 排序质量。

详见 [S03 收尾复评](./S03_CLOSEOUT_2026-10-17.md)。
