/**
 * EvidenceReceipt 账本（W03 / specs/obsidian-knowledge.md §5.1–5.2）。
 *
 * - receipt 由服务端签发：prepareEvidence 只为「创建时刻已复验为 current」的证据签发；
 * - resolveCitation 是引用可信的唯一入口：账本查找 → 会话绑定 → 源身份 → 文件版本 →
 *   quote 切片，逐层复验，任一失败返回结构化 status+reason，绝不抛业务错；
 * - 账本持久化在 knowledge-index.sqlite v2 evidence_receipts（DDL 单一出处 =
 *   @drora/shared knowledge-evidence 常量）；CLI Runtime gate 以只读连接消费同一张表。
 * - excerpt 有界（与检索候选同口径 ≤240 字符）；正文全文不经本通道。
 */
import { createHash, randomBytes } from "node:crypto";
import {
  KNOWLEDGE_EVIDENCE_RECEIPT_COLUMNS,
  KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX,
  KNOWLEDGE_EVIDENCE_REASONS,
  knowledgeSourceFingerprint,
  normalizeContentForQuoteSelector,
  type KnowledgeEvidenceReceiptRow,
  type KnowledgeEvidenceReason,
  type KnowledgeEvidenceStatus,
} from "@drora/shared";
import { createVaultFileSystem, type VaultReadResult } from "../../obsidian-vault/vault-fs.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import type { KnowledgeArticleCandidate, KnowledgeRunView } from "../knowledgeTypes.js";
import type { KnowledgeSourceResolution } from "../source/sourceRegistry.js";

const EXCERPT_MAX_CHARS = 240;

export interface KnowledgeEvidenceReceipt extends KnowledgeEvidenceReceiptRow {}

/** prepareEvidence 的结构化结果：current 才携带 receipt。 */
export type KnowledgePrepareEvidenceResult =
  | { status: "current"; receipt: KnowledgeEvidenceReceipt }
  | { status: "no_source" | "source_stale" | "stale" | "missing" | "forbidden"; receipt: null };

/** resolveCitation 的结构化结果（§5.2 状态机）。 */
export type KnowledgeResolveCitationResult =
  | {
      status: "current";
      citation: {
        receiptId: string;
        sessionId: string;
        runId: string;
        articleId: string;
        relativePath: string;
        title: string;
        heading: string | null;
        quote: KnowledgeEvidenceReceiptRow["quote"];
        excerpt: string;
        createdAtMs: number;
      };
    }
  | { status: KnowledgeEvidenceStatus; reason: KnowledgeEvidenceReason | null; citation: null };

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** 有界摘录（与 lexicalRetriever.excerptOf 同口径；此处独立成函数避免反向依赖检索层）。 */
function excerptOf(body: string): string {
  const compact = body.replace(/\s+/gu, " ").trim();
  return compact.length > EXCERPT_MAX_CHARS ? `${compact.slice(0, EXCERPT_MAX_CHARS)}…` : compact;
}

/** quote 切片复验：规范化文本偏移切片的 sha256 必须等于绑定的 chunk sha。 */
export function quoteSliceSha256(fileContent: string, quote: KnowledgeEvidenceReceiptRow["quote"]): string {
  const normalized = normalizeContentForQuoteSelector(fileContent);
  const slice = normalized.slice(quote.startOffset, quote.endOffset);
  return sha256(slice);
}

function rowToReceipt(row: Record<string, unknown>): KnowledgeEvidenceReceipt {
  return {
    receiptId: String(row.receipt_id),
    sessionId: String(row.session_id),
    runId: String(row.run_id),
    articleId: String(row.article_id),
    vaultId: String(row.vault_id),
    sourceEpoch: Number(row.source_epoch),
    sourceFingerprint: String(row.source_fingerprint),
    relativePath: String(row.relative_path),
    title: String(row.title),
    heading: row.heading === null || row.heading === undefined ? null : String(row.heading),
    fileSha256: String(row.file_sha256),
    chunkSha256: String(row.chunk_sha256),
    quote: {
      startLine: Number(row.start_line),
      endLine: Number(row.end_line),
      startOffset: Number(row.start_offset),
      endOffset: Number(row.end_offset),
    },
    excerpt: String(row.excerpt),
    createdAtMs: Number(row.created_at_ms),
  };
}

const RECEIPT_SELECT = `SELECT ${KNOWLEDGE_EVIDENCE_RECEIPT_COLUMNS.join(", ")} FROM evidence_receipts`;

export function loadReceiptById(
  db: KnowledgeDatabase,
  receiptId: string,
): KnowledgeEvidenceReceipt | null {
  const row = db.raw
    .prepare(`${RECEIPT_SELECT} WHERE receipt_id = ?`)
    .get(receiptId) as Record<string, unknown> | undefined;
  return row ? rowToReceipt(row) : null;
}

/**
 * 从 run 候选签发 receipt。创建时四重复验（run/候选 → 源身份 → 文件版本 → quote 切片），
 * 任一失败不签发（§5.1）。写账本走短事务，与索引写路径同一 db.transaction 收口。
 */
export async function prepareEvidenceFromRun(params: {
  db: KnowledgeDatabase;
  run: KnowledgeRunView | null;
  articleId: string;
  source: KnowledgeSourceResolution;
  readVaultFile: (relativePath: string) => Promise<VaultReadResult | null>;
  nowMs: number;
}): Promise<KnowledgePrepareEvidenceResult> {
  const { db, run, articleId, source, readVaultFile, nowMs } = params;
  if (!run) return { status: "forbidden", receipt: null };
  if (!run.source) return { status: "no_source", receipt: null };
  if (!source.configured || !source.summary || source.sourceEpoch === null) {
    return { status: "no_source", receipt: null };
  }
  if (
    source.summary.vaultId !== run.source.vaultId ||
    source.sourceEpoch !== run.source.sourceEpoch
  ) {
    return { status: "source_stale", receipt: null };
  }
  const candidate: KnowledgeArticleCandidate | undefined = run.candidates.find(
    (entry) => entry.articleId === articleId,
  );
  if (!candidate) return { status: "forbidden", receipt: null };

  const file = await readVaultFile(candidate.relativePath);
  if (!file) return { status: "missing", receipt: null };
  if (file.sha256 !== candidate.fileSha256) return { status: "stale", receipt: null };
  if (quoteSliceSha256(file.content, candidate.quote) !== candidate.chunkSha256) {
    return { status: "stale", receipt: null };
  }

  const receiptId = `${KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX}${randomBytes(16).toString("hex")}`;
  const receipt: KnowledgeEvidenceReceipt = {
    receiptId,
    sessionId: run.sessionId ?? "",
    runId: run.runId,
    articleId: candidate.articleId,
    vaultId: source.summary.vaultId,
    sourceEpoch: source.sourceEpoch,
    sourceFingerprint: knowledgeSourceFingerprint(
      source.summary.vaultId,
      source.summary.configuredAt,
    ),
    relativePath: candidate.relativePath,
    title: candidate.title,
    heading: candidate.matchedHeading,
    fileSha256: candidate.fileSha256,
    chunkSha256: candidate.chunkSha256,
    quote: candidate.quote,
    excerpt: excerptOf(
      normalizeContentForQuoteSelector(file.content).slice(
        candidate.quote.startOffset,
        candidate.quote.endOffset,
      ),
    ),
    createdAtMs: nowMs,
  };
  db.transaction((tx) => {
    tx.raw
      .prepare(
        `INSERT INTO evidence_receipts(
           receipt_id, session_id, run_id, article_id, vault_id, source_epoch,
           source_fingerprint, relative_path, title, heading, file_sha256, chunk_sha256,
           start_line, end_line, start_offset, end_offset, excerpt, created_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.receiptId,
        receipt.sessionId,
        receipt.runId,
        receipt.articleId,
        receipt.vaultId,
        receipt.sourceEpoch,
        receipt.sourceFingerprint,
        receipt.relativePath,
        receipt.title,
        receipt.heading,
        receipt.fileSha256,
        receipt.chunkSha256,
        receipt.quote.startLine,
        receipt.quote.endLine,
        receipt.quote.startOffset,
        receipt.quote.endOffset,
        receipt.excerpt,
        receipt.createdAtMs,
      );
  });
  return { status: "current", receipt };
}

/**
 * 引用解析（§5.2 状态机）。逐层复验顺序固定：账本 → 会话绑定 → 源身份 → 文件 → quote。
 * 每层失败即刻返回，不泄露后续层信息（伪造 id 与越权 id 同样得到 forbidden）。
 */
export async function resolveCitationReceipt(params: {
  db: KnowledgeDatabase;
  receiptId: string;
  sessionId: string | null;
  source: KnowledgeSourceResolution;
  readVaultFile: (relativePath: string) => Promise<VaultReadResult | null>;
}): Promise<KnowledgeResolveCitationResult> {
  const { db, receiptId, sessionId, source, readVaultFile } = params;
  const receipt = loadReceiptById(db, receiptId);
  if (!receipt) {
    return { status: "forbidden", reason: KNOWLEDGE_EVIDENCE_REASONS.unknownReceipt, citation: null };
  }
  // 绑定了会话的 receipt 必须由同一会话解析（未携会话 = 不放行，A19 的保守面）；
  // run 未携带会话（receipt.sessionId=""）→ 不绑会话，跨会话可解析（仍受源/文件校验）。
  if (receipt.sessionId !== "" && sessionId !== receipt.sessionId) {
    return { status: "forbidden", reason: KNOWLEDGE_EVIDENCE_REASONS.crossSession, citation: null };
  }
  if (!source.configured || !source.summary || source.sourceEpoch === null) {
    return {
      status: "forbidden",
      reason: KNOWLEDGE_EVIDENCE_REASONS.sourceUnconfigured,
      citation: null,
    };
  }
  if (source.summary.vaultId !== receipt.vaultId) {
    return {
      status: "forbidden",
      reason: KNOWLEDGE_EVIDENCE_REASONS.vaultSwitched,
      citation: null,
    };
  }
  if (receipt.sourceFingerprint !== knowledgeSourceFingerprint(
    source.summary.vaultId,
    source.summary.configuredAt,
  )) {
    return {
      status: "stale",
      reason: KNOWLEDGE_EVIDENCE_REASONS.sourceReauthorized,
      citation: null,
    };
  }
  const file = await readVaultFile(receipt.relativePath);
  if (!file) {
    return { status: "missing", reason: KNOWLEDGE_EVIDENCE_REASONS.fileDeleted, citation: null };
  }
  if (file.sha256 !== receipt.fileSha256) {
    return { status: "stale", reason: KNOWLEDGE_EVIDENCE_REASONS.fileModified, citation: null };
  }
  if (quoteSliceSha256(file.content, receipt.quote) !== receipt.chunkSha256) {
    return { status: "stale", reason: KNOWLEDGE_EVIDENCE_REASONS.quoteMoved, citation: null };
  }
  return {
    status: "current",
    citation: {
      receiptId: receipt.receiptId,
      sessionId: receipt.sessionId,
      runId: receipt.runId,
      articleId: receipt.articleId,
      relativePath: receipt.relativePath,
      title: receipt.title,
      heading: receipt.heading,
      quote: receipt.quote,
      excerpt: receipt.excerpt,
      createdAtMs: receipt.createdAtMs,
    },
  };
}

/** 宿主侧统一的 vault 文件读取器：内容一律经安全门面（逐段 lstat + 2MB + sha256）。 */
export function createVaultFileReader(rootPath: string): {
  read: (relativePath: string) => Promise<VaultReadResult | null>;
} {
  const vault = createVaultFileSystem(rootPath);
  return {
    async read(relativePath) {
      try {
        return await vault.readFile(relativePath);
      } catch {
        // 文件消失/越界/超限都折叠为 null（missing 语义）；门面已拒绝的路径不可能变可信。
        return null;
      }
    },
  };
}
