import type { ModelToolSideEffectScope } from "@drora/contracts";
import type { PermissionToolCapability } from "../../permission/service.js";
import { isTrustedReadOnlyTool } from "../../permission/write-tier-policy.js";
import type { ToolEntry, ToolRuntimePermissionCapabilityContext } from "../types.js";
import type { ToolExecutorDeps } from "./types.js";

export function resolveRuntimePermissionCapability(
  entry: ToolEntry,
  input: unknown,
  context: ToolRuntimePermissionCapabilityContext,
): PermissionToolCapability {
  const runtimeCapability = entry.resolvePermissionCapability?.(input, context);
  return {
    ...entry.metadata,
    ...runtimeCapability,
    // capability group is provenance, not a runtime/model-controlled override.
    permissionCapabilityGroup: entry.permissionCapabilityGroup,
    permission: {
      ...entry.permission,
      ...runtimeCapability?.permission,
    },
  };
}

/**
 * 一次调用**解析后**的副作用旗标，挂在 `ToolCallStarted` 上：与权限判定同一次解析，所以 Bash 的只读命令判定等运行时结论一并生效。
 * 订阅者（dynamic-workflow 的 driver）据它在 handler 动手之前判断这一笔是否会改写工作区。
 */
export function resolveToolCallCapabilityFlags(
  deps: ToolExecutorDeps,
  entry: ToolEntry,
  input: unknown,
  toolName: string,
): { readOnly?: boolean; sideEffectScope?: ModelToolSideEffectScope } {
  const capability = resolveRuntimePermissionCapability(
    entry,
    input,
    resolveRuntimePermissionContext(deps),
  );
  return {
    // readOnly 旗标只在 host 可信判定成立时外发为 true（2026-10-17 增量评审
    // cli-p0-5 修复）：普通 MCP 的 readOnlyHint 是服务端自报、按 write-tier-policy
    // 同口径不构成信任锚——原样外发会让 dynamic-workflow driver 的导入缓存关门
    // 判定把谎报只读的写调用当只读放行。Bash 等内建工具的运行时只读命令分析
    // 仍照常生效（非 MCP 面不受影响）；不可信时外发 undefined（未知≠只读）。
    readOnly:
      isTrustedReadOnlyTool({
        toolName,
        permissionName: capability.permission?.permission,
        readOnly: capability.readOnly,
        destructive: capability.destructive,
        permissionCapabilityGroup: capability.permissionCapabilityGroup,
      }) || undefined,
    sideEffectScope: capability.sideEffectScope,
  };
}

export function resolveRuntimePermissionContext(
  deps: ToolExecutorDeps,
): ToolRuntimePermissionCapabilityContext {
  return {
    runtimeScope: deps.runtimeScope,
    workingDirectory: deps.getWorkingDirectory(),
    workspaceRoot: deps.getWorkspaceRoot(),
  };
}
