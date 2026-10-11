/**
 * S03 洞 3 单测：Bash 规则评估器的整工具 allow 不再短路 unsafe 命令
 * （specs/agent-write-safety.md §2 / S03-P0-1、S03-P0-2）。
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/bash-command-rule-evaluator.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRuleValue } from "@drora/contracts";
import { evaluateBashRules } from "../src/tool/handlers/bash-command-rule-evaluator.js";

function rulesOf(...contents: (string | undefined)[]): PermissionRuleValue[] {
  return contents.map((ruleContent) => ({ toolName: "Bash", ...(ruleContent ? { ruleContent } : {}) }));
}

const BASE = {
  allSubjectGroups: [["echo hi"]],
  exactCommands: ["echo hi"],
  requiredSubjectGroups: [["echo hi"]],
} as const;

test("S03-P0-1：整工具 allow + 非 safe 命令（重定向）→ 不放行", () => {
  const allowed = evaluateBashRules({
    ...BASE,
    allSubjectGroups: [],
    requiredSubjectGroups: [],
    behavior: "allow",
    rules: rulesOf(undefined),
    safe: false,
  });
  assert.equal(allowed, false);
});

test("S03-P0-2：整工具 allow + safe 命令 → 照旧放行（既有体验保留）", () => {
  const allowed = evaluateBashRules({
    ...BASE,
    behavior: "allow",
    rules: rulesOf(undefined),
    safe: true,
  });
  assert.equal(allowed, true);
});

test("deny/ask 行为的整工具规则照旧匹配一切（安全方向不受限）", () => {
  for (const behavior of ["deny", "ask"] as const) {
    const matched = evaluateBashRules({
      ...BASE,
      allSubjectGroups: [],
      requiredSubjectGroups: [],
      behavior,
      rules: rulesOf(undefined),
      safe: false,
    });
    assert.equal(matched, true, behavior);
  }
});

test("精确命令 allow 规则保持原语义：用户逐条看过的内容规则不受 safe 限制", () => {
  const allowed = evaluateBashRules({
    ...BASE,
    behavior: "allow",
    rules: rulesOf("echo hi"),
    safe: false,
  });
  assert.equal(allowed, true);
});

test("allow + safe + 前缀内容规则照旧匹配", () => {
  const allowed = evaluateBashRules({
    allSubjectGroups: [["git status"]],
    exactCommands: ["git status"],
    behavior: "allow",
    requiredSubjectGroups: [["git status"]],
    rules: rulesOf("git status:*"),
    safe: true,
  });
  assert.equal(allowed, true);
});
