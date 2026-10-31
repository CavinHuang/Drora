import { afterEach, describe, expect, it, vi } from "vitest";
import { droraProtocolMethods } from "@drora/shared";
import { createInMemorySessionEventStore } from "@drora/adapters/storage";
import { DroraProtocolAgentServer } from "../../src/drora-protocol/server.js";
import { registerForkedSession } from "../../src/drora-protocol/server-operations.js";
import type { DroraProtocolAgentServerContext } from "../../src/drora-protocol/server-types.js";
import type { PersonaControlPort } from "../../src/app/drora-persona/index.js";
import { createFakeApp } from "../helpers/fake-drora-app.js";
import type { DroraAppOptions } from "../../src/app/types.js";

// Persona 切片 C 的协议层验收（spec §4/§5/§10、合同 §4.1、PM15/19/29/33/35）：
// - 双层能力发现的 CLI↔Host 侧：runtimeCapabilities 仅在控制路由注册时广告 personaControlV1；
// - 无会话管理：persona 管理方法不经 session/create、不生成占位会话；
// - 执行许可 E：新 Host 确认能力后经 requestRuntimePreferences 附加 personaEnabled，
//   CLI 在 Runtime 新建（record/runtimeConfig）时冻结；旧 Host 不发该键 → 按 false；
// - getPersonaApplication 独立查询：applied/omitted/not_available 三态真值，不伪造冷历史。

function fakeControlPort(): PersonaControlPort {
  return {
    getPersonaOverview: vi.fn(async () => ({
      ok: true as const,
      value: { state: "uninitialized" as const },
    })),
    initializePersona: vi.fn(async () => ({
      ok: true as const,
      value: {
        state: "initialized" as const,
        status: "created" as const,
        personaId: "persona-1",
        schemaVersion: 1,
        coreRevision: 1,
        templateVersion: 1,
        compilerVersion: 1,
      },
    })),
    getPersonaCore: vi.fn(async () => ({
      ok: true as const,
      value: {
        state: "built_in_preview" as const,
        core: {
          displayName: "Drora",
          selfDescription: "",
          warmth: "balanced" as const,
          directness: "direct" as const,
          humor: "light" as const,
        },
        template: {
          templateVersion: 1,
          compilerVersion: 1,
          identityStatement: "identity",
          principles: [],
          capabilityHonesty: "honesty",
          relationshipBoundary: "boundary",
        },
      },
    })),
    updatePersonaCore: vi.fn(async () => ({
      ok: true as const,
      value: { status: "saved" as const, coreRevision: 2 },
    })),
    resetPersonaCore: vi.fn(async () => ({
      ok: true as const,
      value: { status: "unchanged" as const },
    })),
    previewPersona: vi.fn(async () => ({
      ok: true as const,
      value: { text: "preview text", templateVersion: 1, compilerVersion: 1 },
    })),
    // P1a（合同 §3）：策略/偏好/导出与核心管理同一控制端口。listPreferences 故意同时
    // 返回 active 与 forgotten 槽——wire 层 strict schema 必须原样放行（含 status 键）。
    setPersonalPolicy: vi.fn(async () => ({
      ok: true as const,
      value: { status: "saved" as const, policyRevision: 1, policyEpoch: 1 },
    })),
    savePreference: vi.fn(async () => ({
      ok: true as const,
      value: { status: "saved" as const, revision: 1, keyGeneration: 1 },
    })),
    forgetPreference: vi.fn(async () => ({
      ok: true as const,
      value: { status: "forgotten" as const, revision: 2, keyGeneration: 2 },
    })),
    listPreferences: vi.fn(async () => ({
      ok: true as const,
      value: [
        {
          key: "replyLanguage",
          value: "zh-CN",
          revision: 1,
          keyGeneration: 1,
          provenanceKind: "settings" as const,
          epistemicStatus: "explicit" as const,
          pinned: true,
          updatedAt: 1_700_000_000_000,
          status: "active" as const,
        },
        {
          key: "collaborationStyle",
          value: "",
          revision: 2,
          keyGeneration: 2,
          provenanceKind: "settings" as const,
          epistemicStatus: "explicit" as const,
          pinned: false,
          updatedAt: 1_700_000_000_001,
          status: "forgotten" as const,
        },
        // P1b 行（合同 §1.2/§6）：extraction/inferred、disputed、autoSuppressed 与
        // pendingCandidate 槽必须原样通过 strict 校验（P1a 教训：形状冲突只在协议分发测试暴露）。
        {
          key: "explanationDetail",
          value: "concise",
          revision: 3,
          keyGeneration: 3,
          provenanceKind: "extraction" as const,
          epistemicStatus: "inferred" as const,
          pinned: false,
          disputed: true,
          autoSuppressed: false,
          pendingCandidate: {
            proposedValue: "detailed",
            evidenceId: "ev-1",
            expectedGeneration: 3,
            createdAt: 1_700_000_000_002,
          },
          updatedAt: 1_700_000_000_002,
          status: "active" as const,
        },
        {
          key: "preferredAddress",
          value: "",
          revision: 4,
          keyGeneration: 4,
          provenanceKind: "settings" as const,
          epistemicStatus: "explicit" as const,
          pinned: false,
          disputed: false,
          autoSuppressed: true,
          updatedAt: 1_700_000_000_003,
          status: "forgotten" as const,
        },
      ],
    })),
    preparePersonaExport: vi.fn(async () => ({
      ok: true as const,
      value: {
        format: "drora-persona-export",
        formatVersion: 1,
        capturedAt: "2026-10-30T00:00:00.000Z",
        coreRevision: 1,
        policyRevision: 1,
        core: {
          displayName: "Drora",
          selfDescription: "",
          warmth: "balanced" as const,
          directness: "direct" as const,
          humor: "light" as const,
        },
        templateVersion: 1,
        compilerVersion: 1,
        preferences: [],
        omittedCounts: { inferredOmittedUnverifiable: 0 },
        limitations: ["read-only snapshot"],
      },
    })),
    // P1b（合同 §3 allowLearningForKey＋读侧概览；spec §5/§8）：与 P1a 管理同一控制端口。
    allowLearningForKey: vi.fn(async () => ({
      ok: true as const,
      value: { status: "saved" as const, revision: 5, keyGeneration: 5 },
    })),
    getPersonaLearningOverview: vi.fn(async () => ({
      ok: true as const,
      value: {
        state: "initialized" as const,
        policy: {
          usePreferences: true,
          autoLearn: false,
          policyRevision: 2,
          policyEpoch: 2,
          learningGeneration: 1,
        },
        budget: { day: "2026-10-31", attemptsUsed: 0, inputTokensUsed: 0, outputTokensUsed: 0 },
        sources: [
          {
            key: "explanationDetail",
            evidenceId: "ev-1",
            workspaceKey: "/workspace/app",
            sessionId: "sess-1",
          },
        ],
        counters: {
          received: 1,
          droppedQueueFull: 0,
          acceptAccepted: 1,
          acceptAlreadyAccepted: 0,
          acceptSkipped: { policy_disabled: 2 },
          workApplied: 1,
          workNoChange: 0,
          workRejected: 0,
          workRetryWait: 0,
          workConflicts: 0,
          orchestrationErrors: 0,
        },
      },
    })),
  };
}

function createServerWithFakeApp(input: {
  personaControl?: PersonaControlPort;
  runtimeApplications?: (turnId: string) => unknown;
  sessionStore?: unknown;
}) {
  const appOptions: DroraAppOptions[] = [];
  let lastApp: ReturnType<typeof createFakeApp> | undefined;
  const server = new DroraProtocolAgentServer({
    ...(input.personaControl ? { personaControl: input.personaControl } : {}),
    ...(input.sessionStore ? { sessionStore: input.sessionStore } : {}),
    createDroraApp: (options) => {
      appOptions.push(options ?? {});
      const app = createFakeApp(options);
      if (input.runtimeApplications) {
        app.runtime.getPersonaTurnApplication = (query: { turnId: string }) =>
          input.runtimeApplications!(query.turnId);
      }
      lastApp = app;
      return app;
    },
    createSessionEventStore: () => createInMemorySessionEventStore(),
    cwd: "/workspace/app",
  });
  return { server, appOptions, lastApp: () => lastApp };
}

/** 应答 CLI → Host 的 runtime-materialization 请求；personaEnabled 由用例决定（旧 Host 不发）。 */
function respondRuntimePreferences(
  server: DroraProtocolAgentServer,
  preferences: Record<string, unknown>,
): void {
  server.setNotificationSink((message) => {
    if ("id" in message && message.method === droraProtocolMethods.sessionRequestRuntimePreferences) {
      void server.handleMessage({ id: message.id, result: preferences });
    }
  });
}

async function createSession(server: DroraProtocolAgentServer, sessionId: string) {
  return await server.handleMessage({
    id: `create-${sessionId}`,
    method: droraProtocolMethods.sessionCreate,
    params: {
      sessionId,
      workspace: { workspacePath: "/workspace/app", workspaceKey: "/workspace/app" },
    },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("persona 控制路由与能力位（CLI↔Host，合同 §4.1）", () => {
  it("注册控制端口时 runtimeCapabilities 广告 personaControlV1=true", async () => {
    const { server } = createServerWithFakeApp({ personaControl: fakeControlPort() });
    const response = await server.handleMessage({
      id: "caps",
      method: droraProtocolMethods.runtimeCapabilities,
      params: {},
    });
    expect(response).toMatchObject({
      result: { independentPlanState: true, historyFirst: true, personaControlV1: true },
    });
  });

  it("未注册控制端口时整个键缺席（旧 Host 视角＝无该能力，fail-closed）", async () => {
    const { server } = createServerWithFakeApp({});
    const response = await server.handleMessage({
      id: "caps",
      method: droraProtocolMethods.runtimeCapabilities,
      params: {},
    });
    expect(response).toMatchObject({ result: { independentPlanState: true, historyFirst: true } });
    expect((response as { result?: Record<string, unknown> }).result).not.toHaveProperty(
      "personaControlV1",
    );
  });
});

describe("persona 无会话管理路由（spec §4：零 session/create）", () => {
  it("管理方法直通控制端口，全程不创建任何会话记录", async () => {
    const control = fakeControlPort();
    const { server } = createServerWithFakeApp({ personaControl: control });
    const overview = await server.handleMessage({
      id: "ov",
      method: droraProtocolMethods.personaGetOverview,
      params: {},
    });
    expect(overview).toMatchObject({ result: { ok: true, value: { state: "uninitialized" } } });
    expect(control.getPersonaOverview).toHaveBeenCalledExactlyOnceWith();

    const preview = await server.handleMessage({
      id: "pv",
      method: droraProtocolMethods.personaPreview,
      params: {
        draft: {
          displayName: "Drora",
          selfDescription: "",
          warmth: "balanced",
          directness: "direct",
          humor: "light",
        },
      },
    });
    expect(preview).toMatchObject({ result: { ok: true, value: { text: "preview text" } } });

    // 无会话管理：sessions 表保持为空，session/create 从未被调用。
    const sessions = (
      server as unknown as { context: { sessions: Map<string, unknown> } }
    ).context.sessions;
    expect(sessions.size).toBe(0);
  });

  it("控制端口缺席（未装配）时管理方法 fail-closed 返回 -32601", async () => {
    const { server } = createServerWithFakeApp({});
    const response = await server.handleMessage({
      id: "ov",
      method: droraProtocolMethods.personaGetOverview,
      params: {},
    });
    expect(response).toMatchObject({ error: { code: -32601 } });
  });

  it("params 未知字段被 strict schema 拒绝（-32602），不透传给控制端口", async () => {
    const control = fakeControlPort();
    const { server } = createServerWithFakeApp({ personaControl: control });
    const response = await server.handleMessage({
      id: "upd",
      method: droraProtocolMethods.personaUpdateCore,
      params: {
        expectedRevision: 1,
        mutationId: "mut-1",
        patch: { displayName: "Dro", evilField: "nope" },
      },
    });
    expect(response).toMatchObject({ error: { code: -32602 } });
    expect(control.updatePersonaCore).not.toHaveBeenCalled();
  });
});

describe("执行许可 E 的冻结接线（spec §5：新建冻结、旧 Host 缺省 false）", () => {
  it("Host 附加 personaEnabled=true 时，Runtime 配置与 record 冻结为 true", async () => {
    const { server, appOptions } = createServerWithFakeApp({});
    respondRuntimePreferences(server, {
      nativeSearchEnhancementsEnabled: true,
      personaEnabled: true,
    });
    const created = await createSession(server, "sess_persona_on");
    expect(created).toHaveProperty("result");
    expect(appOptions.at(-1)?.runtimeConfig?.persona).toEqual({ enabled: true });
    const record = (
      server as unknown as { context: { sessions: Map<string, { personaEnabled: boolean }> } }
    ).context.sessions.get("sess_persona_on");
    expect(record?.personaEnabled).toBe(true);
  });

  it("旧 Host 不发 personaEnabled 键（能力未确认）：CLI 冻结为 false，会话照常创建", async () => {
    const { server, appOptions } = createServerWithFakeApp({});
    respondRuntimePreferences(server, { nativeSearchEnhancementsEnabled: true });
    const created = await createSession(server, "sess_persona_absent");
    expect(created).toHaveProperty("result");
    expect(appOptions.at(-1)?.runtimeConfig?.persona).toEqual({ enabled: false });
    const record = (
      server as unknown as { context: { sessions: Map<string, { personaEnabled: boolean }> } }
    ).context.sessions.get("sess_persona_absent");
    expect(record?.personaEnabled).toBe(false);
  });

  it("fork 继承：inherit 源沿父 record 的冻结 E 值，且不重读 Host 偏好（零新请求）", async () => {
    const { server, appOptions } = createServerWithFakeApp({
      // fork 注册路径要求子会话已有持久化事实（getPersistedSession）；本用例只关心
      // E 值继承，给最小 getSession 存根：父会话不存在（createSession 可建），
      // 子会话存在（fork 注册可查）。
      sessionStore: {
        getSession: async (sessionId: string) =>
          sessionId === "sess_fork_child"
            ? {
                sessionId,
                workspace: { workspacePath: "/workspace/app", workspaceKey: "/workspace/app" },
                sessionKind: "task",
                title: "child",
                mode: "build",
                status: "idle",
                time: { created: 0, updated: 0 },
                createdAt: 0,
                updatedAt: 0,
              }
            : null,
        // 快照投影会读持久化消息；本用例无历史，返回空即可。
        messages: async () => [],
      },
    });
    const answeredPreferenceRequests: string[] = [];
    server.setNotificationSink((message) => {
      if ("id" in message && message.method === droraProtocolMethods.sessionRequestRuntimePreferences) {
        answeredPreferenceRequests.push(String((message.params as { sessionId?: string }).sessionId));
        void server.handleMessage({
          id: message.id,
          result: { nativeSearchEnhancementsEnabled: true, personaEnabled: true },
        });
      }
    });
    await createSession(server, "sess_fork_parent");
    expect(appOptions.at(-1)?.runtimeConfig?.persona).toEqual({ enabled: true });

    // 走真实 fork 注册路径：materializeSessionRecord 收到 { kind: "inherit", parent } 源
    // （server-operations registerForkedSession 的既有宿主生命周期）。
    const context = (server as unknown as { context: DroraProtocolAgentServerContext }).context;
    const parent = context.sessions.get("sess_fork_parent");
    expect(parent).toBeDefined();
    await registerForkedSession(
      context,
      parent!,
      { forkedSessionId: "sess_fork_child" },
      {
        runtimeConfig: { mode: parent!.app.getMode(), model: parent!.app.getModel() },
        inheritLatestTarget: false,
      },
    );

    // fork 继承父 record 的冻结 E 值；整个 fork 过程没有向 Host 发新的偏好请求
    // （warm/fork 不重读，spec §5）。
    expect(context.sessions.get("sess_fork_child")?.personaEnabled).toBe(true);
    expect(appOptions.at(-1)?.runtimeConfig?.persona).toEqual({ enabled: true });
    expect(answeredPreferenceRequests).toEqual(["sess_fork_parent"]);
  });
});

describe("getPersonaApplication 三态（合同 §3：不伪造冷历史）", () => {
  it("会话存在且 Runtime 有对应结算记录：按 turnId 如实回答 applied", async () => {
    const { server } = createServerWithFakeApp({
      runtimeApplications: (turnId) =>
        turnId === "turn-9" ? { status: "applied", turnId } : { status: "not_available" },
    });
    respondRuntimePreferences(server, { nativeSearchEnhancementsEnabled: true });
    await createSession(server, "sess_apply");
    const response = await server.handleMessage({
      id: "app",
      method: droraProtocolMethods.personaGetApplication,
      params: { sessionId: "sess_apply", turnId: "turn-9" },
    });
    expect(response).toMatchObject({ result: { status: "applied", turnId: "turn-9" } });
  });

  it("会话存在但 Runtime 无该轮记录：not_available（不冒充 applied/omitted）", async () => {
    const { server } = createServerWithFakeApp({
      runtimeApplications: () => ({ status: "not_available" }),
    });
    respondRuntimePreferences(server, { nativeSearchEnhancementsEnabled: true });
    await createSession(server, "sess_cold");
    const response = await server.handleMessage({
      id: "app",
      method: droraProtocolMethods.personaGetApplication,
      params: { sessionId: "sess_cold", turnId: "turn-after-restart" },
    });
    expect(response).toMatchObject({ result: { status: "not_available" } });
  });

  it("会话不存在（重启/他进程）：not_available", async () => {
    const { server } = createServerWithFakeApp({});
    const response = await server.handleMessage({
      id: "app",
      method: droraProtocolMethods.personaGetApplication,
      params: { sessionId: "sess_missing", turnId: "turn-1" },
    });
    expect(response).toMatchObject({ result: { status: "not_available" } });
  });

  it("runtime 未实现查询口（旧嵌入 runtime）：not_available，不抛协议错误", async () => {
    const { server } = createServerWithFakeApp({});
    respondRuntimePreferences(server, { nativeSearchEnhancementsEnabled: true });
    await createSession(server, "sess_legacy_runtime");
    const response = await server.handleMessage({
      id: "app",
      method: droraProtocolMethods.personaGetApplication,
      params: { sessionId: "sess_legacy_runtime", turnId: "turn-1" },
    });
    expect(response).toMatchObject({ result: { status: "not_available" } });
  });
});

describe("persona P1a wire 方法（合同 §3：策略/偏好/导出的分发与 strict 形状）", () => {
  it("五个 P1a 方法直通控制端口；listPreferences 含 forgotten 槽原样通过 strict 校验", async () => {
    const control = fakeControlPort();
    const { server } = createServerWithFakeApp({ personaControl: control });

    const policy = await server.handleMessage({
      id: "p1",
      method: droraProtocolMethods.personaSetPolicy,
      params: { expectedPolicyRevision: 0, usePreferences: true, mutationId: "u-1" },
    });
    expect(policy).toMatchObject({
      result: { ok: true, value: { status: "saved", policyRevision: 1, policyEpoch: 1 } },
    });
    expect(control.setPersonalPolicy).toHaveBeenCalledExactlyOnceWith({
      expectedPolicyRevision: 0,
      usePreferences: true,
      mutationId: "u-1",
    });

    const save = await server.handleMessage({
      id: "p2",
      method: droraProtocolMethods.personaSavePreference,
      params: {
        key: "replyLanguage",
        value: "zh-CN",
        expectedRevision: 0,
        mutationId: "s-1",
      },
    });
    expect(save).toMatchObject({
      result: { ok: true, value: { status: "saved", revision: 1, keyGeneration: 1 } },
    });

    const forget = await server.handleMessage({
      id: "p3",
      method: droraProtocolMethods.personaForgetPreference,
      params: { key: "replyLanguage", expectedRevision: 1, mutationId: "f-1" },
    });
    expect(forget).toMatchObject({
      result: { ok: true, value: { status: "forgotten", revision: 2, keyGeneration: 2 } },
    });

    const list = await server.handleMessage({
      id: "p4",
      method: droraProtocolMethods.personaListPreferences,
      params: {},
    });
    const listValue = (
      list as { result?: { ok?: boolean; value?: { preferences?: Array<Record<string, unknown>> } } }
    ).result;
    expect(listValue).toMatchObject({ ok: true });
    // active 与 forgotten 槽都原样通过（含 status 键；strict 拒绝会在这里爆发）。
    expect(listValue?.value?.preferences?.map((slot) => slot.status)).toEqual([
      "active",
      "forgotten",
      "active",
      "forgotten",
    ]);
    // P1b 槽原样通过：disputed/autoSuppressed/pendingCandidate 与 extraction/inferred 词汇。
    expect(listValue?.value?.preferences?.[2]).toMatchObject({
      provenanceKind: "extraction",
      epistemicStatus: "inferred",
      disputed: true,
      pendingCandidate: { evidenceId: "ev-1", proposedValue: "detailed" },
    });
    expect(listValue?.value?.preferences?.[3]).toMatchObject({
      autoSuppressed: true,
      disputed: false,
    });

    const exported = await server.handleMessage({
      id: "p5",
      method: droraProtocolMethods.personaPrepareExport,
      params: {},
    });
    expect(exported).toMatchObject({
      result: { ok: true, value: { format: "drora-persona-export", formatVersion: 1 } },
    });

    // 无会话管理：sessions 表保持为空。
    const sessions = (
      server as unknown as { context: { sessions: Map<string, unknown> } }
    ).context.sessions;
    expect(sessions.size).toBe(0);
  });

  it.each([
    {
      name: "setPolicy",
      method: droraProtocolMethods.personaSetPolicy,
      params: { expectedPolicyRevision: 0, usePreferences: true, mutationId: "m", evil: 1 },
      key: "setPersonalPolicy",
    },
    {
      name: "setPolicy-autoLearn",
      method: droraProtocolMethods.personaSetPolicy,
      params: {
        expectedPolicyRevision: 0,
        usePreferences: true,
        autoLearn: true,
        mutationId: "m",
        evil: 1,
      },
      key: "setPersonalPolicy",
    },
    {
      name: "savePreference",
      method: droraProtocolMethods.personaSavePreference,
      params: {
        key: "replyLanguage",
        value: "zh-CN",
        expectedRevision: 0,
        mutationId: "m",
        evil: 1,
      },
      key: "savePreference",
    },
    {
      name: "forgetPreference",
      method: droraProtocolMethods.personaForgetPreference,
      params: { key: "replyLanguage", expectedRevision: 0, mutationId: "m", evil: 1 },
      key: "forgetPreference",
    },
    {
      name: "listPreferences",
      method: droraProtocolMethods.personaListPreferences,
      params: { evil: 1 },
      key: "listPreferences",
    },
    {
      name: "prepareExport",
      method: droraProtocolMethods.personaPrepareExport,
      params: { evil: 1 },
      key: "preparePersonaExport",
    },
    {
      name: "allowLearningForKey",
      method: droraProtocolMethods.personaAllowLearningForKey,
      params: { key: "replyLanguage", expectedGeneration: 0, mutationId: "m", evil: 1 },
      key: "allowLearningForKey",
    },
    {
      name: "getLearningOverview",
      method: droraProtocolMethods.personaGetLearningOverview,
      params: { evil: 1 },
      key: "getPersonaLearningOverview",
    },
  ])("$name 的 params 未知字段被 strict schema 拒绝（-32602）", async ({ method, params, key }) => {
    const control = fakeControlPort();
    const { server } = createServerWithFakeApp({ personaControl: control });
    const response = await server.handleMessage({ id: "x", method, params });
    expect(response).toMatchObject({ error: { code: -32602 } });
    expect(control[key as "setPersonalPolicy"]).not.toHaveBeenCalled();
  });
});

describe("persona P1b wire 方法（合同 §3 allowLearningForKey＋读侧概览；spec §5/§8）", () => {
  it("allowLearningForKey 直通控制端口（key/expectedGeneration/mutationId 原样透传）", async () => {
    const control = fakeControlPort();
    const { server } = createServerWithFakeApp({ personaControl: control });
    const response = await server.handleMessage({
      id: "p1b-1",
      method: droraProtocolMethods.personaAllowLearningForKey,
      params: { key: "preferredAddress", expectedGeneration: 4, mutationId: "allow-1" },
    });
    expect(response).toMatchObject({
      result: { ok: true, value: { status: "saved", revision: 5, keyGeneration: 5 } },
    });
    expect(control.allowLearningForKey).toHaveBeenCalledExactlyOnceWith({
      key: "preferredAddress",
      expectedGeneration: 4,
      mutationId: "allow-1",
    });
  });

  it("getPersonaLearningOverview 直通控制端口；policy/budget/sources/counters strict 形状原样通过", async () => {
    const control = fakeControlPort();
    const { server } = createServerWithFakeApp({ personaControl: control });
    const response = await server.handleMessage({
      id: "p1b-2",
      method: droraProtocolMethods.personaGetLearningOverview,
      params: {},
    });
    expect(response).toMatchObject({
      result: {
        ok: true,
        value: {
          state: "initialized",
          policy: { usePreferences: true, autoLearn: false, learningGeneration: 1 },
          budget: { day: "2026-10-31", attemptsUsed: 0 },
          sources: [{ key: "explanationDetail", evidenceId: "ev-1" }],
          counters: { received: 1, acceptSkipped: { policy_disabled: 2 } },
        },
      },
    });
    expect(control.getPersonaLearningOverview).toHaveBeenCalledExactlyOnceWith();
    // 无会话管理：sessions 表保持为空。
    const sessions = (
      server as unknown as { context: { sessions: Map<string, unknown> } }
    ).context.sessions;
    expect(sessions.size).toBe(0);
  });

  it("setPolicy 的 autoLearn patch 直通控制端口（缺省时不发明键）", async () => {
    const control = fakeControlPort();
    const { server } = createServerWithFakeApp({ personaControl: control });
    await server.handleMessage({
      id: "p1b-3",
      method: droraProtocolMethods.personaSetPolicy,
      params: { expectedPolicyRevision: 1, usePreferences: true, autoLearn: true, mutationId: "l-1" },
    });
    expect(control.setPersonalPolicy).toHaveBeenCalledExactlyOnceWith({
      expectedPolicyRevision: 1,
      usePreferences: true,
      autoLearn: true,
      mutationId: "l-1",
    });

    await server.handleMessage({
      id: "p1b-4",
      method: droraProtocolMethods.personaSetPolicy,
      params: { expectedPolicyRevision: 2, usePreferences: false, mutationId: "u-off-1" },
    });
    expect(control.setPersonalPolicy).toHaveBeenLastCalledWith({
      expectedPolicyRevision: 2,
      usePreferences: false,
      mutationId: "u-off-1",
    });
  });

  it("未初始化概览（state=uninitialized）与 ok:false 错误臂原样通过 strict 校验", async () => {
    const control = fakeControlPort();
    control.getPersonaLearningOverview = vi.fn(async () => ({
      ok: true as const,
      value: { state: "uninitialized" as const },
    }));
    const { server } = createServerWithFakeApp({ personaControl: control });
    const uninitialized = await server.handleMessage({
      id: "p1b-5",
      method: droraProtocolMethods.personaGetLearningOverview,
      params: {},
    });
    expect(uninitialized).toMatchObject({ result: { ok: true, value: { state: "uninitialized" } } });

    control.allowLearningForKey = vi.fn(async () => ({
      ok: false as const,
      code: "revision_conflict" as const,
    }));
    const conflicted = await server.handleMessage({
      id: "p1b-6",
      method: droraProtocolMethods.personaAllowLearningForKey,
      params: { key: "preferredAddress", expectedGeneration: 1, mutationId: "allow-stale" },
    });
    expect(conflicted).toMatchObject({ result: { ok: false, code: "revision_conflict" } });
  });
});
