/**
 * Per-product-turn Obsidian provenance. The CLI projects evidenceRefs from the
 * admitted canonical TurnInputIntent onto UserInputRow; do not read mutable
 * Composer state or find receipts by searching an assistant's generated text.
 *
 * The label index comes from the original prompt. Labels are NOT authority:
 * clicking a source passes only the opaque receipt to the Vault host, which
 * resolves a fresh citation and determines the actual file/quote.
 */
import type { UserInputRow } from "@drora/shared/drora-protocol-v4";
import { KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX, MAX_EVIDENCE_REFS_PER_INPUT } from "@drora/shared";
import { KNOWLEDGE_SOURCE_MANIFEST_HEADER } from "@/lib/conversationKnowledgeSources.js";

export interface KnowledgeTurnCitation {
  index: number;
  receiptId: string;
  /** Display hint from the submitted source index, never a navigation target. */
  relativePath: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  sourceCommandId: string;
}

type SourceInput = Pick<
  UserInputRow,
  "turnId" | "sourceCommandId" | "origin" | "evidenceRefs" | "conversationQuotes" | "text"
>;

/** The manifest uses JSON strings; a filename cannot create an extra source line. */
const SOURCE_LINE =
  /^\[(\d+)\] path=("(?:\\.|[^"\\])*") heading=(null|"(?:\\.|[^"\\])*") lines=(\d+)-(\d+)$/;

export function readKnowledgeTurnCitations(
  turnId: string,
  userInputs: readonly SourceInput[],
  headerSourceCommandId?: string,
): KnowledgeTurnCitation[] {
  // One source-bound canonical input per turn. Multiple independent user
  // inputs (e.g. a guide/steer) must not be combined into an invented mapping.
  const bound = userInputs.filter(
    (row) =>
      row.turnId === turnId &&
      row.origin === "realUser" &&
      row.sourceCommandId &&
      row.evidenceRefs?.length,
  );
  if (bound.length !== 1) return [];
  const input = bound[0]!;
  if (headerSourceCommandId && input.sourceCommandId !== headerSourceCommandId) return [];
  // A second real user command in the same product turn is an ambiguous
  // citation scope. Do not silently attach original receipts to a later answer.
  if (
    userInputs.some(
      (row) =>
        row.turnId === turnId &&
        row.origin === "realUser" &&
        row.sourceCommandId !== input.sourceCommandId,
    )
  )
    return [];
  const receipts = input.evidenceRefs ?? [];
  // 上限取 wire 契约常量（C-3 修复）：读取端不再自造魔数 5——6–8 条合法
  // evidenceRefs（单候选逐条「加入 Agent」路径可达）不再被整组静默丢弃。
  if (receipts.length < 1 || receipts.length > MAX_EVIDENCE_REFS_PER_INPUT) return [];
  if (new Set(receipts.map((r) => r.receiptId)).size !== receipts.length) return [];
  if (receipts.some((r) => !r.receiptId.startsWith(KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX)))
    return [];

  // D-2 修复：quote 级收据绑定（渲染器随可信 Markdown 引用携带 evidenceReceiptId）。
  // 有绑定时按 receiptId 一一配对，普通对话选区不再使计数门必然失配；无绑定的
  // 旧投影行回落整表等长校验（旧行不存在混合输入形态，语义不变）。
  const quotes = input.conversationQuotes ?? [];
  const receiptedQuotes = quotes.filter((quote) => typeof quote.evidenceReceiptId === "string");
  let quoteByReceipt: ReadonlyMap<string, { path?: string; text: string }> | null = null;
  if (receiptedQuotes.length > 0) {
    if (receiptedQuotes.length !== receipts.length) return [];
    const map = new Map<string, { path?: string; text: string }>();
    for (const quote of receiptedQuotes) {
      const receiptId = quote.evidenceReceiptId!;
      if (!receipts.some((r) => r.receiptId === receiptId)) return [];
      if (map.has(receiptId)) return [];
      map.set(receiptId, { path: quote.path, text: quote.text });
    }
    quoteByReceipt = map;
  } else if (quotes.length !== receipts.length) {
    // The structured excerpts were submitted in the same canonical input.
    // Reject a model-facing legend that names different files or drops excerpts.
    return [];
  }

  const text = input.text;
  if (text.split(KNOWLEDGE_SOURCE_MANIFEST_HEADER).length !== 2) return [];
  const lines = text.split("\n");
  const header = lines.findIndex((line) => line === KNOWLEDGE_SOURCE_MANIFEST_HEADER);
  if (header === -1) return [];
  const sourceLines: string[] = [];
  for (let at = header + 1; at < lines.length && lines[at]?.trim(); at += 1) {
    sourceLines.push(lines[at]!);
  }
  if (sourceLines.length !== receipts.length) return [];

  try {
    return sourceLines.map((line, index) => {
      const match = SOURCE_LINE.exec(line);
      if (!match || Number(match[1]) !== index + 1) throw new Error("noncontiguous index");
      const relativePath: unknown = JSON.parse(match[2]!);
      const heading: unknown = JSON.parse(match[3]!);
      const startLine = Number(match[4]);
      const endLine = Number(match[5]);
      // 收据绑定行按 receiptId 配对（顺序无关）；旧行沿用位置对齐。
      const boundQuote = quoteByReceipt
        ? quoteByReceipt.get(receipts[index]!.receiptId)
        : quotes[index];
      if (
        typeof relativePath !== "string" ||
        !relativePath ||
        boundQuote?.path !== relativePath ||
        !boundQuote?.text.trim() ||
        (heading !== null && typeof heading !== "string") ||
        !Number.isSafeInteger(startLine) ||
        startLine < 1 ||
        !Number.isSafeInteger(endLine) ||
        endLine < startLine
      )
        throw new Error("invalid source record");
      return {
        index: index + 1,
        receiptId: receipts[index]!.receiptId,
        relativePath,
        heading: heading as string | null,
        startLine,
        endLine,
        sourceCommandId: input.sourceCommandId!,
      };
    });
  } catch {
    return [];
  }
}

/** Display-only diagnostic. Presence of [n] cannot prove factual support. */
export function readAnswerCitationNumbers(text: string): number[] {
  const seen = new Set<number>();
  // Strict numeric citation shape; do not treat ordinary paths as sources.
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
    const id = Number(match[1]);
    if (id > 0) seen.add(id);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Heuristic coverage audit of model-generated prose, never semantic fact-checking.
 * Code, table rows, quoted blocks and headings are skipped so that their numeric
 * markers are not mistaken for sources.
 */
export interface KnowledgeAnswerCitationCoverage {
  proseBlocks: number;
  attributedBlocks: number;
  unattributedBlocks: number;
  unknownNumbers: number[];
  knownNumbers: number[];
}

export function auditKnowledgeAnswerCitationCoverage(
  text: string,
  sourceCount: number,
): KnowledgeAnswerCitationCoverage {
  const blocks: string[] = [];
  let chunk: string[] = [];
  let fence: string | null = null;
  const flush = (): void => {
    if (chunk.length) blocks.push(chunk.join(" "));
    chunk = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match) {
      flush();
      const symbol = match[1]![0]!;
      if (!fence) fence = symbol;
      else if (fence === symbol) fence = null;
      continue;
    }
    if (fence || /^\s*(?:#{1,6}\s|>|[|]|-{3,}$|\*{3,}$)/.test(line)) {
      flush();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)) flush();
    chunk.push(line);
  }
  flush();
  const knownNumbers = new Set<number>();
  const unknownNumbers = new Set<number>();
  let proseBlocks = 0;
  let attributedBlocks = 0;
  for (const block of blocks) {
    // Inline code / normal Markdown links must not count as [n] provenance.
    const plain = block.replace(/\x60+[^\x60]*\x60+/g, "").replace(/!?\[[^\]]*\]\([^)]*\)/g, "");
    const numbers = [...plain.matchAll(/\[([1-9]\d?)\]/g)].map((match) => Number(match[1]));
    if (plain.replace(/\[[1-9]\d?\]/g, "").trim().length < 16) continue;
    proseBlocks++;
    for (const n of numbers) {
      if (n <= sourceCount) knownNumbers.add(n);
      else unknownNumbers.add(n);
    }
    if (numbers.some((n) => n <= sourceCount)) attributedBlocks++;
  }
  return {
    proseBlocks,
    attributedBlocks,
    unattributedBlocks: proseBlocks - attributedBlocks,
    knownNumbers: [...knownNumbers].sort((a, b) => a - b),
    unknownNumbers: [...unknownNumbers].sort((a, b) => a - b),
  };
}
