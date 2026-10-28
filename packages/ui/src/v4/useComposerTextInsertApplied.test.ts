// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
import type { ComposerTextInsertRequest } from "@/store/droraSessionStoreTypes.js";
import { useComposerTextInsertApplied } from "./useComposerTextInsertApplied.js";

/**
 * composerTextInsertRequest 多槽形态守护（specs/voice-agent-integration.md §9.9.2-H4，
 * 2026-10-26）：槽键 = targetSessionId ?? ""（空串 = 草稿 composer 槽）；同槽 append
 * 叠加合并；applied 判定以槽态为准（全局 version 仅发号，不参与判定）。
 * 全部用例走真 store actions（droraSessionStoreWorkspaceSlice 生产写路径），非测试复制品。
 */

let wsPath = "/ws-h4";

function slots(): Record<string, ComposerTextInsertRequest> {
  return useDroraSessionStore.getState().getWorkspaceState(wsPath).composerTextInsertRequests;
}

function slot(key: string): ComposerTextInsertRequest | undefined {
  return slots()[key];
}

beforeEach(() => {
  // 每用例独立 workspacePath：workspace 状态跨用例存活，按 workspace 隔离断言。
  wsPath = `/ws-h4-${Date.now()}-${Math.random().toString(36).slice(2)}`;
});

afterEach(() => {
  cleanup();
});

describe("多槽写入与消费（§9.9.2-H4）", () => {
  it("keeps session A's slot intact while session B's final lands: no cross-slot overwrite", async () => {
    const store = useDroraSessionStore.getState();
    // 会话 A 听写 final 落槽后焦点切至 pane B、B 会话 final 到达。
    const idA = store.requestComposerTextInsert(wsPath, "A 的 final。", undefined, undefined, "append", "sess-A");
    const idB = store.requestComposerTextInsert(wsPath, "B 的 final。", undefined, undefined, "append", "sess-B");
    // A 槽保留、B 槽独立写入（旧单槽实现下 A 槽被 B 覆盖——回退即红：槽结构退回单槽
    // 则 A 的文本丢失）。
    expect(slot("sess-A")).toMatchObject({
      requestId: idA,
      text: "A 的 final。",
      mode: "append",
      targetSessionId: "sess-A",
    });
    expect(slot("sess-B")).toMatchObject({ requestId: idB, text: "B 的 final。" });
    // 焦点回 A 时 A 消费恰一次：按 requestId 扫槽清除，B 槽不受影响。
    useDroraSessionStore.getState().clearComposerTextInsertRequest(wsPath, idA);
    expect(slot("sess-A")).toBeUndefined();
    expect(slot("sess-B")).toMatchObject({ requestId: idB, text: "B 的 final。" });
  });

  it("merges same-slot append requests into one with the §2.4 space rule", () => {
    const store = useDroraSessionStore.getState();
    store.requestComposerTextInsert(wsPath, "第一句。", undefined, undefined, "append", "sess-A");
    const id2 = store.requestComposerTextInsert(wsPath, "第二句！", undefined, undefined, "append", "sess-A");
    // 同槽同 tick 两句 final：合并为一次插入、正文 === 句1 + 一空格 + 句2。
    expect(slot("sess-A")).toMatchObject({
      requestId: id2,
      text: "第一句。 第二句！",
      mode: "append",
    });
    // 尾空白时直连（不补第二个空格）——与消费端 appendComposerText 同款规则。
    store.requestComposerTextInsert(wsPath, "句一 ", undefined, undefined, "append", "sess-B");
    store.requestComposerTextInsert(wsPath, "句二", undefined, undefined, "append", "sess-B");
    expect(slot("sess-B")).toMatchObject({ text: "句一 句二" });
  });

  it("keeps latest-wins for non-append stacking with fields unchanged (mention/replace 族)", () => {
    const store = useDroraSessionStore.getState();
    const mention = {
      id: "plugin-x",
      category: "plugins" as const,
      label: "Plugin X",
      value: "plugin-x",
      markdown: "@[Plugin X](plugin://plugin-x)",
    };
    // 草稿槽（槽键 ""）mention 预填连续两次（replace 族）：逐字段 latest-wins。
    store.requestComposerTextInsert(wsPath, "第一段", undefined, mention, "prepend-if-missing");
    const id2 = store.requestComposerTextInsert(wsPath, "第二段", undefined, mention, "prepend-if-missing");
    const draft = slot("");
    expect(draft).toEqual({
      requestId: id2,
      text: "第二段",
      mention,
      mode: "prepend-if-missing",
    });
    // 旧 append + 新非 append：维持 latest-wins（不合并）。
    store.requestComposerTextInsert(wsPath, "语音句。", undefined, undefined, "append", "sess-A");
    const idReplace = store.requestComposerTextInsert(wsPath, "覆盖正文。", undefined, undefined, undefined, "sess-A");
    expect(slot("sess-A")).toEqual({
      requestId: idReplace,
      text: "覆盖正文。",
      targetSessionId: "sess-A",
    });
  });
});

describe("useComposerTextInsertApplied 槽态判定（§9.9.2-H4）", () => {
  it("resolves applied=true when another slot's request bumps the global version (跨槽交错不误报)", async () => {
    const store = useDroraSessionStore.getState();
    // 草稿槽插件预填 R1 等待期，语音 final 注入会话 A 槽（R2，全局 version bump）。
    const r1 = store.requestComposerTextInsert(wsPath, "草稿预填", undefined, undefined, "prepend-if-missing");
    const { result } = renderHook(() => useComposerTextInsertApplied(wsPath));
    const pending = result.current(r1, "", new AbortController().signal);
    store.requestComposerTextInsert(wsPath, "语音 final。", undefined, undefined, "append", "sess-A");
    // 草稿 composer 消费并清除 R1 → waitForComposerTextInsertApplied(R1, 草稿槽)
    // resolve true（finishMutation 收 succeeded=true，零 Failed popover）。
    // 谓词若按全局 version 比较（version=R2 > R1 且全槽无 R1）则误判 superseded——
    // 回退即红。
    useDroraSessionStore.getState().clearComposerTextInsertRequest(wsPath, r1);
    await expect(pending).resolves.toBe(true);
  });

  it("resolves superseded=false when a later request replaces or merges into the same slot", async () => {
    const store = useDroraSessionStore.getState();
    const r1 = store.requestComposerTextInsert(wsPath, "语音句一。", undefined, undefined, "append", "sess-A");
    const { result } = renderHook(() => useComposerTextInsertApplied(wsPath));
    const pending = result.current(r1, "sess-A", new AbortController().signal);
    // 同槽 append 合并：旧 id 的等待方判 superseded（语音 fire-and-forget 无消费方）。
    store.requestComposerTextInsert(wsPath, "语音句二。", undefined, undefined, "append", "sess-A");
    await expect(pending).resolves.toBe(false);
    // 同槽 replace 替换亦同（旧 id 仍在等待）。
    const r3 = store.requestComposerTextInsert(wsPath, "预填一", undefined, undefined, undefined, "sess-B");
    const pending2 = result.current(r3, "sess-B", new AbortController().signal);
    store.requestComposerTextInsert(wsPath, "预填二", undefined, undefined, undefined, "sess-B");
    await expect(pending2).resolves.toBe(false);
  });

  it("resolves applied=true on consumption for the same slot (无交错回归)", async () => {
    const store = useDroraSessionStore.getState();
    const r1 = store.requestComposerTextInsert(wsPath, "草稿预填", undefined, undefined, undefined);
    const { result } = renderHook(() => useComposerTextInsertApplied(wsPath));
    const pending = result.current(r1, "", new AbortController().signal);
    useDroraSessionStore.getState().clearComposerTextInsertRequest(wsPath, r1);
    await expect(pending).resolves.toBe(true);
  });

  it("resolves false on abort and removes the request from its slot", async () => {
    const store = useDroraSessionStore.getState();
    const r1 = store.requestComposerTextInsert(wsPath, "待中止", undefined, undefined, "append", "sess-A");
    const { result } = renderHook(() => useComposerTextInsertApplied(wsPath));
    const controller = new AbortController();
    const pending = result.current(r1, "sess-A", controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe(false);
    expect(slot("sess-A")).toBeUndefined();
  });

  it("keeps waiting while the request is still pending in its slot", async () => {
    const store = useDroraSessionStore.getState();
    const r1 = store.requestComposerTextInsert(wsPath, "等待中", undefined, undefined, "append", "sess-A");
    const { result } = renderHook(() => useComposerTextInsertApplied(wsPath));
    const pending = result.current(r1, "sess-A", new AbortController().signal);
    // 槽内仍是本 id：pending 继续等（一个 macrotask 内不 settle）。
    await new Promise((resolve) => setTimeout(resolve, 0));
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    useDroraSessionStore.getState().clearComposerTextInsertRequest(wsPath, r1);
    await expect(pending).resolves.toBe(true);
  });
});
