/**
 * Renderer-only provenance matching for Obsidian ANSWER/COMPARE drafts.
 *
 * This is an integrity preflight, NOT a source-authentication mechanism. Only the
 * Knowledge Query Service and CLI evidence admission/queue-promotion gates can
 * confirm a receipt is current. Never serialize source metadata or receipts into
 * model-facing userselect text.
 */
import type { ConversationSelectionReference } from "./conversationSelectionReference.js";

export interface KnowledgeDraftSource {
  relativePath: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  index: number;
}

export const KNOWLEDGE_SOURCE_MANIFEST_HEADER =
  "来源索引（顺序与附带的原文证据片段一致）：";

export function formatKnowledgeDraftSource(source: KnowledgeDraftSource): string {
  return `[${source.index}] path=${JSON.stringify(source.relativePath)} heading=${JSON.stringify(source.heading)} lines=${source.startLine}-${source.endLine}`;
}

export type KnowledgeSourceManifestStatus = "not-applicable" | "valid" | "mismatch";

/**
 * Reject a handoff draft if the source labels shown to the model differ from
 * the actual trusted receipts attached to the composer (including edited,
 * reordered, removed or replaced sources). User-edited questions are allowed.
 */
export function validateKnowledgeSourceManifest(
  prompt: string,
  references: readonly ConversationSelectionReference[],
): KnowledgeSourceManifestStatus {
  const trusted = references.filter(
    (item) => item.contentType === "markdown" && Boolean(item.evidenceReceiptId),
  );
  const indexed = trusted.filter(
    (item) => item.contentType === "markdown" && item.evidenceSource !== undefined,
  );
  const header = KNOWLEDGE_SOURCE_MANIFEST_HEADER;
  const markerCount = prompt.split(header).length - 1;
  if (markerCount === 0 && indexed.length === 0) return "not-applicable";
  if (markerCount !== 1 || indexed.length === 0 || trusted.length !== indexed.length) return "mismatch";

  const lines = prompt.split("\n");
  const headerIndex = lines.findIndex((line) => line === header);
  if (headerIndex === -1) return "mismatch";
  const sourceLines: string[] = [];
  for (let i = headerIndex + 1; i < lines.length && lines[i]?.trim(); i += 1) {
    sourceLines.push(lines[i]!);
  }
  if (sourceLines.length !== indexed.length) return "mismatch";
  const seen = new Set<string>();
  for (let i = 0; i < indexed.length; i += 1) {
    const item = indexed[i];
    if (item?.contentType !== "markdown" || !item.evidenceReceiptId || !item.evidenceSource) {
      return "mismatch";
    }
    const source = item.evidenceSource;
    if (
      source.index !== i + 1 ||
      source.relativePath !== item.path ||
      !Number.isInteger(source.startLine) ||
      !Number.isInteger(source.endLine) ||
      source.startLine < 1 ||
      source.endLine < source.startLine ||
      seen.has(item.evidenceReceiptId) ||
      sourceLines[i] !== formatKnowledgeDraftSource(source)
    ) return "mismatch";
    seen.add(item.evidenceReceiptId);
  }
  return "valid";
}
