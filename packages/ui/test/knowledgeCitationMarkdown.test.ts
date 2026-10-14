import { describe, expect, it } from "vitest";
import {
  createKnowledgeCitationRemarkPlugin,
  knowledgeCitationScopeDefinition,
  linkKnowledgeCitationsFromScopeDefinition,
  linkKnownKnowledgeCitations,
  parseKnowledgeCitationHref,
  resolveBoundKnowledgeCitation,
} from "../src/lib/knowledgeCitationMarkdown.js";

type Node = {
  type: string;
  value?: string;
  url?: string;
  data?: { hProperties?: Record<string, string> };
  children?: Node[];
};

function paragraph(value: string): Node {
  return { type: "paragraph", children: [{ type: "text", value }] };
}

describe("Obsidian turn-scoped inline source markers", () => {
  it("links only canonical allow-listed indices without authorizing unknown model labels", () => {
    const tree = { type: "root", children: [paragraph("A [1], B [2], unknown [3] and [99].")] };
    linkKnownKnowledgeCitations(tree, [1, 2], "test_nonce_9b0f");
    const children = tree.children[0]!.children!;
    expect(children.filter((n) => n.type === "link").map((n) => n.url)).toEqual([
      "#drora-knowledge-source-1--test_nonce_9b0f", "#drora-knowledge-source-2--test_nonce_9b0f",
    ]);
    expect(children.filter((n) => n.type === "link").map((n) =>
      n.data?.hProperties?.["data-drora-bound-knowledge-source"],
    )).toEqual(["1", "2"]);
    expect(children.map((n) => n.value ?? n.children?.[0]?.value).join("")).toBe(
      "A [1], B [2], unknown [3] and [99].",
    );
    const bound = "#drora-knowledge-source-1--test_nonce_9b0f";
    expect(parseKnowledgeCitationHref(bound, "test_nonce_9b0f")).toBe(1);
    expect(parseKnowledgeCitationHref("#drora-knowledge-source-1", "test_nonce_9b0f")).toBe(null);
    expect(parseKnowledgeCitationHref("#drora-knowledge-source-9--test_nonce_9b0f", "test_nonce_9b0f")).toBe(null);
    expect(parseKnowledgeCitationHref("https://example.com/" + bound, "test_nonce_9b0f")).toBe(null);
    expect(resolveBoundKnowledgeCitation(bound, "test_nonce_9b0f", [1, 2])).toBe(1);
    expect(resolveBoundKnowledgeCitation(bound, "wrong-nonce", [1, 2])).toBe(null);
    expect(resolveBoundKnowledgeCitation(bound, "test_nonce_9b0f", [2])).toBe(null);
    expect(resolveBoundKnowledgeCitation("#drora-knowledge-source-2--test_nonce_9b0f", "test_nonce_9b0f", [1, 2])).toBe(2);
    expect(resolveBoundKnowledgeCitation("#drora-knowledge-source-1", "test_nonce_9b0f", [1, 2])).toBe(null);
  });

  it("does not rewrite existing Markdown links, inline/fenced code, quotes, tables or headings", () => {
    const excluded = ["link", "linkReference", "inlineCode", "code", "html", "blockquote", "table", "heading"];
    const tree: Node = { type: "root", children: [
      paragraph("Ordinary prose [1]."),
      ...excluded.map((type) => ({ type, value: "[1]", children: [{ type: "text", value: "[1]" }] })),
    ] };
    linkKnownKnowledgeCitations(tree, [1], "test_nonce_9b0f");
    expect(tree.children?.[0]?.children?.some((n) => n.type === "link")).toBe(true);
    for (const item of tree.children!.slice(1)) {
      expect(item.children?.[0]?.type).toBe("text");
      expect(item.children?.[0]?.value).toBe("[1]");
    }
  });

  it("keeps unknown and ordinary messages inert even for manufactured fragments", () => {
    const original = paragraph("This is [1] and [4].");
    linkKnownKnowledgeCitations(original, [], "test_nonce_9b0f");
    expect(original.children).toEqual([{ type: "text", value: "This is [1] and [4]." }]);
    expect(typeof createKnowledgeCitationRemarkPlugin([2], "test_nonce_9b0f")).toBe("function");
    expect(original.children).toEqual([{ type: "text", value: "This is [1] and [4]." }]);
  });

  it("handles repeated/nested prose markers and leaves explicit Markdown links alone", () => {
    const tree: Node = { type: "paragraph", children: [
      { type: "strong", children: [{ type: "text", value: "[1] and [1]" }] },
      { type: "link", url: "https://example.com", children: [{ type: "text", value: "[1]" }] },
    ] };
    linkKnownKnowledgeCitations(tree, [1], "test_nonce_9b0f");
    expect(tree.children?.[0]?.children?.filter((n) => n.type === "link")).toHaveLength(2);
    expect(tree.children?.[1]?.url).toBe("https://example.com");
  });
  it("pulls current indices and nonce from a parsed per-render marker, not a cached plugin closure", () => {
    const first = {
      type: "root",
      children: [
        paragraph("Evidence [1] [2]"),
        {
          type: "definition",
          identifier: "drora-knowledge-scope-nonce_one--1",
          url: "#drora-knowledge-scope-nonce_one",
        },
      ],
    };
    const second = {
      type: "root",
      children: [
        paragraph("Evidence [1] [2]"),
        {
          type: "definition",
          identifier: "drora-knowledge-scope-nonce_two--2",
          url: "#drora-knowledge-scope-nonce_two",
        },
      ],
    };
    expect(knowledgeCitationScopeDefinition("nonce_one", [1, 1])).toBe(
      "[drora-knowledge-scope-nonce_one--1]: #drora-knowledge-scope-nonce_one",
    );
    linkKnowledgeCitationsFromScopeDefinition(first);
    linkKnowledgeCitationsFromScopeDefinition(second);
    expect(first.children[0]?.children?.filter((node) => node.type === "link").map((node) => node.url))
      .toEqual(["#drora-knowledge-source-1--nonce_one"]);
    expect(second.children[0]?.children?.filter((node) => node.type === "link").map((node) => node.url))
      .toEqual(["#drora-knowledge-source-2--nonce_two"]);
  });

  it("does not allow unmarked AST text to become a clickable source", () => {
    const tree = { type: "root", children: [paragraph("[1]") ] };
    linkKnowledgeCitationsFromScopeDefinition(tree);
    expect(tree.children[0]?.children?.[0]?.type).toBe("text");
    expect(knowledgeCitationScopeDefinition("", [1])).toBe("");
    expect(knowledgeCitationScopeDefinition("nonce", [8])).toBe("");
  });

});
