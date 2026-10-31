import { describe, expect, it } from "vitest";
import {
  SessionEventType,
  type ModelRequest,
  type SessionEvent,
} from "@drora/contracts";
import type { SessionEventStorePort } from "@drora/contracts";
import type {
  PersonaLearningNotificationPort,
  PersonaTurnLearningOpportunity,
} from "../../src/persona/index.js";
import { createTestSessionEventStore } from "../test-event-store.js";
import { createRuntime, stopResult } from "../runtime-output-token-continuation-test-helpers.js";

/**
 * P1b 学习机会通知接缝（specs/drora-persona-system.md §8、合同 §6）：普通成功轮完成后
 * 非阻塞通知一次；资格与 capture 同表；端口故障不影响已完成的轮次；边界事实缺失跳过。
 * 门矩阵/预算/64 上限等消费者语义属 bootstrap 学习消费者测试（bootstrap tests/persona/）。
 */
function createRecordingNotificationPort(options?: {
  throwOnNotify?: boolean;
}): { calls: PersonaTurnLearningOpportunity[]; port: PersonaLearningNotificationPort } {
  const calls: PersonaTurnLearningOpportunity[] = [];
  const port: PersonaLearningNotificationPort = {
    notifyLearningOpportunity: (opportunity) => {
      calls.push(opportunity);
      if (options?.throwOnNotify) {
        throw new Error("notification consumer is broken");
      }
    },
  };
  return { calls, port };
}

async function turnCompleteEvents(
  eventStore: SessionEventStorePort,
  sessionId: string,
): Promise<SessionEvent[]> {
  const events = await eventStore.getEvents(sessionId);
  return events.filter((event) => event.type === SessionEventType.TurnComplete);
}

describe("persona learning opportunity notification seam", () => {
  it("notifies once per normal successful turn with persistence boundary facts", async () => {
    const { calls, port } = createRecordingNotificationPort();
    let requests: ModelRequest[] = [];
    const eventStore = createTestSessionEventStore();
    const runtime = createRuntime({
      id: "persona-learning-notify-basic",
      config: { mode: "yolo" },
      deps: { personaLearningNotificationPort: port, eventStore },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("hello");

    expect(calls).toHaveLength(1);
    const opportunity = calls[0]!;
    expect(opportunity.sessionId).toBe(runtime.sessionId);
    expect(opportunity.turnId).toBeTruthy();
    expect(opportunity.userMessageId).toBeTruthy();
    expect(opportunity.boundaryMessageId).toBeTruthy();
    // 通知不进入 TurnComplete 关键路径的断言事实：调用发生时本轮 TurnComplete 事件已存在。
    const completes = await turnCompleteEvents(eventStore, runtime.sessionId);
    expect(completes).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("does not notify for ineligible synthetic entries", async () => {
    const { calls, port } = createRecordingNotificationPort();
    const runtime = createRuntime({
      id: "persona-learning-notify-ineligible",
      config: { mode: "yolo" },
      deps: { personaLearningNotificationPort: port },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("synthetic entry", undefined, { inputSource: "subagent" });

    expect(calls).toHaveLength(0);
  });

  it("keeps the completed turn intact when the consumer port throws", async () => {
    const { port } = createRecordingNotificationPort({ throwOnNotify: true });
    const eventStore = createTestSessionEventStore();
    const runtime = createRuntime({
      id: "persona-learning-notify-throw",
      config: { mode: "yolo" },
      deps: { personaLearningNotificationPort: port, eventStore },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    const result = await runtime.executeTurn("hello");

    // 端口抛错只丢机会：轮次照常成功收口，TurnComplete 事实不变。
    expect(result.response).toBe("done");
    const completes = await turnCompleteEvents(eventStore, runtime.sessionId);
    expect(completes).toHaveLength(1);
  });

  it("is inert without the port (default-off equivalence)", async () => {
    const runtime = createRuntime({
      id: "persona-learning-notify-absent",
      config: { mode: "yolo" },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    const result = await runtime.executeTurn("hello");
    expect(result.response).toBe("done");
  });
});
