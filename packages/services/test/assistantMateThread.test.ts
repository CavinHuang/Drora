/**
 * P10a-1 服务面单测（10 号详设 §2.4；spec §14 P10 行）：readMateThread 分页只读——
 * - 三源合并（trigger+decision（含 answer）+ticket 终态行）升序返回；同刻并列组按
 *   trigger→decision→ticket 呈现序（用户消息在答复前）；
 * - 非终态工单不进流（活动态走决策卡/工单区既有面）；brief 预览口径；generationCount；
 * - workspaceKey 身份键过滤（trigger.workspace_identity / ticket 目标域；decision 随
 *   其 trigger 归属）；
 * - 分页：beforeMs 严格小于；分页界不切开同刻并列组（界刻补齐，页可略超 limit——
 *   否则同刻的 trigger/decision 残行会因下一页 < 游标而丢失）；nextBeforeMs 游标链
 *   翻到空页；limit 缺省 50、越界/非整数 validationFailed；
 * - 幂等读：同参两次结果 deep equal 且零写（表行数不变）。
 * 库用 :memory:（每用例独立实例）；SQL 直种（照 assistantQueryReply setup 先例）。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_SNAPSHOT_LIMITS,
  ASSISTANT_SOURCE_KINDS,
  ASSISTANT_TICKET_STATUSES,
  MATE_THREAD_LIMITS,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";

const LOCAL_IDENTITY = "local-user";

function createService() {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  return { service, db };
}

function seedTriggerDecision(
  db: ReturnType<typeof openAssistantDatabase>,
  input: {
    id: string;
    text: string;
    workspace: string | null;
    atMs: number;
    outcome?: string;
    answer?: string;
  },
): number {
  db.raw
    .prepare(
      "INSERT INTO trigger(id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      input.id,
      ASSISTANT_SOURCE_KINDS.local,
      "explicit",
      LOCAL_IDENTITY,
      input.workspace,
      input.text,
      input.atMs,
    );
  const info = db.raw
    .prepare(
      "INSERT INTO admission_decision(trigger_id, strength, mode, outcome, reason_code, decided_by, decided_ms) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      input.id,
      "explicit",
      ASSISTANT_MODES.observe,
      input.outcome ?? ASSISTANT_OUTCOMES.decisionCard,
      null,
      "gate",
      input.atMs,
    );
  const decisionId = Number(info.lastInsertRowid);
  if (input.answer !== undefined) {
    db.raw
      .prepare(
        "INSERT INTO router_evaluation(decision_id, state, verdict, decided_ms, answer_text) VALUES (?,?,?,?,?)",
      )
      .run(decisionId, "suggested", "{}", input.atMs, input.answer);
  }
  return decisionId;
}

function seedTicket(
  db: ReturnType<typeof openAssistantDatabase>,
  input: {
    id: string;
    status: string;
    target: string;
    updatedAtMs: number;
    brief?: string;
    generations?: number;
  },
): void {
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
      input.brief ?? "修复登录",
      input.target,
      input.status,
      JSON.stringify({
        sessionId: `sess-${input.id}`,
        boundAtMs: input.updatedAtMs,
      }),
      JSON.stringify(
        Array.from({ length: input.generations ?? 0 }, (_, index) => ({
          sessionId: `sess-${input.id}-${index}`,
          fromMs: input.updatedAtMs - 10 + index,
          toMs: null,
          cause: "dispatched",
        })),
      ),
      "{}",
      input.status === ASSISTANT_TICKET_STATUSES.done ? "产出摘要" : null,
      input.status === ASSISTANT_TICKET_STATUSES.failed ? "boom" : null,
      input.updatedAtMs,
      input.updatedAtMs,
    );
}

/** 种一套三源时间线（ws-1/ws-2 两组；时刻错开并含同刻 trigger/decision 对）。 */
function seedTimeline(db: ReturnType<typeof openAssistantDatabase>) {
  seedTriggerDecision(db, {
    id: "T-a",
    text: "A 组任务请求",
    workspace: "ws-1",
    atMs: 100,
  });
  seedTriggerDecision(db, {
    id: "T-b",
    text: "B 组问询",
    workspace: "ws-2",
    atMs: 200,
    outcome: ASSISTANT_OUTCOMES.statusReplied,
    answer: "ws-b 当前没有活动工单。",
  });
  seedTicket(db, {
    id: "TK-1",
    status: ASSISTANT_TICKET_STATUSES.done,
    target: "ws-1",
    updatedAtMs: 300,
    generations: 1,
  });
  seedTicket(db, {
    id: "TK-2",
    status: ASSISTANT_TICKET_STATUSES.running,
    target: "ws-1",
    updatedAtMs: 250,
  });
  seedTicket(db, {
    id: "TK-3",
    status: ASSISTANT_TICKET_STATUSES.failed,
    target: "ws-2",
    updatedAtMs: 150,
  });
}

describe("P10a readMateThread（10 号详设 §2.4）", () => {
  it("三源合并升序返回：同刻并列 trigger→decision；非终态工单不进流；answer/generationCount 投影", async () => {
    const { service, db } = createService();
    seedTimeline(db);
    const result = await service.readMateThread({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = result.value.rows;
    // 倒序取、正序返回：升序时间线（旧→新）；同刻并列 trigger→decision（用户消息在答复前）。
    expect(rows.map((row) => `${row.kind}@${row.atMs}`)).toEqual([
      "trigger@100",
      "decision@100",
      "ticket@150",
      "trigger@200",
      "decision@200",
      "ticket@300",
    ]);
    // 非终态（running@250）不进流。
    expect(rows.some((row) => row.atMs === 250)).toBe(false);
    // decision 行投影：answer（router_evaluation.answer_text）+triggerText verbatim。
    const decisionB = rows.find((row) => row.kind === "decision" && row.atMs === 200);
    expect(decisionB && decisionB.kind === "decision" && decisionB.decision.answer).toBe(
      "ws-b 当前没有活动工单。",
    );
    expect(decisionB && decisionB.kind === "decision" && decisionB.decision.triggerText).toBe(
      "B 组问询",
    );
    // ticket 终态行：brief 预览+代际数（换代事件不逐条入流，摘要行如实携带）。
    const ticketRow = rows.find((row) => row.kind === "ticket" && row.atMs === 300);
    expect(ticketRow && ticketRow.kind === "ticket" && ticketRow.ticket).toMatchObject({
      ticketId: "TK-1",
      status: ASSISTANT_TICKET_STATUSES.done,
      targetWorkspaceIdentity: "ws-1",
      generationCount: 1,
    });
  });

  it("workspaceKey 身份键过滤：trigger 域/ticket 目标域；decision 随其 trigger 归属", async () => {
    const { service, db } = createService();
    seedTimeline(db);
    const result = await service.readMateThread({ workspaceKey: "ws-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.map((row) => `${row.kind}@${row.atMs}`)).toEqual([
      "trigger@100",
      "decision@100",
      "ticket@300",
    ]);
  });

  it("分页：界刻并列组不切分（trigger/decision 同刻残行零丢失）+游标链翻到空页", async () => {
    const { service, db } = createService();
    seedTimeline(db);
    // 第一页 limit=2：DESC 归并 [ticket300, decision200|截断] → 界刻 200 补齐 trigger200。
    const page1 = await service.readMateThread({ limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.rows.map((row) => `${row.kind}@${row.atMs}`)).toEqual([
      "trigger@200",
      "decision@200",
      "ticket@300",
    ]);
    expect(page1.value.nextBeforeMs).toBe(200);
    const page2 = await service.readMateThread({
      limit: 2,
      beforeMs: page1.value.nextBeforeMs ?? undefined,
    });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.rows.map((row) => `${row.kind}@${row.atMs}`)).toEqual([
      "trigger@100",
      "decision@100",
      "ticket@150",
    ]);
    expect(page2.value.nextBeforeMs).toBe(100);
    const page3 = await service.readMateThread({
      limit: 2,
      beforeMs: page2.value.nextBeforeMs ?? undefined,
    });
    expect(page3.ok).toBe(true);
    if (!page3.ok) return;
    expect(page3.value.rows).toEqual([]);
    expect(page3.value.nextBeforeMs).toBeNull();
  });

  it("缺省 limit=50（MATE_THREAD_LIMITS 单出处）；越界/非整数 validationFailed", async () => {
    const { service, db } = createService();
    for (let index = 0; index < MATE_THREAD_LIMITS.defaultPageSize + 10; index += 1) {
      seedTriggerDecision(db, {
        id: `T-bulk-${index}`,
        text: `bulk ${index}`,
        workspace: null,
        atMs: 1000 + index,
      });
    }
    const full = await service.readMateThread({});
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.value.rows.length).toBe(MATE_THREAD_LIMITS.defaultPageSize);
    expect(full.value.nextBeforeMs).toBeTypeOf("number");
    // 翻页无重叠无丢失：总行数=种子 trigger+decision（每条种子两行）。
    let remaining = full.value.rows.length;
    let cursor = full.value.nextBeforeMs;
    let guard = 0;
    while (cursor !== null && guard < 10) {
      const page = await service.readMateThread({ beforeMs: cursor });
      if (!page.ok) throw new Error(page.error.reason);
      remaining += page.value.rows.length;
      cursor = page.value.nextBeforeMs;
      guard += 1;
    }
    expect(remaining).toBe((MATE_THREAD_LIMITS.defaultPageSize + 10) * 2);
    // 校验 fail-closed：limit 0/201/1.5、beforeMs NaN。
    for (const bad of [0, MATE_THREAD_LIMITS.maxPageSize + 1, 1.5]) {
      const result = await service.readMateThread({ limit: bad });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("mate.validation.failed");
    }
    const badBefore = await service.readMateThread({ beforeMs: Number.NaN });
    expect(badBefore.ok).toBe(false);
  });

  it("幂等读：同参两次 deep equal，零写（三表行数不变）", async () => {
    const { service, db } = createService();
    seedTimeline(db);
    const counts = () =>
      (["trigger", "admission_decision", "ticket", "router_evaluation"] as const).map(
        (table) =>
          (
            db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
              n: number;
            }
          ).n,
      );
    const before = counts();
    const first = await service.readMateThread({ limit: 2 });
    const second = await service.readMateThread({ limit: 2 });
    expect(first).toEqual(second);
    expect(counts()).toEqual(before);
  });

  it("brief 预览口径：超 briefPreviewMax 截断（与快照工单行同界）", async () => {
    const { service, db } = createService();
    const longBrief = "长".repeat(ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax + 50);
    seedTicket(db, {
      id: "TK-long",
      status: ASSISTANT_TICKET_STATUSES.done,
      target: "ws-1",
      updatedAtMs: 100,
      brief: longBrief,
    });
    const result = await service.readMateThread({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ticketRow = result.value.rows.find((row) => row.kind === "ticket");
    expect(ticketRow && ticketRow.kind === "ticket" && [...ticketRow.ticket.brief].length).toBe(
      ASSISTANT_SNAPSHOT_LIMITS.briefPreviewMax,
    );
  });
});
