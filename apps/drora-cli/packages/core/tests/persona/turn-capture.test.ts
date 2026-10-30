import { describe, expect, it, vi } from "vitest";
import {
  CoreErrorType,
  SessionEventType,
  createMessageId,
  createSessionId,
  type ModelRequest,
} from "@drora/contracts";
import type { AgentRuntime } from "../../src/runtime.js";
import {
  compilePersonaCore,
  defaultPersonaCore,
  isPersonaEligibleMainRequest,
  type PersonaCaptureOutcome,
  type PersonaCapturePort,
  type PersonaContribution,
  type PersonaTurnCaptureRequest,
} from "../../src/persona/index.js";
import { createToolRegistry } from "../../src/tool/registry.js";
import { createTestSessionEventStore } from "../test-event-store.js";
import {
  OUTPUT_TOKEN_CONTINUE_PROMPT,
  createRuntime,
  outputLimitResult,
  registerReadOnlyTool,
  requestText,
  stopResult,
} from "../runtime-output-token-continuation-test-helpers.js";

const SENTINEL = contributionFor();
const SECOND_TURN_SENTINEL = contributionFor("Drora Two", 8);

function contributionFor(displayName = "Drora", coreRevision = 7): PersonaContribution {
  const compiled = compilePersonaCore({ ...defaultPersonaCore, displayName }, coreRevision);
  if (compiled.status !== "compiled") throw new Error("Invalid test fixture");
  return compiled.contribution;
}

type CaptureScript = Array<PersonaCaptureOutcome | Error>;

function createScriptedCapturePort(script: CaptureScript) {
  const calls: PersonaTurnCaptureRequest[] = [];
  const port: PersonaCapturePort = {
    captureContribution: async (request) => {
      calls.push(request);
      const next = script.shift();
      if (next === undefined) throw new Error("Unexpected extra persona capture");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { calls, port };
}

function sentinelCount(messages: readonly { content: unknown }[], sentinel = SENTINEL): number {
  return messages.filter((message) => message.content === sentinel.content).length;
}

function canonicalText(runtime: AgentRuntime): string {
  return (runtime as never as { messageHistory: { toRuntimeEntries(): unknown[] } }).messageHistory
    .toRuntimeEntries()
    .map((entry) =>
      requestText([
        (entry as { message?: { content: unknown } }).message ?? (entry as { content: unknown }),
      ]),
    )
    .join("\n");
}

describe("persona main-request eligibility table", () => {
  it.each([{}, { inputVisibility: "user-visible" as const }])(
    "accepts direct real-user turns (%j)",
    (admission) => expect(isPersonaEligibleMainRequest(admission)).toBe(true),
  );

  it.each([
    "workflow_launch",
    "subagent",
    "subagent_message",
    "background_task",
    "goal-continuation",
    "fork",
    "rewind",
    "selection_side_chat",
    "agent_listing_delta",
    "shared_context",
  ])("rejects synthetic source %s", (inputSource) => {
    expect(isPersonaEligibleMainRequest({ inputSource })).toBe(false);
  });

  it.each(["model-only", "some-future-visibility"])(
    "rejects unknown/model-only visibility %s",
    (inputVisibility) => {
      expect(isPersonaEligibleMainRequest({ inputVisibility })).toBe(false);
    },
  );

  it("rejects automation and off-peak identities", () => {
    expect(isPersonaEligibleMainRequest({ automationId: "automation-1" })).toBe(false);
    expect(isPersonaEligibleMainRequest({ offPeakTaskId: "offpeak-1" })).toBe(false);
  });
});

describe("persona runtime turn capture", () => {
  it("applies one frozen contribution to the request and keeps canonical history clean", async () => {
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
    ]);
    let requests: ModelRequest[] = [];
    const runtime = createRuntime({
      id: "persona-applied-basic",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("hello");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBeDefined();
    expect(requests).toHaveLength(1);
    expect(sentinelCount(requests[0]?.messages ?? [])).toBe(1);
    // 贡献只进入请求投影；canonical 历史没有新增人格正文。
    expect(canonicalText(runtime)).not.toContain(SENTINEL.content);
  });

  it("keeps default-off equivalent: applied adds exactly one system message to the baseline", async () => {
    let requests: ModelRequest[] = [];
    const modelAdapter = {
      async generateText(request: ModelRequest) {
        requests.push(request);
        return stopResult("done", 2);
      },
    };
    const baseline = createRuntime({
      id: "persona-baseline",
      config: { mode: "yolo" },
      modelAdapter,
    });
    await baseline.executeTurn("hello");
    const baselineMessages = requests[0]?.messages ?? [];

    requests = [];
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
    ]);
    const personal = createRuntime({
      id: "persona-applied-compare",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter,
    });
    await personal.executeTurn("hello");
    const personalMessages = requests[0]?.messages ?? [];

    expect(calls).toHaveLength(1);
    expect(personalMessages).toHaveLength(baselineMessages.length + 1);
    expect(personalMessages.filter((message) => message.content !== SENTINEL.content)).toEqual(
      baselineMessages,
    );
    // 插入点在前导 system 组末尾：删除贡献后角色序列与基线一致。
    const leadingSystem = baselineMessages.filter((m) => m.role === "system").length;
    expect(personalMessages[leadingSystem]?.content).toBe(SENTINEL.content);
  });

  it("freezes one capture across tool continuations within the same turn", async () => {
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
    ]);
    const registry = createToolRegistry();
    registerReadOnlyTool(registry, "Echo", "ok");
    const requests: ModelRequest[] = [];
    let callCount = 0;
    const runtime = createRuntime({
      id: "persona-tool-continuation",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port, toolRegistry: registry },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          callCount += 1;
          if (callCount === 1) {
            return {
              finishReason: "tool-calls",
              text: "",
              toolCalls: [{ id: "echo-1", name: "Echo", input: {} }],
              usage: {},
            };
          }
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("use the tool");

    // 同一存活轮只捕获一次；重试与工具续跑复用冻结值（PM03/PR02）。
    expect(calls).toHaveLength(1);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const request of requests) {
      expect(sentinelCount(request.messages)).toBe(1);
    }
    expect(canonicalText(runtime)).not.toContain(SENTINEL.content);
  });

  it("reuses the frozen contribution across output-token continuation and keeps records consistent", async () => {
    const sessionId = createSessionId("persona-continuation-records");
    const eventStore = createTestSessionEventStore();
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
    ]);
    const requests: ModelRequest[] = [];
    let callCount = 0;
    const runtime = createRuntime({
      id: "persona-continuation-records",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port, eventStore },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          callCount += 1;
          if (callCount === 1) {
            return outputLimitResult({ rawFinishReason: "max_tokens", text: "A" });
          }
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("start");

    expect(calls).toHaveLength(1);
    expect(requests).toHaveLength(2);
    // 实际请求：续跑提示与冻结贡献同时在。
    expect(requests[0]?.messages.some((m) => m.content === OUTPUT_TOKEN_CONTINUE_PROMPT)).toBe(
      false,
    );
    expect(requests[1]?.messages.some((m) => m.content === OUTPUT_TOKEN_CONTINUE_PROMPT)).toBe(
      true,
    );
    for (const request of requests) {
      expect(sentinelCount(request.messages)).toBe(1);
    }
    // 记录投影（ModelRequest 事件）：二次渲染同样包含一次贡献，且不含自动 Continue 提示。
    const events = await eventStore.getEvents(sessionId);
    const modelRequestEvents = events.filter(
      (event) => event.type === SessionEventType.ModelRequest,
    );
    expect(modelRequestEvents).toHaveLength(2);
    for (const event of modelRequestEvents) {
      const recorded = (event.payload as { messages: { content: unknown }[] }).messages;
      expect(sentinelCount(recorded)).toBe(1);
      expect(requestText(recorded)).not.toContain(OUTPUT_TOKEN_CONTINUE_PROMPT);
    }
  });

  it("captures at execution time for busy-queued turns", async () => {
    let releaseFirst: (result: ReturnType<typeof stopResult>) => void = () => {};
    const firstGate = new Promise<ReturnType<typeof stopResult>>((resolve) => {
      releaseFirst = resolve;
    });
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
      { status: "applied", contribution: SECOND_TURN_SENTINEL },
    ]);
    const requests: ModelRequest[] = [];
    let callCount = 0;
    const runtime = createRuntime({
      id: "persona-busy-queue",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          callCount += 1;
          if (callCount === 1) return firstGate;
          return stopResult("second done", 2);
        },
      },
    });

    const first = runtime.executeTurn("first");
    const queued = runtime.executeTurn("second");
    // 第一轮在执行时捕获 revision 7；排队轮以执行时版本捕获（PM04）。
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    releaseFirst(stopResult("first done", 2));
    await first;
    await queued;

    expect(calls).toHaveLength(2);
    expect(sentinelCount(requests[0]?.messages ?? [])).toBe(1);
    const lastRequest = requests.at(-1)?.messages ?? [];
    expect(sentinelCount(lastRequest, SECOND_TURN_SENTINEL)).toBe(1);
    expect(sentinelCount(lastRequest)).toBe(0);
  });

  it("propagates cancellation during capture without sending a model request", async () => {
    const controller = new AbortController();
    const port: PersonaCapturePort = {
      captureContribution: (request) =>
        request.signal.aborted
          ? Promise.reject(request.signal.reason)
          : new Promise((_, reject) => {
              request.signal.addEventListener("abort", () => reject(request.signal.reason), {
                once: true,
              });
            }),
    };
    const requests: ModelRequest[] = [];
    const runtime = createRuntime({
      id: "persona-cancelled",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          return stopResult("done", 2);
        },
      },
    });

    const pending = runtime.executeTurn("hello", undefined, { abortSignal: controller.signal });
    controller.abort();
    // 取消沿原 AbortSignal 路径传播，不能被转换成 omitted 后继续请求。
    await expect(pending).rejects.toMatchObject({ type: CoreErrorType.TurnCancelled });
    expect(requests).toHaveLength(0);
  });

  it("degrades port faults and port-side cancellation to a plain omission", async () => {
    for (const script of [
      [new Error("worker unavailable")] satisfies CaptureScript,
      [{ status: "cancelled", reason: "stale" }] satisfies CaptureScript,
      [{ status: "omitted", reason: "core corrupted" }] satisfies CaptureScript,
    ]) {
      const { calls, port } = createScriptedCapturePort(script);
      const requests: ModelRequest[] = [];
      const runtime = createRuntime({
        id: "persona-omitted",
        config: { mode: "yolo" },
        deps: { personaCapturePort: port },
        modelAdapter: {
          async generateText(request: ModelRequest) {
            requests.push(request);
            return stopResult("done", 2);
          },
        },
      });

      const result = await runtime.executeTurn("hello");

      expect(result.response).toBe("done");
      expect(calls).toHaveLength(1);
      expect(sentinelCount(requests[0]?.messages ?? [])).toBe(0);
    }
  });

  it.each([
    {
      name: "model-only continuation",
      options: {
        inputVisibility: "model-only" as const,
        recordedInputMessageId: createMessageId(),
        skipInputRecord: true,
        skipUserPromptSubmitHooks: true,
      },
    },
    { name: "subagent source", options: { inputSource: "subagent" as const } },
    { name: "automation turn", options: { automationId: "automation-abc" } },
  ])("never captures for $name", async ({ options }) => {
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
    ]);
    const requests: ModelRequest[] = [];
    const runtime = createRuntime({
      id: "persona-ineligible",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("hello", undefined, options);

    expect(calls).toHaveLength(0);
    expect(sentinelCount(requests[0]?.messages ?? [])).toBe(0);
  });

  it("captures fresh per turn: omitted turn stays clean, next eligible turn applies", async () => {
    const { calls, port } = createScriptedCapturePort([
      { status: "omitted", reason: "not initialized" },
      { status: "applied", contribution: SENTINEL },
    ]);
    const requests: ModelRequest[] = [];
    const runtime = createRuntime({
      id: "persona-per-turn",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("first");
    await runtime.executeTurn("second");

    expect(calls).toHaveLength(2);
    expect(sentinelCount(requests[0]?.messages ?? [])).toBe(0);
    expect(sentinelCount(requests[1]?.messages ?? [])).toBe(1);
  });
});

describe("persona turn application query (切片 C：getPersonaApplication 的 Runtime 侧三态)", () => {
  it("reports applied for the settled turn and not_available for any other turnId", async () => {
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
    ]);
    const runtime = createRuntime({
      id: "persona-query-applied",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("hello");

    const turnId = calls[0]?.turnId;
    expect(turnId).toBeTruthy();
    // 当前轮已应用：按 turnId 精确命中。
    expect(runtime.getPersonaTurnApplication({ turnId })).toEqual({
      status: "applied",
      turnId,
    });
    // 其余 turnId（更早轮/未知轮）不冒充已应用。
    expect(runtime.getPersonaTurnApplication({ turnId: "some-other-turn" })).toEqual({
      status: "not_available",
    });
  });

  it("reports omitted with the settled reason for the settled turn", async () => {
    const { calls, port } = createScriptedCapturePort([
      { status: "omitted", reason: "permission_not_granted" },
    ]);
    const runtime = createRuntime({
      id: "persona-query-omitted",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("hello");

    const turnId = calls[0]?.turnId;
    expect(runtime.getPersonaTurnApplication({ turnId })).toEqual({
      status: "omitted",
      turnId,
      reason: "permission_not_granted",
    });
  });

  it("keeps cancelled out of the application record: turn continues, query answers not_available", async () => {
    // spec §6「不能将 cancelled 当 omitted 继续请求」：编排层不再把端口侧 cancelled
    // 记成省略——轮次继续但无贡献，查询口按无记录如实 not_available。
    const { calls, port } = createScriptedCapturePort([
      { status: "cancelled", reason: "stale" },
    ]);
    const requests: ModelRequest[] = [];
    const runtime = createRuntime({
      id: "persona-query-cancelled",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText(request: ModelRequest) {
          requests.push(request);
          return stopResult("done", 2);
        },
      },
    });

    const result = await runtime.executeTurn("hello");

    expect(result.response).toBe("done");
    expect(sentinelCount(requests[0]?.messages ?? [])).toBe(0);
    const turnId = calls[0]?.turnId;
    expect(runtime.getPersonaTurnApplication({ turnId })).toEqual({ status: "not_available" });
  });

  it("records a reason-less omission when the port throws but the turn still runs", async () => {
    // 端口抛错＝该轮执行过且贡献已省略：如实落 omitted（原因未知），查询口不把
    // 「执行过且省略」的轮误报成 not_available（合同 §3 三态）。
    const { calls, port } = createScriptedCapturePort([new Error("worker unavailable")]);
    const runtime = createRuntime({
      id: "persona-query-port-throw",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    const result = await runtime.executeTurn("hello");

    expect(result.response).toBe("done");
    const turnId = calls[0]?.turnId;
    expect(runtime.getPersonaTurnApplication({ turnId })).toEqual({
      status: "omitted",
      turnId,
    });
  });

  it("keeps only the latest settled turn: a newer turn supersedes the previous record", async () => {
    const { calls, port } = createScriptedCapturePort([
      { status: "applied", contribution: SENTINEL },
      { status: "omitted", reason: "stale" },
    ]);
    const runtime = createRuntime({
      id: "persona-query-latest",
      config: { mode: "yolo" },
      deps: { personaCapturePort: port },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    await runtime.executeTurn("first");
    await runtime.executeTurn("second");

    expect(calls).toHaveLength(2);
    const [firstTurnId, secondTurnId] = calls.map((call) => call.turnId);
    // 查询口只持有最近一次结算记录：旧轮如实 not_available，不回放历史。
    expect(runtime.getPersonaTurnApplication({ turnId: firstTurnId })).toEqual({
      status: "not_available",
    });
    expect(runtime.getPersonaTurnApplication({ turnId: secondTurnId })).toEqual({
      status: "omitted",
      turnId: secondTurnId,
      reason: "stale",
    });
  });

  it("answers not_available on a fresh runtime for a turnId it never settled (重启不伪造冷历史)", async () => {
    const runtime = createRuntime({
      id: "persona-query-fresh",
      config: { mode: "yolo" },
      modelAdapter: {
        async generateText() {
          return stopResult("done", 2);
        },
      },
    });

    // 无端口的 Runtime（功能关闭）对任何 turnId 都没有内存记录。
    expect(runtime.getPersonaTurnApplication({ turnId: "cold-turn-after-restart" })).toEqual({
      status: "not_available",
    });
  });
});
