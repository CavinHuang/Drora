/**
 * SourceRegistry（W02 / spec §5b.2）。
 *
 * 唯一事实源链：`vault-config.json`（obsidian-vault 门面读写的那一份）+ Profile 数据根。
 * 本模块不复制任何 Vault 配置字段，每次解析都重新 loadVaultConfig：
 * - 未配置 / 根失效 → 无源（configured=false）；
 * - 源指纹 = vaultId(realpath 根 sha256) + configuredAt；
 * - 指纹相对 DB 记录变化 → sourceEpoch+1，并清除旧 epoch 的缓存行
 *   （documents/chunks/chunks_fts/index_jobs/coverage；W06 起审核账本
 *   review_proposals/review_approvals/review_operations/review_operation_files 与
 *   evidence_receipts 同库共存，但**不在本清除路径上**——账本是持久事实，索引可重建）。
 * allowAgentWrites 翻转不换 epoch：它门控写入，不改变读取范围（读不受限是既有语义）。
 */
import { join } from "node:path";
import {
  loadVaultConfig,
  vaultSummary,
  type VaultConfig,
  type VaultSummary,
} from "../../obsidian-vault/config.js";
import { getDroraDataRootDir } from "../../paths.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";

export interface KnowledgeSourceResolution {
  configured: boolean;
  config: VaultConfig | null;
  summary: VaultSummary | null;
  /** 与 DB 对账后的当前 epoch；无源时为 null。 */
  sourceEpoch: number | null;
  /** 本次解析是否触发了 epoch 递增（旧 Query/Job 失效）。 */
  epochBumped: boolean;
}

interface SourceRow {
  fingerprint: string;
  current_epoch: number;
}

function sourceFingerprint(vaultId: string, configuredAt: number): string {
  return `${vaultId}:${configuredAt}`;
}

/** Profile 维度的知识索引库路径：<数据根>/.drora/knowledge/knowledge-index.sqlite。 */
export function resolveKnowledgeDatabasePath(): string {
  return join(getDroraDataRootDir(), "knowledge", "knowledge-index.sqlite");
}

/**
 * 解析当前源并与 DB 对账 epoch。每次 RPC（索引/检索）入口调用：
 * 切库、撤权后重新授权在这里显式失效旧身份。
 */
export async function resolveKnowledgeSource(
  db: KnowledgeDatabase,
  pluginDataDir: string,
  nowMs: number,
): Promise<KnowledgeSourceResolution> {
  // 与面板服务同一份 loadVaultConfig：坏 JSON/根失效回落到未配置（绝不带病索引）。
  const config = await loadVaultConfig(pluginDataDir);
  if (!config) {
    return { configured: false, config: null, summary: null, sourceEpoch: null, epochBumped: false };
  }
  const summary = vaultSummary(config);
  const fingerprint = sourceFingerprint(summary.vaultId, config.configuredAt);

  let epochBumped = false;
  const epoch = db.transaction((tx) => {
    const row = tx.raw.prepare("SELECT fingerprint, current_epoch FROM sources WHERE vault_id = ?").get(
      summary.vaultId,
    ) as SourceRow | undefined;
    if (row && row.fingerprint === fingerprint) {
      // 同一授权继续使用：仍清理其他 vault/epoch 的残留缓存（单 Vault 配置模型）。
      pruneStaleSourceRows(tx, summary.vaultId, row.current_epoch);
      return row.current_epoch;
    }
    const nextEpoch = (row?.current_epoch ?? 0) + 1;
    tx.raw
      .prepare(
        `INSERT INTO sources(vault_id, display_name, fingerprint, current_epoch, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(vault_id) DO UPDATE SET display_name=excluded.display_name,
           fingerprint=excluded.fingerprint, current_epoch=excluded.current_epoch,
           updated_at_ms=excluded.updated_at_ms`,
      )
      .run(summary.vaultId, summary.displayName, fingerprint, nextEpoch, nowMs);
    epochBumped = row !== undefined;
    // 旧 epoch 缓存整体失效：索引可重建，逐表清除（不触及本库之外任何账本）。
    pruneStaleSourceRows(tx, summary.vaultId, nextEpoch);
    return nextEpoch;
  });

  return {
    configured: true,
    config,
    summary,
    sourceEpoch: epoch,
    epochBumped,
  };
}

/**
 * 只保留 (keepVaultId, keepEpoch) 的缓存行：单 Vault 配置模型下，切库后旧 vault 的
 * documents/chunks/jobs/coverage 一律失效清除（索引可重建）。**绝不触及**审核账本
 * review_* 四表与 evidence_receipts——它们是持久事实（W06/spec §5e.2）。
 */
function pruneStaleSourceRows(tx: KnowledgeDatabase, keepVaultId: string, keepEpoch: number): void {
  tx.raw
    .prepare(
      `DELETE FROM chunks_fts WHERE rowid IN (
         SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE NOT (d.vault_id = ? AND d.source_epoch = ?)
       )`,
    )
    .run(keepVaultId, keepEpoch);
  tx.raw
    .prepare(`DELETE FROM documents WHERE NOT (vault_id = ? AND source_epoch = ?)`)
    .run(keepVaultId, keepEpoch);
  tx.raw
    .prepare(`DELETE FROM index_jobs WHERE NOT (vault_id = ? AND source_epoch = ?)`)
    .run(keepVaultId, keepEpoch);
  tx.raw
    .prepare(`DELETE FROM coverage WHERE NOT (vault_id = ? AND source_epoch = ?)`)
    .run(keepVaultId, keepEpoch);
}
