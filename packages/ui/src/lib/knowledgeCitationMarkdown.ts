/**
 * Assistant [n] citation links are presentational only. The allow-list comes
 * from an admitted turn's Receipt-backed source manifest, never model text.
 * The click handler still asks VaultView to revalidate the opaque Receipt.
 * Streamdown strips our custom mdast hProperties. Use a renderer-generated,
 * per-scope nonce in the fragment URL so model-authored links cannot impersonate
 * internal source bindings; VaultView still validates the actual Receipt.
 *
 * Transform mdast text nodes (not raw Markdown strings) so code, HTML, links,
 * headings and reference definitions cannot be silently rewritten.
 */
import type { Plugin } from "unified";

export const KNOWLEDGE_CITATION_HASH_PREFIX = "#drora-knowledge-source-";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  /** Internal mdast-to-hast marker; ordinary model Markdown links lack it. */
  data?: { hProperties?: Record<string, string> };
  children?: MarkdownNode[];
}

const CITATION_TEXT = /\[([1-5])\]/g;
const NON_PROSE_NODES = new Set([
  "link", "linkReference", "image", "imageReference",
  "code", "inlineCode", "html", "heading", "definition", "blockquote",
  "table", "tableRow", "tableCell",
]);

/** A model-authored bare #drora-knowledge-source-1 link is never authoritative. */
export function parseKnowledgeCitationHref(href: string, nonce: string): number | null {
  if (!nonce) return null;
  const match = /^#drora-knowledge-source-([1-5])--([a-zA-Z0-9_-]+)$/.exec(href);
  return match?.[2] === nonce ? Number(match[1]) : null;
}

/** The unpredictable per-render nonce is minted after model output, before Streamdown. */
export function resolveBoundKnowledgeCitation(
  href: string,
  nonce: string,
  allowedIndices: readonly number[],
): number | null {
  const index = parseKnowledgeCitationHref(href, nonce);
  return index !== null && allowedIndices.includes(index) ? index : null;
}

export function linkKnownKnowledgeCitations(
  tree: MarkdownNode,
  allowedIndices: readonly number[],
  nonce: string,
): void {
  if (!nonce || !/^[a-zA-Z0-9_-]+$/.test(nonce)) return;
  const allowed = new Set(allowedIndices.filter((n) => Number.isInteger(n) && n >= 1 && n <= 5));
  if (allowed.size === 0) return;

  const visit = (node: MarkdownNode): void => {
    if (NON_PROSE_NODES.has(node.type) || !node.children) return;
    const children: MarkdownNode[] = [];
    for (const child of node.children) {
      if (child.type !== "text" || !child.value) {
        visit(child);
        children.push(child);
        continue;
      }
      CITATION_TEXT.lastIndex = 0;
      let offset = 0;
      for (const match of child.value.matchAll(CITATION_TEXT)) {
        const index = Number(match[1]);
        if (!allowed.has(index)) continue;
        const at = match.index;
        if (at === undefined) continue;
        if (at > offset) children.push({ type: "text", value: child.value.slice(offset, at) });
        children.push({
          type: "link",
          title: null,
          url: `${KNOWLEDGE_CITATION_HASH_PREFIX}${index}--${nonce}`,
          data: { hProperties: { "data-drora-bound-knowledge-source": String(index) } },
          children: [{ type: "text", value: match[0] }],
        });
        offset = at + match[0].length;
      }
      if (offset < child.value.length) children.push({ type: "text", value: child.value.slice(offset) });
    }
    node.children = children;
  };
  visit(tree);
}

export function createKnowledgeCitationRemarkPlugin(
  indices: readonly number[], nonce: string,
): Plugin {
  return function knowledgeCitationRemarkPlugin() {
    return (tree: unknown): void => linkKnownKnowledgeCitations(tree as MarkdownNode, indices, nonce);
  };
}
