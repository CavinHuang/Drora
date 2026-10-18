/**
 * Knowledge EvidenceReceipt 跨进程契约（W03 / specs/obsidian-knowledge.md §5）。
 *
 * 单一出处：本文件是 evidence 契约字面量的唯一定义处，两侧同时引用——
 * - 宿主（packages/services）：`evidence_receipts` 表 DDL / 列名 / 状态机；
 * - CLI Runtime gate（apps/drora-cli/packages/bootstrap）：只读 SELECT 列清单 / guard
 *   reasonCode / 引用上限；
 * - 两侧共用的数据文件名（vault-config.json / knowledge-index.sqlite）与摘录界值
 *   亦在此收口（PR #23 终审 conv-1 / shared-3）。
 * 任何一侧不得手写第二份字面量（AGENTS.md「契约键单一出处」）。
 *
 * 安全不变量：跨进程/跨线只传 opaque receiptId；relativePath/fileSha/quote 等
 * 绑定事实只存服务端账本，由宿主写入、CLI 只读复验。
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
 * Vault 配置唯一事实源文件名（PR #23 终审 conv-1 收口）：services obsidian-vault
 * 门面写入、CLI gate（vault-config-reader）只读镜像的是同一物理文件，此前两侧
 * 各手写一份字面量——漂移即两侧读到不同配置。obsidian-plugin 包因不依赖
 * @drora/shared，其本地副本豁免（终审判定已记录）。
 */
export const VAULT_CONFIG_FILE_NAME = "vault-config.json";

/**
 * 知识索引/账本库文件名（PR #23 终审 conv-1 收口）：<数据根>/knowledge/ 下与
 * services sourceRegistry（getDroraDataRootDir 推导）和 CLI gate（DRORA_DATA_BASE_DIR
 * 推导）两侧独立构造的路径必须落在同一物理文件上，文件名在此单一出处。
 */
export const KNOWLEDGE_INDEX_DB_FILE_NAME = "knowledge-index.sqlite";

/**
 * 引用解析状态机（服务端 resolveCitation 与 CLI gate 共用语义）：
 * - current：授权 + 源身份 + 文件版本 + quote 切片全部通过；
 * - stale：文件被改 / quote 移位 / 源被撤权重授；
 * - missing：文件已删除；
 * - forbidden：切库 / 撤权 / 跨会话 / 伪造 receipt。
 */
export type KnowledgeEvidenceStatus = "current" | "stale" | "missing" | "forbidden";

/** 复验失败的机器可读原因（guard id / 结构化 reason，两侧共用词表）。 */
export const KNOWLEDGE_EVIDENCE_REASONS = {
  unknownReceipt: "unknown_receipt",
  crossSession: "cross_session",
  sourceUnconfigured: "source_unconfigured",
  vaultSwitched: "vault_switched",
  sourceReauthorized: "source_reauthorized",
  fileDeleted: "file_deleted",
  fileModified: "file_modified",
  quoteMoved: "quote_moved",
  // gate 自身不可用（配置/DB 读取失败）：spec §5.3 已记为正式拒绝原因——fail-closed
  // 拒绝、不 fail-open；此前 CLI 侧 4 处手写该字面量未收口（PR #23 终审 shared-2）。
  gateUnavailable: "gate_unavailable",
} as const;
export type KnowledgeEvidenceReason =
  (typeof KNOWLEDGE_EVIDENCE_REASONS)[keyof typeof KNOWLEDGE_EVIDENCE_REASONS];

/**
 * 发送链路 guard reasonCode（CLI ACK failed.reasonCode）。桌面按前缀
 * `guard.evidence` 分流提示；词表在此收口，CLI handler 只引用常量。
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
 * `evidence_receipts` 表 DDL（migration v2 与 CLI 只读侧共用；改列必须同步本常量并
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

/** CLI gate 的只读 SELECT 列清单（与 DDL 列一一对应；顺序即读取顺序契约）。 */
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

/** 账本行的结构化视图（宿主写入与 CLI 只读共用的形状）。 */
export interface KnowledgeEvidenceReceiptRow {
  receiptId: string;
  /** 绑定会话；空串 = run 未携带 sessionId（跨会话不拒绝）。 */
  sessionId: string;
  runId: string;
  articleId: string;
  vaultId: string;
  sourceEpoch: number;
  /** vaultId:configuredAt 指纹；CLI gate 直接与当前 vault-config.json 对比。 */
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

/** vault-config 源指纹（与 services sourceRegistry 同式：`${vaultId}:${configuredAt}`）。 */
export function knowledgeSourceFingerprint(vaultId: string, configuredAt: number): string {
  return `${vaultId}:${configuredAt}`;
}

/**
 * quote selector 偏移的规范化口径（与 W02 markdownChunker 同式）：按 `\r?\n` 切行后
 * 以 `\n` 重组。偏移是该规范化文本的字符偏移（含头不含尾）。宿主与 CLI gate 复验
 * quote 切片必须共用本函数，禁止各自实现第二份口径。
 */
export function normalizeContentForQuoteSelector(content: string): string {
  return content.split(/\r?\n/).join("\n");
}

/**
 * 摘录字符上限（PR #23 终审 shared-3 收口）：回执摘录（knowledgeEvidenceExcerpt）
 * 与检索候选 excerpt 窗口（services lexicalRetriever）**同界**——候选展示即回执
 * 预览，两侧此前各写一份 240，漂移会造成「候选看到的与复验回执不一致」。
 */
export const KNOWLEDGE_EXCERPT_MAX_CHARS = 240;

/**
 * Quote excerpt projection shared by the Receipt issuer and renderer readback.
 * Keep truncation and whitespace normalization in one place.
 */
export function knowledgeEvidenceExcerpt(content: string): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  const maxChars = KNOWLEDGE_EXCERPT_MAX_CHARS;
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}
