import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendConversationSelectionReference,
  requestKnowledgeAgentHandoff,
  requestKnowledgeCitationOpen,
  KNOWLEDGE_CITATION_OPEN_TIMEOUT_MS,
  getKnowledgeCitationOpenEventName,
  isKnowledgeCitationOpenEvent,
  commitKnowledgeAgentHandoff,
  appendConversationSelectionReferences,
  getKnowledgeAgentHandoffEventName,
  isKnowledgeAgentHandoffEvent,
  collectConversationEvidenceRefs,
  buildPromptWithConversationSelections,
  clearConversationSelectionReferenceScope,
  dispatchConversationSelectionAdd,
  getConversationSelectionReferenceScope,
  parsePromptConversationSelections,
  type ConversationSelectionReference,
} from "../src/lib/conversationSelectionReference.js";
import {
  buildPromptWithWebElementContexts,
  parsePromptWebElementContexts,
  type WebElementContextComposerAttachment,
} from "../src/lib/webElementContext.js";

function reference(
  id: string,
  sourceRowId = 1,
  text = "selected text",
): ConversationSelectionReference {
  return {
    contentType: "assistant",
    id,
    sourceRowId,
    sourceSessionId: "parent-1",
    text,
  };
}

describe("conversation selection references", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("在 composer 挂载前先写入 session scope，首次打开不会丢引用", () => {
    vi.stubGlobal("window", new EventTarget());
    const nextReference = reference("ref-before-mount");

    expect(
      dispatchConversationSelectionAdd({
        targetSessionId: "child-before-mount",
        workspaceKey: "/workspace",
        reference: nextReference,
      }),
    ).toMatchObject({ ok: true, duplicate: false });
    expect(getConversationSelectionReferenceScope("child-before-mount", "/workspace")).toEqual([
      nextReference,
    ]);

    clearConversationSelectionReferenceScope("child-before-mount", "/workspace");
  });

  it("按来源与原文去重，同文不同 row 保留", () => {
    const first = appendConversationSelectionReference([], reference("ref-1"));
    expect(first).toMatchObject({ ok: true, duplicate: false });
    if (!first.ok) return;

    const duplicate = appendConversationSelectionReference(first.references, reference("ref-2"));
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });

    const otherRow = appendConversationSelectionReference(first.references, reference("ref-3", 2));
    expect(otherRow).toMatchObject({ ok: true, duplicate: false });
    if (otherRow.ok) expect(otherRow.references).toHaveLength(2);
  });

  it("可信知识引用只在独立 command evidenceRefs 中发送 Receipt，不泄漏给 userselect", () => {
    const trusted = {
      contentType: "markdown" as const,
      id: "verified-1",
      sourceKey: "vault:notes/agent.md",
      sourceTitle: "Agent memory",
      path: "notes/agent.md",
      text: "A verified source excerpt.",
      evidenceReceiptId: "evr_verified0000000000000000000000001",
    };
    const plain = { ...trusted, id: "plain-1", sourceKey: "vault:other.md", evidenceReceiptId: undefined };
    const refs = [trusted, plain, reference("normal-1")];
    expect(collectConversationEvidenceRefs(refs)).toEqual([
      { receiptId: trusted.evidenceReceiptId },
    ]);
    const prompt = buildPromptWithConversationSelections("Compare sources", refs);
    expect(prompt).not.toContain("evidenceReceiptId");
    expect(prompt).not.toContain(trusted.evidenceReceiptId);
    expect(parsePromptConversationSelections(prompt).references).toEqual([
      { path: trusted.path, text: trusted.text },
      { path: plain.path, text: plain.text },
      { text: "selected text" },
    ]);
  });

  it("对同一段文字重新核验证据，应替换过期 Receipt 而非去重保留旧凭据", () => {
    const base = {
      contentType: "markdown" as const,
      sourceKey: "vault:topic.md",
      sourceTitle: "topic",
      path: "topic.md",
      text: "same text",
    };
    const first = appendConversationSelectionReference([], {
      ...base, id: "ref-old", evidenceReceiptId: "evr_old",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const updated = appendConversationSelectionReference(first.references, {
      ...base, id: "ref-fresh", evidenceReceiptId: "evr_fresh",
    });
    expect(updated).toMatchObject({ ok: true, duplicate: false });
    if (!updated.ok) return;
    expect(updated.references).toHaveLength(1);
    expect(collectConversationEvidenceRefs(updated.references)).toEqual([
      { receiptId: "evr_fresh" },
    ]);
    const repeated = appendConversationSelectionReference(updated.references, {
      ...base, id: "ref-third", evidenceReceiptId: "evr_fresh",
    });
    expect(repeated).toMatchObject({ ok: true, duplicate: true });
  });

  it("超限原子拒绝，不截断或修改已有引用", () => {
    const existing = [reference("ref-existing", 1, "a".repeat(8_000))];
    const rejected = appendConversationSelectionReference(
      existing,
      reference("ref-next", 2, "b".repeat(8_001)),
    );

    expect(rejected).toEqual({ ok: false, reason: "single" });
    expect(existing).toHaveLength(1);
    expect(existing[0]?.text).toHaveLength(8_000);
  });

  it("批量可信引用必须原子加入：第二项超限时首项也不能落库", () => {
    const existing = [reference("ref-existing", 1, "old")];
    const first = {
      contentType: "markdown" as const,
      id: "md1",
      sourceKey: "vault:a.md",
      sourceTitle: "A",
      path: "a.md",
      text: "verified A",
      evidenceReceiptId: "evr_a",
    };
    const large = { ...first, id: "md2", sourceKey: "vault:b.md", text: "z".repeat(20_000) };
    expect(appendConversationSelectionReferences(existing, [first, large]))
      .toEqual({ ok: false, reason: "single" });
    expect(existing).toHaveLength(1);
    const success = appendConversationSelectionReferences(existing, [first, { ...first, id: "md3", evidenceReceiptId: "evr_new" }]);
    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.references).toHaveLength(2);
      expect(collectConversationEvidenceRefs(success.references)).toEqual([{ receiptId: "evr_new" }]);
    }
  });

  it("未挂载目标 Agent 时不能静默写入引用 scope", () => {
    vi.stubGlobal("window", new EventTarget());
    const targetSessionId = "absent-composer";
    const workspaceKey = "/workspace-missing";
    const result = requestKnowledgeAgentHandoff({
      targetSessionId,
      workspaceKey,
      prompt: "请解释",
      references: [{
        contentType: "markdown",
        id: "md-evidence",
        sourceKey: "vault:a.md",
        sourceTitle: "A",
        path: "a.md",
        text: "真实片段",
        evidenceReceiptId: "evr_current",
      }],
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(getConversationSelectionReferenceScope(targetSessionId, workspaceKey)).toEqual([]);
  });

  it("Agent 接收方确认后，问题交接一次性提交真实 receipt 引用", () => {
    vi.stubGlobal("window", new EventTarget());
    const sessionId = "handoff-session";
    const workspaceKey = "/handoff-space";
    const markdown = {
      contentType: "markdown" as const,
      id: "verified-source",
      sourceKey: "vault:a.md",
      sourceTitle: "A",
      path: "a.md",
      text: "来自笔记 A 的真实片段",
      evidenceReceiptId: "evr_a1",
    };
    let dispatched = 0;
    window.addEventListener(getKnowledgeAgentHandoffEventName(), (event) => {
      if (!isKnowledgeAgentHandoffEvent(event)) return;
      const detail = event.detail;
      if (detail.targetSessionId !== sessionId || detail.workspaceKey !== workspaceKey) return;
      const appended = appendConversationSelectionReferences(
        getConversationSelectionReferenceScope(sessionId, workspaceKey),
        detail.references,
      );
      if (!appended.ok) return;
      commitKnowledgeAgentHandoff(detail, appended);
      detail.result = appended;
      dispatched += 1;
    });
    expect(requestKnowledgeAgentHandoff({
      targetSessionId: sessionId,
      workspaceKey,
      prompt: "比较一下",
      references: [markdown],
    })).toMatchObject({ ok: true });
    expect(dispatched).toBe(1);
    expect(collectConversationEvidenceRefs(
      getConversationSelectionReferenceScope(sessionId, workspaceKey),
    )).toEqual([{ receiptId: "evr_a1" }]);
    clearConversationSelectionReferenceScope(sessionId, workspaceKey);
  });

  it("新发送只序列化 userselect text，并恢复可见正文与 chips", () => {
    const references = [reference("ref-1"), reference("ref-2", 2, "second")];
    const prompt = buildPromptWithConversationSelections("Explain this", references);

    expect(prompt).toBe(
      [
        "Explain this",
        "",
        "# userselect:",
        "```userselect",
        JSON.stringify([{ text: "selected text" }, { text: "second" }]),
        "```",
      ].join("\n"),
    );
    expect(prompt).not.toContain("sourceSessionId");
    expect(prompt).not.toContain("sourceRowId");
    expect(prompt).not.toContain("contentType");
    expect(prompt).not.toContain('"id"');
    expect(parsePromptConversationSelections(prompt)).toEqual({
      visibleContent: "Explain this",
      references: [{ text: "selected text" }, { text: "second" }],
    });
  });

  it("文件路径随选段往返，普通对话与无路径 Markdown 不发送内部来源", () => {
    const file = {
      id: "md",
      contentType: "markdown" as const,
      sourceKey: "identity",
      sourceTitle: "note",
      path: "C:\\docs\\a.md",
      text: "excerpt",
    };
    const prompt = buildPromptWithConversationSelections("Explain", [
      file,
      reference("msg"),
      { ...file, path: undefined },
    ]);
    expect(parsePromptConversationSelections(prompt)).toEqual({
      visibleContent: "Explain",
      references: [
        { path: file.path, text: "excerpt" },
        { text: "selected text" },
        { text: "excerpt" },
      ],
    });
    expect(prompt).not.toContain("identity");
    expect(
      buildPromptWithConversationSelections(
        "Explain",
        parsePromptConversationSelections(prompt).references,
      ),
    ).toBe(prompt);
  });

  it.each([42, "", "   ", null])("非法文件路径不吞掉原文：%s", (path) => {
    const prompt =
      "# userselect:\n```userselect\n" + JSON.stringify([{ path, text: "excerpt" }]) + "\n```";
    expect(parsePromptConversationSelections(prompt)).toEqual({
      visibleContent: prompt,
      references: [],
    });
  });

  it("继续只读解析旧 Conversation selections 完整结构块", () => {
    const references = [reference("legacy-ref")];
    const legacyPrompt = [
      "Explain legacy",
      "",
      "# Conversation selections:",
      "```drora-conversation-selections",
      JSON.stringify(references),
      "```",
    ].join("\n");

    expect(parsePromptConversationSelections(legacyPrompt)).toEqual({
      visibleContent: "Explain legacy",
      references,
    });
  });

  it("与 Web element block 共存且按发送端顺序逐层解析", () => {
    const webContext: WebElementContextComposerAttachment = {
      id: "web-1",
      pageTitle: "Example",
      pageUrl: "https://example.com",
      selector: "#submit",
      tagName: "button",
      text: "Submit",
      workspacePath: "/workspace",
    };
    const selectionReferences = [reference("ref-1")];
    const prompt = buildPromptWithWebElementContexts(
      buildPromptWithConversationSelections("Explain both", selectionReferences),
      [webContext],
    );
    const webParsed = parsePromptWebElementContexts(prompt, {
      workspacePath: "/workspace",
    });
    const selectionParsed = parsePromptConversationSelections(webParsed.visibleContent);

    expect(webParsed.webElementContexts).toHaveLength(1);
    expect(selectionParsed).toEqual({
      visibleContent: "Explain both",
      references: [{ text: "selected text" }],
    });
  });
  it("trusted citation navigation is handled only by a mounted matching-session Vault", async () => {
    vi.stubGlobal("window", new EventTarget());
    const noView = await requestKnowledgeCitationOpen({
      targetSessionId: "session-1", workspaceKey: "/vault", receiptId: "evr_a",
    });
    expect(noView).toEqual({ ok: false, reason: "unavailable" });
    let received = 0;
    window.addEventListener(getKnowledgeCitationOpenEventName(), (event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      if (event.detail.targetSessionId !== "session-1" || event.detail.workspaceKey !== "/vault") return;
      if (event.detail.accepted) return;
      received++;
      event.detail.accepted = true;
      event.detail.finish({ ok: true });
    });
    expect(await requestKnowledgeCitationOpen({
      targetSessionId: "session-1", workspaceKey: "/vault", receiptId: "evr_a",
    })).toEqual({ ok: true });
    expect(received).toBe(1);
    expect(await requestKnowledgeCitationOpen({
      targetSessionId: "session-other", workspaceKey: "/vault", receiptId: "evr_a",
    })).toEqual({ ok: false, reason: "unavailable" });
    expect(received).toBe(1);
  });

  it("malformed navigation requests never dispatch a source-open event", async () => {
    vi.stubGlobal("window", new EventTarget());
    let observed = false;
    window.addEventListener(getKnowledgeCitationOpenEventName(), () => { observed = true; });
    expect(await requestKnowledgeCitationOpen({
      targetSessionId: "", workspaceKey: "/vault", receiptId: "evr_a",
    })).toEqual({ ok: false, reason: "unavailable" });
    expect(await requestKnowledgeCitationOpen({
      targetSessionId: "session-1", workspaceKey: "/vault", receiptId: " ",
    })).toEqual({ ok: false, reason: "unavailable" });
    expect(observed).toBe(false);
  });

  it("deduplicates rapid identical receipt opens and releases the lock after completion", async () => {
    vi.stubGlobal("window", new EventTarget());
    let events = 0;
    let finish: ((result: { ok: true }) => void) | undefined;
    window.addEventListener(getKnowledgeCitationOpenEventName(), (event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      events++;
      event.detail.accepted = true;
      finish = event.detail.finish;
    });
    const input = { targetSessionId: "s1", workspaceKey: "/vault", receiptId: "evr_one" };
    const first = requestKnowledgeCitationOpen(input);
    const second = requestKnowledgeCitationOpen(input);
    expect(first).toBe(second);
    expect(events).toBe(1);
    finish?.({ ok: true });
    expect(await first).toEqual({ ok: true });
    await Promise.resolve();
    expect(await requestKnowledgeCitationOpen(input)).toEqual({ ok: false, reason: "failed" });
  });

  it("fails closed after a hung accepted RPC and invalidates late navigation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    let detail: import("../src/lib/conversationSelectionReference.js").KnowledgeCitationOpenEventDetail | undefined;
    window.addEventListener(getKnowledgeCitationOpenEventName(), (event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      event.detail.accepted = true;
      detail = event.detail;
    });
    const request = requestKnowledgeCitationOpen({
      targetSessionId: "s2", workspaceKey: "/vault", receiptId: "evr_hung",
    });
    expect(detail?.isActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(KNOWLEDGE_CITATION_OPEN_TIMEOUT_MS);
    expect(await request).toEqual({ ok: false, reason: "failed" });
    expect(detail?.isActive()).toBe(false);
    detail?.finish({ ok: true });
    expect(detail?.isActive()).toBe(false);
  });

  it("invalidates a synchronously finished navigation and does not leave a timer running", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    window.addEventListener(getKnowledgeCitationOpenEventName(), (event) => {
      if (!isKnowledgeCitationOpenEvent(event)) return;
      event.detail.accepted = true;
      event.detail.finish({ ok: true });
      expect(event.detail.isActive()).toBe(false);
    });
    expect(await requestKnowledgeCitationOpen({
      targetSessionId: "s3", workspaceKey: "/vault", receiptId: "evr_sync",
    })).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

});
