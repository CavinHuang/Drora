/**
 * Query 编排（W02 / spec §5b.6）。
 *
 * - createRun 绑定当前 sourceEpoch；无源 → no_source run（结构化，不抛业务错）；
 * - search 完成时重验 epoch：已变 → source_stale 并丢弃候选（旧 Query 失效）；
 * - runGeneration 单调递增：cancelRun 提升代数，in-flight 结果按代数丢弃，
 *   onRunUpdated 事件携带 runGeneration+seq，迟到消息不得覆盖新状态（W04 UI 契约）；
 * - clientRequestId 幂等：重复 createRun 返回同一 run。
 */
import { randomUUID } from "node:crypto";
import { Emitter, type Event } from "@drora/rpc";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { loadCoverage } from "../store/indexRepository.js";
import { resolveKnowledgeSource, type KnowledgeSourceResolution } from "../source/sourceRegistry.js";
import { searchKnowledgeLexical } from "../search/lexicalRetriever.js";
import type { KnowledgeSemanticContext } from "../search/embeddingPort.js";
import type {
  KnowledgeCoverage,
  KnowledgeRunUpdatedEvent,
  KnowledgeRunView,
} from "../knowledgeTypes.js";
import type { KnowledgeCreateRunParams } from "../knowledgeQuery.js";

const MAX_QUERY_CHARS = 512;

interface RunRecord {
  runId: string;
  runGeneration: number;
  clientRequestId: string;
  sessionId: string | null;
  query: string;
  sourceRef: { vaultId: string; sourceEpoch: number } | null;
  view: KnowledgeRunView;
  seq: number;
}

export class QueryOrchestrator {
  private readonly logger = createServiceLogger("knowledge-query");
  private readonly runs = new Map<string, RunRecord>();
  private readonly runsByClientRequestId = new Map<string, string>();
  private generation = 0;
  private readonly runUpdated = new Emitter<KnowledgeRunUpdatedEvent>();

  constructor(
    private readonly db: KnowledgeDatabase,
    private readonly semantic: KnowledgeSemanticContext,
    private readonly pluginDataDir: string,
  ) {}

  get onRunUpdated(): Event<KnowledgeRunUpdatedEvent> {
    return this.runUpdated.event;
  }

  dispose(): void {
    for (const record of this.runs.values()) {
      if (record.view.status === "retrieving") {
        record.view = { ...record.view, status: "cancelled", finishedAtMs: Date.now() };
      }
    }
    this.runs.clear();
    this.runsByClientRequestId.clear();
    this.runUpdated.dispose();
  }

  async createRun(params: KnowledgeCreateRunParams): Promise<KnowledgeRunView> {
    const query = typeof params.query === "string" ? params.query : "";
    if (!query.trim()) throw new Error("查询文本不能为空");
    if (query.length > MAX_QUERY_CHARS) throw new Error(`查询文本超过 ${MAX_QUERY_CHARS} 字符上限`);
    const clientRequestId = typeof params.clientRequestId === "string" ? params.clientRequestId.trim() : "";
    if (!clientRequestId) throw new Error("clientRequestId 不能为空");

    const existingRunId = this.runsByClientRequestId.get(clientRequestId);
    if (existingRunId) {
      const existing = this.runs.get(existingRunId);
      if (existing) return existing.view;
    }

    const source = await this.resolveSource();
    const sourceRef =
      source.configured && source.summary && source.sourceEpoch !== null
        ? { vaultId: source.summary.vaultId, sourceEpoch: source.sourceEpoch }
        : null;
    const runId = `run-${randomUUID()}`;
    const runGeneration = ++this.generation;
    const nowMs = Date.now();
    const record: RunRecord = {
      runId,
      runGeneration,
      clientRequestId,
      sessionId: params.sessionId ?? null,
      query,
      sourceRef,
      seq: 0,
      view: {
        runId,
        runGeneration,
        status: sourceRef ? "retrieving" : "no_source",
        query,
        sessionId: params.sessionId ?? null,
        source: sourceRef,
        createdAtMs: nowMs,
        finishedAtMs: sourceRef ? null : nowMs,
        candidates: [],
        coverage: null,
        diagnostics: null,
        reason: sourceRef ? null : "vault_not_configured",
      },
    };
    this.runs.set(runId, record);
    this.runsByClientRequestId.set(clientRequestId, runId);
    this.pruneRuns();
    this.emit(record);
    return record.view;
  }

  async search(params: { runId: string }): Promise<KnowledgeRunView> {
    const record = this.runs.get(params.runId);
    if (!record) throw new Error("run 不存在或已丢弃");
    if (record.view.status !== "retrieving") return record.view;
    const generationAtStart = record.runGeneration;

    try {
      const source = await this.resolveSource();
      if (!source.configured || source.sourceEpoch === null || !source.summary) {
        return this.applyResult(record, generationAtStart, {
          status: "source_stale",
          reason: "vault_not_configured",
        });
      }
      if (
        !record.sourceRef ||
        source.summary.vaultId !== record.sourceRef.vaultId ||
        source.sourceEpoch !== record.sourceRef.sourceEpoch
      ) {
        // 源身份/epoch 在检索期间变化：旧 Query 失效（spec §5b.6）。
        // vaultId 必须一并比较：epoch 是 vault 内计数，换库后新 vault 可能同为 1。
        return this.applyResult(record, generationAtStart, {
          status: "source_stale",
          reason: "source_epoch_changed",
        });
      }

      const coverage = loadCoverage(this.db, source.summary.vaultId, source.sourceEpoch);
      const result = await searchKnowledgeLexical(this.db, record.sourceRef, record.query, {
        semantic: this.semantic,
        partial: coverage?.partial ?? false,
      });
      const finalCoverage: KnowledgeCoverage | null = coverage ?? {
        indexedFiles: 0,
        indexedChunks: 0,
        excludedHidden: 0,
        excludedSymlink: 0,
        excludedNotMarkdown: 0,
        excludedOverSize: 0,
        excludedOverQuota: 0,
        excludedDepth: 0,
        truncatedFiles: 0,
        partial: false,
      };
      return this.applyResult(record, generationAtStart, {
        status: result.status,
        candidates: result.candidates,
        coverage: finalCoverage,
        diagnostics: result.diagnostics,
        reason: null,
      });
    } catch (error) {
      this.logger.error("检索失败", { runId: record.runId });
      return this.applyResult(record, generationAtStart, {
        status: "failed",
        reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    }
  }

  getRun(params: { runId: string }): KnowledgeRunView | null {
    return this.runs.get(params.runId)?.view ?? null;
  }

  cancelRun(params: { runId: string }): { cancelled: boolean } {
    const record = this.runs.get(params.runId);
    if (!record) return { cancelled: false };
    if (record.view.status === "retrieving") {
      record.runGeneration = ++this.generation; // 提升 in-flight 校验代数：旧结果按代数丢弃。
      record.view = {
        ...record.view,
        runGeneration: record.runGeneration,
        status: "cancelled",
        finishedAtMs: Date.now(),
        candidates: [],
      };
      this.emit(record);
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  /** 测试与上层观察入口。 */
  get runCount(): number {
    return this.runs.size;
  }

  private async resolveSource(): Promise<KnowledgeSourceResolution> {
    return resolveKnowledgeSource(this.db, this.pluginDataDir, Date.now());
  }

  /** 结果落定：代数不匹配即丢弃（cancel/重放竞态）；候选不回填过期 run。 */
  private applyResult(
    record: RunRecord,
    generationAtStart: number,
    patch: Partial<Pick<KnowledgeRunView, "status" | "reason" | "candidates" | "coverage" | "diagnostics">>,
  ): KnowledgeRunView {
    if (record.runGeneration !== generationAtStart) {
      this.logger.debug("丢弃过期检索结果", { runId: record.runId });
      return record.view;
    }
    record.view = {
      ...record.view,
      ...patch,
      finishedAtMs: Date.now(),
    };
    this.emit(record);
    return record.view;
  }

  private emit(record: RunRecord): void {
    record.seq += 1;
    this.runUpdated.fire({
      runId: record.runId,
      runGeneration: record.runGeneration,
      seq: record.seq,
      status: record.view.status,
    });
  }

  /** run 是进程内易失状态：上限裁剪，最旧完成态先淘汰。 */
  private pruneRuns(limit = 100): void {
    if (this.runs.size <= limit) return;
    const completed = [...this.runs.values()]
      .filter((record) => record.view.status !== "retrieving")
      .sort((left, right) => left.view.createdAtMs - right.view.createdAtMs);
    for (const record of completed) {
      if (this.runs.size <= limit) break;
      this.runs.delete(record.runId);
      this.runsByClientRequestId.delete(record.clientRequestId);
    }
  }
}
