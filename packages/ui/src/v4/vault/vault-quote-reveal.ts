import { EditorView } from "@codemirror/view";
import { isVaultCitationFocusCurrent } from "./knowledge/knowledgeCitationNavigation.js";

/**
 * 引用回跳的行锚定（W04 / specs/obsidian-knowledge.md §5c.1）。
 *
 * quote selector 的行号在「原始文本」与「规范化文本（\r?\n → \n）」中同义
 * （markdownChunker 按 \r?\n 切行），字符偏移则会随换行符漂移——因此按行号锚定，
 * 不用偏移。锚定后选中原引用行区间并滚动到视口居中，用户能直接看到被引用的原文。
 */
export function revealVaultQuote(
  view: EditorView,
  quote: { startLine: number; endLine: number },
): void {
  const doc = view.state.doc;
  const startLine = Math.max(1, Math.min(quote.startLine, doc.lines));
  const endLine = Math.max(startLine, Math.min(quote.endLine, doc.lines));
  const from = doc.line(startLine).from;
  const to = doc.line(endLine).to;
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
  view.focus();
}

/**
 * The actual CodeMirror entrypoint for a delayed citation focus. Revalidate
 * the captured epoch immediately before mutating selection or focus, even if
 * the editor mounted after the session/Vault switched A→B→A.
 */
export function revealVaultQuoteIfCurrent(
  view: EditorView,
  quote: { startLine: number; endLine: number },
  requestEpoch: number | undefined,
  activeEpoch: number,
): boolean {
  if (!isVaultCitationFocusCurrent(requestEpoch, activeEpoch)) return false;
  revealVaultQuote(view, quote);
  return true;
}
