// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeResolveCitationResult } from "@drora/services";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import {
  KNOWLEDGE_CITATION_OPEN_TIMEOUT_MS,
  getKnowledgeCitationOpenEventName,
  isKnowledgeCitationOpenEvent,
  requestKnowledgeCitationOpen,
  type KnowledgeCitationOpenResult,
} from "@/lib/conversationSelectionReference.js";
import { navigateKnowledgeCitation } from "@/v4/vault/knowledge/knowledgeCitationNavigation.js";

const quote = { startLine: 6, endLine: 7, startOffset: 64, endOffset: 84 };
const receipt = "evr-opaque-test";
const session = "session-1";
const workspace = "/workspace";
const resolved: KnowledgeResolveCitationResult = {
  status: "current",
  citation: {
    receiptId: receipt, sessionId: session, runId: "run-1",
    articleId: "article-1", relativePath: "notes/evidence.md",
    title: "Evidence", heading: null, quote, excerpt: "Verified original content",
    fileSha256: "a".repeat(64), createdAtMs: 1,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAnswer(
  text: string,
  onOpen: (index: number) => void,
  indices: readonly number[] = [1],
) {
  return render(createElement(
    TooltipProvider, null,
    createElement(
      DroraIntlProvider, { initialLocale: "zh-CN" },
      createElement(
        MessageResponse,
        {
          theme: "light",
          sessionId: session,
          knowledgeCitationScopeKey: "session-1:turn-1:receipt-1",
          knowledgeCitationIndices: indices,
          onOpenKnowledgeCitation: onOpen,
        }, text,
      ),
    ),
  ));
}

function createOpenAdapter() {
  const requests: Array<Promise<KnowledgeCitationOpenResult>> = [];
  const onOpen = vi.fn((index: number) => {
    if (index !== 1) return;
    requests.push(requestKnowledgeCitationOpen({
      receiptId: receipt, targetSessionId: session, workspaceKey: workspace,
    }));
  });
  return { onOpen, requests };
}

describe("Obsidian rendered Agent citation → event bus → Vault resolver → note reader", () => {
  it("clicks the actual Markdown source and opens only the freshly resolved note + quote", async () => {
    const { onOpen, requests } = createOpenAdapter();
    const openNote = vi.fn().mockResolvedValue(true);
    const resolveCitation = vi.fn().mockResolvedValue(resolved);
    const onEvent = (event: Event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      const detail = event.detail;
      if (detail.accepted || detail.targetSessionId !== session ||
          detail.workspaceKey !== workspace) return;
      detail.accepted = true;
      void navigateKnowledgeCitation({
        sessionId: session,
        receiptId: detail.receiptId,
        isCurrent: detail.isActive,
        resolveCitation,
        openNote,
      }).then(detail.finish);
    };
    window.addEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    try {
      const view = renderAnswer("According to the note [1].", onOpen);
      const source = await waitFor(() => view.getByTestId("knowledge-inline-citation-1"));
      fireEvent.click(source);
      expect(onOpen).toHaveBeenCalledExactlyOnceWith(1);
      expect(requests).toHaveLength(1);
      expect(await requests[0]).toEqual({ ok: true });
      expect(resolveCitation).toHaveBeenCalledOnce();
      expect(openNote).toHaveBeenCalledExactlyOnceWith(
        "notes/evidence.md", quote, expect.any(Function),
        "Verified original content", "a".repeat(64),
      );
    } finally {
      window.removeEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    }
  });

  it("rejects an expired Receipt after a real source click and never opens a note", async () => {
    const { onOpen, requests } = createOpenAdapter();
    const openNote = vi.fn().mockResolvedValue(true);
    const onEvent = (event: Event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      event.detail.accepted = true;
      void navigateKnowledgeCitation({
        sessionId: session, receiptId: event.detail.receiptId,
        isCurrent: event.detail.isActive,
        resolveCitation: async () => ({
          status: "stale", reason: null, citation: null,
        }),
        openNote,
      }).then(event.detail.finish);
    };
    window.addEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    try {
      const view = renderAnswer("Outdated note [1].", onOpen);
      fireEvent.click(await waitFor(() => view.getByTestId("knowledge-inline-citation-1")));
      expect(await requests[0]).toEqual({ ok: false, reason: "stale" });
      expect(openNote).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    }
  });

  it("does not dispatch when clicking a model-authored fake hash link", async () => {
    const onOpen = vi.fn();
    const onEvent = vi.fn();
    window.addEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    try {
      const view = renderAnswer("[1](#drora-knowledge-source-1) and a real citation [2].",
        onOpen, [1, 2]);
      await waitFor(() => view.getByTestId("knowledge-inline-citation-2"));
      const fake = view.container.querySelector('[title="#drora-knowledge-source-1"]');
      expect(fake).not.toBeNull();
      fireEvent.click(fake!);
      expect(onOpen).not.toHaveBeenCalled();
      expect(onEvent).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    }
  });

  it("blocks a late resolver response when a Vault/session scope is revoked mid-flight", async () => {
    const { onOpen, requests } = createOpenAdapter();
    let active = true;
    let finishResolve: ((value: KnowledgeResolveCitationResult) => void) | undefined;
    const openNote = vi.fn().mockResolvedValue(true);
    const onEvent = (event: Event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      event.detail.accepted = true;
      void navigateKnowledgeCitation({
        sessionId: session, receiptId: event.detail.receiptId,
        isCurrent: () => active && event.detail.isActive(),
        resolveCitation: () => new Promise((resolve) => { finishResolve = resolve; }),
        openNote,
      }).then(event.detail.finish);
    };
    window.addEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    try {
      const view = renderAnswer("Authorized when mounted [1].", onOpen);
      fireEvent.click(await waitFor(() => view.getByTestId("knowledge-inline-citation-1")));
      expect(requests).toHaveLength(1);
      expect(finishResolve).toBeDefined();
      active = false; // equivalent to switching Vault or active Session before RPC completes
      finishResolve?.(resolved);
      expect(await requests[0]).toEqual({ ok: false, reason: "forbidden" });
      expect(openNote).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    }
  });

  it("G45 deduplicates the open RPC and permanently rejects a late success after timeout", async () => {
    vi.useFakeTimers();
    let dispatchCount = 0;
    let finishLate: (() => void) | undefined;
    let isActive: (() => boolean) | undefined;
    const onEvent = (event: Event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      const detail = event.detail;
      detail.accepted = true;
      dispatchCount += 1;
      finishLate = () => detail.finish({ ok: true });
      isActive = detail.isActive;
    };
    window.addEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    try {
      const first = requestKnowledgeCitationOpen({
        receiptId: receipt, targetSessionId: session, workspaceKey: workspace,
      });
      const duplicate = requestKnowledgeCitationOpen({
        receiptId: receipt, targetSessionId: session, workspaceKey: workspace,
      });
      expect(duplicate).toBe(first);
      expect(dispatchCount).toBe(1);

      await vi.advanceTimersByTimeAsync(KNOWLEDGE_CITATION_OPEN_TIMEOUT_MS);
      await expect(first).resolves.toEqual({ ok: false, reason: "failed" });
      finishLate?.();
      expect(isActive?.()).toBe(false);
      await expect(duplicate).resolves.toEqual({ ok: false, reason: "failed" });
    } finally {
      window.removeEventListener(getKnowledgeCitationOpenEventName(), onEvent);
      vi.useRealTimers();
    }
  });

});
