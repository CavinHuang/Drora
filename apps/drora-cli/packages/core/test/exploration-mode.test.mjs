// 探索模式核心单测：对 specs/exploration-mode.md 验收场景 2/3/6 的 core 逻辑逐条断言。
// 覆盖：执行态只读解析（readOnly 不可被 mode/plan 补丁清除）、ReadSessionContext 的
// fork 边界切片（last-wins）、权限服务只读闸门（读放行/写拒绝/plan 切换拒绝）、
// 经 tsx 直接消费 src（workspace 内包以 TS 源码导出）。
import assert from "node:assert/strict";
import { resolveExecutionState, executionStateSchema } from "@drora/shared";

// ── 执行态：readOnly 语义 ─────────────────────────────────────────────

function testReadOnlySurvivesPatches() {
  // 创建边界写入 readOnly 后，任何 mode/planEnabled 补丁不得清除它。
  const current = { mode: "build", planEnabled: false, readOnly: true };
  const patched = resolveExecutionState({ mode: "yolo" }, current);
  assert.equal(patched.readOnly, true, "mode patch must not clear readOnly");
  assert.equal(patched.mode, "yolo");

  const patchedPlan = resolveExecutionState({ planEnabled: true }, current);
  assert.equal(patchedPlan.readOnly, true, "planEnabled patch must not clear readOnly");

  // 缺席 readOnly 的旧调用方零语义漂移。
  const legacy = resolveExecutionState({ mode: "edit" }, { mode: "build", planEnabled: false });
  assert.equal(legacy.readOnly, undefined);
}

function testReadOnlySchemaRoundTrip() {
  // resume 恢复路径：executionStateSchema.safeParse 必须保留 readOnly。
  const parsed = executionStateSchema.safeParse({ mode: "build", planEnabled: false, readOnly: true });
  assert.ok(parsed.success);
  assert.equal(parsed.data.readOnly, true);

  // 旧执行态条目（无 readOnly）解析成功且 readOnly 缺席。
  const legacyParsed = executionStateSchema.safeParse({ mode: "yolo", planEnabled: false });
  assert.ok(legacyParsed.success);
  assert.equal(legacyParsed.data.readOnly, undefined);
}

// ── ReadSessionContext：fork 边界切片 ────────────────────────────────

// 直接驱动 core 导出的纯函数 buildSessionContextMaterial；
// fork notice 检测在其入口（slice 层）实现，formatMessageSnippet 跳过 model-only。
async function testForkBoundarySlicing() {
  const { buildSessionContextMaterial } = await import(
    "../src/session-context/read-session-context.js"
  );
  const { createMessageId, createPartId } = await import("@drora/contracts");

  function userMessage(id, text, extra = {}) {
    return {
      info: {
        id: createMessageId(id),
        sessionID: "sess_parent",
        role: "user",
        time: { created: 1, updated: 1 },
        ...extra,
      },
      parts: [
        {
          id: createPartId(id),
          messageID: createMessageId(id),
          sessionID: "sess_parent",
          type: "text",
          text,
          time: { start: 1, end: 1 },
        },
      ],
    };
  }

  function assistantMessage(id, text) {
    return {
      info: {
        id: createMessageId(id),
        sessionID: "sess_parent",
        role: "assistant",
        time: { created: 2, updated: 2 },
        modelID: "m",
        providerID: "p",
      },
      parts: [
        {
          id: createPartId(id),
          messageID: createMessageId(id),
          sessionID: "sess_parent",
          type: "text",
          text,
          time: { start: 1, end: 1 },
        },
      ],
    };
  }

  function forkNoticeMessage(id, parentSessionId, targetMessageId) {
    return {
      info: {
        id: createMessageId(id),
        sessionID: "sess_child",
        role: "user",
        synthetic: true,
        source: "fork",
        time: { created: 3, updated: 3 },
        metadata: { forkOrigin: { parentSessionId, targetMessageId } },
        visibility: "model-only",
      },
      parts: [],
    };
  }

  const messages = [
    userMessage("u1", "主线问题一"),
    assistantMessage("a1", "主线回答一"),
    forkNoticeMessage("f1", "sess_parent", "msg_a1"),
    userMessage("u2", "分支内问题"),
    assistantMessage("a2", "分支内回答：结论 beta"),
  ];

  const material = buildSessionContextMaterial({
    messages,
    query: "分支结论",
    session: {
      id: "sess_child",
      projectID: "p",
      taskType: "fork",
      slug: "s",
      directory: "/tmp",
      title: "分支",
      forkSourceMessageID: "msg_a1",
      forkSourceLabel: "这条回复",
      version: "1",
      time: { created: 1, updated: 1 },
    },
    strategy: "relevant",
  });

  assert.ok(material.forkBoundary, "fork boundary must be detected");
  assert.equal(material.forkBoundary.parentSessionId, "sess_parent");
  assert.equal(material.forkBoundary.sourceMessageId, "msg_a1");
  // 切片：锚点之前的主线前缀不进材料。
  assert.ok(!material.allContent.includes("主线回答一"), "pre-fork prefix must be excluded");
  assert.ok(material.allContent.includes("结论 beta"), "branch delta must be included");

  // 分支的分支：两条 fork notice 取 last（自身边界），不取 first（祖先边界）。
  const nested = [
    ...messages,
    forkNoticeMessage("f2", "sess_child", "msg_a2"),
    userMessage("u3", "孙分支问题"),
    assistantMessage("a3", "孙分支回答：结论 gamma"),
  ];
  const nestedMaterial = buildSessionContextMaterial({
    messages: nested,
    query: "结论",
    session: {
      id: "sess_grandchild",
      projectID: "p",
      taskType: "fork",
      slug: "s2",
      directory: "/tmp",
      title: "孙分支",
      version: "1",
      time: { created: 1, updated: 1 },
    },
    strategy: "relevant",
  });
  assert.ok(nestedMaterial.forkBoundary);
  assert.equal(
    nestedMaterial.forkBoundary.sourceMessageId,
    "msg_a2",
    "nested branch must use its own fork notice (last wins)",
  );
  assert.ok(!nestedMaterial.allContent.includes("结论 beta"), "parent branch delta excluded");
  assert.ok(nestedMaterial.allContent.includes("结论 gamma"), "own delta included");
}

// ── 冷恢复：readOnly 保真（specs/exploration-mode.md 场景 3 后半句）────

async function testResumeMergesReadOnly() {
  const { applyResumeExecutionState } = await import("../src/runtime/execution-state.js");

  // 场景 A：modeOverride 存在（冷恢复主链路——derivePersistedSessionMode 几乎恒有值）
  // 且持久化 entry 带 readOnly → mode/plan 以 override 为准，readOnly 必须合入。
  const configA = { mode: "build", planEnabled: false, readOnly: true };
  applyResumeExecutionState(configA, "build", { mode: "build", planEnabled: false, readOnly: true }, true);
  assert.equal(configA.readOnly, true, "modeOverride must not drop persisted readOnly");

  // 场景 A'：seed 无 readOnly（普通会话）→ entry 的 readOnly 仍然合入；
  // entry 无 readOnly 时不误标。
  const configA2 = { mode: "build", planEnabled: false };
  applyResumeExecutionState(configA2, "build", { mode: "build", planEnabled: false, readOnly: true }, true);
  assert.equal(configA2.readOnly, true, "persisted readOnly must merge even without seed");
  const configA3 = { mode: "build", planEnabled: false };
  applyResumeExecutionState(configA3, "build", { mode: "yolo", planEnabled: false }, true);
  assert.equal(configA3.readOnly, undefined, "no readOnly in entry, none in config");

  // 场景 B：无 override（旧路径）→ entry 全量生效。
  const configB = { mode: "build", planEnabled: false, readOnly: true };
  applyResumeExecutionState(configB, "edit", { mode: "edit", planEnabled: false, readOnly: true }, false);
  assert.equal(configB.mode, "edit");
  assert.equal(configB.readOnly, true);

  // 场景 C：只有权威 mode 事件、无 entry → seed readOnly 不被 mode 恢复抹掉。
  const configC = { mode: "build", planEnabled: false, readOnly: true };
  applyResumeExecutionState(configC, "build", undefined, false);
  assert.equal(configC.readOnly, true, "mode restore must keep seeded readOnly");
}

const tests = [
  testReadOnlySurvivesPatches,
  testReadOnlySchemaRoundTrip,
  testForkBoundarySlicing,
  testReadOnlyPermissionGate,
  testResumeMergesReadOnly,
];

for (const test of tests) {
  await test();
  console.log(`ok - ${test.name}`);
}

// ── 权限服务：只读会话闸门 ───────────────────────────────────────────

async function testReadOnlyPermissionGate() {
  const { PermissionService } = await import("../src/permission/service.js");

  const service = new PermissionService({ disallowedTools: new Set() });
  // 读工具（readOnly 且非 destructive）：放行，ruleId 带 readonly 标注。
  const readDecision = service.checkPermission(
    {
      toolName: "Read",
      input: { path: "/tmp/a.txt" },
      riskLevel: "low",
      mode: "build",
      planEnabled: false,
      readOnly: true,
    },
    { readOnly: true, destructive: false, riskLevel: "low" },
  );
  assert.equal(readDecision.decision, "allow");
  assert.equal(readDecision.ruleId, "mode.readonly.readOnly");

  // 写工具：拒绝。
  const writeDecision = service.checkPermission(
    {
      toolName: "Write",
      input: { path: "/tmp/a.txt", content: "x" },
      riskLevel: "medium",
      mode: "build",
      planEnabled: false,
      readOnly: true,
    },
    { readOnly: false, destructive: false, riskLevel: "medium" },
  );
  assert.equal(writeDecision.decision, "deny");
  assert.equal(writeDecision.ruleId, "mode.readonly.nonReadOnly");

  // EnterPlanMode / ExitPlanMode：在判定序最前拒绝（早于 requiresUserInteraction 的 ask）。
  const enterPlan = service.checkPermission(
    {
      toolName: "EnterPlanMode",
      input: {},
      riskLevel: "low",
      mode: "build",
      planEnabled: false,
      readOnly: true,
    },
    undefined,
  );
  assert.equal(enterPlan.decision, "deny");
  assert.equal(enterPlan.ruleId, "mode.readOnly.planTransition");

  const exitPlan = service.checkPermission(
    {
      toolName: "ExitPlanMode",
      input: { plan: "x" },
      riskLevel: "low",
      mode: "build",
      planEnabled: true,
      readOnly: true,
    },
    { readOnly: false, destructive: false, riskLevel: "low", requiresUserInteraction: true },
  );
  assert.equal(exitPlan.decision, "deny");
  assert.equal(exitPlan.ruleId, "mode.readOnly.planTransition");

  // 对照组：同样的 ExitPlanMode 在非只读 + plan 会话走原有逻辑（不命中 readonly 规则）。
  const planSession = service.checkPermission(
    {
      toolName: "ExitPlanMode",
      input: { plan: "x" },
      riskLevel: "low",
      mode: "build",
      planEnabled: true,
      readOnly: false,
    },
    { readOnly: false, destructive: false, riskLevel: "low", requiresUserInteraction: true },
  );
  assert.notEqual(planSession.ruleId, "mode.readOnly.planTransition");

  // yolo 也压不过只读闸门。
  const yoloWrite = service.checkPermission(
    {
      toolName: "Write",
      input: { path: "/tmp/a.txt", content: "x" },
      riskLevel: "medium",
      mode: "yolo",
      planEnabled: false,
      readOnly: true,
    },
    { readOnly: false, destructive: false, riskLevel: "medium" },
  );
  assert.equal(yoloWrite.decision, "deny");
}
