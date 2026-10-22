import { describe, expect, it } from "vitest";
import {
  buildPermissionAnnouncementText,
  resolveFocusedAnnouncementTail,
  VOICE_ANNOUNCEMENT_PERMISSION_MAX_CHARS,
} from "./useVoiceAnnouncement.js";

/**
 * 播报接线纯函数守护（specs/voice-agent-integration.md §4.1 / §9.3 验收
 * 「TTS 逐句播报的全文 === assistantTextRows 聚合文本（与复制文本一致）」）。
 */

function makeUnit(overrides: {
  turnId: string;
  latestState?: "complete" | "interrupted" | "streaming";
  texts?: string[];
  hasLatest?: boolean;
}): Record<string, unknown> {
  const state = overrides.latestState ?? "complete";
  return {
    turnId: overrides.turnId,
    latestAssistantTextRow:
      overrides.hasLatest === false
        ? undefined
        : { state, text: overrides.texts?.join("") ?? "" },
    assistantTextRows: (overrides.texts ?? []).map((text) => ({ text })),
  };
}

describe("resolveFocusedAnnouncementTail", () => {
  it("returns the newest terminal turn aggregated with the copy-text join chain", () => {
    const units = [
      makeUnit({ turnId: "t1", texts: ["第一段", "第二段"] }),
      makeUnit({ turnId: "t2", texts: ["第二回答。"] }),
    ] as never;
    const tail = resolveFocusedAnnouncementTail(units);
    expect(tail).toEqual({ turnId: "t2", text: "第二回答。" });
  });

  it("skips running turns and falls back to the newest terminal one", () => {
    const units = [
      makeUnit({ turnId: "t1", texts: ["已完成的回答。"] }),
      makeUnit({ turnId: "t2", latestState: "streaming", texts: ["流式中…"] }),
    ] as never;
    // 最新轮在流式（非终态）：不播流式中间态（§4.1 永不播），回退到最近终态轮。
    expect(resolveFocusedAnnouncementTail(units)).toEqual({
      turnId: "t1",
      text: "已完成的回答。",
    });
  });

  it("skips turns without terminal text and empty aggregations", () => {
    const units = [
      makeUnit({ turnId: "t1", hasLatest: false }),
      makeUnit({ turnId: "t2", texts: ["   "] }),
    ] as never;
    expect(resolveFocusedAnnouncementTail(units)).toBeNull();
  });
});

describe("buildPermissionAnnouncementText", () => {
  it("composes tool name title with the question summary", () => {
    expect(
      buildPermissionAnnouncementText(
        { kind: "permission", toolName: "Bash", summary: "要运行 rm -rf 吗？" },
        "（截断）",
      ),
    ).toBe("Bash: 要运行 rm -rf 吗？");
  });

  it("falls back to summary only or title only", () => {
    expect(buildPermissionAnnouncementText({ kind: "permission", summary: "问题" }, "")).toBe(
      "问题",
    );
    expect(buildPermissionAnnouncementText({ kind: "permission", toolName: "Edit" }, "")).toBe(
      "Edit",
    );
  });

  it("truncates overlong content at the spec bound with the suffix (§4.1)", () => {
    const suffix = "（截断）";
    const text = buildPermissionAnnouncementText(
      { kind: "permission", summary: "x".repeat(300) },
      suffix,
    );
    expect(text.length).toBe(VOICE_ANNOUNCEMENT_PERMISSION_MAX_CHARS + suffix.length);
    expect(text.endsWith(suffix)).toBe(true);
  });

  it("documents the truncation bound (§4.1 200 字符)", () => {
    expect(VOICE_ANNOUNCEMENT_PERMISSION_MAX_CHARS).toBe(200);
  });
});
