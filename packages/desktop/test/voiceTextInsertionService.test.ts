import { describe, expect, it } from "vitest";
import {
  insertTextAtFrontmostCursor,
  shouldRestoreSnapshot,
  type TextInsertionDeps,
} from "../src/main/voiceTextInsertionService.js";

/**
 * §5.6 终稿注入契约（specs/voice-agent-integration.md §5.6，Proma text-insertion 同款，
 * 适配 Electron 44 异步 clipboard）：注入主链（快照→写入→⌘V→定时还原原样条目）；
 * 还原判定（纯函数）；兜底语义（辅助功能未授权不劫持剪贴板；粘贴失败文本留在剪贴板）。
 */

function makeClipboard(initial: { text?: string; items?: unknown[] } = {}) {
  const state = {
    text: initial.text ?? "",
    items: initial.items ?? [],
    writes: [] as Array<Record<string, unknown>>,
    pasted: false,
  };
  const deps: TextInsertionDeps = {
    readText: async () => state.text,
    readAll: async () => state.items,
    writeText: async (text) => {
      state.writes.push({ text });
      state.text = text;
    },
    writeAll: async (items) => {
      state.writes.push({ items });
      state.items = items;
      state.text = items.length > 0 ? "restored" : "";
    },
    clear: () => {
      state.text = "";
      state.items = [];
    },
    triggerPaste: async () => {
      state.pasted = true;
    },
    isTrustedAccessibilityClient: () => true,
    sleep: async () => undefined,
    setTimeoutUnref: (cb) => cb(), // 测试同步执行还原。
  };
  return { deps, state };
}

describe("还原判定（纯逻辑）", () => {
  it("用户未改动（仍是注入文本）才还原", () => {
    expect(shouldRestoreSnapshot("注入文本", "注入文本")).toBe(true);
    expect(shouldRestoreSnapshot("用户复制的新内容", "注入文本")).toBe(false);
  });
});

describe("注入主链", () => {
  it("成功路径：快照→写入→粘贴→还原原样条目", async () => {
    const clip = makeClipboard({ text: "旧文本", items: [{ kind: "text/html", blob: "x" }] });
    const result = await insertTextAtFrontmostCursor("你好世界", clip.deps);
    expect(result).toEqual({ success: true });
    expect(clip.state.writes[0]).toEqual({ text: "你好世界" });
    expect(clip.state.pasted).toBe(true);
    expect(clip.state.writes.at(-1)).toEqual({ items: [{ kind: "text/html", blob: "x" }] });
  });

  it("原剪贴板为空：还原为 clear（不残留注入文本）", async () => {
    const clip = makeClipboard();
    await insertTextAtFrontmostCursor("你好", clip.deps);
    expect(clip.state.text).toBe("");
    expect(clip.state.items).toHaveLength(0);
  });

  it("辅助功能未授权 → 不劫持剪贴板，返回引导错误", async () => {
    const clip = makeClipboard({ text: "旧" });
    clip.deps.isTrustedAccessibilityClient = () => false;
    const result = await insertTextAtFrontmostCursor("你好", clip.deps);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("accessibility");
    expect(clip.state.writes).toHaveLength(0); // 未动剪贴板
  });

  it("粘贴失败 → 兜底：文本留在剪贴板", async () => {
    const clip = makeClipboard();
    clip.deps.triggerPaste = async () => {
      throw new Error("osascript timeout");
    };
    clip.deps.setTimeoutUnref = () => undefined;
    const result = await insertTextAtFrontmostCursor("你好", clip.deps);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("clipboard");
    expect(clip.state.text).toBe("你好"); // 兜底保留
  });

  it("空文本 → 拒绝", async () => {
    const clip = makeClipboard();
    const result = await insertTextAtFrontmostCursor("   ", clip.deps);
    expect(result.success).toBe(false);
  });
});
