/**
 * S03 洞 1a + 洞 2 评估侧单测（specs/agent-write-safety.md §2 / S03-P0-3..5、S03-P1-8）。
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/permission-service-write-tier.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PermissionCapabilityGroup } from "@drora/contracts";
import { defaultPermissionConfig, PermissionService, type PermissionToolCapability } from "../src/permission/service.js";
import { OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME } from "@drora/shared";

function mcpCapability(overrides: Partial<PermissionToolCapability> = {}): PermissionToolCapability {
  return {
    readOnly: false,
    destructive: false,
    permission: {
      permission: "mcp",
      reason: "mcp tool",
      riskLevel: "medium",
      sideEffectScope: "workspace",
      needsApproval: true,
      patternSources: [],
      denyPriority: "beforeAsk",
    },
    ...overrides,
  };
}

const JS_CAPABILITY: PermissionToolCapability = {
  readOnly: false,
  destructive: false,
  riskLevel: "high",
  sideEffectScope: "system",
  needsApproval: true,
};

function ruleset(behavior: "allow" | "deny" | "ask", toolName: string, ruleContent?: string) {
  return {
    version: 1 as const,
    [behavior]: [{ toolName, ...(ruleContent ? { ruleContent } : {}) }],
  };
}

test("S03-P1-8：plan 模式未自报 readOnly 的 MCP → deny（直通分支已删）", () => {
  const service = new PermissionService();
  const decision = service.checkPermission(
    { toolName: "mcp__srv__write", input: {}, riskLevel: "medium", mode: "plan" },
    mcpCapability(),
  );
  assert.equal(decision.decision, "deny");
  assert.equal(decision.ruleId, "mode.plan.nonReadOnly");
});

test("plan 模式第三方 MCP 即使自报 readOnly 也必须 deny", () => {
  const service = new PermissionService();
  const decision = service.checkPermission(
    { toolName: "mcp__srv__search", input: {}, riskLevel: "low", mode: "plan" },
    mcpCapability({ readOnly: true, permission: { ...mcpCapability().permission!, riskLevel: "low", sideEffectScope: "none", needsApproval: false } }),
  );
  assert.equal(decision.decision, "deny");
  assert.equal(decision.ruleId, "mode.plan.nonReadOnly");
});

test("plan mode: Host-verified OfficialCua read-only capability remains allowed", () => {
  const service = new PermissionService();
  const base = mcpCapability().permission!;
  const decision = service.checkPermission(
    { toolName: "mcp__computer-use__screenshot", input: {}, riskLevel: "low", mode: "plan" },
    mcpCapability({
      readOnly: true,
      permissionCapabilityGroup: PermissionCapabilityGroup.OfficialCua,
      permission: { ...base, riskLevel: "low", sideEffectScope: "none", needsApproval: false },
    }),
  );
  assert.equal(decision.decision, "allow");
  assert.equal(decision.ruleId, "mode.plan.readOnly");
});

test("S03-P0-3：js 的整工具 allow 规则不生效，落到 highRisk 逐次确认", () => {
  const service = new PermissionService();
  const decision = service.checkPermission(
    { toolName: "js", input: { code: "process.stdout.write('x')" }, riskLevel: "high", mode: "build" },
    JS_CAPABILITY,
    ruleset("allow", "js"),
  );
  assert.equal(decision.decision, "ask");
  assert.equal(decision.ruleId, "mode.build.highRisk");
});

test("S03-P0-4：未自报 readOnly 的 MCP 整工具 allow 规则不生效", () => {
  const service = new PermissionService();
  const decision = service.checkPermission(
    { toolName: "mcp__srv__write", input: {}, riskLevel: "medium", mode: "build" },
    mcpCapability(),
    ruleset("allow", "mcp__srv__write"),
  );
  assert.equal(decision.decision, "ask");
});

test("第三方 MCP 的 readOnlyHint 不允许整工具 allow 绕过逐次确认", () => {
  const service = new PermissionService();
  const capability = mcpCapability({
    readOnly: true,
    permission: { ...mcpCapability().permission!, sideEffectScope: "workspace", needsApproval: false, riskLevel: "low" },
  });
  const decision = service.checkPermission(
    { toolName: "mcp__srv__search", input: {}, riskLevel: "low", mode: "build" },
    capability,
    ruleset("allow", "mcp__srv__search"),
  );
  assert.equal(decision.decision, "ask");
  assert.equal(decision.ruleId, "mode.build.sideEffect");
});

test("S03-P0-5：宿主验证能力组（OfficialCua）整工具规则豁免门控", () => {
  const service = new PermissionService();
  const decision = service.checkPermission(
    { toolName: "mcp__computer-use__screenshot", input: {}, riskLevel: "low", mode: "build" },
    {
      readOnly: true,
      permissionCapabilityGroup: PermissionCapabilityGroup.OfficialCua,
    },
    ruleset("allow", OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME),
  );
  assert.equal(decision.decision, "allow");
  assert.equal(decision.ruleId, "rule.project.allow");
});

test("P0 global allowedTools cannot bypass per-call checks for js or ordinary MCP", () => {
  const service = new PermissionService({
    ...defaultPermissionConfig,
    allowedTools: new Set(["js", "mcp__srv__search", "Read"]),
  });
  const jsDecision = service.checkPermission(
    { toolName: "js", input: { code: "process.stdout.write('x')" }, riskLevel: "high", mode: "build" },
    JS_CAPABILITY,
  );
  assert.equal(jsDecision.decision, "ask");
  assert.equal(jsDecision.ruleId, "mode.build.highRisk");

  const mcpDecision = service.checkPermission(
    { toolName: "mcp__srv__search", input: { query: "x" }, riskLevel: "medium", mode: "build" },
    mcpCapability({ readOnly: true }),
  );
  assert.equal(mcpDecision.decision, "ask");
  assert.equal(mcpDecision.ruleId, "mode.build.sideEffect");

  const readDecision = service.checkPermission(
    { toolName: "Read", input: { file_path: "/tmp/ws/a.md" }, riskLevel: "low", mode: "build" },
    { readOnly: true, riskLevel: "low", sideEffectScope: "none", needsApproval: false },
  );
  assert.equal(readDecision.decision, "allow");
  assert.equal(readDecision.ruleId, "rule.allowedTools");
});

test("P1 不受影响：Write 的内容级 allow 规则照旧", () => {
  const service = new PermissionService();
  const decision = service.checkPermission(
    {
      toolName: "Write",
      input: { file_path: "/tmp/ws/a.md", content: "x" },
      riskLevel: "medium",
      mode: "build",
    },
    undefined,
    {
      version: 1,
      allow: [
        { toolName: "Write", ruleContent: "/tmp/ws/*" },
      ],
    },
  );
  assert.equal(decision.decision, "allow");
  assert.equal(decision.ruleId, "rule.project.allow");
});
