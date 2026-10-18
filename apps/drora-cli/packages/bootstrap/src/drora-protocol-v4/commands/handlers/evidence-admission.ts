// W03 Evidence 发送链路复验辅助（handlers 共用）。
// - sendText：admission 前复验 payload.evidenceRefs；guide/steer 投递禁用（回退 queue，
//   记录 fallbackReasonCode）——guide 行内消费不经过 sendQueuedNow 提升漏斗，无复验点。
// - sendQueuedNow：reserve 前复验 queueItem.evidenceRefs（手动提升与 auto-drain 合成信封
//   的唯一漏斗，W00 S02 接线点）。失败 → 抛 EvidenceGuardRejectionError → ACK failed
//   （guard.evidence*）；提升路径的 finally 会回滚 reservation，队首原位保留。
// 宿主未注入 verifyInputEvidence 时拒绝携带证据的输入（fail-closed），普通输入不受影响。
// 修复（2026-10-18 终审 cli-proto-2 / cli-proto-5）：evidenceRefs 形状与 gate_unavailable
// 字面量统一引用 @drora/shared 常量，遵守 AGENTS.md「契约键单一出处」，禁止手写第二份。
import {
  KNOWLEDGE_EVIDENCE_GUARDS,
  KNOWLEDGE_EVIDENCE_REASONS,
  type KnowledgeEvidenceGuard,
  type KnowledgeEvidenceReason,
  type KnowledgeEvidenceRef,
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

/** 复验入口：refs 为空直接放行；宿主无 port 拒绝（fail-closed）。 */
export async function verifyEvidenceOrThrow(
  host: V4CommandCoreHost,
  sessionId: string,
  refs: ReadonlyArray<KnowledgeEvidenceRef> | undefined,
): Promise<void> {
  if (!refs || refs.length === 0) return;
  if (!host.verifyInputEvidence) {
    throw new EvidenceGuardRejectionError(
      KNOWLEDGE_EVIDENCE_GUARDS.forbidden,
      KNOWLEDGE_EVIDENCE_REASONS.gateUnavailable,
      refs[0]?.receiptId ?? "",
    );
  }
  // 宿主可能在 RPC 断连、账本关闭等情况下抛异常；统一转为结构化拒绝，
  // 而不是让异常逃出 ACK guard 分类。任何异常都不得降级成无证据发送。
  let verdict: Awaited<ReturnType<NonNullable<V4CommandCoreHost["verifyInputEvidence"]>>>;
  try {
    verdict = await host.verifyInputEvidence({ sessionId, evidenceRefs: refs });
  } catch {
    throw new EvidenceGuardRejectionError(
      KNOWLEDGE_EVIDENCE_GUARDS.unavailable,
      KNOWLEDGE_EVIDENCE_REASONS.gateUnavailable,
      refs[0]?.receiptId ?? "",
    );
  }
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
