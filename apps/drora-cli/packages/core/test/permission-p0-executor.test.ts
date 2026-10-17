import assert from "node:assert/strict";
import test from "node:test";
import { createSessionId, createToolCallId, createRootTraceContext } from "@drora/contracts";
import { PermissionService } from "../src/permission/service.js";
import { createInMemoryHookRunner } from "../src/hooks/index.js";
import { createToolRegistry } from "../src/tool/registry.js";
import { createToolExecutor } from "../src/tool/executor.js";

for (const persist of [false, true]) {
  test(`S03 P0 真 executor: Hook 不代批，用户${persist ? "持久授权应答被拒" : "单次批准生效"}`, async () => {
    const sessionId = createSessionId("p0-user-once");
    const traceContext = createRootTraceContext({ sessionId });
    const registry = createToolRegistry();
    let executions = 0;
    let requests = 0;
    let permissionHooks = 0;
    registry.register({
      inputSchema: {}, metadata: { name: "mcp__srv__execute", readOnly: true, destructive: false,
        concurrentSafe: false, needsApproval: true, sideEffectScope: "network", riskLevel: "medium" },
      permission: { permission: "mcp", reason: "untrusted", needsApproval: true, riskLevel: "medium",
        sideEffectScope: "network", patternSources: [], denyPriority: "beforeAsk" },
      handler: async () => { executions++; return "executed"; },
    });
    const hooks = createInMemoryHookRunner({ hooks: [
      { event: "PreToolUse", matcher: "*", callback: async (input) => ({
        hookSpecificOutput: { hookEventName: input.hookEventName, permissionDecision: "allow" },
      }) },
      { event: "PermissionRequest", matcher: "*", callback: async (input) => {
        permissionHooks++;
        return { hookSpecificOutput: { hookEventName: input.hookEventName, decision: { behavior: "allow" } } };
      } },
    ] });
    const executor = createToolExecutor({ registry, hookRunner: hooks, sessionId, traceContext,
      emitEvent: async () => {}, permissionService: new PermissionService(),
      permissionBroker: { requestPermission: async (request) => {
        requests++;
        assert.equal(request.approvalMode, "user-once");
        return { decision: "allow", ...(persist ? { permissionUpdates: [{ type: "addRules", behavior: "allow",
          rules: [{ toolName: "mcp__srv__execute", ruleContent: "/tmp/a.md" }] }] } : {}) };
      } },
    });
    const result = await executor.execute({ name: "mcp__srv__execute", id: createToolCallId("p0-call"),
      input: { path: "/tmp/a.md" } }, { traceContext });
    assert.equal(requests, 1);
    assert.equal(permissionHooks, 0);
    assert.equal(executions, persist ? 0 : 1);
    assert.equal(result.success, !persist);
  });
}
