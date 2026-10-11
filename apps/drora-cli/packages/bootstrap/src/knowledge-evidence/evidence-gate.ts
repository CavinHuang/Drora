/**
 * Evidence gate（W03 / specs/obsidian-knowledge.md §5.3）。
 *
 * CLI Runtime 侧的执行时复验：sendText admission 前、sendQueuedNow 提升前对输入携带的
 * evidenceRefs 逐条复验「服务端签发的 receipt 仍然指向当前世界」——
 *   账本存在 → 会话绑定 → vault-config 授权与源指纹 → 文件存在与 sha256 → quote 切片 sha256。
 * 任一失败返回结构化拒绝（guard.evidence*），**绝不静默降级为 current**；gate 自身不可用
 * （配置/DB 读取失败）按 fail-closed 拒绝。
 *
 * 数据面（只读，零出站）：vault-config.json（唯一配置事实源）+ knowledge-index.sqlite
 * （宿主写入的 receipt 账本，只读连接）+ 当前 Vault 文件内容。没有模型与网络调用。
 */
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  KNOWLEDGE_EVIDENCE_GUARDS,
  KNOWLEDGE_EVIDENCE_RECEIPT_COLUMNS,
  KNOWLEDGE_EVIDENCE_REASONS,
  KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX,
  knowledgeSourceFingerprint,
  normalizeContentForQuoteSelector,
  type KnowledgeEvidenceGuard,
  type KnowledgeEvidenceReason,
} from "@drora/shared";
import {
  isSafeRegularFileWithinRoot,
  loadGateVaultConfig,
  resolveObsidianPluginDataDirForGate,
} from "./vault-config-reader.js";

/** 单文件读取上限（与面板门面 MAX_VAULT_FILE_BYTES 同值；超限按不可读拒绝）。 */
const MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;

export interface KnowledgeEvidenceRefInput {
  receiptId: string;
}

/** gate 复验结果：ok=false 时 guard 是发给 ACK 的 reasonCode，reason 是结构化原因。 */
export type EvidenceGateVerdict =
  | { ok: true }
  | { ok: false; guard: KnowledgeEvidenceGuard; reason: KnowledgeEvidenceReason | "gate_unavailable" };

export interface EvidenceGatePort {
  verify(input: {
    sessionId: string;
    evidenceRefs: readonly KnowledgeEvidenceRefInput[];
  }): Promise<EvidenceGateVerdict>;
  /** 关闭只读连接（测试/进程收尾用；Windows 上未关闭的句柄会锁住 DB 文件）。 */
  close(): void;
}

interface ReceiptRow {
  receipt_id: string;
  session_id: string;
  vault_id: string;
  source_fingerprint: string;
  relative_path: string;
  file_sha256: string;
  chunk_sha256: string;
  start_offset: number;
  end_offset: number;
}

export interface EvidenceGateOptions {
  /** 覆盖插件数据目录（测试注入）；缺省按 DRORA_DATA_BASE_DIR||HOME 推导。 */
  pluginDataDir?: string;
  /** 覆盖账本 DB 路径（测试注入）；缺省 = <dataRoot>/knowledge/knowledge-index.sqlite。 */
  databasePath?: string;
}

export function resolveKnowledgeDatabasePathForGate(env: NodeJS.ProcessEnv = process.env): string {
  const dataBaseDir = env.DRORA_DATA_BASE_DIR?.trim() || env.HOME?.trim() || homedir();
  return join(dataBaseDir, ".drora", "knowledge", "knowledge-index.sqlite");
}

/**
 * 生产 gate。DB 连接惰性打开（宿主可能从未建库——此时任何 receipt 都不可信），
 * vault-config 每次复验都重读（与 hooks/面板同式，撤权即时生效）。
 */
export function createKnowledgeEvidenceGate(options: EvidenceGateOptions = {}): EvidenceGatePort {
  const pluginDataDir = options.pluginDataDir ?? resolveObsidianPluginDataDirForGate();
  const databasePath = options.databasePath ?? resolveKnowledgeDatabasePathForGate();
  let db: DatabaseSync | null = null;
  let dbFailed = false;

  function openLedger(): DatabaseSync | "missing" | "failed" {
    if (db) return db;
    if (dbFailed) return "failed";
    if (!existsSync(databasePath)) return "missing";
    try {
      const connection = new DatabaseSync(databasePath, { readOnly: true });
      // 账本尚未迁移到 v2（旧宿主库）→ evidence_receipts 不存在 = 空 ledger（全部 unknown），
      // 与「无 DB 文件」同语义；绝不在这里建表（只读连接）。
      const table = connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'evidence_receipts'",
        )
        .get() as { name?: string } | undefined;
      if (!table?.name) {
        connection.close();
        dbFailed = false;
        return "missing";
      }
      db = connection;
      return db;
    } catch {
      dbFailed = true;
      return "failed";
    }
  }

  function loadReceipt(receiptId: string): ReceiptRow | "unknown" | "failed" {
    const opened = openLedger();
    if (opened === "missing") return "unknown";
    if (opened === "failed") return "failed";
    try {
      const row = opened
        .prepare(`SELECT ${KNOWLEDGE_EVIDENCE_RECEIPT_COLUMNS.join(", ")} FROM evidence_receipts WHERE receipt_id = ?`)
        .get(receiptId) as Record<string, unknown> | undefined;
      if (!row) return "unknown";
      return {
        receipt_id: String(row.receipt_id),
        session_id: String(row.session_id),
        vault_id: String(row.vault_id),
        source_fingerprint: String(row.source_fingerprint),
        relative_path: String(row.relative_path),
        file_sha256: String(row.file_sha256),
        chunk_sha256: String(row.chunk_sha256),
        start_offset: Number(row.start_offset),
        end_offset: Number(row.end_offset),
      };
    } catch {
      return "failed";
    }
  }

  return {
    async verify({ sessionId, evidenceRefs }) {
      if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) return { ok: true };
      const config = await loadGateVaultConfig(pluginDataDir);
      if (!config) return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.forbidden, reason: KNOWLEDGE_EVIDENCE_REASONS.sourceUnconfigured };
      for (const ref of evidenceRefs) {
        const verdict = await verifyOne(config, sessionId, ref);
        if (!verdict.ok) return verdict;
      }
      return { ok: true };
    },
    close(): void {
      if (db) {
        try {
          db.close();
        } catch {
          // 重复 close / 已损坏连接：收尾路径不抛。
        }
        db = null;
        dbFailed = false;
      }
    },
  };

  async function verifyOne(
    config: { rootPath: string; configuredAt: number },
    sessionId: string,
    ref: KnowledgeEvidenceRefInput,
  ): Promise<EvidenceGateVerdict> {
    if (
      !ref ||
      typeof ref.receiptId !== "string" ||
      !ref.receiptId.startsWith(KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX)
    ) {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.unknown, reason: KNOWLEDGE_EVIDENCE_REASONS.unknownReceipt };
    }
    const receipt = loadReceipt(ref.receiptId);
    if (receipt === "failed") {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.unavailable, reason: "gate_unavailable" };
    }
    if (receipt === "unknown") {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.unknown, reason: KNOWLEDGE_EVIDENCE_REASONS.unknownReceipt };
    }
    if (receipt.session_id !== "" && sessionId !== receipt.session_id) {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.forbidden, reason: KNOWLEDGE_EVIDENCE_REASONS.crossSession };
    }
    // vaultId 口径与 services vaultId 同式：sha256(realpath 根)。这里 config.rootPath 已经
    // 是 realpath 结果（loadGateVaultConfig），直接哈希。
    const currentVaultId = sha256(config.rootPath);
    if (receipt.vault_id !== currentVaultId) {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.forbidden, reason: KNOWLEDGE_EVIDENCE_REASONS.vaultSwitched };
    }
    if (receipt.source_fingerprint !== knowledgeSourceFingerprint(currentVaultId, config.configuredAt)) {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.stale, reason: KNOWLEDGE_EVIDENCE_REASONS.sourceReauthorized };
    }
    const file = await readVaultFileSafely(config.rootPath, receipt.relative_path);
    if (file === "missing") {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.missing, reason: KNOWLEDGE_EVIDENCE_REASONS.fileDeleted };
    }
    if (file === "failed") {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.unavailable, reason: "gate_unavailable" };
    }
    if (sha256(file) !== receipt.file_sha256) {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.stale, reason: KNOWLEDGE_EVIDENCE_REASONS.fileModified };
    }
    const slice = normalizeContentForQuoteSelector(file).slice(receipt.start_offset, receipt.end_offset);
    if (sha256(slice) !== receipt.chunk_sha256) {
      return { ok: false, guard: KNOWLEDGE_EVIDENCE_GUARDS.stale, reason: KNOWLEDGE_EVIDENCE_REASONS.quoteMoved };
    }
    return { ok: true };
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** 门面同式安全读取：逐段 lstat 拒软链 + 2MB 上限；missing/failed 二值化，不给部分真相。 */
async function readVaultFileSafely(
  rootPath: string,
  relativePath: string,
): Promise<string | "missing" | "failed"> {
  if (!(await isSafeRegularFileWithinRoot(rootPath, relativePath))) return "missing";
  try {
    const stats = await lstat(join(rootPath, relativePath));
    if (!stats.isFile() || stats.size > MAX_EVIDENCE_FILE_BYTES) return "missing";
    return await readFile(join(rootPath, relativePath), "utf-8");
  } catch {
    return "failed";
  }
}
