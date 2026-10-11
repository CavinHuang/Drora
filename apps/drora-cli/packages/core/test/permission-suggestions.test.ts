/**
 * S03 洞 2 建议侧单测：P0 工具无内容时不提供整工具「总是允许」建议
 * （specs/agent-write-safety.md §2 / S03-P0-6）。
 * 运行：node --import tsx --test apps/drora-cli/packages/core/test/permission-suggestions.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PermissionCapabilityGroup } from "@drora/contracts";
import { buildDefaultPermissionUpdates } from "../src/tool/executor/permission-suggestions.js";
import { OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME } from "@drora/shared";

test("S03-P0-6：js（无内容键输入）→ 空建议", () => {
  const updates = buildDefaultPermissionUpdates("js", { code: "console.log(1)" });
  assert.deepEqual(updates, []);
});

test("未自报 readOnly 的 MCP（无内容键输入）→ 空建议", () => {
  const updates = buildDefaultPermissionUpdates("mcp__srv__tool", { data: "x" }, undefined, {
    permissionName: "mcp",
    readOnly: false,
  });
  assert.deepEqual(updates, []);
});

test("有内容键的工具照旧给内容级建议（Write/file_path）", () => {
  const updates = buildDefaultPermissionUpdates("Write", { file_path: "/tmp/ws/a.md" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.behavior, "allow");
  assert.deepEqual(updates[0]?.rules, [{ toolName: "Write", ruleContent: "/tmp/ws/a.md" }]);
});

test("自报 readOnly 的 MCP 无内容 → 照旧给整工具建议（P0 之外）", () => {
  const updates = buildDefaultPermissionUpdates("mcp__srv__search", { query: 1 }, undefined, {
    permissionName: "mcp",
    readOnly: true,
  });
  assert.deepEqual(updates[0]?.rules, [{ toolName: "mcp__srv__search" }]);
});

test("OfficialCua 能力组路径不变", () => {
  const updates = buildDefaultPermissionUpdates(
    "mcp__computer-use__screenshot",
    {},
    PermissionCapabilityGroup.OfficialCua,
  );
  assert.deepEqual(updates[0]?.rules, [
    { toolName: OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME },
  ]);
});
