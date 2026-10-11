# ADR-001 · Drora Obsidian 分级审核与 Knowledge 领域隔离

- **决策日期**：2026-10-09
- **状态**：**Accepted（产品决策已确认）**；具体 Runtime 受控执行实现仍需 T0 Spike 验证
- **产品主体**：Drora（不是新的独立 Agent 应用）
- **关联**：`specs/obsidian-plugin.md`、`specs/obsidian-knowledge.md`（拟新增）、第一轮评审 R1
- **源码证据基线**：`CavinHuang/Drora@615a46e059b3801230d4b55f53c7fdbbb264727a`（2026-10-09）
- **注意**：本文是供合入仓库的决策文档草案，尚未向仓库提交。

## 背景

当前 Obsidian 插件通过 `SessionStart` / `UserPromptSubmit` 注入上下文，`PermissionRequest` 对当前已授权根内的 `Write|Edit` 在 `allowAgentWrites=true` 时自动返回 `allow`。VaultView 通过 `IObsidianVaultService` 安全门面读写；Knowledge 候选与审核服务尚不存在。原生 Agent 编辑不能自然等同于用户已审核知识提案。用户已明确选择方案 C（按风险分级审核）。

## 决策

1. **明确授权的日常单篇 Markdown 编辑**：允许在 Drora 原有 Runtime 授权机制下直接执行。`allowAgentWrites=false` 时仍逐次询问；设为 true 后的自动允许范围须至少收紧至安全的普通 `.md` 目标，且排除 `.obsidian/**`、隐藏目录、软链、越权路径等。
2. **知识候选沉淀**：一律先形成持久 Proposal，用户看到来源和 Diff，明确批准后才进入 apply；不能由普通 Agent 工具伪造审核完成。Proposal Store 是审批事实源，Vault 文件是笔记事实源。
3. **高风险操作**：批量删除/移动、整库重组织、覆盖多个文件、修改 Vault 配置、语义上不可逆的动作必须受高风险策略约束；不因为 `allowAgentWrites=true` 自动放行。删除/重命名若由 Bash、脚本或其他工具实施同样有副作用；只修改 Write/Edit hook 不足以提供强保证。**上线前需盘点全部写盘工具及其有效控制点**。
4. **职责分离**：Knowledge 不持有 Vault 文件的唯一权威；Memory 不持有 Knowledge 原文；索引可以重建，审核、审计、Undo 数据不可随索引重建删除。
5. **多 Host**：每个 Local Host 可提供同一服务描述符，但同一本地 Profile 的索引/Proposal 状态共享一个持久数据库，所有写入由数据库事务串行化，并对后台 Job 使用带 fencing token 的租约。Renderer 不能直接访问数据库。
6. **证据来源**：Agent 生成内容可引用服务端签发的 evidence receipt；渲染时再次核查 receipt + 文件权限/版本。模型自行输出的路径或引用字符串不构成可信引用。

## 风险等级与操作政策（目标设计）

| 等级 | 操作 | 用户控制 | 约束位置 |
|---|---|---|---|
| L0 | 搜索、读取、只读关联 | 已授权读范围即可 | Source adapter + Query Service |
| L1 | 单篇 `.md` 明确请求的小范围改写 | 原有 Runtime 权限；自动开关仅在已定义的安全范围有效 | Runtime tool policy / PermissionRequest；不伪称已做 Proposal 审核 |
| L2 | 将知识结论沉淀到已有或新笔记 | 必须 Proposal → 查看 Diff → 显式批准 | Review Service + apply executor |
| L3 | 删除、批量修改、移动、全量重组、配置修改及跨源写入 | MVP 禁止自动执行；后续专门审批和作用域授权 | 有效的工具执行边界；不能仅凭 Prompt |

**关键真实性约束**：目前 `PermissionRequest` 的 matcher 仅含 `Write|Edit`，运行时 Bash 等工具的覆盖尚未审完；不能在 T0 完成前对外承诺“所有 L3 行为绝无绕行路径”。需在受控知识工作流中禁止使用未纳入执行边界的写盘工具，直到覆盖测试通过。

## 不采纳的方案

- A：只对显式 Knowledge Proposal 审核，其他路径完全照旧。兼容容易，但隐藏目录仍可能被自动授权，用户也难理解差异。
- B：所有 Agent 文件编辑一律产生提案。最严格但会显著破坏既有 Drora 自动化体验。

## 明确不在本轮隐式改变

- 既有单活动 Vault、VaultView、原生 Read/Glob/Grep/Edit/Write、桌面/手机远控复用的 Runtime。
- 已有 `vault-config.json` 是 Vault 配置事实源，不能另建并行授权配置。
- Memory Agent 自己的受限记忆写入流程；Knowledge P0 不自动更新长期记忆。

## 实现门禁（Blocking）

- G-01：验证所有可能触碰 Vault 的工具执行面（Write、Edit、Bash、脚本、MCP/插件等）；区分“未自动授权”与“程序级阻断”。
- G-02：缩小 PermissionRequest 自动授权路径；`.obsidian/config.json`、`notes/.secret.md`、`notes/a.txt`、软链、根外路径一律不得自动允许。
- G-03：知识提案走独立 `review → apply`，审批必须由受信的用户交互通路发起；Agent 不能访问审批接口。
- G-04：多进程文件竞争不能假定原子 rename = 原子 CAS；必须设置审计、快照和未知结果恢复。
- G-05：没有后端接入时 UI 不得展示“全局安全治理已启用”之类的保证性文案。

## 实施优先级

T0（权限+源身份+服务边界）→ T1（索引/搜索/证据）→ T2（Agent 问库）→ T3（Proposal 审核/Undo）→ T4（主动洞察）→ T5（Memory/手机）。

## 验收重点

- 仅改变 `allowAgentWrites` 不会改变 Proposal 审核要求；普通 `.md` 已授权的直接编辑仍可用。
- 恶意/失效/越权目标不获自动授权；申请拒绝后不得落盘。
- 人工批准前，任何 Proposal 不修改 Vault；`operationId` 重复不二次写；sourceEpoch 不匹配禁止 apply。
- 文件在 diff 展示后被外部修改，返回冲突并要求重新审核。
- Agent 权限流程与手机远控不生成两套 Session/Owner。