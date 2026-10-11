/**
 * 索引协调者（W02 / spec §5b.3–5b.4）。
 *
 * 一个协调者实例 = 一个 Host 侧 writer（owner 随机生成）。任务执行模型：
 * 1. 抢租约（epoch+1 = fence）→ 心跳维持；
 * 2. 全量扫描（门面不变量 + 排除计数）→ 与 DB 对账；
 * 3. **每个文档一个短事务**：事务内先 verifyLeaseInsideTransaction（fence 校验），
 *    再落 document/chunks/FTS——迟到 writer 的提交在事务内被拒绝（W00 Spike3 纪律）；
 * 4. 租约丢失/取消时停止；源指纹变化由调用方（服务层）先 supersede 旧任务再重提；
 * 5. 结束时写 coverage + job 终态，释放租约。
 */
import { randomUUID } from "node:crypto";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { createVaultFileSystem } from "../../obsidian-vault/vault-fs.js";
import type { VaultConfig } from "../../obsidian-vault/config.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import {
  acquireIndexLease,
  heartbeatIndexLease,
  KNOWLEDGE_INDEX_LEASE_NAME,
  KnowledgeLeaseLostError,
  readIndexLease,
  releaseIndexLease,
  verifyLeaseInsideTransaction,
} from "../store/indexLease.js";
import {
  deleteDocumentInTransaction,
  getJob,
  getLatestJob,
  insertJobInTransaction,
  listDocuments,
  replaceDocumentInTransaction,
  saveCoverageInTransaction,
  updateJobInTransaction,
} from "../store/indexRepository.js";
import { chunkMarkdown } from "./markdownChunker.js";
import { scanVaultSource, type ScanExclusions } from "./sourceScanner.js";
import type {
  KnowledgeIndexJobKind,
  KnowledgeIndexJobStartResult,
  KnowledgeJobCancelResult,
  KnowledgeLeaseView,
} from "../knowledgeTypes.js";

export interface IndexCoordinatorOptions {
  /** 租约 TTL；死亡检测只能靠它过期（默认 10s，测试可收紧）。 */
  leaseTtlMs?: number;
  /** 心跳间隔（默认 3s）。 */
  heartbeatIntervalMs?: number;
}

interface ActiveJob {
  jobId: string;
  kind: KnowledgeIndexJobKind;
  generation: number;
  fence: number;
  sourceEpoch: number;
  vaultId: string;
  /** cancelJob 或 supersede 都会置位：循环在每个文档前检查，尽快停止。 */
  cancelled: boolean;
  /** supersede（源切换）置位：终态写 superseded 而不是 cancelled。 */
  superseded: boolean;
}

export class IndexCoordinator {
  private readonly logger = createServiceLogger("knowledge-index");
  private readonly leaseTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly owner = `host-${randomUUID()}`;
  private activeJob: ActiveJob | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private generation = 0;

  constructor(
    private readonly db: KnowledgeDatabase,
    options: IndexCoordinatorOptions = {},
  ) {
    this.leaseTtlMs = options.leaseTtlMs ?? 10_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 3_000;
  }

  get ownerIdentity(): string {
    return this.owner;
  }

  /** 进行中任务的 RPC 视图（无任务时 null）。 */
  getActiveJobView(): KnowledgeIndexJobStartResult | null {
    const job = this.activeJob;
    if (!job) return null;
    return {
      jobId: job.jobId,
      kind: job.kind,
      generation: job.generation,
      fence: job.fence,
      sourceEpoch: job.sourceEpoch,
      alreadyRunning: true,
    };
  }

  getLeaseView(): KnowledgeLeaseView {
    const lease = readIndexLease(this.db, KNOWLEDGE_INDEX_LEASE_NAME);
    return {
      heldBySelf: lease.owner === this.owner && lease.epoch > 0,
      owner: lease.owner,
      fence: lease.epoch,
      expiresAtMs: lease.expiresAtMs > 0 ? lease.expiresAtMs : null,
    };
  }

  getLatestJobView(): ReturnType<typeof getLatestJob> {
    return getLatestJob(this.db);
  }

  /** 进行中任务优先的最近任务视图（getStatus 的 job 字段）。 */
  getActiveOrLatestJobView(): ReturnType<typeof getJob> {
    const active = this.activeJob;
    if (active) return getJob(this.db, active.jobId);
    return getLatestJob(this.db);
  }

  /** 提交任务：已有同 epoch 任务在跑 → 幂等返回既有任务；epoch 已变 → 旧任务作废重提。 */
  startJob(params: {
    kind: KnowledgeIndexJobKind;
    config: VaultConfig;
    vaultId: string;
    sourceEpoch: number;
    nowMs: number;
  }): KnowledgeIndexJobStartResult {
    const active = this.activeJob;
    if (active && active.sourceEpoch === params.sourceEpoch) {
      return {
        jobId: active.jobId,
        kind: active.kind,
        generation: active.generation,
        fence: active.fence,
        sourceEpoch: active.sourceEpoch,
        alreadyRunning: true,
      };
    }
    if (active) {
      // 源已切换：旧任务标记 superseded（spec §5b.2：sourceEpoch 变化使旧 Index Job 失效）。
      // cancelled 一并置位：runJob 的逐文档循环据此尽快停止，不再为旧 epoch 写入。
      active.cancelled = true;
      active.superseded = true;
      this.db.transaction((tx) =>
        updateJobInTransaction(tx, active.jobId, {
          status: "superseded",
          finishedAtMs: params.nowMs,
          reason: "source_epoch_changed",
        }),
      );
      this.activeJob = null;
      this.stopHeartbeat();
    }

    const acquire = acquireIndexLease(
      this.db,
      KNOWLEDGE_INDEX_LEASE_NAME,
      this.owner,
      this.leaseTtlMs,
      params.nowMs,
    );
    if (!acquire.acquired) {
      throw new Error("knowledge 索引租约被其他 Host 持有，稍后重试");
    }

    const generation = ++this.generation;
    const jobId = `job-${randomUUID()}`;
    this.db.transaction((tx) =>
      insertJobInTransaction(tx, {
        id: jobId,
        vaultId: params.vaultId,
        sourceEpoch: params.sourceEpoch,
        kind: params.kind,
        generation,
        fence: acquire.fence,
        nowMs: params.nowMs,
      }),
    );
    const job: ActiveJob = {
      jobId,
      kind: params.kind,
      generation,
      fence: acquire.fence,
      sourceEpoch: params.sourceEpoch,
      vaultId: params.vaultId,
      cancelled: false,
      superseded: false,
    };
    this.activeJob = job;
    this.startHeartbeat();
    // 任务异步执行：RPC 立即返回 job 句柄，getStatus/cancelJob 轮询推进。
    void this.runJob(job, params.config, params.sourceEpoch).catch((error) => {
      this.logger.error("索引任务异常终止", { jobId });
      this.activeJob = null;
      this.stopHeartbeat();
      try {
        this.db.transaction((tx) =>
          updateJobInTransaction(tx, jobId, {
            status: "failed",
            finishedAtMs: Date.now(),
            reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
          }),
        );
      } catch {
        // DB 已不可用时保留日志即可。
      }
    });
    return {
      jobId,
      kind: params.kind,
      generation,
      fence: acquire.fence,
      sourceEpoch: params.sourceEpoch,
      alreadyRunning: false,
    };
  }

  cancelJob(jobId: string, nowMs: number): KnowledgeJobCancelResult {
    const job = this.activeJob;
    if (!job || job.jobId !== jobId) {
      const existing = getJob(this.db, jobId);
      return { cancelled: false, status: existing?.status ?? "not_found" };
    }
    job.cancelled = true;
    this.db.transaction((tx) =>
      updateJobInTransaction(tx, jobId, {
        status: "cancelled",
        finishedAtMs: nowMs,
        reason: "cancelled_by_caller",
      }),
    );
    return { cancelled: true, status: "cancelled" };
  }

  /** 供测试/上层观察；生产代码不轮询内部字段。 */
  get runningJobId(): string | null {
    return this.activeJob?.jobId ?? null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const job = this.activeJob;
      if (!job) return;
      try {
        const alive = heartbeatIndexLease(
          this.db,
          KNOWLEDGE_INDEX_LEASE_NAME,
          this.owner,
          job.fence,
          this.leaseTtlMs,
          Date.now(),
        );
        if (!alive) {
          // 租约被接管：当前任务立即降级停止，等待调用方重新提交。
          this.logger.warn("索引租约丢失，任务停止", { jobId: job.jobId });
          this.db.transaction((tx) =>
            updateJobInTransaction(tx, job.jobId, {
              status: "failed",
              finishedAtMs: Date.now(),
              reason: "lease_lost",
            }),
          );
          this.activeJob = null;
          this.stopHeartbeat();
        }
      } catch {
        // 心跳竞争失败由下个 tick 或任务内 fence 校验兜底。
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** 任务主体：扫描 → 对账 → 逐文档短事务（fence 校验）→ coverage/终态。 */
  private async runJob(job: ActiveJob, config: VaultConfig, sourceEpoch: number): Promise<void> {
    const startedMs = Date.now();
    try {
      if (job.kind === "rebuild") {
        // 重建：逐文档短事务清空当前 epoch（缓存可重建），随后与 reconcile 同一扫描路径。
        for (const doc of listDocuments(this.db, job.vaultId, sourceEpoch)) {
          if (job.cancelled) break;
          try {
            this.db.transaction((tx) => {
              verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, this.owner, job.fence, Date.now());
              deleteDocumentInTransaction(tx, job.vaultId, sourceEpoch, doc.relativePath);
            });
          } catch (error) {
            if (error instanceof KnowledgeLeaseLostError) throw error;
            throw error;
          }
        }
      }

      const vault = createVaultFileSystem(config.rootPath);
      const scan = await scanVaultSource(config.rootPath);
      const indexed = listDocuments(this.db, job.vaultId, sourceEpoch);
      const byPath = new Map(indexed.map((doc) => [doc.relativePath, doc]));
      let indexedFiles = 0;
      let indexedChunks = 0;
      let truncatedFiles = 0;
      let leaseLost = false;

      for (const candidate of scan.files) {
        if (job.cancelled || leaseLost) break;
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
        try {
          this.db.transaction((tx) => {
            verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, this.owner, job.fence, Date.now());
            replaceDocumentInTransaction(tx, {
              vaultId: job.vaultId,
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
        if (job.cancelled || leaseLost) break;
        if (scanned.has(doc.relativePath)) continue;
        try {
          this.db.transaction((tx) => {
            verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, this.owner, job.fence, Date.now());
            deleteDocumentInTransaction(tx, job.vaultId, sourceEpoch, doc.relativePath);
          });
        } catch (error) {
          if (error instanceof KnowledgeLeaseLostError) {
            leaseLost = true;
            break;
          }
          throw error;
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
      this.db.transaction((tx) => {
        verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, this.owner, job.fence, finishedMs);
        saveCoverageInTransaction(tx, job.vaultId, sourceEpoch, counters, indexedFiles, indexedChunks, finishedMs);
        updateJobInTransaction(
          tx,
          job.jobId,
          job.superseded
            ? {
                status: "superseded",
                finishedAtMs: finishedMs,
                reason: "source_epoch_changed",
                indexedFiles,
                indexedChunks,
              }
            : job.cancelled
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
    } finally {
      if (this.activeJob?.jobId === job.jobId) {
        this.activeJob = null;
        this.stopHeartbeat();
        try {
          releaseIndexLease(this.db, KNOWLEDGE_INDEX_LEASE_NAME, this.owner, job.fence);
        } catch {
          // 释放失败只影响下次抢租约时序（TTL 过期兜底），不影响任务结果。
        }
      }
      this.logger.info("索引任务结束", {
        jobId: job.jobId,
        kind: job.kind,
        durationMs: Date.now() - startedMs,
      });
    }
  }
}
