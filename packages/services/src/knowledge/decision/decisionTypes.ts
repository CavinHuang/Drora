/**
 * Jev 决策层共享契约（W05 / spec §5d）。
 *
 * 单一出处：决策端口、授权、诊断的 DTO 唯一定义处。默认关闭：不注入
 * DecisionProvider 时管线恒走 off 分支，outboundCount=0（ADR #5/#11）。
 */

/** 本地 DecisionPolicy 五动作（spec §5d.5）；硬条件优先，Jev 不可越权。 */
export type KnowledgeDecisionAction =
  | "SHOW_CANDIDATES"
  | "EXPAND_ONCE"
  | "ASK_CLARIFICATION"
  | "PREPARE_EVIDENCE_FOR_AGENT"
  | "NO_RELIABLE_MATCH";

/** 决策阶段状态：off=未启用；denied=启用但无有效授权；applied=已融合；fallback=已尝试但降级。 */
export type KnowledgeDecisionStageStatus = "off" | "denied" | "applied" | "fallback" | "cancelled";

/**
 * 机器可读降级原因（spec §5d.6）；不含查询文本、路径与凭据。
 */
export type KnowledgeDecisionFallbackReason =
  | "disabled_no_provider"
  | "consent_missing"
  | "consent_expired"
  | "consent_revoked"
  | "consent_scope_mismatch"
  | "timeout"
  | "http_429"
  | "http_5xx"
  | "invalid_score"
  | "unknown_candidate"
  | "provider_error"
  | "cancelled";

/** 进入决策阶段的候选（来自 run 的文章级候选，excerpt 已有界 ≤240 字符）。 */
export interface KnowledgeDecisionCandidate {
  /** 稳定文章 id（sha256(vaultId + relativePath)），可安全出现在结果中。 */
  candidateId: string;
  /** 命中 chunk 文本 sha256：授权绑定与缓存键的内容版本分量。 */
  chunkSha256: string;
  title: string;
  headingPath: string | null;
  excerpt: string;
  /** 1 起始本地名次。 */
  localRank: number;
  /** 本地归一化分数（名次归一，∈(0,1]；不是概率，不对外展示为准确率）。 */
  localScore: number;
}

/** 决策阶段请求（provider 只看到有界片段，绝无绝对路径/凭据/其他会话历史）。 */
export interface KnowledgeDecisionRequest {
  /** run id：决策按 run 作用域隔离（J07 跨 run 竞态的结构边界）。 */
  queryId: string;
  vaultId: string;
  sourceEpoch: number;
  /** 规范化查询文本（原文回显最小化由调用方裁剪）。 */
  query: string;
  /** 规范化查询 sha256：授权绑定与缓存键的查询分量。 */
  queryHash: string;
  candidates: KnowledgeDecisionCandidate[];
  /** 出站候选上限（管线按本地名次截断）。 */
  maxCandidates: number;
  /**
   * 本次出站授权（管线在门禁校验后传入；null = 无授权，仅限不出站的本地 provider）。
   * JevAdapter 在每次实际 HTTP 调用前再经账本逐候选重查（spec §5d.6）。
   */
  consent: KnowledgeDecisionConsent | null;
  signal: AbortSignal;
}

/** 单候选决策产出：scored=合法 noul；fallback=该候选本地回退（附机器原因）。 */
export interface KnowledgeDecisionOutcome {
  candidateId: string;
  status: "scored" | "fallback";
  /** 仅 status=scored；有限数且 ∈[0,1]。 */
  noul?: number;
  fallbackReason?: KnowledgeDecisionFallbackReason;
}

/** 决策阶段结果（provider 返回；管线再校验后才落定）。 */
export interface KnowledgeDecisionResult {
  providerId: string;
  /** 响应回报的具体模型版本（如 jev-1.13.0）；无远端时为 null。 */
  modelVersion: string | null;
  outcomes: KnowledgeDecisionOutcome[];
  /** 实际出站请求数（A23 的断言面；缓存命中不计入）。 */
  outboundCount: number;
  /** 远端 token 用量（成本代理）；无远端为 0。 */
  inputTokens: number;
  outputTokens: number;
  /** 出站候选名次单调性调试字段：被截断未出站的候选数。 */
  skippedCount: number;
}

/** 决策提供方端口：实现自带出站授权责任（与 KnowledgeEmbeddingPort 同形）。 */
export interface KnowledgeDecisionProvider {
  /** 实现标识（如 "jev-typesafe" / "stub-reranker"）；进诊断与缓存键。 */
  readonly id: string;
  /** 请求的模型/规则版本（缓存键分量；响应可回报更具体的版本）。 */
  readonly modelId: string;
  decide(request: KnowledgeDecisionRequest): Promise<KnowledgeDecisionResult>;
}

// ── 授权（spec §5d.6）──────────────────────────────────────

/** 授权凭据内容：按本次出站范围与 provider/source/epoch/queryHash/candidateHash 绑定。 */
export interface KnowledgeDecisionConsent {
  consentId: string;
  providerId: string;
  vaultId: string;
  sourceEpoch: number;
  queryHash: string;
  /** 授权出站的候选 chunkSha256 集合（用户批准的内容范围）。 */
  candidateHashes: ReadonlySet<string>;
  grantedAtMs: number;
  expiresAtMs: number;
}

/** grantDecisionConsent 的 RPC 结果（判别式：granted）。 */
export type KnowledgeDecisionConsentGrantResult =
  | {
      granted: true;
      consentId: string;
      expiresAtMs: number;
      /** 实际绑定出站的候选数。 */
      boundCandidateCount: number;
    }
  | { granted: false; reason: "disabled" | "no_source" | "run_not_settled" | "no_candidates" };

/** 逐调用重查结果：ok 之外一律拒绝出站（fail-closed，spec §5d.6）。 */
export type KnowledgeConsentVerification =
  | { ok: true; consent: KnowledgeDecisionConsent }
  | { ok: false; reason: KnowledgeDecisionFallbackReason };

// ── run 诊断（RPC additive 字段，spec §5d.6）────────────────

/** run 视图的决策诊断（落定时产出；off 分支也有 action/policyVersion）。 */
export interface KnowledgeDecisionDiagnostics {
  status: KnowledgeDecisionStageStatus;
  /** off/denied/fallback 的机器原因；applied 时为 null。 */
  reason: KnowledgeDecisionFallbackReason | null;
  action: KnowledgeDecisionAction;
  providerId: string | null;
  modelVersion: string | null;
  policyVersion: string;
  outboundCount: number;
  scoredCount: number;
  fallbackCount: number;
  cacheHitCount: number;
  latencyMs: number | null;
}

/** 策略可调参数（实验初值，policyVersion 钉住；离线评测标定后才允许调整上线）。 */
export interface KnowledgeDecisionPolicyConfig {
  /** Jev 输入上限（候选池 30 内截断，JEV_DETAIL §0C.4）。 */
  maxCandidates: number;
  /** 出站并发（4–8）。 */
  concurrency: number;
  /** 单调用超时（实验值 3s）。 */
  perCallTimeoutMs: number;
  /** 阶段总预算（实验值 6s）。 */
  stageBudgetMs: number;
  /** 429/529 短退避重试次数（0/1）。 */
  rateLimitRetries: number;
  rateLimitBackoffMs: number;
  /** 直接证据阈值：top noul ≥ 此值建议 PREPARE_EVIDENCE_FOR_AGENT。 */
  directThreshold: number;
  /** 拒识阈值：top noul < 此值进入 ASK_CLARIFICATION 判定。 */
  abstainThreshold: number;
  /** 前两名分差 ≤ 此值视为并列（ASK_CLARIFICATION）。 */
  ambiguityBand: number;
  /** 融合权重（实验起始 0.35/0.65，JEV_DETAIL §0C.3）。 */
  weightLocal: number;
  weightJev: number;
  /** 授权 TTL（单 query，默认 60s）。 */
  consentTtlMs: number;
  /** 决策缓存容量上限（LRU）。 */
  cacheMaxEntries: number;
}
