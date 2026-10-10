/**
 * JevAdapter（W05 / spec §5d.3–§5d.7）。
 *
 * DecisionProvider 的 Jev 实现：P0 每**候选**恰好一次 TypeSafe systemOne Noul 出站
 * （单条问题合并「相关性 + 直接证据」判定，不为每条 Query 固定连跑 9 次）。
 * - 实际调用前逐候选重查授权绑定（fail-closed，spec §5d.6）；
 * - 429/529 短退避重试一次后仍失败、5xx、超时、取消、非法评分（非有限数或出 [0,1]）、
 *   坏响应 → 该候选本地回退（本地候选永远可用，A25）；
 * - 结果只按输入候选 ID 收敛；模型自报路径/引用/未知 ID 一律不采信（管线再校验一次）。
 */
import type {
  KnowledgeDecisionCandidate,
  KnowledgeDecisionOutcome,
  KnowledgeDecisionProvider,
  KnowledgeDecisionRequest,
  KnowledgeDecisionResult,
  KnowledgeDecisionFallbackReason,
} from "./decisionTypes.js";
import type { DecisionConsentRegistry } from "./decisionConsent.js";
import type { JevTransport } from "./jevTransport.js";
import { createServiceLogger } from "../../logger/serviceLogger.js";

export const JEV_PROVIDER_ID = "jev-typesafe";
export const JEV_MODEL_ID = "jev-latest";

/** P0 合并问题（spec §5d.4）：命题级匹配而非话题相似，单候选单次出站。 */
export function mergedNoulQuestion(query: string): {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
} {
  return {
    type: "noul",
    instructions: `用户在个人笔记库中检索，查询是：「${query}」。判断该笔记片段是否明确支持用户想找的具体观点或答案（命题级匹配），而不仅仅是话题相似。`,
    criteria: {
      true: "片段直接陈述或具体回答了查询所指向的观点/事实，可指出依据",
      false: "片段仅涉及相似主题、泛泛而谈，或与查询意图不符",
    },
  };
}

export interface JevAdapterOptions {
  transport: JevTransport;
  /** 逐调用重查的授权账本（与管线共享同一实例）。 */
  consentRegistry: DecisionConsentRegistry;
  /** 单调用超时/阶段预算/并发/退避（实验初值，policy 配置）。 */
  perCallTimeoutMs: number;
  stageBudgetMs: number;
  concurrency: number;
  rateLimitRetries: number;
  rateLimitBackoffMs: number;
}

export function createJevAdapter(options: JevAdapterOptions): KnowledgeDecisionProvider {
  const logger = createServiceLogger("knowledge-jev");
  return {
    id: JEV_PROVIDER_ID,
    modelId: JEV_MODEL_ID,
    async decide(request: KnowledgeDecisionRequest): Promise<KnowledgeDecisionResult> {
      const pool = request.candidates.slice(0, request.maxCandidates);
      const skippedCount = request.candidates.length - pool.length;
      const outcomes: KnowledgeDecisionOutcome[] = [];
      let outboundCount = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let modelVersion: string | null = null;
      const deadline = Date.now() + options.stageBudgetMs;
      let cursor = 0;

      const workerCount = Math.max(1, Math.min(options.concurrency, pool.length));
      const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
          // 预算/取消：不再发起新调用（在途调用各自受 per-call 超时与外层 abort 约束）。
          if (request.signal.aborted || Date.now() >= deadline) return;
          const index = cursor;
          cursor += 1;
          const candidate = pool[index];
          if (!candidate) return;
          const call = await callSingleCandidate(candidate, request, options);
          if (call.model !== null && modelVersion === null) modelVersion = call.model;
          outcomes.push(call.outcome);
          outboundCount += call.outboundCount;
          inputTokens += call.inputTokens;
          outputTokens += call.outputTokens;
        }
      });
      await Promise.all(workers);

      // 取消/预算耗尽未覆盖的候选补齐本地回退：结果集合完整，融合规则唯一。
      const fallbackReason: KnowledgeDecisionFallbackReason = request.signal.aborted ? "cancelled" : "timeout";
      for (const candidate of pool) {
        if (!outcomes.some((existing) => existing.candidateId === candidate.candidateId)) {
          outcomes.push({ candidateId: candidate.candidateId, status: "fallback", fallbackReason });
        }
      }
      // 按本地名次稳定排序，便于诊断聚合（融合名次由 policy 决定，与此序无关）。
      const orderIndex = new Map(pool.map((candidate, index) => [candidate.candidateId, index]));
      outcomes.sort(
        (left, right) =>
          (orderIndex.get(left.candidateId) ?? Number.MAX_SAFE_INTEGER) -
          (orderIndex.get(right.candidateId) ?? Number.MAX_SAFE_INTEGER),
      );
      logger.debug("jev 决策阶段完成", {
        queryId: request.queryId,
        outboundCount,
        scored: outcomes.filter((outcome) => outcome.status === "scored").length,
      });
      return {
        providerId: JEV_PROVIDER_ID,
        modelVersion,
        outcomes,
        outboundCount,
        inputTokens,
        outputTokens,
        skippedCount,
      };
    },
  };
}

interface SingleCallResult {
  outcome: KnowledgeDecisionOutcome;
  outboundCount: number;
  inputTokens: number;
  outputTokens: number;
  /** 响应回报的具体模型版本；失败/回退为 null。 */
  model: string | null;
}

async function callSingleCandidate(
  candidate: KnowledgeDecisionCandidate,
  request: KnowledgeDecisionRequest,
  options: JevAdapterOptions,
): Promise<SingleCallResult> {
  const fallback = (reason: KnowledgeDecisionFallbackReason, outboundCount: number): SingleCallResult => ({
    outcome: { candidateId: candidate.candidateId, status: "fallback", fallbackReason: reason },
    outboundCount,
    inputTokens: 0,
    outputTokens: 0,
    model: null,
  });

  // 实际调用前重查（spec §5d.6）：撤销/换源/过期/范围不匹配 → 本地回退，绝不出站。
  const consent = request.consent;
  if (!consent) return fallback("consent_missing", 0);
  const verification = options.consentRegistry.verify({
    consentId: consent.consentId,
    providerId: JEV_PROVIDER_ID,
    vaultId: request.vaultId,
    sourceEpoch: request.sourceEpoch,
    queryHash: request.queryHash,
    candidateHash: candidate.chunkSha256,
    nowMs: Date.now(),
  });
  if (!verification.ok) return fallback(verification.reason, 0);

  const maxAttempts = 1 + Math.max(0, options.rateLimitRetries);
  let outboundCount = 0;
  let lastReason: KnowledgeDecisionFallbackReason = "provider_error";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (request.signal.aborted) return fallback("cancelled", outboundCount);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("per-call-timeout")), options.perCallTimeoutMs);
    const onOuterAbort = () => controller.abort(new Error("stage-cancelled"));
    request.signal.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const response = await options.transport.post({
        state: { query: request.query, note_excerpt: candidate.excerpt, title: candidate.title },
        model: JEV_MODEL_ID,
        questions: { relevance: mergedNoulQuestion(request.query) },
        signal: controller.signal,
      });
      outboundCount += 1;
      if (response.status === 429 || response.status === 529) {
        lastReason = "http_429";
        if (attempt < maxAttempts) {
          await sleep(options.rateLimitBackoffMs, request.signal);
          continue;
        }
        return fallback(lastReason, outboundCount);
      }
      if (response.status >= 500) return fallback("http_5xx", outboundCount);
      if (response.status >= 400 || !response.body) return fallback("provider_error", outboundCount);
      // 响应校验（spec §5d.7）：只接受问题名 relevance 下的合法 noul；
      // 缺失/非数/NaN/出 [0,1] → invalid_score（该候选回退，不阻塞其余候选）。
      const answer = response.body.answers?.relevance;
      const noul = answer?.noul;
      if (answer?.type !== "noul" || typeof noul !== "number" || !Number.isFinite(noul) || noul < 0 || noul > 1) {
        return fallback("invalid_score", outboundCount);
      }
      return {
        outcome: { candidateId: candidate.candidateId, status: "scored", noul },
        outboundCount,
        inputTokens: typeof response.body.usage?.input_tokens === "number" ? (response.body.usage.input_tokens as number) : 0,
        outputTokens: typeof response.body.usage?.output_tokens === "number" ? (response.body.usage.output_tokens as number) : 0,
        model: typeof response.body.model === "string" ? response.body.model : null,
      };
    } catch (error) {
      // AbortController 超时与网络异常同类：该候选回退，不阻塞其余候选。
      if (request.signal.aborted) return fallback("cancelled", outboundCount);
      lastReason = error instanceof Error && error.message === "stage-cancelled" ? "cancelled" : "timeout";
      return fallback(lastReason, outboundCount);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onOuterAbort);
    }
  }
  return fallback(lastReason, outboundCount);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
