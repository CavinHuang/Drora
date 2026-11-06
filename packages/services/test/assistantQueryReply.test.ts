/**
 * P7 查询确定性应答器单测（08 号详设 §3.2/§6）：四 scope×空态矩阵、有界、与快照
 * 投影同读点（答案与面板事实恒一致的结构性保证）。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ASSISTANT_REPLY_LIMITS, ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { composeQueryReply } from "../src/assistant-tickets/queryReply.js";

const LOCAL_IDENTITY = "local-user";
const NOW = 1_000_000;

function setup() {
  const db = openAssistantDatabase(":memory:");
  const reply = (scope: Parameters<typeof composeQueryReply>[0]["scope"]) =>
    composeQueryReply({
      scope,
      raw: db.raw,
      localIdentity: LOCAL_IDENTITY,
      nowMs: () => NOW,
    });
  return { db, reply };
}

function seedTicket(
  db: ReturnType<typeof openAssistantDatabase>,
  input: {
    id: string;
    status: string;
    target?: string;
    brief?: string;
    outputSummary?: string | null;
    failReason?: string | null;
    updatedAtMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    generation?: number;
  },
): void {
  const ts = input.updatedAtMs ?? NOW - 1000;
  // mandate 先行（ticket.mandate_id 外键；state=active 占位即可，应答器不读 mandate）。
  db.raw
    .prepare("INSERT INTO mandate(id, ticket_id, scope, state, created_cause) VALUES (?,?,?,?,?)")
    .run(`M-${input.id}`, input.id, "{}", "active", "accept");
  db.raw
    .prepare(
      `INSERT INTO ticket(id, mandate_id, brief, target_workspace_identity, status,
        incarnation_current, incarnation_generations, usage_accum, output_summary, fail_reason, created_ms, updated_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.id,
      `M-${input.id}`,
      input.brief ?? "修复登录\n第二行",
      input.target ?? "ws-a",
      input.status,
      JSON.stringify({
        workspaceIdentity: input.target ?? "ws-a",
        sessionId: `sess-${input.id}`,
        boundAtMs: ts,
        cause: "dispatched",
        anchorCommandId: `${input.id}-1`,
        dispatchSeq: 1,
      }),
      JSON.stringify(
        input.generation && input.generation > 1
          ? [
              { sessionId: "sess-old", fromMs: ts - 10, toMs: ts - 5, cause: "lost" },
              { sessionId: `sess-${input.id}`, fromMs: ts - 5, toMs: null, cause: "dispatched" },
            ]
          : [],
      ),
      JSON.stringify({
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        lastCumulative: {
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
      input.outputSummary ?? null,
      input.failReason ?? null,
      ts,
      ts,
    );
}

describe("P7 应答器：status scope（08 §3.2）", () => {
  it("workspace 域：活动行带状态/模式/时刻+最近完成；空域诚实空态", () => {
    const { db, reply } = setup();
    seedTicket(db, {
      id: "T-1",
      status: ASSISTANT_TICKET_STATUSES.running,
      target: "ws-a",
      brief: "修复登录",
      updatedAtMs: NOW - 500,
    });
    seedTicket(db, {
      id: "T-2",
      status: ASSISTANT_TICKET_STATUSES.done,
      target: "ws-a",
      outputSummary: "回归通过",
      updatedAtMs: NOW - 400,
    });
    const replyA = reply({ kind: "status", workspaceIdentity: "ws-a" });
    expect(replyA.matchedTickets).toBe(2);
    expect(replyA.text).toContain("修复登录：进行中");
    expect(replyA.text).toContain("最近完成：回归通过");
    expect(replyA.text.length).toBeLessThanOrEqual(ASSISTANT_REPLY_LIMITS.replyTextMax + 1);

    const empty = reply({ kind: "status", workspaceIdentity: "ws-nothing" });
    expect(empty.matchedTickets).toBe(0);
    expect(empty.text).toContain("没有大副工单");
  });

  it("全局域：无工单引导点名", () => {
    const { reply } = setup();
    const empty = reply({ kind: "status" });
    expect(empty.text).toContain("可在面板底部点名派活");
  });
});

describe("P7 应答器：ticket/usage scope", () => {
  it("ticket：状态/代际/汇报/失败原因/滞留提示；查无此票空态", () => {
    const { db, reply } = setup();
    seedTicket(db, {
      id: "T-run",
      status: ASSISTANT_TICKET_STATUSES.running,
      generation: 2,
      outputSummary: "上一代汇报：构建红了",
      updatedAtMs: NOW - 100,
    });
    seedTicket(db, {
      id: "T-await",
      status: ASSISTANT_TICKET_STATUSES.awaitingOutput,
      failReason: null,
      updatedAtMs: NOW - 90,
    });
    seedTicket(db, {
      id: "T-fail",
      status: ASSISTANT_TICKET_STATUSES.failed,
      failReason: "assistant_row_failed",
      updatedAtMs: NOW - 80,
    });
    const run = reply({ kind: "ticket", ticketId: "T-run" });
    expect(run.text).toContain("第 2 代");
    expect(run.text).toContain("上一代汇报");
    const awaiting = reply({ kind: "ticket", ticketId: "T-await" });
    expect(awaiting.text).toContain("人工确认交付");
    const failed = reply({ kind: "ticket", ticketId: "T-fail" });
    expect(failed.text).toContain("assistant_row_failed");
    const missing = reply({ kind: "ticket", ticketId: "T-none" });
    expect(missing.matchedTickets).toBe(0);
    expect(missing.text).toContain("没有找到工单 T-none");
  });

  it("usage：累计+按代分解（与面板成本页签同一投影读点）", () => {
    const { db, reply } = setup();
    seedTicket(db, {
      id: "T-u",
      status: ASSISTANT_TICKET_STATUSES.done,
      inputTokens: 1200,
      outputTokens: 300,
      generation: 2,
      updatedAtMs: NOW - 70,
    });
    const usage = reply({ kind: "usage", ticketId: "T-u" });
    expect(usage.text).toContain("输入 1200 / 输出 300");
    expect(usage.matchedTickets).toBe(1);
  });
});

describe("P7 应答器：digest scope 与有界", () => {
  it("digest：近 7 日完成/失败计数+逐条；空周空态", () => {
    const { db, reply } = setup();
    seedTicket(db, {
      id: "T-a",
      status: ASSISTANT_TICKET_STATUSES.done,
      updatedAtMs: NOW - 1000,
    });
    seedTicket(db, {
      id: "T-b",
      status: ASSISTANT_TICKET_STATUSES.failed,
      failReason: "x",
      updatedAtMs: NOW - 900,
    });
    const digest = reply({ kind: "digest" });
    expect(digest.text).toContain("完成 1 / 失败 1");
    expect(digest.matchedTickets).toBe(2);
    const emptyDb = setup();
    const empty = emptyDb.reply({ kind: "digest" });
    expect(empty.text).toContain("近 7 日没有");
  });

  it("答复全文恒在 replyTextMax 界内（各成分行级预截断使界由构造保证；cap 为纵深防御）", () => {
    const { db, reply } = setup();
    seedTicket(db, {
      id: "T-long",
      status: ASSISTANT_TICKET_STATUSES.running,
      brief: `很长的原文${"字".repeat(ASSISTANT_REPLY_LIMITS.replyTextMax)}`,
      updatedAtMs: NOW - 60,
    });
    const replyLong = reply({ kind: "status", workspaceIdentity: "ws-a" });
    // 各成分（brief 首行 40/摘要 120/逐条 ≤6）预截断后全文远小于界；断言性质恒成立
    // ——若未来放宽行级截断导致全文超界，此断言即红（cap 截断兜底）。
    expect(replyLong.text.length).toBeLessThanOrEqual(ASSISTANT_REPLY_LIMITS.replyTextMax);
  });
});
