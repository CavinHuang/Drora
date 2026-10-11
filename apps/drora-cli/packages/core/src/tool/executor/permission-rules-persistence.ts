// project 级权限规则的读取与持久化（从 permission-flow.ts 拆出）。
// 拆分原因：permission-flow.ts 引入 responder 竞速后超过单文件 400 行上限；
// 这三个 helper 只与 sessionStore 的 project permission 存取内聚，与 ask 时序无关。
import {
  traceContextToLogContext,
  type PermissionRuleset,
  type PermissionUpdate,
  type ProjectId,
  type TraceContext,
} from "@drora/contracts";
import { applyPermissionUpdates } from "./permission-rules.js";
import { sanitizePermissionUpdatesForPersistence } from "../../permission/write-tier-policy.js";
import type { ToolExecutorDeps } from "./types.js";

export async function loadProjectPermissionRuleset(
  deps: ToolExecutorDeps,
): Promise<PermissionRuleset | null> {
  if (!deps.sessionStore) return null;
  const projectId = await resolveProjectId(deps);
  if (!projectId) return null;
  return deps.sessionStore.getProjectPermission(projectId);
}

export async function persistProjectPermissionUpdates(
  deps: ToolExecutorDeps,
  updates: PermissionUpdate[],
  traceContext: TraceContext,
): Promise<void> {
  if (updates.length === 0) return;

  // S03 洞 2 持久化边界（specs/agent-write-safety.md §2）：建议侧不给 P0 工具整工具
  // 「总是允许」，但 updates 来自 broker 应答（客户端可回传任意内容）——落盘前消毒，
  // P0 工具的无内容 allow 规则一律丢弃并留审计，与建议侧互为纵深。
  const sanitized = sanitizePermissionUpdatesForPersistence(updates);
  if (sanitized.updates.length === 0) {
    deps.logger?.warn("Project permission update fully rejected by write-tier sanitize", {
      ...traceContextToLogContext(traceContext),
      droppedWholeToolAllowRules: sanitized.droppedWholeToolAllowRules,
      event: "tool.permission.project_update.sanitized",
      module: "core.tool.executor",
      requestedCount: updates.length,
      status: "completed",
    });
    return;
  }
  if (sanitized.droppedWholeToolAllowRules > 0) {
    deps.logger?.warn("Dropped whole-tool allow rules for P0 write tools", {
      ...traceContextToLogContext(traceContext),
      droppedWholeToolAllowRules: sanitized.droppedWholeToolAllowRules,
      event: "tool.permission.project_update.sanitized",
      module: "core.tool.executor",
      requestedCount: updates.length,
      status: "completed",
    });
  }
  const effectiveUpdates = sanitized.updates;

  if (!deps.sessionStore) {
    deps.logger?.warn("Project permission update skipped without session store", {
      ...traceContextToLogContext(traceContext),
      event: "tool.permission.project_update.skipped",
      module: "core.tool.executor",
      status: "completed",
    });
    return;
  }

  const projectID = await resolveProjectId(deps);
  if (!projectID) {
    deps.logger?.warn("Project permission update skipped without persisted session", {
      ...traceContextToLogContext(traceContext),
      event: "tool.permission.project_update.skipped",
      module: "core.tool.executor",
      status: "completed",
    });
    return;
  }

  const current = (await deps.sessionStore.getProjectPermission(projectID)) ?? { version: 1 };
  const next = applyPermissionUpdates(current, effectiveUpdates);
  await deps.sessionStore.saveProjectPermission({ projectID, permission: next });

  deps.logger?.info("Project permission updated", {
    ...traceContextToLogContext(traceContext),
    event: "tool.permission.project_update.saved",
    module: "core.tool.executor",
    status: "completed",
    updateCount: effectiveUpdates.length,
  });
}

async function resolveProjectId(deps: ToolExecutorDeps): Promise<ProjectId | undefined> {
  const session = await deps.sessionStore?.getSession(deps.sessionId);
  return session?.projectID;
}
