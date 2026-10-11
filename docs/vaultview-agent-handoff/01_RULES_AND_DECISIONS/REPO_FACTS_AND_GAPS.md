# 2026-10-10 源码快照与待验证事项

审计基线 `main` SHA `c1870c9c730975a02117e93e025ae486eb757cf1`。该版本只是交接时快照，Coding Agent 必须重新检查自己的 HEAD。

| 类别 | 当前代码路径或事实 |
|---|---|
| Vault RPC | `packages/services/src/obsidian-vault/obsidianVault.ts`、`obsidianVaultService.ts` |
| 文件与路径安全 | `packages/services/src/obsidian-vault/{vault-fs,paths,atomic}.ts` |
| UI | `packages/ui/src/v4/VaultView.tsx`、`packages/ui/src/v4/vault/*` |
| Agent Hook | `apps/drora-cli/packages/obsidian-plugin/src/hooks/{session-start,user-prompt-submit,permission-request}.ts` |
| 写权限风险 | 当前 PermissionRequest matcher 为 Write/Edit；不能证明 Bash/MCP 等绕行路径已拦截 |
| 现有证据格式 | `conversationSelectionReference.ts` 的 `# userselect` 只含路径+文本，并无可信 receipt |
| Session / Host | `packages/services/src/drora-session/droraSession.ts`、`packages/desktop/src/host/index.ts` |
| 服务注册 | `packages/services/src/node.ts` 的 `createLocalServices`、`packages/shared/src/channels.ts` |
| UI 规范 | `DESIGN.md`：`text-ui-*`、语义 token、深浅主题、紧凑工作台 |
| 研发治理 | `AGENTS.md`：原还原代码隔离、先 Spec 后代码、真实 typecheck/lint/architecture 检查 |

独立 T0 Spike 通过 15 项 Node 测试，**但不代表已在 Drora 主仓运行**。在真实集成前仍须验证：S01 多 Host、S02 admission 与证据新鲜度、S03 全工具写入路径、S04 Vault identity、S05 中文词法与语义效果；Jev 真实 API、Windows/macOS Electron 尚未联调。