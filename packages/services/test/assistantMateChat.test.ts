/**
 * P10a-1 服务面单测（10 号详设 §2.2；spec §14 P10 行）：
 * - schema：query_status scope 枚举扩 "chat"（无参形态）可解析，chat 臂分流语义正确；
 * - 聊天轮：评估循环不走 composeQueryReply——改调 router chat 端口（同一 Router 会话
 *   追加轮），输入含互扰标记「本输入为聊天轮」+用户问题 verbatim，countTowardsRotation
 *   恒 false（不计轮转——autonomy 自主轮同款声明式断言）；输出仅截断 ≤800 code
 *   points（超界加省略号；无失败解析态）；answer 落 router_evaluation.answer_text、
 *   decision outcome=status_replied 且 reason_code=chat_replied（与确定性 query 的
 *   query_replied 区分）；
 * - 诚实降级：chat 通道未装配（旧装配）/聊天轮通道失败 → router_evaluation=failed、
 *   decision 留 decision_card（Tier3 问人，不猜答案不重试）；
 * - off 模式：触发 outcome=ignored，零评估零聊天轮（含读零执行不变）；
 * - 回归：确定性 query_status（status scope）仍走应答器（query_replied，chat 端口零调用）。
 * 库用 :memory:（每用例独立实例）；端口全部 fake 注入（assistantPorts 模块级 set*）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_REPLY_LIMITS,
  ASSISTANT_STRENGTHS,
} from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantRouterChatPort,
  setAssistantRouterPort,
} from "../src/assistant-tickets/assistantPorts.js";
import { parseRouterDecisionText } from "../src/assistant-tickets/routerDecision.js";
import type { AssistantSnapshot } from "../src/assistant-tickets/assistantTickets.js";

const LOCAL_IDENTITY = "local-user";

function clearPorts(): void {
  setAssistantRouterPort(null);
  setAssistantRouterChatPort(null);
}

afterEach(() => {
  clearPorts();
  vi.restoreAllMocks();
});

function createService() {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  return { service, db };
}

/** 候选卡端口 fake：按脚本输出结构化 JSON（"__fail__"=评估通道失败臂）。 */
function installRouterCard(outputs: string[]): { calls: string[] } {
  const calls: string[] = [];
  setAssistantRouterPort(async ({ card }) => {
    calls.push(card);
    const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
    return output === "__fail__"
      ? { ok: false as const, reason: "router boom" }
      : { ok: true as const, output };
  });
  return { calls };
}

interface ChatCall {
  readonly text: string;
  readonly countTowardsRotation: boolean;
}

/** 聊天轮端口 fake：记录入参并按脚本回自然语言（"__fail__"=聊天轮通道失败臂）。 */
function installRouterChat(outputs: string[]): { calls: ChatCall[] } {
  const calls: ChatCall[] = [];
  setAssistantRouterChatPort(async (input) => {
    // 照 autonomy installRouter 先例记录布尔化声明值（true=计轮转；chat 端口恒 false）。
    calls.push({
      text: input.text,
      countTowardsRotation: input.countTowardsRotation !== false,
    });
    const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
    return output === "__fail__"
      ? { ok: false as const, reason: "chat turn boom" }
      : { ok: true as const, output };
  });
  return { calls };
}

/** fire-and-forget 评估的既定等待式（照 assistantP2Flows：await 快照让出事件循环）。 */
async function waitForSnapshot(
  service: ReturnType<typeof createService>["service"],
  predicate: (snapshot: AssistantSnapshot) => boolean,
): Promise<AssistantSnapshot> {
  for (let i = 0; i < 30; i += 1) {
    const snapshot = await service.getSnapshot();
    if (predicate(snapshot)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return await service.getSnapshot();
}

/** router_evaluation 行直读（answer/verdict/error 断言面）。 */
function readEvaluation(
  db: ReturnType<typeof openAssistantDatabase>,
  decisionId: number,
): {
  state: string;
  verdict: string | null;
  error: string | null;
  answer_text: string | null;
} {
  return db.raw
    .prepare(
      "SELECT state, verdict, error, answer_text FROM router_evaluation WHERE decision_id = ?",
    )
    .get(decisionId) as {
    state: string;
    verdict: string | null;
    error: string | null;
    answer_text: string | null;
  };
}

describe("P10a chat scope kind（10 号详设 §2.2）", () => {
  it("schema：query_status scope 枚举收「chat」（无参形态可解析）", () => {
    const parsed = parseRouterDecisionText(
      `前缀${JSON.stringify({
        query_status: {
          scope: { kind: "chat" },
          reason: "闲聊咨询，非四 scope 读意图",
        },
        evidence: [{ quote: "随便聊聊" }],
      })}后缀`,
    );
    expect(parsed).toEqual({
      ok: true,
      decision: {
        kind: "query_status",
        arm: { scope: { kind: "chat" }, reason: "闲聊咨询，非四 scope 读意图" },
        evidence: ["随便聊聊"],
      },
    });
  });

  it("chat 臂分流：评估走候选卡端口、答复走聊天轮端口——互扰标记+不计轮转+verbatim+chat_replied", async () => {
    const { service, db } = createService();
    installRouterCard([
      JSON.stringify({
        query_status: { scope: { kind: "chat" }, reason: "泛问题自由作答" },
        evidence: [{ quote: "大副你觉得" }],
      }),
    ]);
    const chat = installRouterChat(["我是大副，这个问题我的看法是……建议走面板派发。"]);
    const recorded = await service.recordTrigger({
      text: "大副你觉得今天先做哪个任务？",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    expect(recorded.ok).toBe(true);
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    const snapshot = await waitForSnapshot(
      service,
      (s) => s.decisions[0]?.outcome === ASSISTANT_OUTCOMES.statusReplied,
    );
    // 聊天轮入口恰好一次；候选卡评估轮照旧一次（判定与作答两轮分离）。
    expect(chat.calls.length).toBe(1);
    // 互扰标记（自主轮同款先例）+ 用户问题 verbatim。
    expect(chat.calls[0]?.text).toContain("【本输入为聊天轮】");
    expect(chat.calls[0]?.text).toContain("大副你觉得今天先做哪个任务？");
    expect(chat.calls[0]?.text).toContain("不承诺执行");
    // 不计轮转：端口以 countTowardsRotation=false 显式声明（ticketsSinceRotation 只数候选卡轮）。
    expect(chat.calls[0]?.countTowardsRotation).toBe(false);
    // 落账：answer 进 router_evaluation.answer_text；decision status_replied+chat_replied。
    const decisionId = snapshot.decisions[0]?.id;
    expect(decisionId).toBeTypeOf("number");
    const evaluation = readEvaluation(db, decisionId!);
    expect(evaluation.state).toBe("suggested");
    expect(evaluation.answer_text).toBe("我是大副，这个问题我的看法是……建议走面板派发。");
    expect(JSON.parse(evaluation.verdict ?? "{}")).toMatchObject({
      kind: "query_status",
      arm: { scope: { kind: "chat" } },
    });
    const decisionRow = db.raw
      .prepare("SELECT outcome, reason_code FROM admission_decision WHERE id = ?")
      .get(decisionId) as { outcome: string; reason_code: string };
    expect(decisionRow.outcome).toBe(ASSISTANT_OUTCOMES.statusReplied);
    expect(decisionRow.reason_code).toBe("chat_replied");
    // 快照投影：答复气泡消费 decision.answer（query 臂同面）。
    expect(snapshot.decisions[0]?.answer).toBe("我是大副，这个问题我的看法是……建议走面板派发。");
  });

  it("截断：聊天输出超 replyTextMax 截为 800 code points+省略号（无失败解析态）", async () => {
    const { service, db } = createService();
    installRouterCard([
      JSON.stringify({
        query_status: { scope: { kind: "chat" }, reason: "长答复" },
        evidence: [{ quote: "详细说说" }],
      }),
    ]);
    // 含代理对（emoji，BMP 外）——锁定 code point 截断而非 UTF-16 单元截断。
    const long = "🚀".repeat(900);
    installRouterChat([long]);
    await service.recordTrigger({
      text: "详细说说",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    const snapshot = await waitForSnapshot(
      service,
      (s) => s.decisions[0]?.outcome === ASSISTANT_OUTCOMES.statusReplied,
    );
    const decisionId = snapshot.decisions[0]?.id;
    const evaluation = readEvaluation(db, decisionId!);
    const answer = evaluation.answer_text ?? "";
    expect([...answer].length).toBe(ASSISTANT_REPLY_LIMITS.replyTextMax + 1); // 800 content + 省略号
    expect(answer.endsWith("…")).toBe(true);
    expect([...answer].slice(0, -1).join("")).toBe("🚀".repeat(800));
  });

  it("诚实降级：chat 通道未装配（旧装配）→ failed+决策卡留 Tier3，不猜答案", async () => {
    const { service, db } = createService();
    installRouterCard([
      JSON.stringify({
        query_status: { scope: { kind: "chat" }, reason: "闲聊" },
        evidence: [{ quote: "聊两句" }],
      }),
    ]);
    // 不注入 setAssistantRouterChatPort（旧装配形态）。
    await service.recordTrigger({
      text: "聊两句",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    const snapshot = await waitForSnapshot(
      service,
      (s) => s.decisions[0]?.routerState === "failed",
    );
    const decisionId = snapshot.decisions[0]?.id;
    const evaluation = readEvaluation(db, decisionId!);
    expect(evaluation.state).toBe("failed");
    expect(evaluation.error).toContain("chat 通道未装配");
    expect(evaluation.answer_text).toBeNull();
    const decisionRow = db.raw
      .prepare("SELECT outcome FROM admission_decision WHERE id = ?")
      .get(decisionId) as { outcome: string };
    expect(decisionRow.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
  });

  it("诚实降级：聊天轮通道失败 → failed+决策卡留 Tier3（不重试模型）", async () => {
    const { service, db } = createService();
    installRouterCard([
      JSON.stringify({
        query_status: { scope: { kind: "chat" }, reason: "闲聊" },
        evidence: [{ quote: "再聊聊" }],
      }),
    ]);
    installRouterChat(["__fail__"]);
    await service.recordTrigger({
      text: "再聊聊",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    const snapshot = await waitForSnapshot(
      service,
      (s) => s.decisions[0]?.routerState === "failed",
    );
    const decisionId = snapshot.decisions[0]?.id;
    const evaluation = readEvaluation(db, decisionId!);
    expect(evaluation.state).toBe("failed");
    expect(evaluation.error).toContain("聊天轮失败");
    const decisionRow = db.raw
      .prepare("SELECT outcome FROM admission_decision WHERE id = ?")
      .get(decisionId) as { outcome: string };
    expect(decisionRow.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
  });

  it("off 模式：触发 outcome=ignored，零评估零聊天轮（含读零执行不变）", async () => {
    const { service, db } = createService();
    const setMode = await service.setMode(ASSISTANT_MODES.off);
    expect(setMode.ok).toBe(true);
    const card = installRouterCard(["__never__"]);
    const chat = installRouterChat(["__never__"]);
    const recorded = await service.recordTrigger({
      text: "现在都有什么工单在跑？（问询形态文本）",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    expect(recorded.ok).toBe(true);
    // off=只记 trigger+decision（outcome=ignored）零执行——读意图也不例外（读零执行不变）。
    expect(recorded.value.outcome).toBe(ASSISTANT_OUTCOMES.ignored);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(card.calls.length).toBe(0);
    expect(chat.calls.length).toBe(0);
    const evaluationCount = (
      db.raw.prepare("SELECT COUNT(*) AS n FROM router_evaluation").get() as {
        n: number;
      }
    ).n;
    expect(evaluationCount).toBe(0);
  });

  it("回归：确定性 query_status（status scope）仍走应答器——query_replied，chat 端口零调用", async () => {
    const { service, db } = createService();
    installRouterCard([
      JSON.stringify({
        query_status: { scope: { kind: "status" }, reason: "查进度" },
        evidence: [{ quote: "工单进展" }],
      }),
    ]);
    const chat = installRouterChat(["不应被调用"]);
    await service.recordTrigger({
      text: "工单进展如何？",
      simulated: ASSISTANT_STRENGTHS.explicit,
    });
    const snapshot = await waitForSnapshot(
      service,
      (s) => s.decisions[0]?.outcome === ASSISTANT_OUTCOMES.statusReplied,
    );
    const decisionId = snapshot.decisions[0]?.id;
    const decisionRow = db.raw
      .prepare("SELECT outcome, reason_code FROM admission_decision WHERE id = ?")
      .get(decisionId) as { outcome: string; reason_code: string };
    expect(decisionRow.outcome).toBe(ASSISTANT_OUTCOMES.statusReplied);
    expect(decisionRow.reason_code).toBe("query_replied");
    expect(chat.calls.length).toBe(0);
  });
});
