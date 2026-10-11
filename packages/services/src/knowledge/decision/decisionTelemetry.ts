/**
 * 决策 Telemetry（W05 / spec §5d.1–§5d.2）。
 *
 * 服务生命周期内的聚合计数与延迟样本；**不落任何查询文本、片段、路径与凭据**。
 * `outboundCountTotal` 是 A23（默认关闭/拒绝 → 零出站）的断言面；延迟样本供
 * 评测框架计算 P50/P95（J10）。
 */
import type { KnowledgeDecisionFallbackReason } from "./decisionTypes.js";

export interface DecisionTelemetrySnapshot {
  outboundCountTotal: number;
  cacheHitCountTotal: number;
  fallbackCountTotal: number;
  scoredCountTotal: number;
  /** 按降级原因分桶（unknown_candidate / invalid_score / timeout / http_429 / ...）。 */
  fallbackByReason: Record<string, number>;
  inputTokensTotal: number;
  outputTokensTotal: number;
  /** 阶段延迟样本（ms）；供 P50/P95 聚合，最多保留 500 个。 */
  latencySamplesMs: number[];
}

export class DecisionTelemetry {
  private outboundCountTotal = 0;
  private cacheHitCountTotal = 0;
  private fallbackCountTotal = 0;
  private scoredCountTotal = 0;
  private readonly fallbackByReason = new Map<string, number>();
  private inputTokensTotal = 0;
  private outputTokensTotal = 0;
  private readonly latencySamplesMs: number[] = [];

  recordStage(entry: {
    outboundCount: number;
    cacheHitCount: number;
    outcomes: Array<{ status: "scored" | "fallback"; fallbackReason?: KnowledgeDecisionFallbackReason }>;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }): void {
    this.outboundCountTotal += entry.outboundCount;
    this.cacheHitCountTotal += entry.cacheHitCount;
    this.inputTokensTotal += entry.inputTokens;
    this.outputTokensTotal += entry.outputTokens;
    for (const outcome of entry.outcomes) {
      if (outcome.status === "scored") {
        this.scoredCountTotal += 1;
      } else {
        this.fallbackCountTotal += 1;
        const reason = outcome.fallbackReason ?? "unknown";
        this.fallbackByReason.set(reason, (this.fallbackByReason.get(reason) ?? 0) + 1);
      }
    }
    if (this.latencySamplesMs.length >= 500) this.latencySamplesMs.shift();
    this.latencySamplesMs.push(entry.latencyMs);
  }

  snapshot(): DecisionTelemetrySnapshot {
    return {
      outboundCountTotal: this.outboundCountTotal,
      cacheHitCountTotal: this.cacheHitCountTotal,
      fallbackCountTotal: this.fallbackCountTotal,
      scoredCountTotal: this.scoredCountTotal,
      fallbackByReason: Object.fromEntries(this.fallbackByReason),
      inputTokensTotal: this.inputTokensTotal,
      outputTokensTotal: this.outputTokensTotal,
      latencySamplesMs: [...this.latencySamplesMs],
    };
  }
}
