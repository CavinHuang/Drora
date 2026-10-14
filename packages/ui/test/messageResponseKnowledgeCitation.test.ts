// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderCitationAnswer(
  markdown: string,
  allowedIndices: readonly number[],
  onOpen: (index: number) => void,
  scopeKey = "session-1:turn-1",
) {
  return createElement(
    TooltipProvider,
    null,
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        MessageResponse,
        {
          theme: "light",
          sessionId: "session-1",
          knowledgeCitationIndices: allowedIndices,
          knowledgeCitationScopeKey: scopeKey,
          onOpenKnowledgeCitation: onOpen,
        },
        markdown,
      ),
    ),
  );
}

describe("Obsidian receipt-backed inline Markdown source navigation (rendered)", () => {
  it("creates a clickable source only for admitted prose indices", async () => {
    const open = vi.fn();
    const view = render(renderCitationAnswer(
      "来自笔记的分析内容 [1]；另一个未知来源 [4]。",
      [1, 2], open,
    ));
    const citation = await waitFor(() => view.getByTestId("knowledge-inline-citation-1"));
    expect(view.queryByTestId("knowledge-inline-citation-4")).toBeNull();
    expect(view.container.textContent).toContain("[4]");
    fireEvent.click(citation);
    expect(open).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("never turns a model-crafted fragment link into a receipt navigation", async () => {
    const open = vi.fn();
    const view = render(renderCitationAnswer(
      "[1](#drora-knowledge-source-1) and a legitimate prose citation [2].",
      [1, 2], open,
    ));
    await waitFor(() => expect(view.getByTestId("knowledge-inline-citation-2")).toBeTruthy());
    expect(view.queryByTestId("knowledge-inline-citation-1")).toBeNull();
    fireEvent.click(view.getByTestId("knowledge-inline-citation-2"));
    expect(open).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("does not activate code or headings as sources", async () => {
    const open = vi.fn();
    const view = render(renderCitationAnswer(
      "# Heading [1]\n\n`[1]` and `[2]`\n\n```javascript\n// [1]\n```\n\nNormal paragraph ends [2].",
      [1, 2], open,
    ));
    const citation = await waitFor(() => view.getByTestId("knowledge-inline-citation-2"));
    expect(view.queryByTestId("knowledge-inline-citation-1")).toBeNull();
    fireEvent.click(citation);
    expect(open).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("revokes old turn citation buttons when the bound scope changes", async () => {
    const oldOpen = vi.fn();
    const nextOpen = vi.fn();
    const markdown = "Evidence [1] and [2].";
    const view = render(renderCitationAnswer(markdown, [1], oldOpen));
    await waitFor(() => expect(view.getByTestId("knowledge-inline-citation-1")).toBeTruthy());
    view.rerender(renderCitationAnswer(markdown, [2], nextOpen, "session-2:turn-9"));
    const current = await waitFor(() => view.getByTestId("knowledge-inline-citation-2"));
    expect(view.queryByTestId("knowledge-inline-citation-1")).toBeNull();
    fireEvent.click(current);
    expect(nextOpen).toHaveBeenCalledExactlyOnceWith(2);
    expect(oldOpen).not.toHaveBeenCalled();
  });
});
