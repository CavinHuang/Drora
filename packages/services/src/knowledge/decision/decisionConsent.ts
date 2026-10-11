/**
 * 决策授权账本（W05 / spec §5d.6）。
 *
 * Host 进程内存账本（不持久化）：授予时绑定 provider/vaultId/sourceEpoch/queryHash/
 * candidateHashes/TTL；**实际出站调用前逐候选重查**（fail-closed），撤销即时生效。
 * renderer 只能经 grantDecisionConsent RPC 请求授权，provider 注入与凭证永远在 Host 侧。
 */
import { randomUUID } from "node:crypto";
import type {
  KnowledgeConsentVerification,
  KnowledgeDecisionConsent,
  KnowledgeDecisionFallbackReason,
} from "./decisionTypes.js";

export interface ConsentVerificationInput {
  consentId: string;
  providerId: string;
  vaultId: string;
  sourceEpoch: number;
  queryHash: string;
  /** 本次要出站候选的 chunkSha256（逐候选校验）。 */
  candidateHash: string;
  nowMs: number;
}

export class DecisionConsentRegistry {
  private readonly consents = new Map<string, KnowledgeDecisionConsent>();

  grant(consent: Omit<KnowledgeDecisionConsent, "consentId">): KnowledgeDecisionConsent {
    const record: KnowledgeDecisionConsent = { ...consent, consentId: `cons_${randomUUID()}` };
    this.consents.set(record.consentId, record);
    return record;
  }

  revoke(consentId: string): boolean {
    return this.consents.delete(consentId);
  }

  /** 读取（撤销前的缓存失效清理需要绑定信息）；不存在返回 null。 */
  get(consentId: string): KnowledgeDecisionConsent | null {
    return this.consents.get(consentId) ?? null;
  }

  /** 阶段门禁：校验除单候选范围外的全部绑定（候选 hash 在 adapter 逐调用重查）。 */
  verifyBinding(input: {
    consentId: string;
    providerId: string;
    vaultId: string;
    sourceEpoch: number;
    queryHash: string;
    nowMs: number;
  }): KnowledgeConsentVerification {
    if (!input.consentId) return { ok: false, reason: "consent_missing" };
    const reason = this.rejectReason({ ...input, candidateHash: "" });
    if (reason !== null) return { ok: false, reason };
    const consent = this.consents.get(input.consentId) as KnowledgeDecisionConsent;
    return { ok: true, consent };
  }

  /** 是否存在绑定该 queryHash 的有效授权（缓存失效清理用）。 */
  hasActiveForQuery(queryHash: string, nowMs: number): boolean {
    for (const consent of this.consents.values()) {
      if (consent.queryHash === queryHash && consent.expiresAtMs > nowMs) return true;
    }
    return false;
  }

  /**
   * 逐调用重查（spec §5d.6）：provider/source/epoch/queryHash/candidateHash 任一不绑定、
   * 过期或已撤销 → 拒绝出站。每次真实 HTTP 调用前调用，不做批量预检缓存。
   */
  verify(input: ConsentVerificationInput): KnowledgeConsentVerification {
    const reason = this.rejectReason(input);
    if (reason !== null) return { ok: false, reason };
    // rejectReason 非空已排除；非空断言收窄。
    const consent = this.consents.get(input.consentId) as KnowledgeDecisionConsent;
    return { ok: true, consent };
  }

  private rejectReason(input: ConsentVerificationInput): KnowledgeDecisionFallbackReason | null {
    const consent = this.consents.get(input.consentId);
    if (!consent) return "consent_revoked";
    if (consent.providerId !== input.providerId) return "consent_scope_mismatch";
    if (consent.vaultId !== input.vaultId) return "consent_scope_mismatch";
    if (consent.sourceEpoch !== input.sourceEpoch) return "consent_scope_mismatch";
    if (consent.queryHash !== input.queryHash) return "consent_scope_mismatch";
    // 候选 hash 为空串 = 阶段门禁（verifyBinding）：跳过逐候选范围校验。
    if (input.candidateHash !== "" && !consent.candidateHashes.has(input.candidateHash)) {
      return "consent_scope_mismatch";
    }
    if (input.nowMs >= consent.expiresAtMs) return "consent_expired";
    return null;
  }

  /** 生命周期清理（dispose 链）。 */
  clear(): void {
    this.consents.clear();
  }
}
