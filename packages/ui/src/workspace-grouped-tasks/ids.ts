import type { DroraTaskMeta } from "@drora/shared";
import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";

function taskKey(
  task: Pick<DroraTaskMeta, "workspacePath" | "workspaceIdentity" | "taskId">,
): string {
  return `${buildTaskWorkspaceKey(task.workspacePath, task.workspaceIdentity)}\u0000${task.taskId}`;
}

export { taskKey };
