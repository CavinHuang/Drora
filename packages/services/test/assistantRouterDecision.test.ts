/**
 * Router 决策 schema 与无状态壳纯模块测试（02 详设 §1.1-§1.3）：
 * 四臂互斥/严格校验/证据有界/JSON 提取；候选卡 verbatim 截断+读指针；轮转阈值。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ASSISTANT_SNAPSHOT_LIMITS } from "@drora/shared";
import {
  extractRouterDecisionJson,
  parseRouterDecision,
  parseRouterDecisionText,
} from "../src/assistant-tickets/routerDecision.js";
import {
  composeCandidateCard,
  composeRoutingPreamble,
  composeTeamLeadBrief,
  filterAttachCandidates,
  routerSessionName,
  shouldRotateRouterSession,
} from "../src/assistant-tickets/routerShell.js";
import type { AssistantSessionSummaryLite } from "../src/assistant-tickets/assistantPorts.js";

describe("routerDecision schema（02 §1.2）", () => {
  const dispatchDecision = {
    dispatch: {
      targetWorkspaceIdentity: "ws-a",
      permissionTier: "build",
      briefBase: "verbatim",
    },
    evidence: [{ quote: "修登录白屏" }],
  };

  it("dispatch 臂通过并归一为 tagged union", () => {
    const parsed = parseRouterDecision(dispatchDecision);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.decision.kind).toBe("dispatch");
    if (parsed.decision.kind !== "dispatch") return;
    expect(parsed.decision.arm.targetWorkspaceIdentity).toBe("ws-a");
    expect(parsed.decision.arm.permissionTier).toBe("build");
    expect(parsed.decision.evidence).toEqual(["修登录白屏"]);
  });

  it("四臂互斥：两臂同现拒绝", () => {
    const parsed = parseRouterDecision({ ...dispatchDecision, hold: { reason: "信息不足" } });
    expect(parsed.ok).toBe(false);
  });

  it("零臂拒绝；yolo 档拒绝（不在枚举）", () => {
    expect(parseRouterDecision({ evidence: [] }).ok).toBe(false);
    expect(
      parseRouterDecision({
        dispatch: { ...dispatchDecision.dispatch, permissionTier: "yolo" },
        evidence: [],
      }).ok,
    ).toBe(false);
  });

  it("证据超界（>80 字 / >3 条）拒绝", () => {
    const longQuote = "字".repeat(ASSISTANT_SNAPSHOT_LIMITS.routerEvidenceQuoteMax + 1);
    expect(parseRouterDecision({ ...dispatchDecision, evidence: [{ quote: longQuote }] }).ok).toBe(
      false,
    );
    const tooMany = Array.from({ length: ASSISTANT_SNAPSHOT_LIMITS.routerEvidenceMax + 1 }, () => ({
      quote: "x",
    }));
    expect(parseRouterDecision({ ...dispatchDecision, evidence: tooMany }).ok).toBe(false);
  });

  it("attach 臂（02 §2 Tier2）通过；未知字段 strict 拒绝", () => {
    const parsed = parseRouterDecision({
      attach: { sessionId: "sess-1", targetWorkspaceIdentity: "ws-a" },
      evidence: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.decision.kind).toBe("attach");
    expect(parseRouterDecision({ ...dispatchDecision, unknown: 1 }).ok).toBe(false);
  });

  it("extractRouterDecisionJson：容忍前后缀说明；括号计数忽略字符串内花括号", () => {
    const text = `评估如下。\n\`\`\`json\n${JSON.stringify(dispatchDecision)}\n\`\`\`\n请审。`;
    expect(extractRouterDecisionJson(text)).toEqual(dispatchDecision);
    const tricky = '{"hold":{"reason":"a}b"},"evidence":[]}';
    expect(extractRouterDecisionJson(`前缀 ${tricky} 后缀`)).toEqual({
      hold: { reason: "a}b" },
      evidence: [],
    });
    expect(extractRouterDecisionJson("没有 JSON")).toBeUndefined();
  });

  it("parseRouterDecisionText：坏 JSON → 降级臂（不重试模型）", () => {
    const parsed = parseRouterDecisionText("输出不含 JSON");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("JSON");
    // evidence 是 schema 必填（设计原文；Router 缺证据=不命中 schema → Tier3 问人）。
    expect(parseRouterDecisionText('{"hold":{"reason":"r"},"evidence":[]}').ok).toBe(true);
    expect(parseRouterDecisionText('{"hold":{"reason":"r"}}').ok).toBe(false);
  });

  // P7（08 号详设 §3.1）：query_status 第五臂——查询直答意图（host 确定性应答器消费）。
  it("query_status 臂解析：scope 四 kind + reason；与既有臂互斥", () => {
    const parsed = parseRouterDecisionText(
      JSON.stringify({
        query_status: { scope: { kind: "status", workspaceIdentity: "ws-a" }, reason: "进度查询" },
        evidence: [{ quote: "原文片段" }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.decision.kind === "query_status") {
      expect(parsed.decision.arm.scope.kind).toBe("status");
      expect(parsed.decision.arm.scope.workspaceIdentity).toBe("ws-a");
    } else {
      throw new Error("expected query_status arm");
    }
    // 两臂并存 → schema 拒绝（恰现其一）。
    const both = parseRouterDecisionText(
      JSON.stringify({
        hold: { reason: "x" },
        query_status: { scope: { kind: "usage", ticketId: "T-1" }, reason: "花费查询" },
        evidence: [],
      }),
    );
    expect(both.ok).toBe(false);
  });

});

describe("routerShell 无状态壳（02 §1.1/§1.3）", () => {
  it("序列名与轮转阈值：N=10 张工单触发轮转；无会话即轮转", () => {
    expect(routerSessionName(3)).toBe("mate-session-3");
    expect(
      shouldRotateRouterSession({ seq: 1, currentSessionId: "s", ticketsSinceRotation: 9 }),
    ).toBe(false);
    expect(
      shouldRotateRouterSession({ seq: 1, currentSessionId: "s", ticketsSinceRotation: 10 }),
    ).toBe(true);
    expect(shouldRotateRouterSession({ seq: 1, currentSessionId: null, ticketsSinceRotation: 0 })).toBe(
      true,
    );
    expect(ASSISTANT_SNAPSHOT_LIMITS.routerRotateEveryTickets).toBe(10);
  });

  it("候选卡：verbatim 截断 1500 字 + 元数据 + 读指针 + 约言前缀", () => {
    const card = composeCandidateCard({
      triggerId: "T-1",
      text: "修复登录白屏",
      strength: "explicit",
      identity: "local@h",
      atMs: 1_700_000_000_000,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(card.input).toContain(composeRoutingPreamble());
    expect(card.input).toContain("修复登录白屏");
    expect(card.input).toContain("triggerId: T-1");
    expect(card.truncated).toBe(false);
    expect(card.readPointer).toContain("trigger:T-1");
    const long = "字".repeat(ASSISTANT_SNAPSHOT_LIMITS.candidateBriefMax + 50);
    const truncatedCard = composeCandidateCard({
      triggerId: "T-2",
      text: long,
      strength: "explicit",
      identity: "local@h",
      atMs: 1,
    });
    expect(truncatedCard.truncated).toBe(true);
    expect(truncatedCard.input).toContain(`原文超 ${ASSISTANT_SNAPSHOT_LIMITS.candidateBriefMax} 字已截断`);
    // 截断体（1500）+ 约言/元数据（<1300，P7 约言加查询臂指引+台账速览段指引用后 ~2755）恒小于原文全长注入。
    expect(truncatedCard.input.length).toBeLessThan(
      ASSISTANT_SNAPSHOT_LIMITS.candidateBriefMax + 1400,
    );
  });

  it("Mode B lead brief：指示走 /team 且不得跳过人工审批（02 §5 prompt 驱动）", () => {
    const brief = composeTeamLeadBrief("重构导出模块");
    expect(brief).toContain("重构导出模块");
    expect(brief).toContain("/team");
    expect(brief).toContain("不得跳过审批门");
  });
});

describe("Tier2 附着候选集（02 §2；P2 审查修复接线）", () => {
  const now = 1_700_000_000_000;
  const fresh = now - 60 * 60 * 1000; // 1h 前
  const session = (over: Partial<AssistantSessionSummaryLite> & { sessionId: string }): AssistantSessionSummaryLite => ({
    title: `会话 ${over.sessionId}`,
    phase: "completedSuccess",
    sessionEnded: false,
    updatedAtMs: fresh,
    ...over,
  });

  it("硬过滤：已结束/busy(running/prewarming)/无转录 draft/过期>7d 剔除；顺序保留", () => {
    const candidates = filterAttachCandidates({
      nowMs: now,
      sessions: [
        session({ sessionId: "s-ok" }),
        session({ sessionId: "s-ended", sessionEnded: true }),
        session({ sessionId: "s-running", phase: "running" }),
        session({ sessionId: "s-prewarming", phase: "prewarming" }),
        session({ sessionId: "s-draft", phase: "draft" }),
        session({ sessionId: "s-stale", updatedAtMs: now - 8 * 24 * 60 * 60 * 1000 }),
        session({ sessionId: "s-fresh-edge", updatedAtMs: now - 7 * 24 * 60 * 60 * 1000 }),
        session({ sessionId: "" }),
      ],
    });
    expect(candidates.map((candidate) => candidate.sessionId)).toEqual(["s-ok", "s-fresh-edge"]);
  });

  it("有界：最多 attachCandidatesMax 条（防止无界喂给 Router）", () => {
    const candidates = filterAttachCandidates({
      nowMs: now,
      sessions: Array.from({ length: 12 }, (_, i) => session({ sessionId: `s-${i}` })),
    });
    expect(candidates).toHaveLength(ASSISTANT_SNAPSHOT_LIMITS.attachCandidatesMax);
    expect(ASSISTANT_SNAPSHOT_LIMITS.attachCandidatesMax).toBe(5);
  });

  it("候选卡携带【附着候选】段（sessionId 可选来源）；空候选不出段", () => {
    const withCandidates = composeCandidateCard({
      triggerId: "T-1",
      text: "继续上次的重构",
      strength: "explicit",
      identity: "local@h",
      atMs: now,
      targetWorkspaceIdentity: "ws-a",
      attachCandidates: [{ sessionId: "sess-9", title: "重构导出", phase: "completedInterrupted", updatedAtMs: fresh }],
    });
    expect(withCandidates.input).toContain("【附着候选】目标 workspace 的可附着会话");
    expect(withCandidates.input).toContain("sess-9");
    expect(withCandidates.input).toContain("已硬过滤");
    expect(withCandidates.input).toContain("禁止编造 sessionId");
    const without = composeCandidateCard({
      triggerId: "T-2",
      text: "x",
      strength: "explicit",
      identity: "local@h",
      atMs: now,
    });
    expect(without.input).not.toContain("【附着候选】目标 workspace 的可附着会话");
    // 反编造纪律在约言中恒在（无候选卡同样约束 attach 臂）。
    expect(without.input).toContain("禁止编造 sessionId");
  });
});
