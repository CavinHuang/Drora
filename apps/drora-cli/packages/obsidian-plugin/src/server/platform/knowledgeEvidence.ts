/**
 * Knowledge EvidenceReceipt 跨进程契约（P7/C6 插件自带副本，specs/
 * obsidian-vault-phase2-true-extraction.md §1-C6/§9 白名单「obsidian-plugin 包本身」）。
 *
 * 迁自 packages/shared/src/knowledge-evidence.ts @ HEAD bf872a6c0（迁移注记：
 * P7 本体清除删除 shared 契约——实现归属迁入插件包，本文件为插件侧唯一出处；
 * 除本头注释与上述迁移说明外与 HEAD 逐字节等价）。本体 wire 侧 deprecated 证据
 * 词表在 @drora/shared drora-protocol-v4/input-intent.ts 兼容区（CLI legacy 探测器
 * 消费），两份词表互不引用、各自封闭——插件数据面只读本文件。
 *
 * 安全不变量：跨进程/跨线只传 opaque receiptId；relativePath/fileSha/quote 等
 * 绑定事实只存服务端账本，由插件 server 写入。
 */

/** 发送链路携带的 opaque 证据引用；除 receiptId 外不允许任何字段（伪造载体无意义）。 */
export interface KnowledgeEvidenceRef {
  receiptId: string;
}

/** 单条输入允许携带的证据引用上限（与 renderer 选区引用上限同量级，防批量滥用）。 */
export const MAX_EVIDENCE_REFS_PER_INPUT = 8;

/** opaque receipt id 前缀；解析时校验形状，杜绝把任意字符串当账本键扫表。 */
export const KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX = "evr_";

/**
 * Vault 配置唯一事实源文件名（PR #23 终审 conv-1 收口迁入）：插件 vault 门面与
 * D14 legacy 状态机消费同一物理文件。
 */
export const VAULT_CONFIG_FILE_NAME = "vault-config.json";

/**
 * 知识索引/账本库文件名（PR #23 终审 conv-1 收口迁入）：插件数据目录与 D14
 * legacy 旧路径判定两侧构造的路径必须落在同一物理文件上，文件名在此单一出处。
 */
export const KNOWLEDGE_INDEX_DB_FILE_NAME = "knowledge-index.sqlite";

/**
 * 引用解析状态机（服务端 resolveCitation 共用语义）：
 * - current：授权 + 源身份 + 文件版本 + quote 切片全部通过；
 * - stale：文件被改 / quote 移位 / 源被撤权重授；
 * - missing：文件已删除；
 * - forbidden：切库 / 撤权 / 跨会话 / 伪造 receipt。
 */
export type KnowledgeEvidenceStatus = "current" | "stale" | "missing" | "forbidden";

/** 复验失败的机器可读原因（guard id / 结构化 reason 词表）。 */
export const KNOWLEDGE_EVIDENCE_REASONS = {
  unknownReceipt: "unknown_receipt",
  crossSession: "cross_session",
  sourceUnconfigured: "source_unconfigured",
  vaultSwitched: "vault_switched",
  sourceReauthorized: "source_reauthorized",
  fileDeleted: "file_deleted",
  fileModified: "file_modified",
  quoteMoved: "quote_moved",
  gateUnavailable: "gate_unavailable",
} as const;
export type KnowledgeEvidenceReason =
  (typeof KNOWLEDGE_EVIDENCE_REASONS)[keyof typeof KNOWLEDGE_EVIDENCE_REASONS];

/**
 * 发送链路 guard reasonCode（CLI ACK failed.reasonCode 词表）。P7 后 CLI 侧唯一
 * 活跃拒绝是 legacy 探测器（guard.evidenceForbidden + legacy_evidence_unverifiable，
 * 词表在 @drora/shared wire 兼容区）；本词表保留供工具结果内 evidence 三态注解与
 * 历史语义对账。
 */
export const KNOWLEDGE_EVIDENCE_GUARD_PREFIX = "guard.evidence" as const;
export const KNOWLEDGE_EVIDENCE_GUARDS = {
  stale: "guard.evidenceStale",
  missing: "guard.evidenceMissing",
  forbidden: "guard.evidenceForbidden",
  unknown: "guard.evidenceUnknown",
  unavailable: "guard.evidenceUnavailable",
  guideForbidden: "guard.evidenceGuideForbidden",
} as const;
export type KnowledgeEvidenceGuard =
  (typeof KNOWLEDGE_EVIDENCE_GUARDS)[keyof typeof KNOWLEDGE_EVIDENCE_GUARDS];

/**
 * `evidence_receipts` 表 DDL（migration v2 与插件账本共用；改列必须同步本常量并
 * 提升 migration 版本）。receipt 绑定 sessionId（空串 = 未绑定会话）。
 */
export const KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS evidence_receipts(
        receipt_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        run_id TEXT NOT NULL,
        article_id TEXT NOT NULL,
        vault_id TEXT NOT NULL,
        source_epoch INTEGER NOT NULL,
        source_fingerprint TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        title TEXT NOT NULL,
        heading TEXT,
        file_sha256 TEXT NOT NULL,
        chunk_sha256 TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        excerpt TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      )`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_receipts_session
        ON evidence_receipts(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_receipts_run
        ON evidence_receipts(run_id)`,
] as const;

/** 账本只读 SELECT 列清单（与 DDL 列一一对应；顺序即读取顺序契约）。 */
export const KNOWLEDGE_EVIDENCE_RECEIPT_COLUMNS = [
  "receipt_id",
  "session_id",
  "run_id",
  "article_id",
  "vault_id",
  "source_epoch",
  "source_fingerprint",
  "relative_path",
  "title",
  "heading",
  "file_sha256",
  "chunk_sha256",
  "start_line",
  "end_line",
  "start_offset",
  "end_offset",
  "excerpt",
  "created_at_ms",
] as const;

/** 账本行的结构化视图（插件 server 写入的形状）。 */
export interface KnowledgeEvidenceReceiptRow {
  receiptId: string;
  /** 绑定会话；空串 = run 未携带 sessionId（跨会话不拒绝）。 */
  sessionId: string;
  runId: string;
  articleId: string;
  vaultId: string;
  sourceEpoch: number;
  /** vaultId:configuredAt 指纹；与当前 vault-config.json 对比。 */
  sourceFingerprint: string;
  relativePath: string;
  title: string;
  heading: string | null;
  fileSha256: string;
  chunkSha256: string;
  quote: { startLine: number; endLine: number; startOffset: number; endOffset: number };
  /** 有界摘录（≤240 字符 + 省略号），供回跳预览；正文全文不经此通道。 */
  excerpt: string;
  createdAtMs: number;
}

/** vault-config 源指纹（与 sourceRegistry 同式：`${vaultId}:${configuredAt}`）。 */
export function knowledgeSourceFingerprint(vaultId: string, configuredAt: number): string {
  return `${vaultId}:${configuredAt}`;
}

/**
 * quote selector 偏移的规范化口径（与 W02 markdownChunker 同式）：按 `\r?\n` 切行后
 * 以 `\n` 重组。偏移是该规范化文本的字符偏移（含头不含尾）。
 */
export function normalizeContentForQuoteSelector(content: string): string {
  return content.split(/\r?\n/).join("\n");
}

/**
 * 摘录字符上限（PR #23 终审 shared-3 收口迁入）：回执摘录与检索候选 excerpt 窗口
 * **同界**——候选展示即回执预览。
 */
export const KNOWLEDGE_EXCERPT_MAX_CHARS = 240;

/** Quote excerpt projection shared by the Receipt issuer and renderer readback. */
export function knowledgeEvidenceExcerpt(content: string): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  const maxChars = KNOWLEDGE_EXCERPT_MAX_CHARS;
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

// ---------------------------------------------------------------------------
// 插件服务通道名（P7/C6-C7：本体 ServiceChannels 四成员已删——shared channels.ts
// 只剩非 vault 服务；插件 descriptors 的 channelName 字面量迁入本插件自带常量，
// 值与 HEAD bf872a6c0 的 PlatformChannels 逐字等价）。
// ---------------------------------------------------------------------------

/** 插件四服务 RPC 通道名（obsidianVault/knowledgeIndex/knowledgeQuery/knowledgeReview）。 */
export const KNOWLEDGE_SERVICE_CHANNELS = {
  ObsidianVault: "obsidian-vault",
  KnowledgeIndex: "knowledge-index",
  KnowledgeQuery: "knowledge-query",
  KnowledgeReview: "knowledge-review",
} as const;
