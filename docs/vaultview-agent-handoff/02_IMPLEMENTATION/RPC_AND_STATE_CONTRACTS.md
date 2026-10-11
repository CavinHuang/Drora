# RPC 与状态契约（设计草案）

建议 `IKnowledgeIndexService`：`getStatus`, `startReconcile`, `cancelJob`, `requestRebuild`。
建议 `IKnowledgeQueryService`：`createRun`, `search`, `prepareEvidence`, `resolveCitation`, `getRun`, `cancelRun`。
建议 `IKnowledgeReviewService`（独立开关）：`createProposal`, `listProposals`, `approve`, `reject`, `apply`, `reconcile`, `undo`。
建议 `IKnowledgeInsightService`（P1）：`list`, `getEvidence`, `feedback`。

共享类型（需要按实际 RPC/Zod 实现）：

```ts
type QueryIntent = 'FIND_ARTICLE' | 'ANSWER_FROM_VAULT' | 'COMPARE_SOURCES' | 'EDIT_NOTE' | 'UNCERTAIN';
type QueryPhase = 'idle' | 'retrieving' | 'local_ready' | 'deciding' | 'verifying' | 'ready' | 'ambiguous' | 'insufficient' | 'partial' | 'failed' | 'cancelled';
type EvidenceStatus = 'current' | 'stale' | 'missing' | 'forbidden' | 'unverified';
type RerankMode = 'local' | 'jev' | 'jev_partial' | 'fallback';
interface SourceRef { sourceId: string; sourceEpoch: number; vaultId: string; }
interface CreateQueryRunRequest { query: string; source: SourceRef; sessionId?: string; clientRequestId: string; intentOverride?: QueryIntent; }
interface ArticleCandidate { articleId: string; title: string; relativePath: string; matchedHeading?: string; excerpt: string; receiptId?: string; evidenceStatus: EvidenceStatus; rank: number; }
interface ResolveCitationRequest { receiptId: string; sessionId?: string; }
```

无源授权、换源、源失效、索引部分覆盖、入队后证据过期、Jev 超时都需有机器可测的错误码和可见降级；状态事件用 `runGeneration+seq` 保证迟到消息不能覆盖新 Query。

Receipt 必须在服务端保存 `runId/sessionId/sourceEpoch/fileSha/quoteSelector/createdAt`，模型生成字符串不可变成可信链接。
详细参考 `05_REFERENCE/ARCHITECTURE_v4.0.md`。