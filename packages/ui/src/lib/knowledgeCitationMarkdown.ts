/**
 * Assistant [n] citation links are presentational only. The allow-list comes
 * from an admitted turn's Receipt-backed source manifest, never model text.
 * The click handler still asks VaultView to revalidate the opaque Receipt.
 *
 * Transform mdast text nodes (not raw Markdown strings) so code, HTML, links,
 * headings and reference definitions cannot be silently rewritten.
 */
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

export function parseKnowledgeCitationHref(href: string): number | null {
  const match = /^#drora-knowledge-source-([1-5])$/.exec(href);
  return match ? Number(match[1]) : null;
}

export function linkKnownKnowledgeCitations(
  tree: MarkdownNode,
  allowedIndices: readonly number[],
): void {
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
        if (at > offset) children.push({ type: "text", value: child.value.slice(offset, at) });
        children.push({
          type: "link",
          title: null,
          url: `${KNOWLEDGE_CITATION_HASH_PREFIX}${index}`,
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

export function createKnowledgeCitationRemarkPlugin(indices: readonly number[]) {
  return function knowledgeCitationRemarkPlugin() {
    return (tree: MarkdownNode): void => linkKnownKnowledgeCitations(tree, indices);
  };
}
