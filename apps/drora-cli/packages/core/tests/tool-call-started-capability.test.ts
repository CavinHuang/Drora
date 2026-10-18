/**
 * `ToolCallStarted` 载荷上的解析后副作用能力（apps/drora-cli/packages/dynamic-workflow/docs/execution-engine.md
 * 「Amend-resume」）。dynamic-workflow 的 driver 据它在子代理动手前关导入缓存，所以这里钉三件事：
 *   1. 元数据声明的 readOnly / sideEffectScope 原样上载荷；
 *   2. 按入参解析的运行时能力（`resolvePermissionCapability`，Bash 的只读命令判定就是它）覆盖元数据；
 *   3. 事件在 handler 之前发出——handler 一开跑，订阅者就已经知道了。
 */

import { describe, expect, it } from "vitest";
import {
  SessionEventType,
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTurnId,
  isWorkspaceMutatingToolCall,
  type SessionEvent,
  type ToolCallStartedPayload,
} from "@drora/contracts";
import { PermissionService, defaultPermissionConfig } from "../src/permission/service.js";
import { createToolExecutor } from "../src/tool/executor.js";
import { createToolRegistry } from "../src/tool/registry.js";
import type { ToolEntry } from "../src/tool/types.js";

function probeEntry(overrides: Partial<ToolEntry>): ToolEntry {
  return {
    capability: "Probe for the ToolCallStarted capability flags",
    metadata: {
      name: "CapabilityProbe",
      description: "Probe",
      readOnly: false,
      destructive: false,
      concurrentSafe: true,
      timeoutMs: 1_000,
      maxOutputBytes: 10_000,
      sideEffectScope: "workspace",
      riskLevel: "low",
      needsApproval: false,
    },
    handler: async () => ({ ok: true }),
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    permission: {
      permission: "capabilityProbe",
      reason: "probe",
      riskLevel: "low",
      sideEffectScope: "workspace",
      needsApproval: false,
      patternSources: ["toolName"],
      denyPriority: "beforeAsk",
    },
    resultBudget: { maxInlineBytes: 10_000, maxModelBytes: 10_000, strategy: "truncate" },
    timeout: { defaultMs: 1_000, maxMs: 1_000, allowCallOverride: false },
    cancellation: { supported: false, cleanup: "none", userVisibleMessage: "n/a" },
    trace: {
      required: true,
      propagateToAdapters: false,
      recordInput: "summary",
      recordOutput: "summary",
    },
    ...overrides,
  };
}

async function run(entry: ToolEntry, input: Record<string, unknown>, name: string) {
  const sessionId = createSessionId(name);
  const turnId = createTurnId(name);
  const traceContext = createRootTraceContext({ sessionId, turnId });
  const events: SessionEvent[] = [];
  const order: string[] = [];
  const registry = createToolRegistry();
  registry.register({
    ...entry,
    handler: async (...args) => {
      order.push("handler");
      return entry.handler(...args);
    },
  });
  const executor = createToolExecutor({
    emitEvent: async (event) => {
      if (event.type === SessionEventType.ToolCallStarted) order.push("started");
      events.push(event);
    },
    mode: "yolo",
    permissionBroker: {
      async requestPermission() {
        return { decision: "allow" as const };
      },
    },
    permissionService: new PermissionService(defaultPermissionConfig),
    registry,
    sessionId,
    turnId,
    traceContext,
    workingDirectory: "/probe/cwd",
  });
  await executor.execute(
    { id: createToolCallId(name), input, name: entry.metadata.name },
    { traceContext },
  );
  const started = events.find((event) => event.type === SessionEventType.ToolCallStarted);
  return { payload: started?.payload as ToolCallStartedPayload | undefined, order };
}

describe("ToolCallStarted carries the resolved side-effect capability", () => {
  it("declares the metadata flags on the payload, before the handler runs", async () => {
    const { payload, order } = await run(probeEntry({}), {}, "cap-meta");
    expect(payload).toMatchObject({
      toolName: "CapabilityProbe",
      readOnly: false,
      sideEffectScope: "workspace",
    });
    expect(isWorkspaceMutatingToolCall(payload!)).toBe(true);
    expect(order).toEqual(["started", "handler"]);
  });

  it("lets the per-call runtime capability override the metadata (the Bash read-only case)", async () => {
    const entry = probeEntry({
      resolvePermissionCapability: (input) =>
        (input as { command?: string }).command === "ls"
          ? { readOnly: true, sideEffectScope: "none" }
          : undefined,
    });
    const safe = await run(entry, { command: "ls" }, "cap-safe");
    expect(safe.payload).toMatchObject({ readOnly: true, sideEffectScope: "none" });
    expect(isWorkspaceMutatingToolCall(safe.payload!)).toBe(false);
    const unsafe = await run(entry, { command: "rm -rf build" }, "cap-unsafe");
    expect(unsafe.payload).toMatchObject({ readOnly: false, sideEffectScope: "workspace" });
    expect(isWorkspaceMutatingToolCall(unsafe.payload!)).toBe(true);
  });

  it("a read-only tool is not a write, whatever its scope", async () => {
    const entry = probeEntry({
      metadata: { ...probeEntry({}).metadata, readOnly: true, sideEffectScope: "none" },
    });
    const { payload } = await run(entry, {}, "cap-readonly");
    expect(payload).toMatchObject({ readOnly: true, sideEffectScope: "none" });
    expect(isWorkspaceMutatingToolCall(payload!)).toBe(false);
  });

  it("suppresses an untrusted MCP readOnlyHint:true to undefined (unknown is not read-only)", async () => {
    // 2026-10-18 终审阻塞①：普通 MCP 的 readOnlyHint 是服务端自报，不可信的
    // readOnly=true 不得外发为 true——降为 undefined，driver 按会写保守处理。
    const entry = probeEntry({
      metadata: {
        ...probeEntry({}).metadata,
        name: "mcp__demo-server__query",
        readOnly: true,
        sideEffectScope: "workspace",
      },
      permission: { ...probeEntry({}).permission, permission: "mcp" },
    });
    const { payload } = await run(entry, {}, "cap-mcp-hint-true");
    // 先钉住元数据确实自报了 readOnly=true，证明 undefined 是门控抑制的结果。
    expect(entry.metadata.readOnly).toBe(true);
    expect(payload?.readOnly).toBeUndefined();
    expect(isWorkspaceMutatingToolCall(payload!)).toBe(true);
  });

  it("passes a trusted built-in readOnly:true through as true, even with a workspace scope", async () => {
    // 非 MCP 内建元数据是 host 可信的：readOnly=true 原样外发，且优先于
    // sideEffectScope 的写范围声明（readOnly 工具不算写）。
    const entry = probeEntry({
      metadata: { ...probeEntry({}).metadata, readOnly: true, sideEffectScope: "workspace" },
    });
    const { payload } = await run(entry, {}, "cap-builtin-readonly-true");
    expect(payload?.readOnly).toBe(true);
    expect(isWorkspaceMutatingToolCall(payload!)).toBe(false);
  });
});
