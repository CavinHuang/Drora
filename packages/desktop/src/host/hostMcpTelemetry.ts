import type { IDisposable } from "@drora/rpc";
import type { IDroraAgentService } from "@drora/services";
import type { ProcessResourceRuntimeSurface } from "@drora/shared";
import { HostResponseTypes } from "@drora/shared";

interface RegisterHostMcpTelemetryOptions {
  agentService: Pick<IDroraAgentService, "onDynamicMcpTelemetry">;
  postMessage(message: unknown): void;
  runtimeSurface: ProcessResourceRuntimeSurface;
}

export function registerHostMcpTelemetry(options: RegisterHostMcpTelemetryOptions): IDisposable {
  return options.agentService.onDynamicMcpTelemetry()((event) => {
    try {
      options.postMessage({
        type: HostResponseTypes.McpTelemetry,
        runtimeSurface: options.runtimeSurface,
        event,
      });
    } catch {
      // main 已退出或 IPC 不可用时只丢当前遥测，不影响 MCP 生命周期。
    }
  });
}
