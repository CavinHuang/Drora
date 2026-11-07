/**
 * Router 单轮输出汇聚器单测（2026-11-07 dev 实机修复批）：settle 矩阵——
 * assistantText 双臂 + turnHeader 终态归因（轮在产出 assistantText 之前失败时
 * 旧监听永不 settle，串行评估队列被一轮毒化；详见 routerTurnSink.ts 头注）。
 */
import { describe, expect, it } from "vitest";
import { createRouterTurnSink } from "../src/assistant-tickets/routerTurnSink.js";

const SID = "sess-r1";
const CMD = "router-eval-0001";

function deltasFrame(rows: unknown[], topic = `conversation/${SID}`): unknown {
  return { topic, payload: { kind: "deltas", deltas: rows } };
}

function row(op: "row.appended" | "row.upserted", row: Record<string, unknown>): unknown {
  return { op, row };
}

/** 喂帧后取 settle 结果；pending 时返回哨兵（用例显式断言挂起语义的唯一手段）。 */
const PENDING = Symbol("pending");
async function settleWith(sink: ReturnType<typeof createRouterTurnSink>): Promise<unknown> {
  const raced = await Promise.race([
    sink.output.then((r) => r),
    new Promise((resolve) => setTimeout(() => resolve(PENDING), 20)),
  ]);
  return raced;
}

describe("createRouterTurnSink：assistantText 双臂（既有语义回归）", () => {
  it("complete → {ok, output}", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(deltasFrame([row("row.appended", { kind: "assistantText", state: "streaming" })]));
    sink.handleFrame(
      deltasFrame([row("row.upserted", { kind: "assistantText", state: "complete", text: "VERDICT" })]),
    );
    await expect(sink.output).resolves.toEqual({ ok: true, output: "VERDICT" });
  });

  it("failed/interrupted → 失败臂（不重试模型）", async () => {
    const failed = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    failed.handleFrame(deltasFrame([row("row.upserted", { kind: "assistantText", state: "failed" })]));
    await expect(failed.output).resolves.toMatchObject({ ok: false });

    const interrupted = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    interrupted.handleFrame(
      deltasFrame([row("row.upserted", { kind: "assistantText", state: "interrupted" })]),
    );
    await expect(interrupted.output).resolves.toMatchObject({ ok: false });
  });

  it("topic 不匹配/非 deltas 帧忽略", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(deltasFrame([], "conversation/other"));
    sink.handleFrame({ topic: `conversation/${SID}`, payload: { kind: "snapshot", snapshot: {} } });
    sink.handleFrame(null);
    expect(await settleWith(sink)).toBe(PENDING);
  });
});

describe("createRouterTurnSink：turnHeader 终态归因（修复主断言）", () => {
  it("failed（sourceCommandId 匹配）→ 失败臂——修复前此处永久挂起", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(
      deltasFrame([row("row.upserted", { kind: "turnHeader", state: "failed", sourceCommandId: CMD })]),
    );
    const result = await sink.output;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("turnHeader failed");
  });

  it("completedInterrupted（匹配）→ 失败臂", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(
      deltasFrame([
        row("row.upserted", { kind: "turnHeader", state: "completedInterrupted", sourceCommandId: CMD }),
      ]),
    );
    await expect(sink.output).resolves.toMatchObject({ ok: false });
  });

  it("completedSuccess（匹配、无 assistantText）→ {ok, output:\"\"}（空输出交下游诚实解析失败）", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(
      deltasFrame([
        row("row.upserted", { kind: "turnHeader", state: "completedSuccess", sourceCommandId: CMD }),
      ]),
    );
    await expect(sink.output).resolves.toEqual({ ok: true, output: "" });
  });

  it("sourceCommandId 不匹配/缺席 → 忽略（他轮终态不误伤本轮）", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(
      deltasFrame([
        row("row.upserted", { kind: "turnHeader", state: "failed", sourceCommandId: "other-cmd" }),
      ]),
    );
    sink.handleFrame(
      deltasFrame([row("row.upserted", { kind: "turnHeader", state: "failed" })]),
    );
    expect(await settleWith(sink)).toBe(PENDING);
    // 他轮失败帧被忽略后，本轮仍能由 assistantText complete 正常 settle。
    sink.handleFrame(
      deltasFrame([row("row.upserted", { kind: "assistantText", state: "complete", text: "OK" })]),
    );
    await expect(sink.output).resolves.toEqual({ ok: true, output: "OK" });
  });

  it("同帧 assistantText complete 在先 → turnHeader completedSuccess 不覆盖首臂", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(
      deltasFrame([
        row("row.appended", { kind: "assistantText", state: "complete", text: "FIRST" }),
        row("row.upserted", { kind: "turnHeader", state: "completedSuccess", sourceCommandId: CMD }),
      ]),
    );
    await expect(sink.output).resolves.toEqual({ ok: true, output: "FIRST" });
  });

  it("settle 后迟到帧全部忽略（不抛错不双 settle）", async () => {
    const sink = createRouterTurnSink({ sessionId: SID, commandId: CMD });
    sink.handleFrame(
      deltasFrame([row("row.upserted", { kind: "assistantText", state: "complete", text: "A" })]),
    );
    await expect(sink.output).resolves.toEqual({ ok: true, output: "A" });
    expect(() =>
      sink.handleFrame(
        deltasFrame([row("row.upserted", { kind: "turnHeader", state: "failed", sourceCommandId: CMD })]),
      ),
    ).not.toThrow();
    await expect(sink.output).resolves.toEqual({ ok: true, output: "A" });
  });
});
