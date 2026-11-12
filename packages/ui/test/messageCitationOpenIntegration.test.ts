// @vitest-environment jsdom
// P7 本体清除改造（specs/obsidian-vault-phase2-true-extraction.md §1-C5a）：chat 渲染
// 引用点击 → conversationSelectionReference 事件总线 → 消费者（g9 面板路由替身）。
// 原 VaultView resolver（navigateKnowledgeCitation）已随 C3 拆除——receipt 解析与
// 原文定位在插件面板内经插件 server 完成；本文件锁定本体侧契约：渲染端只发
// opaque receiptId、事件单消费者认领、同键单击去重、插件不在场（无消费者）时
// 结构化 unavailable 终态（降级提示消费端见 knowledgeEvidenceSendFailure /
// knowledgeCitationOpenFeedback）。
import { createElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import {
  getKnowledgeCitationOpenEventName,
  isKnowledgeCitationOpenEvent,
  requestKnowledgeCitationOpen,
  type KnowledgeCitationOpenResult,
} from "@/lib/conversationSelectionReference.js";

const receipt = "evr-opaque-test";
const session = "session-1";
const workspace = "/workspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderAnswer(
  text: string,
  onOpen: (index: number) => void,
  indices: readonly number[] = [1],
) {
  return render(
    createElement(
      TooltipProvider,
      null,
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          MessageResponse,
          {
            theme: "light",
            sessionId: session,
            knowledgeCitationScopeKey: "session-1:turn-1:receipt-1",
            knowledgeCitationIndices: indices,
            onOpenKnowledgeCitation: onOpen,
          },
          text,
        ),
      ),
    ),
  );
}

function createOpenAdapter() {
  const requests: Array<Promise<KnowledgeCitationOpenResult>> = [];
  const onOpen = vi.fn((index: number) => {
    if (index !== 1) return;
    requests.push(
      requestKnowledgeCitationOpen({
        receiptId: receipt,
        targetSessionId: session,
        workspaceKey: workspace,
      }),
    );
  });
  return { onOpen, requests };
}

/** g9 面板路由替身：Shell 侧 openWith 编排（WorkspaceShellLayout）的受控行为桩。 */
function installPanelRouterStub(result: KnowledgeCitationOpenResult) {
  const consumer = vi.fn((event: Event) => {
    if (!isKnowledgeCitationOpenEvent(event)) return;
    const detail = event.detail;
    if (detail.accepted || detail.targetSessionId !== session || detail.workspaceKey !== workspace)
      return;
    detail.accepted = true;
    detail.finish(result);
  });
  window.addEventListener(getKnowledgeCitationOpenEventName(), consumer);
  return () => window.removeEventListener(getKnowledgeCitationOpenEventName(), consumer);
}

describe("chat 渲染引用 → 事件总线 → 面板路由（g9 openWith 替身）", () => {
  it("点击真实引用 → 单消费者认领 → openWith 终态 ok", async () => {
    const { onOpen, requests } = createOpenAdapter();
    const detach = installPanelRouterStub({ ok: true });
    try {
      const view = renderAnswer("According to the note [1].", onOpen);
      const source = await waitFor(() => view.getByTestId("knowledge-inline-citation-1"));
      fireEvent.click(source);
      expect(onOpen).toHaveBeenCalledExactlyOnceWith(1);
      expect(requests).toHaveLength(1);
      expect(await requests[0]).toEqual({ ok: true });
    } finally {
      detach();
    }
  });

  it("插件面板不在场（无消费者认领）→ 结构化 unavailable 终态（降级提示语义）", async () => {
    const { onOpen, requests } = createOpenAdapter();
    try {
      const view = renderAnswer("Orphaned note [1].", onOpen);
      fireEvent.click(await waitFor(() => view.getByTestId("knowledge-inline-citation-1")));
      // 无消费者 → dispatch 后立即终态 unavailable（不再有宿主面板 fail-open 挂载）。
      expect(await requests[0]).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      cleanup();
    }
  });

  it("面板路由失败（openWith 投递超时等）→ failed 终态，不静默落空", async () => {
    const { onOpen, requests } = createOpenAdapter();
    const detach = installPanelRouterStub({ ok: false, reason: "failed" });
    try {
      const view = renderAnswer("Broken route [1].", onOpen);
      fireEvent.click(await waitFor(() => view.getByTestId("knowledge-inline-citation-1")));
      expect(await requests[0]).toEqual({ ok: false, reason: "failed" });
    } finally {
      detach();
    }
  });

  it("does not dispatch when clicking a model-authored fake hash link", async () => {
    const onOpen = vi.fn();
    const onEvent = vi.fn();
    window.addEventListener(getKnowledgeCitationOpenEventName(), onEvent);
    try {
      const view = renderAnswer(
        "[1](#drora-knowledge-source-1) and a real citation [2].",
        onOpen,
        [1, 2],
      );
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

  it("同键快速重复点击共享同一在途请求（去重，防重复投递面板）", async () => {
    const detach = installPanelRouterStub({ ok: true });
    try {
      const first = requestKnowledgeCitationOpen({
        receiptId: receipt,
        targetSessionId: session,
        workspaceKey: workspace,
      });
      const second = requestKnowledgeCitationOpen({
        receiptId: receipt,
        targetSessionId: session,
        workspaceKey: workspace,
      });
      expect(second).toBe(first);
      expect(await first).toEqual({ ok: true });
    } finally {
      detach();
    }
  });
});
