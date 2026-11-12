// P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C6 D9，A17 fail-closed
// 延续）：原 W03「执行时复验 gate」（宿主 verifyInputEvidence → knowledge-evidence/
// evidence-gate.ts 只读账本）已随本体数据面拆除。本文件降格为**最小 legacy 探测器**：
// - sendText：admission 前检测 payload.evidenceRefs；guide/steer 投递禁用（回退 queue，
//   记录 fallbackReasonCode）——guide 行内消费不经过 sendQueuedNow 提升漏斗，无检测点。
// - sendQueuedNow：reserve 前检测 queueItem.evidenceRefs（手动提升与 auto-drain 合成
//   信封的唯一漏斗，W00 S02 接线点）。失败 → 抛 EvidenceGuardRejectionError → ACK
//   failed（guard.evidenceForbidden + legacy_evidence_unverifiable）；提升路径的 finally
//   会回滚 reservation，队首原位保留。
// 旧持久化账本中携带 refs 的排队/重放条目一律拒绝（不静默容忍：receipt 账本已不在
// 本体可读路径，任何「放行」都等于未验证证据直接进模型），普通输入不受影响。
// 词表（guard/reason/前缀）唯一出处在 shared drora-protocol-v4/input-intent.ts 的
// deprecated wire 兼容区（AGENTS.md「契约键单一出处」，禁止手写第二份）。
import {
  KNOWLEDGE_EVIDENCE_GUARDS,
  KNOWLEDGE_EVIDENCE_REASONS,
  type KnowledgeEvidenceGuard,
  type KnowledgeEvidenceReason,
  type KnowledgeEvidenceRef,
} from "@drora/shared";

/** guard.evidence* 领域错误：reasonCode 原样上行为 ACK failed.reasonCode。 */
export class EvidenceGuardRejectionError extends Error {
  readonly reasonCode: KnowledgeEvidenceGuard;

  constructor(
    guard: KnowledgeEvidenceGuard,
    readonly evidenceReason: KnowledgeEvidenceReason,
    receiptId: string,
  ) {
    // message 只携带 id 前缀与原因，不携带路径/笔记内容（日志边界）。
    super(`evidence rejected: ${guard} (${evidenceReason}): ${receiptId.slice(0, 12)}…`);
    this.name = "EvidenceGuardRejectionError";
    this.reasonCode = guard;
  }
}

/**
 * legacy 探测器入口：refs 为空（当前唯一合法形态——生产端写入路径已全删）直接放行；
 * refs 非空 = 旧账本条目，一律拒绝（legacy_evidence_unverifiable，fail-closed）。
 */
export async function verifyEvidenceOrThrow(
  _host: unknown,
  _sessionId: string,
  refs: ReadonlyArray<KnowledgeEvidenceRef> | undefined,
): Promise<void> {
  if (!refs || refs.length === 0) return;
  throw new EvidenceGuardRejectionError(
    KNOWLEDGE_EVIDENCE_GUARDS.forbidden,
    KNOWLEDGE_EVIDENCE_REASONS.legacyEvidenceUnverifiable,
    refs[0]?.receiptId ?? "",
  );
}

/**
 * guide 禁用裁决（§5.3 第 3 层语义延续）：证据输入一律不得按 guide/steer 投递。
 * 返回实际生效的 requestedDelivery 与（回退时的）fallbackReasonCode。
 */
export function resolveEvidenceSafeDelivery(input: {
  requestedDelivery: "startNow" | "queue" | "guide";
  routingMode: string | null;
  hasEvidence: boolean;
}): { requestedDelivery: "startNow" | "queue" | "guide"; fallbackReasonCode?: string } {
  if (!input.hasEvidence) {
    return { requestedDelivery: input.requestedDelivery };
  }
  if (input.requestedDelivery === "guide" || input.routingMode === "guide") {
    return {
      requestedDelivery: "queue",
      fallbackReasonCode: KNOWLEDGE_EVIDENCE_GUARDS.guideForbidden,
    };
  }
  return { requestedDelivery: input.requestedDelivery };
}
