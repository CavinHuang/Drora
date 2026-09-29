import { resolveExecutionState, type ExecutionState } from "@drora/shared";
import {
  SESSION_ENTRY_EXECUTION_STATE,
  type CollaborationMode,
  SessionEventType,
  type TraceContext,
  type SessionId,
  type SessionEntryInfo,
} from "@drora/contracts";
import type { AgentRuntimeInternal } from "./internal.js";
import {
  unpublishedPermissionGrants,
  recoverPendingPermissionGrant,
} from "./permission-grant-recovery.js";

export function readRuntimeExecutionState(runtime: AgentRuntimeInternal): ExecutionState {
  return resolveExecutionState(runtime.config);
}

async function persistExecutionState(
  runtime: AgentRuntimeInternal,
  state = readRuntimeExecutionState(runtime),
): Promise<void> {
  if (!runtime.sessionPersisted || !runtime.sessionStore?.saveSessionEntry) return;
  await runtime.sessionStore.saveSessionEntry(buildExecutionStateEntry(runtime.sessionId, state));
}

export function buildExecutionStateEntry(
  sessionId: SessionId,
  state: ExecutionState,
): SessionEntryInfo {
  const timestamp = Date.now();
  return {
    id: `${sessionId}:runtime-execution-state`,
    sessionID: sessionId,
    type: SESSION_ENTRY_EXECUTION_STATE,
    touchSession: false,
    time: { created: timestamp, updated: timestamp },
    data: state,
  };
}

/**
 * 冷恢复执行态合并（specs/exploration-mode.md 决策 2）：
 * - 权威 mode（override/事件/permission）恢复时不得抹掉创建边界 seed 的 readOnly；
 * - modeOverride 场景跳过持久化 entry 的 mode/plan（保持 override 语义），但 readOnly
 *   是创建边界的安全承诺，必须从持久化 entry 合入——否则探索分支重启后只读闸门失效。
 */
export function applyResumeExecutionState(
  config: { mode?: CollaborationMode; planEnabled?: boolean; readOnly?: boolean },
  resolvedMode: string | undefined,
  savedExecution: ExecutionState | undefined,
  hasModeOverride: boolean,
): void {
  if (resolvedMode !== undefined) {
    const merged = resolveExecutionState(
      { mode: resolvedMode },
      {
        // current 仅用于 readOnly 继承；mode/plan 随后被 resolvedMode 覆盖，
        // 遇到 legacy "plan" 值时落回 build 即可（ExecutionState.mode 不含 plan）。
        mode: !config.mode || config.mode === "plan" ? "build" : config.mode,
        planEnabled: config.planEnabled ?? false,
        ...(config.readOnly !== undefined ? { readOnly: config.readOnly } : {}),
      },
    );
    config.mode = merged.mode;
    config.planEnabled = merged.planEnabled;
    config.readOnly = merged.readOnly;
  }
  if (!savedExecution) return;
  if (!hasModeOverride) {
    config.mode = savedExecution.mode;
    config.planEnabled = savedExecution.planEnabled;
    config.readOnly = savedExecution.readOnly;
    return;
  }
  if (savedExecution.readOnly === true) config.readOnly = true;
}

/** 权限与 Plan 是一个已消费状态；保存失败不发布成功快照，也不提前改内存。 */
export async function applyRuntimeExecutionState(
  runtime: AgentRuntimeInternal,
  input: { mode?: string; planEnabled?: boolean },
  cause: { source: "command" | "tool"; toolCallId?: string; traceContext?: TraceContext },
): Promise<ExecutionState> {
  if (runtime.permissionFullAccessPending)
    throw new Error("Permission update is busy; retry mode change");
  if (unpublishedPermissionGrants.has(runtime)) await recoverPendingPermissionGrant(runtime);
  const previous = readRuntimeExecutionState(runtime);
  const next = resolveExecutionState(input, previous);
  if (next.mode === previous.mode && next.planEnabled === previous.planEnabled) return next;
  if (next.planEnabled && !previous.planEnabled) {
    const goal = await runtime.readSessionTargetForContext?.(
      cause.traceContext ?? runtime.rootTraceContext,
    );
    if (goal?.status === "active")
      throw new Error("Plan and Goal cannot be active at the same time.");
  }
  await persistExecutionState(runtime, next);
  runtime.config.mode = next.mode;
  runtime.config.planEnabled = next.planEnabled;
  if (previous.planEnabled !== next.planEnabled)
    runtime.needsPlanModeExitReminder = !next.planEnabled;
  const trace = cause.traceContext ?? runtime.rootTraceContext;
  await runtime.appendEvent(
    runtime.createEvent(
      SessionEventType.SessionModeChanged,
      {
        ...next,
        previousMode: previous.mode,
        previousPlanEnabled: previous.planEnabled,
        source: cause.source,
        ...(cause.toolCallId ? { toolCallId: cause.toolCallId } : {}),
      },
      trace,
    ),
    trace,
  );
  return next;
}
