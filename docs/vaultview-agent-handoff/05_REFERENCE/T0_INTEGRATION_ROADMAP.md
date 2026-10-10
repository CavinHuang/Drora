# Drora VaultView 2.0 — 从 T0 Spike 到主仓库的文件级集成计划

> 基于 Drora main tree `c1870c9c730975a02117e93e025ae486eb757cf1` 源码核对；下列 NEW/MODIFY 是**建议**，未实际提交。

## 已存在的代码事实

| 文件 | 当前责任 | 建议变更 |
|---|---|---|
| `apps/drora-cli/packages/obsidian-plugin/src/hooks/permission-request.ts` | 在 `allowAgentWrites` true 时对授权根内 `Write/Edit` 输出 auto-allow | 按补丁先收紧自动授权 `.md` 且非隐藏；不能据此声称所有工具被阻断 |
| `apps/drora-cli/packages/obsidian-plugin/src/lib/agent-access.ts` | 载入 Vault 授权、相对根路径及软链接校验、Session 焦点 | 先保证根身份与路径语义复用；更严格策略应迁移到独立 policy 模块 |
| `packages/services/src/obsidian-vault/vault-fs.ts` | 安全 Vault IO、SHA 预检查 + 原子替换 | 只读索引调用既有安全能力；写入事务不要假定跨进程严格 CAS |
| `packages/services/src/obsidian-vault/obsidianVault.ts` | `IObsidianVaultService` 接口 | 作为 Vault IO 服务，不复写新知识索引逻辑 |
| `packages/services/src/node.ts` | `createLocalServices` 注册 Host 服务 | 按原有服务描述符装配新增 Knowledge；资源 dispose / Host 可达性 |
| `packages/services/src/index.ts` + `packages/shared/src/channels.ts` | 公开 RPC 描述符与 channel | 扩展单一 DTO 和注册入口 |
| `packages/ui/src/v4/VaultView.tsx` | Vault 当前笔记/编辑与选区动作 | wrapper 接入智能问库；不把新域逻辑塞入现有巨型组件 |
| `packages/ui/src/v4/SessionPane.tsx` | Agent 会话呈现和输入 | `@Vault` 与真实 `CommandInbox` admission 的接入点必须先 Spike |
| `packages/ui/src/lib/conversationSelectionReference.ts` | 把 `{path,text}` 序列化到 `# userselect:` | 不可把这段普通文本误当可信 citation receipt |
| `packages/ui/src/app-shell/WorkspaceShellLayout.tsx` | Workspace UI 挂载点，含 VaultView | 引用回跳通过现有 workspace/split pane 机制 |

## 集成顺序（按合入 PR 的最小颗粒拆分）

### PR-01：Spec 和最小权限收窄

`NEW specs/obsidian-knowledge.md`、`MODIFY specs/obsidian-plugin.md`、`MODIFY .../permission-request.ts` 和 Hook E2E。先验证 `.obsidian/`、隐藏目录、非 .md 不再**自动**授权；并运行当前插件自身测试。**注意该补丁不会自动阻止用户手动授权写入**。

### PR-02：只读 Source + Index RPC

`NEW packages/shared/src/knowledge.ts`；`MODIFY packages/shared/src/channels.ts`；`NEW packages/services/src/knowledge/source/registry.ts`、`index/store.ts`、`index/coordinator.ts`、`index/chunker.ts`、`knowledgeIndexService.ts`；`MODIFY packages/services/src/{index,node}.ts`。Profile + vaultId + epoch，复用现有 Vault；先能针对单活动 Vault 建索引、删除、重建和 report partial。

### PR-03：Query + Source Evidence RPC

`NEW packages/services/src/knowledge/query/{lexical,semantic,fusion,source-verifier,evidence}.ts`；先词法，语义 provider 留端口；需要 session-scoped receipt 和当前源重验，不能由 Renderer 直发真实文件路径充当受信引用。

### PR-04：Agent 查询接入 Spike

为 `@Vault` 查找真正的发送前/发送后 admission boundary，确保排队和恢复时来源版本绑定。输入证据需额外标识「用户文件内容属于不可信数据」并有外发模型授权策略。只实现 read-only 查询，不引入第二套 Agent 会话。

### PR-05：Jev 决策端口与 A/B

先定义 provider port 和 consent scope；对 TypeSafe Jev 官方 SDK 的正确版本、Noul/Choice 格式和费用做独立联调；provider 不可用时返回本地结果。Jev 不控制授权、文件删除、原文版本或批准状态。

### PR-06：VaultView 交互

`NEW packages/ui/src/v4/vault/{VaultShell,VaultSmartQueryView,VaultArticleCandidates,VaultEvidenceInspector,VaultDecisionTrace,VaultRerankConsentDialog}.tsx`；`MODIFY packages/ui/src/v4/VaultView.tsx`（尽量最小）。沿用 v4.0 设计、Drora `text-ui-*` 及主题 tokens。

### PR-07：审核与写入独立安全评审

继续执行 R2 方案 C：L0 只读，L1 明确范围普通编辑，L2 知识沉淀强制审核，L3 高风险默认不开。**在无法覆盖 Bash/MCP 等写盘边界以前，不开放“所有高风险操作都已被拦截”的界面承诺。**

## 上游基线和工程门槛

按仓库 `AGENTS.md`：先 Spec 后代码，新增自研模块物理隔离；变更前运行 workspace freshness，完成 architecture context；需要执行 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 和相关 E2E。当前 Spike 是无依赖独立模块，不属于主仓类型检查结果。