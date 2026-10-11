/**
 * S03 洞 1b 单测：memory md 覆盖器保留一切 deny（plan 绕过已修）
 * （specs/agent-write-safety.md §2 / S03-P1-9、S03-P2-10）。
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/memory-file-permission.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyMemoryFilePermission } from "../src/tool/executor/memory-file-permission.js";
import type { PermissionDecisionResult } from "../src/permission/service.js";

const LAYOUT = {
  memoryRoot: "/tmp/ws/.drora-memory",
  toolName: "Write",
  workingDirectory: "/tmp/ws",
  workspaceRoot: "/tmp/ws",
};

const MEMORY_NOTE = `${LAYOUT.memoryRoot}/notes/a.md`;

function decisionOf(patch: Partial<PermissionDecisionResult>): PermissionDecisionResult {
  return {
    decision: "ask",
    allowed: false,
    escalated: true,
    mode: "build",
    ruleId: "mode.build.sideEffect",
    riskLevel: "medium",
    ...patch,
  };
}

test("S03-P1-9：plan 模式 deny（mode.plan.nonReadOnly）不再被覆盖为 allow", () => {
  const result = applyMemoryFilePermission({
    ...LAYOUT,
    executionInput: { file_path: MEMORY_NOTE, content: "x" },
    decision: decisionOf({
      decision: "deny",
      allowed: false,
      escalated: false,
      mode: "plan",
      ruleId: "mode.plan.nonReadOnly",
      reason: "Plan mode only allows read-only, non-destructive tools",
    }),
  });
  assert.equal(result.decision, "deny");
  assert.equal(result.ruleId, "mode.plan.nonReadOnly");
});

test("S03-P2-10：非 plan 模式的 build ask 覆盖为 allow（P2 免确认保留）", () => {
  const result = applyMemoryFilePermission({
    ...LAYOUT,
    executionInput: { file_path: MEMORY_NOTE, content: "x" },
    decision: decisionOf({}),
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.ruleId, "memory.file.markdown");
});

test("任意 deny 规则一律保留（不变量）", () => {
  const result = applyMemoryFilePermission({
    ...LAYOUT,
    executionInput: { file_path: MEMORY_NOTE, content: "x" },
    decision: decisionOf({
      decision: "deny",
      allowed: false,
      escalated: false,
      ruleId: "rule.disallowedTools",
    }),
  });
  assert.equal(result.decision, "deny");
});

test("alwaysAsk 的 ask 与项目 ask 保留分支照旧（不覆盖）", () => {
  const alwaysAsk = applyMemoryFilePermission({
    ...LAYOUT,
    executionInput: { file_path: MEMORY_NOTE, content: "x" },
    decision: decisionOf({ alwaysAsk: true, ruleId: "tool.alwaysAsk" }),
  });
  assert.equal(alwaysAsk.decision, "ask");
  assert.equal(alwaysAsk.ruleId, "tool.alwaysAsk");

  const projectAsk = applyMemoryFilePermission({
    ...LAYOUT,
    executionInput: { file_path: MEMORY_NOTE, content: "x" },
    decision: decisionOf({ ruleId: "rule.project.ask" }),
  });
  assert.equal(projectAsk.decision, "ask");
});

test("非 memory 目标照旧透传（不改判定）", () => {
  const outside = applyMemoryFilePermission({
    ...LAYOUT,
    executionInput: { file_path: "/tmp/ws/other/a.md", content: "x" },
    decision: decisionOf({}),
  });
  assert.equal(outside.ruleId, "mode.build.sideEffect");

  const nonMd = applyMemoryFilePermission({
    ...LAYOUT,
    executionInput: { file_path: `${LAYOUT.memoryRoot}/notes/data.json`, content: "x" },
    decision: decisionOf({}),
  });
  assert.equal(nonMd.ruleId, "mode.build.sideEffect");
});
