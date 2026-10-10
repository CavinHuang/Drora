# 文件级实施地图

## 先读现有文件（路径需在当前 HEAD 复查）

- `apps/drora-cli/packages/obsidian-plugin/src/{hooks/permission-request.ts,lib/agent-access.ts}`
- `packages/services/src/obsidian-vault/{obsidianVault.ts,obsidianVaultService.ts,vault-fs.ts}`
- `packages/services/src/{node.ts,index.ts,collection.ts}`
- `packages/shared/src/channels.ts`
- `packages/ui/src/v4/{VaultView.tsx,SessionPane.tsx}`
- `packages/ui/src/v4/vault/`
- `packages/ui/src/app-shell/WorkspaceShellLayout.tsx`
- `packages/ui/src/hooks/useServices.tsx`

## 建议新增，非仓库现有事实

```text
packages/services/src/knowledge/
  source/sourceRegistry.ts
  store/{knowledgeDatabase,indexRepository,migrations}.ts
  index/{indexCoordinator,markdownChunker,sourceScanner}.ts
  search/{lexicalRetriever,semanticRetriever,candidateFusion}.ts
  query/{queryOrchestrator,sufficiencyPolicy}.ts
  evidence/{evidenceStore,citationResolver,agentEvidenceBridge}.ts
  decision/{decisionEngine,decisionPolicy,decisionCache}.ts
  decision/providers/{localDecisionProvider,jevDecisionProvider}.ts
  review/{proposalRepo,operationRepo,snapshotStore,riskPolicy,proposalCoordinator}.ts
packages/ui/src/v4/vault/
  VaultKnowledgeShell.tsx
  VaultSmartQueryView.tsx
  VaultArticleCandidates.tsx
  VaultEvidenceInspector.tsx
  VaultDecisionTrace.tsx
  VaultRerankConsentDialog.tsx
  VaultInsightsView.tsx
  VaultReviewView.tsx
```

RPC 扩展需在 `packages/shared/src/channels.ts`、`packages/services/src/index.ts` / `node.ts` 注册，遵循服务生命周期和可取消资源清理；共享 DTO 的键定义一次。

**禁止**：未经证明直接复制独立 T0 SQLite `.mjs` 为生产代码；大范围重写原 `VaultView.tsx`；不经审核自动推送知识写回。