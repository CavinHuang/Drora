/**
 * S03 写入分级策略单测（specs/agent-write-safety.md §1/§2 洞 2 持久化边界）。
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/write-tier-policy.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionUpdate } from "@drora/contracts";
import {
  isP0WriteRuleToolName,
  isP0WriteTarget,
  resolveWriteToolTier,
  sanitizePermissionUpdatesForPersistence,
} from "../src/permission/write-tier-policy.js";

test("P0 判定：Bash/js 恒 P0；MCP 未自报 readOnly 为 P0", () => {
  assert.equal(isP0WriteTarget({ toolName: "Bash" }), true);
  assert.equal(isP0WriteTarget({ toolName: "js" }), true);
  assert.equal(
    isP0WriteTarget({ toolName: "mcp__srv__tool", permissionName: "mcp", readOnly: false }),
    true,
  );
  assert.equal(
    isP0WriteTarget({ toolName: "mcp__srv__tool", permissionName: "mcp" }),
    true,
    "readOnly 缺失（未自报）按 P0 处理",
  );
});

test("P0 判定：自报 readOnly 的 MCP 降出 P0", () => {
  assert.equal(
    isP0WriteTarget({ toolName: "mcp__srv__tool", permissionName: "mcp", readOnly: true }),
    false,
  );
});

test("分级：P1 授权根内写与 P2 其它", () => {
  assert.equal(resolveWriteToolTier({ toolName: "Write" }), "p1");
  assert.equal(resolveWriteToolTier({ toolName: "Edit" }), "p1");
  assert.equal(resolveWriteToolTier({ toolName: "ApplyPatch" }), "p1");
  assert.equal(resolveWriteToolTier({ toolName: "Read" }), "p2");
});

test("规则名侧：mcp__ 前缀与固定名识别，CUA 规则名天然豁免", () => {
  assert.equal(isP0WriteRuleToolName("Bash"), true);
  assert.equal(isP0WriteRuleToolName("js"), true);
  assert.equal(isP0WriteRuleToolName("mcp__srv__tool"), true);
  assert.equal(isP0WriteRuleToolName("drora:permission-capability:official_cua"), false);
  assert.equal(isP0WriteRuleToolName("Write"), false);
});

test("S03-P0-7：消毒丢弃 P0 无内容 allow 规则并整条移除空 update", () => {
  const input: PermissionUpdate[] = [
    { behavior: "allow", rules: [{ toolName: "js" }], type: "addRules" },
    { behavior: "allow", rules: [{ toolName: "mcp__srv__tool" }], type: "addRules" },
    { behavior: "deny", rules: [{ toolName: "Bash" }], type: "addRules" },
  ];
  const result = sanitizePermissionUpdatesForPersistence(input);
  assert.deepEqual(result.updates, [
    { behavior: "deny", rules: [{ toolName: "Bash" }], type: "addRules" },
  ]);
  assert.equal(result.droppedWholeToolAllowRules, 2);
});

test("消毒：有内容 allow 与 CUA 规则名保留", () => {
  const input: PermissionUpdate[] = [
    {
      behavior: "allow",
      rules: [{ toolName: "Bash", ruleContent: "git status:*" }],
      type: "addRules",
    },
    {
      behavior: "allow",
      rules: [{ toolName: "drora:permission-capability:official_cua" }],
      type: "addRules",
    },
  ];
  const result = sanitizePermissionUpdatesForPersistence(input);
  assert.equal(result.updates.length, 2);
  assert.equal(result.droppedWholeToolAllowRules, 0);
});
