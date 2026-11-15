// 对齐上游 v3.18.2 官方 0.6.5 桩 d.ts 的字面量联合与具名导出
// （对照基准：git show refs/upstream-trees/v3.18.2:packages/zcode-cua/index.d.ts）。
// R3 纪律：仅补类型声明，运行时实现（src/runtime.ts）不动。
// actionTitle 为官方 0.6.5 切段真字段而上游桩漏列（upstream/zcode-cua-0.6.5.index.js
// :38485-38486 解析 slice(0,120)、:44958 requestMetaFor 消费为 title），本仓
// node-repl-host cua-broker.ts parseContext 已按此产出，故补入。
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ComputerUseRuntimeContext {
  sessionId: string;
  runtimeScope: "main" | "subagent";
  workspaceKey: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  turnId?: string;
  clientMode?: "web-remote-replayable" | "desktop-continuous";
  deliveryKind?: "web-remote-replayable" | "desktop-continuous";
  trace?: Record<string, unknown>;
  actionTitle?: string;
}

export interface ComputerUseRuntimeExecuteInput {
  toolName: string;
  arguments?: unknown;
  context: ComputerUseRuntimeContext;
  signal?: AbortSignal;
}

export interface ComputerUseRuntime {
  // 公共 broker 读取 MCP 元数据；占位返回同一结果类型，避免导出后丢失契约。
  execute(input: ComputerUseRuntimeExecuteInput): Promise<CallToolResult>;
  closeSession(context: ComputerUseRuntimeContext): Promise<void>;
  dispose(): Promise<void>;
}

export interface ComputerUseRuntimeOptions {
  brokerSocketPath?: string;
  refreshMarkerPath?: string;
  ensureBrokerAvailable?: () => Promise<void>;
  env?: Record<string, string | undefined>;
}

export declare function createComputerUseRuntime(
  options?: ComputerUseRuntimeOptions,
): ComputerUseRuntime;
