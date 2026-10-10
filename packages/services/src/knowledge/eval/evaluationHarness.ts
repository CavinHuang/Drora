/**
 * 离线评测 harness（W05 / spec §5d.8）。
 *
 * 走**真实**检索代码路径（createKnowledgeServices → createRun/search/grant → 决策管线）
 * 对比变体：lexical（无语义端口）/ hybrid（+Embedding）/ hybrid+jev（+DecisionProvider）/
 * hybrid+reranker（任意替代 provider）。真值只来自标注数据集；指标数字的解释力取决于
 * 数据集质量——合成试点集不构成真实收益声明（A28 边界）。
 */
import {
  averageNonNull,
  evidencePrecisionTop1,
  hitAtK,
  percentileNearestRank,
  recallAtK,
  reciprocalRank,
} from "./evaluationMetrics.js";
import type { KnowledgeServices } from "../knowledgeServices.js";

/** 评测样例（标注真值）。路径是相对 Vault 根的路径；绝不使用用户真实 Vault。 */
export interface EvaluationQueryCase {
  id: string;
  query: string;
  intent: "FIND" | "ANSWER" | "COMPARE";
  /** 正确文章（相对路径）；无答案样本为空数组。 */
  relevantArticlePaths: string[];
  /** 是否真实存在答案（false = 无答案负样本，进 No-answer FP 分母）。 */
  hasAnswer: boolean;
  /** 可选 chunk 级标注（top-1 证据精度用）；缺省不进该指标分母。 */
  relevantChunkSha256s?: string[];
}

/** 单样例执行记录（保留原始名次，供聚合与排查）。 */
export interface EvaluationPerQueryResult {
  caseId: string;
  /** 系统是否「宣布找到」（非空候选且决策动作 ≠ NO_RELIABLE_MATCH）。 */
  declared: boolean;
  /** 前 limit 名的相对路径（Recall/Hit/MRR 的评定对象）。 */
  rankedPaths: string[];
  top1ChunkSha256: string | null;
  firstRelevantRank: number | null;
  latencyMs: number;
  decisionAction: string | null;
  decisionOutboundCount: number;
}

/** 单变体评测报告。 */
export interface EvaluationVariantReport {
  variantId: string;
  cases: number;
  answeredCases: number;
  noAnswerCases: number;
  recallAt30: number | null;
  hitAt1: number | null;
  hitAt5: number | null;
  mrr: number | null;
  /** 无答案样本被宣布命中的比例（越低越好）。 */
  noAnswerFalsePositiveRate: number | null;
  /** top-1 chunk 级证据精度（仅对提供 chunk 标注的样例取均值）。 */
  evidencePrecisionTop1: number | null;
  /** top-1 引用经 prepareEvidence→resolveCitation 验证为 current 的比例。 */
  citationSupportRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  /** 成本代理：出站调用与 token 用量（真实 provider 才非零）。 */
  outboundCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
  perQuery: EvaluationPerQueryResult[];
}

export interface EvaluationVariant {
  variantId: string;
  /** 已按变体注入 embedding/decision 的服务实例（harness 不负责 dispose）。 */
  services: KnowledgeServices;
  /** 是否走「本地检索 → 授权 → 决策补跑」链路（有 provider 的变体设 true）。 */
  withDecisionConsent: boolean;
  /** 是否执行 top-1 引用核验（默认 true）。 */
  withCitationCheck?: boolean;
}

export interface EvaluationRunOptions {
  /** 候选名单长度（Recall@30 语义 → 30；受检索上限约束时如实降低）。 */
  limit?: number;
  /**
   * clientRequestId 前缀（默认 "eval"）：同一 services 上多次评测必须换前缀，
   * 否则 createRun 按 clientRequestId 幂等返回旧 run，决策补跑不会执行。
   */
  requestIdPrefix?: string;
}

const NO_DECLARATION_ACTIONS = new Set(["NO_RELIABLE_MATCH"]);

export async function runKnowledgeEvaluation(
  variants: EvaluationVariant[],
  dataset: EvaluationQueryCase[],
  options: EvaluationRunOptions = {},
): Promise<EvaluationVariantReport[]> {
  const limit = options.limit ?? 30;
  const requestIdPrefix = options.requestIdPrefix ?? "eval";
  const reports: EvaluationVariantReport[] = [];
  for (const variant of variants) {
    reports.push(await evaluateVariant(variant, dataset, limit, requestIdPrefix));
  }
  return reports;
}

async function evaluateVariant(
  variant: EvaluationVariant,
  dataset: EvaluationQueryCase[],
  limit: number,
  requestIdPrefix: string,
): Promise<EvaluationVariantReport> {
  const { services, variantId } = variant;
  const perQuery: EvaluationPerQueryResult[] = [];
  const latencies: number[] = [];
  let citationChecked = 0;
  let citationCurrent = 0;

  for (const testCase of dataset) {
    const startedAtMs = Date.now();
    const created = await services.queryService.createRun({
      query: testCase.query,
      clientRequestId: `${requestIdPrefix}-${variantId}-${testCase.id}`,
    });
    let run = created;
    if (created.status === "retrieving") {
      run = await services.queryService.search({ runId: created.runId });
      if (variant.withDecisionConsent) {
        // 本地候选落定后授权（绑定候选 chunkSha），再补跑决策阶段。
        const grant = await services.queryService.grantDecisionConsent({ runId: run.runId });
        if (grant.granted) {
          run = await services.queryService.search({
            runId: run.runId,
            decisionConsentId: grant.consentId,
          });
        }
      }
    }
    const latencyMs = Date.now() - startedAtMs;
    latencies.push(latencyMs);

    const relevantPaths = new Set(testCase.relevantArticlePaths);
    const rankedPaths = run.candidates.slice(0, limit).map((candidate) => candidate.relativePath);
    const firstRelevantIndex = run.candidates.findIndex((candidate) => relevantPaths.has(candidate.relativePath));
    const action = run.decision?.action ?? null;
    perQuery.push({
      caseId: testCase.id,
      declared: run.candidates.length > 0 && !(action !== null && NO_DECLARATION_ACTIONS.has(action)),
      rankedPaths,
      top1ChunkSha256: run.candidates[0]?.chunkSha256 ?? null,
      firstRelevantRank: firstRelevantIndex === -1 ? null : firstRelevantIndex + 1,
      latencyMs,
      decisionAction: action,
      decisionOutboundCount: run.decision?.outboundCount ?? 0,
    });

    const top1 = run.candidates[0];
    if (variant.withCitationCheck !== false && top1) {
      const prepared = await services.queryService.prepareEvidence({
        runId: run.runId,
        articleId: top1.articleId,
      });
      if (prepared.receipt) {
        const resolved = await services.queryService.resolveCitation({ receiptId: prepared.receipt.receiptId });
        citationChecked += 1;
        if (resolved.status === "current") citationCurrent += 1;
      }
    }
  }

  return aggregateReport(variantId, dataset, perQuery, latencies, services, citationChecked, citationCurrent);
}

function aggregateReport(
  variantId: string,
  dataset: EvaluationQueryCase[],
  perQuery: EvaluationPerQueryResult[],
  latencies: number[],
  services: KnowledgeServices,
  citationChecked: number,
  citationCurrent: number,
): EvaluationVariantReport {
  const answered = dataset.filter((testCase) => testCase.hasAnswer);
  const noAnswer = dataset.filter((testCase) => !testCase.hasAnswer);
  const telemetry = services.decision?.telemetry.snapshot() ?? null;
  const metricFor = (
    testCase: EvaluationQueryCase,
    compute: (paths: string[], relevant: Set<string>) => number | null,
  ): number | null => {
    const result = perQuery.find((entry) => entry.caseId === testCase.id);
    if (!result) return null;
    return compute(result.rankedPaths, new Set(testCase.relevantArticlePaths));
  };

  return {
    variantId,
    cases: dataset.length,
    answeredCases: answered.length,
    noAnswerCases: noAnswer.length,
    recallAt30: averageNonNull(answered.map((testCase) => metricFor(testCase, (paths, relevant) => recallAtK(paths, relevant, 30)))),
    hitAt1: averageNonNull(answered.map((testCase) => metricFor(testCase, (paths, relevant) => hitAtK(paths, relevant, 1)))),
    hitAt5: averageNonNull(answered.map((testCase) => metricFor(testCase, (paths, relevant) => hitAtK(paths, relevant, 5)))),
    mrr: averageNonNull(answered.map((testCase) => metricFor(testCase, (paths, relevant) => reciprocalRank(paths, relevant)))),
    noAnswerFalsePositiveRate: noAnswer.length
      ? noAnswer.filter((testCase) => perQuery.find((entry) => entry.caseId === testCase.id)?.declared ?? false).length /
        noAnswer.length
      : null,
    evidencePrecisionTop1: evidencePrecisionAverage(perQuery, dataset),
    citationSupportRate: citationChecked > 0 ? citationCurrent / citationChecked : null,
    p50LatencyMs: latencies.length ? percentileNearestRank(latencies, 0.5) : null,
    p95LatencyMs: latencies.length ? percentileNearestRank(latencies, 0.95) : null,
    outboundCalls: telemetry?.outboundCountTotal ?? 0,
    inputTokens: telemetry?.inputTokensTotal ?? 0,
    outputTokens: telemetry?.outputTokensTotal ?? 0,
    cacheHits: telemetry?.cacheHitCountTotal ?? 0,
    perQuery,
  };
}

function evidencePrecisionAverage(
  perQuery: EvaluationPerQueryResult[],
  dataset: EvaluationQueryCase[],
): number | null {
  const annotated = dataset.filter((testCase) => (testCase.relevantChunkSha256s?.length ?? 0) > 0);
  if (annotated.length === 0) return null;
  const values = annotated.map((testCase) => {
    const result = perQuery.find((entry) => entry.caseId === testCase.id);
    const hit = evidencePrecisionTop1(result?.top1ChunkSha256 ?? null, new Set(testCase.relevantChunkSha256s));
    return hit === null ? null : hit ? 1 : 0;
  });
  return averageNonNull(values);
}
