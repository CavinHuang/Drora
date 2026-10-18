/**
 * Query 编排（W02 / spec §5b.6；W05 增量决策阶段 / spec §5d）。
 *
 * - createRun 绑定当前 sourceEpoch；无源 → no_source run（结构化，不抛业务错）；
 * - search：AND 轮 → DecisionPolicy 裁决 EXPAND_ONCE（至多一次 OR 扩搜）→ 可选决策
 *   阶段（默认关闭）→ policy 五动作/融合 → run 落定；
 * - 决策阶段：授权门（consent 绑定 provider/vault/epoch/queryHash/candidateHash）→
 *   管线（缓存/provider/校验）→ 融合只重排候选次序，不改候选事实（A26）；
 * - runGeneration 单调递增：cancelRun 提升代数并中止决策阶段，in-flight 结果按代数
 *   丢弃，迟到响应不得覆盖新状态（A22/A26）；
 * - clientRequestId 幂等：重复 createRun 返回同一 run。
 *   授权授予/候选映射/融合重排在 queryDecisionBridge.ts（纯辅助）。
 */
import { randomUUID } from "node:crypto";
import { Emitter, type Event } from "@drora/rpc";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { resolveKnowledgeSource, type KnowledgeSourceResolution } from "../source/sourceRegistry.js";
import type { KnowledgeSemanticContext } from "../search/embeddingPort.js";
import { executeKnowledgeSearch } from "./querySearchPipeline.js";
import { queryHashOf } from "../decision/decisionPolicy.js";
import type {
  KnowledgeDecisionConsentGrantResult,
} from "../decision/decisionTypes.js";
import type {
  KnowledgeRunUpdatedEvent,
  KnowledgeRunView,
} from "../knowledgeTypes.js";
import type {
  KnowledgeCreateRunParams,
  KnowledgeSearchParams,
} from "../knowledgeQuery.js";
import {
  grantDecisionConsentForRun,
  reorderCandidates,
  toDecisionCandidates,
  type KnowledgeDecisionContext,
} from "./queryDecisionBridge.js";

export type { KnowledgeDecisionContext } from "./queryDecisionBridge.js";

interface RunRecord {
  runId: string;
  runGeneration: number;
  clientRequestId: string;
  sessionId: string | null;
  query: string;
  sourceRef: { vaultId: string; sourceEpoch: number } | null;
  view: KnowledgeRunView;
  seq: number;
  /** 进行中决策阶段的中止句柄；cancelRun 触发（迟到响应按代数丢弃）。 */
  abort: AbortController | null;
}

export class QueryOrchestrator {
  private readonly logger = createServiceLogger("knowledge-query");
  private readonly runs = new Map<string, RunRecord>();
  private readonly runsByClientRequestId = new Map<string, string>();
  /** 在源解析期间，同一请求键只允许创建一个 Run。 */
  private readonly pendingCreates = new Map<string, {
    query: string;
    sessionId: string | null;
    result: Promise<KnowledgeRunView>;
  }>();
  /** 同一 run 的在途检索只允许执行一次；重试复用该结果。 */
  private readonly pendingSearches = new Map<string, {
    consentId: string | null;
    result: Promise<KnowledgeRunView>;
  }>();
  private generation = 0;
  private readonly runUpdated = new Emitter<KnowledgeRunUpdatedEvent>();

  constructor(
    private readonly db: KnowledgeDatabase,
    private readonly semantic: KnowledgeSemanticContext,
    private readonly pluginDataDir: string,
    private readonly decision: KnowledgeDecisionContext | null = null,
  ) {}

  get onRunUpdated(): Event<KnowledgeRunUpdatedEvent> {
    return this.runUpdated.event;
  }

  dispose(): void {
    for (const record of this.runs.values()) {
      record.abort?.abort();
      if (record.view.status === "retrieving") {
        record.view = { ...record.view, status: "cancelled", finishedAtMs: Date.now() };
      }
    }
    this.runs.clear();
    this.runsByClientRequestId.clear();
    this.pendingCreates.clear();
    this.pendingSearches.clear();
    this.decision?.registry.clear();
    this.runUpdated.dispose();
  }

  async createRun(params: KnowledgeCreateRunParams): Promise<KnowledgeRunView> {
    const query = typeof params.query === "string" ? params.query : "";
    if (!query.trim()) throw new Error("查询文本不能为空");
    if (query.length > MAX_QUERY_CHARS) throw new Error(`查询文本超过 ${MAX_QUERY_CHARS} 字符上限`);
    const clientRequestId = typeof params.clientRequestId === "string" ? params.clientRequestId.trim() : "";
    if (!clientRequestId) throw new Error("clientRequestId 不能为空");
    const sessionId = params.sessionId ?? null;

    // 相同 key 只允许同一查询和同一会话重试，避免断线或 UI 重用 key 时串问题/串会话。
    const existingRunId = this.runsByClientRequestId.get(clientRequestId);
    if (existingRunId) {
      const existing = this.runs.get(existingRunId);
      if (existing) {
        this.assertSameRequest(existing.query, existing.sessionId, query, sessionId);
        return existing.view;
      }
    }

    // 在等待源解析前登记 pending：并发同 key 只能生成一个 Run。
    const pending = this.pendingCreates.get(clientRequestId);
    if (pending) {
      this.assertSameRequest(pending.query, pending.sessionId, query, sessionId);
      return pending.result;
    }
    const result = this.createRunOnce(query, clientRequestId, sessionId);
    this.pendingCreates.set(clientRequestId, { query, sessionId, result });
    try {
      return await result;
    } finally {
      this.pendingCreates.delete(clientRequestId);
    }
  }

  private assertSameRequest(
    storedQuery: string,
    storedSessionId: string | null,
    query: string,
    sessionId: string | null,
  ): void {
    if (storedQuery !== query || storedSessionId !== sessionId) {
      // 不回显另一会话的查询文本或 Vault 数据。
      throw new Error("clientRequestId 已绑定其他查询或会话");
    }
  }

  private async createRunOnce(
    query: string,
    clientRequestId: string,
    sessionId: string | null,
  ): Promise<KnowledgeRunView> {
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
      sessionId: sessionId,
      query,
      sourceRef,
      seq: 0,
      abort: null,
      view: {
        runId,
        runGeneration,
        status: sourceRef ? "retrieving" : "no_source",
        query,
        sessionId: sessionId,
        source: sourceRef,
        createdAtMs: nowMs,
        finishedAtMs: sourceRef ? null : nowMs,
        candidates: [],
        coverage: null,
        diagnostics: null,
        decision: null,
        reason: sourceRef ? null : "vault_not_configured",
      },
    };
    this.runs.set(runId, record);
    this.runsByClientRequestId.set(clientRequestId, runId);
    this.pruneRuns();
    this.emit(record);
    return record.view;
  }

  async search(params: KnowledgeSearchParams): Promise<KnowledgeRunView> {
    const record = this.runs.get(params.runId);
    if (!record) throw new Error("run 不存在或已丢弃");
    const generationAtStart = record.runGeneration;

    // 已落定 run 的再检索只允许补跑决策；不重新检索已落定候选。
    if (record.view.status !== "retrieving") {
      if (params.decisionConsentId) {
        return this.runDecisionRefresh(record, generationAtStart, params.decisionConsentId);
      }
      return record.view;
    }

    const consentId = params.decisionConsentId ?? null;
    const pending = this.pendingSearches.get(record.runId);
    if (pending) {
      if (pending.consentId !== consentId) {
        // 并发检索不能替换已启动任务的出站授权语义。
        throw new Error("run 检索已启动，不能使用不同的 decisionConsentId");
      }
      return pending.result;
    }
    const result = this.runSearchOnce(record, generationAtStart, params);
    this.pendingSearches.set(record.runId, { consentId, result });
    try {
      return await result;
    } finally {
      if (this.pendingSearches.get(record.runId)?.result === result) {
        this.pendingSearches.delete(record.runId);
      }
    }
  }

  private async runSearchOnce(
    record: RunRecord,
    generationAtStart: number,
    params: KnowledgeSearchParams,
  ): Promise<KnowledgeRunView> {
    const abort = new AbortController();
    record.abort = abort;

    try {
      const patch = await executeKnowledgeSearch({
        db: this.db,
        semantic: this.semantic,
        sourceRef: record.sourceRef,
        runId: record.runId,
        query: record.query,
        decisionConsentId: params.decisionConsentId,
        decision: this.decision,
        signal: abort.signal,
        resolveSource: () => this.resolveSource(),
        sourceChangedSince: () => this.sourceChangedSince(record.sourceRef),
      });
      return this.applyResult(record, generationAtStart, patch);
    } catch (error) {
      this.logger.error("检索失败", { runId: record.runId });
      return this.applyResult(record, generationAtStart, {
        status: "failed",
        reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        decision: null,
      });
    } finally {
      record.abort = null;
    }
  }

  /**
   * 已落定 run 的决策补跑：只执行决策阶段并按融合名次重排（候选事实/引用字段原样）。
   * 授权在管线门与 adapter 逐调用重查；阶段后重验源；取消/换源按代数与 epoch 丢弃。
   */
  private async runDecisionRefresh(
    record: RunRecord,
    generationAtStart: number,
    consentId: string,
  ): Promise<KnowledgeRunView> {
    if (!this.decision || !record.sourceRef) return record.view;
    if (!["ready", "partial", "empty"].includes(record.view.status)) return record.view;
    const abort = new AbortController();
    record.abort = abort;
    try {
      const stage = await this.decision.pipeline.runStage({
        runId: record.runId,
        vaultId: record.sourceRef.vaultId,
        sourceEpoch: record.sourceRef.sourceEpoch,
        query: record.query,
        queryHash: queryHashOf(record.query),
        candidates: toDecisionCandidates(record.view.candidates),
        consentId,
        canExpand: false,
        expanded: record.view.diagnostics?.matchRelaxedToOr ?? false,
        signal: abort.signal,
      });
      // 阶段后重验源：换源/撤权发生在出站期间 → 旧 Query 失效（spec §5b.6/§5d.7）。
      if (await this.sourceChangedSince(record.sourceRef)) {
        return this.applyResult(record, generationAtStart, {
          status: "source_stale",
          reason: "source_epoch_changed",
          candidates: [],
          decision: stage.diagnostics,
        });
      }
      return this.applyResult(record, generationAtStart, {
        candidates: reorderCandidates(record.view.candidates, stage.policy.fusedRankByCandidateId),
        decision: stage.diagnostics,
      });
    } finally {
      record.abort = null;
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
      record.abort?.abort(); // 决策阶段在途调用中止（迟到响应不落定，A26）。
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
    // 已落定 run 的决策补跑进行中：中止在途阶段并提升代数——刷新结果不落定，
    // 已有本地候选保留（W04「取消不清空上一轮可用结果」语义）。
    if (record.abort) {
      record.runGeneration = ++this.generation;
      record.abort.abort();
      return { cancelled: true };
    }
    return { cancelled: false };
  }

  /** 授权授予（绑定逻辑在 queryDecisionBridge；这里只做参数校验与透传）。 */
  async grantDecisionConsent(params: {
    runId: string;
    candidateIds?: string[];
  }): Promise<KnowledgeDecisionConsentGrantResult> {
    if (!this.decision) return { granted: false, reason: "disabled" };
    return grantDecisionConsentForRun({
      decision: this.decision,
      run: this.runs.get(params.runId) ?? null,
      candidateIds: params.candidateIds,
      nowMs: Date.now(),
    });
  }

  /** 撤销授权：账本删除 + 关联缓存清除；进行中阶段在逐调用重查时失败回退。 */
  async revokeDecisionConsent(params: { consentId: string }): Promise<{ revoked: boolean }> {
    if (!this.decision) return { revoked: false };
    const consent = this.decision.registry.get(params.consentId);
    if (!consent) return { revoked: false };
    this.decision.cache.invalidate(
      (_, entry) =>
        entry.vaultId === consent.vaultId &&
        entry.sourceEpoch === consent.sourceEpoch &&
        entry.queryHash === consent.queryHash,
    );
    return { revoked: this.decision.registry.revoke(params.consentId) };
  }

  /** 测试与上层观察入口。 */
  get runCount(): number {
    return this.runs.size;
  }

  private async resolveSource(): Promise<KnowledgeSourceResolution> {
    return resolveKnowledgeSource(this.db, this.pluginDataDir, Date.now());
  }

  /** 阶段后重验：vaultId + epoch 任一变化即失效（epoch 是 vault 内计数，必须同查）。 */
  private async sourceChangedSince(
    sourceRef: { vaultId: string; sourceEpoch: number } | null,
  ): Promise<boolean> {
    if (!sourceRef) return true;
    const source = await this.resolveSource();
    return (
      !source.configured ||
      source.sourceEpoch === null ||
      !source.summary ||
      source.summary.vaultId !== sourceRef.vaultId ||
      source.sourceEpoch !== sourceRef.sourceEpoch
    );
  }

  /** 结果落定：代数不匹配即丢弃（cancel/重放竞态）；候选不回填过期 run。 */
  private applyResult(
    record: RunRecord,
    generationAtStart: number,
    patch: Partial<
      Pick<
        KnowledgeRunView,
        "status" | "reason" | "candidates" | "coverage" | "diagnostics" | "decision"
      >
    >,
  ): KnowledgeRunView {
    if (record.runGeneration !== generationAtStart) {
      this.logger.debug("丢弃过期检索结果", { runId: record.runId });
      return record.view;
    }
    record.view = { ...record.view, ...patch, finishedAtMs: Date.now() };
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

const MAX_QUERY_CHARS = 512;
