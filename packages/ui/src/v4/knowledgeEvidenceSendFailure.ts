import { KNOWLEDGE_EVIDENCE_GUARDS } from "@drora/shared";

/**
 * Interpret only exact, server-owned CLI admission reason codes.
 * Do not infer trusted evidence status from model text or arbitrary exceptions.
 */
export type KnowledgeEvidenceSendFailure =
  | "stale"
  | "missing"
  | "forbidden"
  | "unknown"
  | "unavailable";

export function resolveKnowledgeEvidenceSendFailure(
  reasonCode: string,
): KnowledgeEvidenceSendFailure | null {
  switch (reasonCode) {
    case KNOWLEDGE_EVIDENCE_GUARDS.stale:
      return "stale";
    case KNOWLEDGE_EVIDENCE_GUARDS.missing:
      return "missing";
    case KNOWLEDGE_EVIDENCE_GUARDS.forbidden:
      return "forbidden";
    case KNOWLEDGE_EVIDENCE_GUARDS.unknown:
      return "unknown";
    case KNOWLEDGE_EVIDENCE_GUARDS.unavailable:
      return "unavailable";
    default:
      return null;
  }
}
