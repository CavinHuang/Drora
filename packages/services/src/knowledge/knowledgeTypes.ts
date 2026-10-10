/**
 * Knowledge 索引/检索共享 DTO（W02）。
 *
 * 单一出处：channel 字面量在 @drora/shared channels.ts；本文件是这些 channel
 * 上往返的 DTO 类型唯一定义处（与 obsidianVault.ts 同形），经 services index.ts
 * 以纯类型导出（根 index 会被 renderer 拉进浏览器包，禁止携带实现值）。
 *
 * 行为契约见 specs/obsidian-knowledge.md §5b。
 */

/** 索引任务种类：reconcile=增量对账（增删改/重命名/漏事件），rebuild=全量重建。 */
export type KnowledgeIndexJobKind = "reconcile" | "rebuild";

export type KnowledgeIndexJobStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  /** 源指纹变化（切库/重新授权）导致本 job 所属 sourceEpoch 失效。 */
  | "superseded";

/** 源引用：按 vaultId + sourceEpoch 隔离一切候选与缓存。 */
export interface KnowledgeSourceRef {
  vaultId: string;
  sourceEpoch: number;
}

/** 收录/排除计数；任一排除非零或配额截断 → partial（不假装全库完整）。 */
export interface KnowledgeCoverage {
  /** 当前 epoch 已索引文件数与 chunk 数。 */
  indexedFiles: number;
  indexedChunks: number;
  /** 隐藏段（`.` 开头目录/文件）排除数。 */
  excludedHidden: number;
  /** 符号链接（含 Windows junction 语义下的软链形态）排除数。 */
  excludedSymlink: number;
  /** 非 `.md` 文件跳过数。 */
  excludedNotMarkdown: number;
  /** 超过 2MB 门面读取上限的文件数。 */
  excludedOverSize: number;
  /** 文件/目录配额（5000/1000）截断数。 */
  excludedOverQuota: number;
  /** 超过深度上限（16）未枚举的条目数。 */
  excludedDepth: number;
  /** 单文件 chunk 超过上限被截断的文件数。 */
  truncatedFiles: number;
  /** 排除或截断是否令索引不完整。 */
  partial: boolean;
}

export interface KnowledgeIndexJobView {
  jobId: string;
  kind: KnowledgeIndexJobKind;
  status: KnowledgeIndexJobStatus;
  /** 本 job 提交时的 run 代数（进程内单调），用于丢弃迟到状态。 */
  generation: number;
  /** 提交/接管本 job 时的 lease fence token；fence 失效即拒绝提交。 */
  fence: number;
  sourceEpoch: number;
  startedAtMs: number;
  finishedAtMs: number | null;
  /** cancelled/superseded/failed 时的机器可读原因；不含绝对路径。 */
  reason: string | null;
  indexedFiles: number;
  indexedChunks: number;
}

export interface KnowledgeLeaseView {
  /** 当前协调者是否持有租约。 */
  heldBySelf: boolean;
  /** 持有者 id（随机 host 标识，不含路径/凭据）。 */
  owner: string | null;
  /** 当前 fence token（epoch，单调递增）。 */
  fence: number;
  expiresAtMs: number | null;
}

/** Embedding 端口可用性：默认无端口 → semantic_unavailable（显式呈现，不静默）。 */
export type KnowledgeSemanticAvailability = "unavailable" | "available";

export interface KnowledgeIndexStatus {
  /** 当前活动 Vault 是否可作检索源（vault-config.json 有效且根存在）。 */
  configured: boolean;
  source: (KnowledgeSourceRef & { displayName: string }) | null;
  coverage: KnowledgeCoverage;
  /** 最近一次任务（任意 epoch）；进行中的任务优先生效。 */
  job: KnowledgeIndexJobView | null;
  lease: KnowledgeLeaseView;
  semantic: KnowledgeSemanticAvailability;
}

/** startReconcile/requestRebuild 返回；alreadyRunning=true 时返回的是既有任务。 */
export interface KnowledgeIndexJobStartResult {
  jobId: string;
  kind: KnowledgeIndexJobKind;
  generation: number;
  fence: number;
  sourceEpoch: number;
  alreadyRunning: boolean;
}

/** 文章级候选：同文档多 chunk 命中聚合为一条（去重），附命中 chunk 数。 */
export interface KnowledgeArticleCandidate {
  /** 稳定文章 id = sha256(vaultId + relativePath)；不含根路径，可安全出站。 */
  articleId: string;
  title: string;
  relativePath: string;
  /** 命中 chunk 的 heading 路径（`A > B`）；正文顶层命中为 null。 */
  matchedHeading: string | null;
  /** 命中 chunk 的原文节选（有界，≤240 字符）。 */
  excerpt: string;
  /** quote selector：命中 chunk 的 1-based 起止行与全文字符偏移（W03 Receipt 绑定用）。 */
  quote: { startLine: number; endLine: number; startOffset: number; endOffset: number };
  /** 命中 chunk 所属文件内容 sha256（乐观锁版本）。 */
  fileSha256: string;
  /** 命中 chunk 文本 sha256。 */
  chunkSha256: string;
  /** 1 起始名次。 */
  rank: number;
  /** 融合得分（BM25 为主；语义重排可微调）。仅供排序展示，不是正确率。 */
  score: number;
  /** 聚合：该文章内命中的 chunk 数。 */
  matchedChunkCount: number;
  /** Receipt 尚未存在（W03）；在此之前引用一律不可信为服务端证据。 */
  evidenceStatus: "unverified";
}

/** cancelJob 结果：not_found 表示 jobId 不存在或任务已结束离场。 */
export type KnowledgeJobCancelResult = { cancelled: boolean; status: KnowledgeIndexJobStatus | "not_found" };

export type KnowledgeQueryStatus =
  | "retrieving"
  | "ready"
  | "partial"
  | "empty"
  | "no_source"
  | "source_stale"
  | "cancelled"
  | "failed";

export type KnowledgeSemanticStage = "unavailable" | "applied" | "skipped";

export interface KnowledgeSearchDiagnostics {
  semantic: KnowledgeSemanticStage;
  /** 语义不可用原因（端口缺失/嵌入缺失/调用失败）；不含笔记内容与绝对路径。 */
  semanticReason: string | null;
  /** FTS 命中的 chunk 总数（聚合前的原始命中）。 */
  lexicalChunkHits: number;
  /** 进入融合的词法候选 chunk 数。 */
  lexicalCandidates: number;
  /** MATCH 是否使用了 OR 降级（AND 无命中时的一次扩搜上限）。 */
  matchRelaxedToOr: boolean;
}

/** 检索 run 的完整视图：getRun/search/createRun 的统一返回。 */
export interface KnowledgeRunView {
  runId: string;
  /** 进程内单调代数；cancelRun 会使 in-flight 结果按代数丢弃。 */
  runGeneration: number;
  status: KnowledgeQueryStatus;
  /** 原样查询文本（回显），不参与任何范围/日期扩展。 */
  query: string;
  /** 发起会话（createRun 透传）；null = 无会话的纯检索，Receipt 不绑会话（W03 §5.1）。 */
  sessionId: string | null;
  source: KnowledgeSourceRef | null;
  createdAtMs: number;
  finishedAtMs: number | null;
  candidates: KnowledgeArticleCandidate[];
  coverage: KnowledgeCoverage | null;
  diagnostics: KnowledgeSearchDiagnostics | null;
  /** failed 的机器可读原因；不含绝对路径与笔记内容。 */
  reason: string | null;
}

/** onRunUpdated 事件负载：runGeneration+seq 防迟到覆盖（spec §5b.6）。 */
export interface KnowledgeRunUpdatedEvent {
  runId: string;
  runGeneration: number;
  seq: number;
  status: KnowledgeQueryStatus;
}

// ── Evidence（W03 / spec §5）────────────────────────────────
// 结构化结果类型从 evidenceRegistry 的返回判别式推导（单一出处），此处只 re-export
// RPC 面需要的别名，避免消费方深入实现层导入。

export type {
  KnowledgeEvidenceReceipt,
  KnowledgePrepareEvidenceResult,
  KnowledgeResolveCitationResult,
} from "./evidence/evidenceRegistry.js";

/** prepareEvidence 入参：run + 候选定位；session 可选绑定（缺省取 run 的发起会话）。 */
export interface KnowledgePrepareEvidenceParams {
  runId: string;
  articleId: string;
}

/** resolveCitation 入参：opaque receiptId + 调用方会话（跨会话拒绝依据，spec §5.2）。 */
export interface KnowledgeResolveCitationParams {
  receiptId: string;
  sessionId?: string;
}
