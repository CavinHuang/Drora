// W03 Evidence 发送链路复验辅助（handlers 共用）。
// - sendText：admission 前复验 payload.evidenceRefs；guide/steer 投递禁用（回退 queue，
//   记录 fallbackReasonCode）——guide 行内消费不经过 sendQueuedNow 提升漏斗，无复验点。
// - sendQueuedNow：reserve 前复验 queueItem.evidenceRefs（手动提升与 auto-drain 合成信封
//   的唯一漏斗，W00 S02 接线点）。失败 → 抛 EvidenceGuardRejectionError → ACK failed
//   （guard.evidence*）；提升路径的 finally 会回滚 reservation，队首原位保留。
// 宿主未注入 verifyInputEvidence（旧宿主/测试桩）→ 不复验，保持既有行为（additive）。
import {
  KNOWLEDGE_EVIDENCE_GUARDS,
  type KnowledgeEvidenceGuard,
  type KnowledgeEvidenceReason,
} from "@drora/shared";
import type { V4CommandCoreHost } from "../types.js";

/** guard.evidence* 领域错误：reasonCode 原样上行为 ACK failed.reasonCode。 */
export class EvidenceGuardRejectionError extends Error {
  readonly reasonCode: KnowledgeEvidenceGuard;

  constructor(
    guard: KnowledgeEvidenceGuard,
    readonly evidenceReason: KnowledgeEvidenceReason | "gate_unavailable",
    receiptId: string,
  ) {
    // message 只携带 id 前缀与原因，不携带路径/笔记内容（日志边界）。
    super(`evidence rejected: ${guard} (${evidenceReason}): ${receiptId.slice(0, 12)}…`);
    this.name = "EvidenceGuardRejectionError";
    this.reasonCode = guard;
  }
}

export interface EvidenceAdmissionDecision {
  refs: ReadonlyArray<{ receiptId: string }>;
  /** true = 输入携带证据引用（触发复验与 guide 禁用）。 */
  hasEvidence: boolean;
}

/** 复验入口：refs 为空直接放行；宿主无 port 放行（additive 语义）。 */
export async function verifyEvidenceOrThrow(
  host: V4CommandCoreHost,
  sessionId: string,
  refs: ReadonlyArray<{ receiptId: string }> | undefined,
): Promise<void> {
  if (!refs || refs.length === 0) return;
  if (!host.verifyInputEvidence) return;
  const verdict = await host.verifyInputEvidence({ sessionId, evidenceRefs: refs });
  if (verdict.ok) return;
  throw new EvidenceGuardRejectionError(verdict.guard, verdict.reason, refs[0]?.receiptId ?? "");
}

/**
 * guide 禁用裁决（§5.3 第 3 层）：证据输入一律不得按 guide/steer 投递。
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
