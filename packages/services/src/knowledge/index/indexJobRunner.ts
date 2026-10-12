/**
 * 索引任务执行主体（W02 / spec §5b.3–5b.4、§5b.9；从 IndexCoordinator 拆出收口
 * max-lines 门禁）：扫描 → 对账 → 逐文档短事务（fence 校验）→ 向量回填 → coverage/终态。
 *
 * 生命周期（抢租约/心跳/释放/activeJob 记账）留在 IndexCoordinator；本模块只做
 * 「一个已持租约任务的执行」。embed-before-tx 与向量回填同在此处（spec §5b.9）。
 */
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { createVaultFileSystem } from "../../obsidian-vault/vault-fs.js";
import type { VaultConfig } from "../../obsidian-vault/config.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import {
  KNOWLEDGE_INDEX_LEASE_NAME,
  KnowledgeLeaseLostError,
  verifyLeaseInsideTransaction,
} from "../store/indexLease.js";
import {
  deleteDocumentInTransaction,
  listDocuments,
  replaceDocumentInTransaction,
  saveCoverageInTransaction,
  updateJobInTransaction,
} from "../store/indexRepository.js";
import {
  countMissingVectors,
  insertVectorsInTransaction,
  loadChunksMissingVectors,
} from "../store/vectorRepository.js";
import { chunkMarkdown } from "./markdownChunker.js";
import { scanVaultSource, type ScanExclusions } from "./sourceScanner.js";
import type { KnowledgeSemanticContext } from "../search/embeddingPort.js";
import { composeEmbeddingText } from "../search/embeddingInput.js";

/** 执行上下文：协调器注入的已持租约任务事实与依赖（fence/取消位由协调器记账）。 */
export interface IndexJobExecutionContext {
  db: KnowledgeDatabase;
  semantic: KnowledgeSemanticContext;
  owner: string;
  jobId: string;
  kind: "reconcile" | "rebuild";
  fence: number;
  vaultId: string;
  sourceEpoch: number;
  /** supersede（源切换）置位：终态写 superseded 而不是 cancelled。 */
  superseded: boolean;
  /** 取消位：循环在每个文档前检查，尽快停止。 */
  isCancelled(): boolean;
}

const logger = createServiceLogger("knowledge-index");

  async function backfillVectors(ctx: IndexJobExecutionContext, sourceEpoch: number): Promise<void> {
    const port = ctx.semantic.port;
    if (!port) return;
    const total = countMissingVectors(ctx.db, { vaultId: ctx.vaultId, sourceEpoch }, port.id);
    if (total === 0) return;
    logger.info("向量回填开始", { jobId: ctx.jobId, missing: total, modelId: port.id });
    const BATCH = 32;
    let lastId = 0;
    let written = 0;
    for (;;) {
      if (ctx.isCancelled()) return;
      const batch = loadChunksMissingVectors(
        ctx.db,
        { vaultId: ctx.vaultId, sourceEpoch },
        port.id,
        BATCH,
        lastId,
      );
      if (batch.length === 0) break;
      const values = await port.embed(batch.map((row) => row.body));
      if (!values || values.length !== batch.length) return;
      ctx.db.transaction((tx) => {
        verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, ctx.owner, ctx.fence, Date.now());
        insertVectorsInTransaction(
          tx,
          port.id,
          batch.map((row, index) => ({
            chunkId: row.id,
            vector: values[index] ?? [],
          })),
        );
      });
      written += batch.length;
      lastId = batch[batch.length - 1]?.id ?? lastId;
    }
    logger.info("向量回填完成", { jobId: ctx.jobId, written, modelId: port.id });
  }

export async function executeIndexJob(ctx: IndexJobExecutionContext, config: VaultConfig, sourceEpoch: number): Promise<void> {
    if (ctx.kind === "rebuild") {
      // 重建：逐文档短事务清空当前 epoch（缓存可重建），随后与 reconcile 同一扫描路径。
      for (const doc of listDocuments(ctx.db, ctx.vaultId, sourceEpoch)) {
        if (ctx.isCancelled()) break;
        try {
          ctx.db.transaction((tx) => {
            verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, ctx.owner, ctx.fence, Date.now());
            deleteDocumentInTransaction(tx, ctx.vaultId, sourceEpoch, doc.relativePath);
          });
        } catch (error) {
          if (error instanceof KnowledgeLeaseLostError) throw error;
          throw error;
        }
      }
    }

    const vault = createVaultFileSystem(config.rootPath);
    const scan = await scanVaultSource(config.rootPath);
    const indexed = listDocuments(ctx.db, ctx.vaultId, sourceEpoch);
    const byPath = new Map(indexed.map((doc) => [doc.relativePath, doc]));
    let indexedFiles = 0;
    let indexedChunks = 0;
    let truncatedFiles = 0;
    let leaseLost = false;

    for (const candidate of scan.files) {
      if (ctx.isCancelled() || leaseLost) break;
      const existing = byPath.get(candidate.relativePath);
      if (existing && existing.mtimeMs === candidate.mtimeMs && existing.sizeBytes === candidate.size) {
        indexedFiles += 1;
        indexedChunks += existing.chunkCount;
        continue; // 未变化：跳过读取（reconcile 增量语义）。
      }
      // 内容一律过安全门面（逐段 lstat + 2MB 上限 + sha256 同面板）。
      const content = await vault.readFile(candidate.relativePath);
      if (existing && existing.sha256 === content.sha256) {
        // 内容未变（仅 mtime 抖动）：跳过重切。
        indexedFiles += 1;
        indexedChunks += existing.chunkCount;
        continue;
      }
      const name = candidate.name.replace(/\.md$/i, "");
      const chunked = chunkMarkdown(content.content, name);
      // embed-before-tx（spec §5b.9）：嵌入是慢的纯计算，放在事务**外**逐文档批量完成；
      // 向量行与 chunks 行同事务提交，一致性不靠事后修补。嵌入失败 = 本文档无向量
      // （诚实降级，任务尾部回填阶段/下次变更补齐），绝不阻塞索引。
      let vectors: { modelId: string; values: number[][] } | undefined;
      const embeddingPort = ctx.semantic.port;
      if (embeddingPort && chunked.chunks.length > 0) {
        try {
          // 嵌入输入 = 标题 + 标题路径 + 净化正文（spec §5b.9 准确性保障）。
          const values = await embeddingPort.embed(
            chunked.chunks.map((chunk) =>
              composeEmbeddingText({
                title: chunked.title,
                headingPath: chunk.headingPath,
                body: chunk.text,
              }),
            ),
          );
          if (values && values.length === chunked.chunks.length) {
            vectors = { modelId: embeddingPort.id, values };
          }
        } catch (error) {
          logger.warn("文档嵌入失败（本文档无向量，索引照常）", {
            jobId: ctx.jobId,
            relativePath: content.relativePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      try {
        ctx.db.transaction((tx) => {
          verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, ctx.owner, ctx.fence, Date.now());
          // 向量与 chunks 同事务落库（spec §5b.9 embed-before-tx 的写侧）。
          const chunkIds = replaceDocumentInTransaction(tx, {
            vaultId: ctx.vaultId,
            sourceEpoch,
            relativePath: content.relativePath,
            title: chunked.title,
            sha256: content.sha256,
            sizeBytes: candidate.size,
            mtimeMs: candidate.mtimeMs,
            chunks: chunked.chunks,
            truncated: chunked.truncated,
            indexedAtMs: Date.now(),
          });
          if (vectors !== undefined) {
            insertVectorsInTransaction(
              tx,
              vectors.modelId,
              chunkIds.map((chunkId, index) => ({ chunkId, vector: vectors.values[index] ?? [] })),
            );
          }
        });
      } catch (error) {
        if (error instanceof KnowledgeLeaseLostError) {
          leaseLost = true;
          break;
        }
        throw error;
      }
      indexedFiles += 1;
      indexedChunks += chunked.chunks.length;
      if (chunked.truncated) truncatedFiles += 1;
    }

    // 删除已消失的文档（含重命名旧路径；重命名 = 旧路径删除 + 新路径新增）。
    const scanned = new Set(scan.files.map((file) => file.relativePath));
    for (const doc of indexed) {
      if (ctx.isCancelled() || leaseLost) break;
      if (scanned.has(doc.relativePath)) continue;
      try {
        ctx.db.transaction((tx) => {
          verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, ctx.owner, ctx.fence, Date.now());
          deleteDocumentInTransaction(tx, ctx.vaultId, sourceEpoch, doc.relativePath);
        });
      } catch (error) {
        if (error instanceof KnowledgeLeaseLostError) {
          leaseLost = true;
          break;
        }
        throw error;
      }
    }

    // 向量回填（spec §5b.9）：存量索引/历史失败留下的缺向量 chunk 分批补齐——
    // 启用语义检索后的首次任务为分钟级 CPU 时间，job 异步不阻塞 UI；批间校验
    // fence 与取消位，租约丢失即让位。
    if (!ctx.isCancelled() && !leaseLost && ctx.semantic.port !== null) {
      try {
        await backfillVectors(ctx, sourceEpoch);
      } catch (error) {
        if (error instanceof KnowledgeLeaseLostError) {
          leaseLost = true;
        } else {
          logger.warn("向量回填中止（不影响本次索引结果）", {
            jobId: ctx.jobId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const finishedMs = Date.now();
    if (leaseLost) {
      // 租约已失：终态由心跳/异常路径负责；不写 coverage（新 writer 会重建）。
      return;
    }
    const counters: ScanExclusions & { truncatedFiles: number } = {
      ...scan.exclusions,
      truncatedFiles,
    };
    ctx.db.transaction((tx) => {
      verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, ctx.owner, ctx.fence, finishedMs);
      saveCoverageInTransaction(tx, ctx.vaultId, sourceEpoch, counters, indexedFiles, indexedChunks, finishedMs);
      updateJobInTransaction(
        tx,
        ctx.jobId,
        ctx.superseded
          ? {
              status: "superseded",
              finishedAtMs: finishedMs,
              reason: "source_epoch_changed",
              indexedFiles,
              indexedChunks,
            }
          : ctx.isCancelled()
            ? {
                status: "cancelled",
                finishedAtMs: finishedMs,
                reason: "cancelled_by_caller",
                indexedFiles,
                indexedChunks,
              }
            : {
                status: "completed",
                finishedAtMs: finishedMs,
                reason: null,
                indexedFiles,
                indexedChunks,
              },
      );
    });
}
