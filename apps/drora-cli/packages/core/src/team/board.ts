import type {
  TeamTaskClaimResult,
  TeamTaskStatus,
  TeamTaskUpdateInput,
} from "@drora/contracts";
import { teamPortError } from "./errors.js";
import { LEAD_ASSIGNEE_KEY, type TeamTaskInternal } from "./types.js";

/**
 * 任务板纯内核（PR-1.2；spec §2.3 + §16.1/§16.2 机器规则）。
 * 全部纯函数：id/时间由参数注入，便于故障矩阵参数化测试。
 * hub 是唯一调用方（单所有者串行裁决）；这里的「并发」在裁决外，
 * 串行进入后天然原子。
 */

/** 严格迁移表：终态无出边；claimed 不得直接 completed（E4）。 */
export const TASK_TRANSITIONS: Readonly<
  Record<TeamTaskStatus, readonly TeamTaskStatus[]>
> = {
  pending: ["claimed", "cancelled"],
  claimed: ["in_progress", "failed", "cancelled"],
  in_progress: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const TERMINAL_STATUSES: readonly TeamTaskStatus[] = ["completed", "failed", "cancelled"];

export function isTerminalTaskStatus(status: TeamTaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function transitionError(
  current: TeamTaskStatus,
  next: TeamTaskStatus,
): ReturnType<typeof teamPortError> | undefined {
  if (current === next) return undefined;
  if (TASK_TRANSITIONS[current].includes(next)) return undefined;
  return teamPortError("invalid_transition", { from: current, to: next });
}

export function unsatisfiedDependencies(
  tasks: readonly TeamTaskInternal[],
  dependencies: readonly string[],
): string[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task] as const));
  // 依赖只认上游 completed；failed/cancelled 永不解锁下游（spec §2.3）。
  return dependencies.filter((id) => byId.get(id)?.status !== "completed");
}

export interface BoardClock {
  now: () => string;
  newId: () => string;
}

/** 结果归属单个 attempt：开新世代时清空上一轮全部证据（重试必须自证）。 */
function clearAttemptResult(task: TeamTaskInternal): void {
  task.output = undefined;
  task.acceptanceSupplement = undefined;
}

/** 开新 attempt 世代（attempt++ + 新 attemptId + 置 claimed）。 */
export function beginTaskAttempt(
  task: TeamTaskInternal,
  assignee: string,
  clock: BoardClock,
): string {
  const attemptId = clock.newId();
  task.attempt += 1;
  task.status = "claimed";
  task.assignee = assignee;
  task.attemptId = attemptId;
  task.handoffId = undefined;
  task.reassigning = false;
  clearAttemptResult(task);
  task.updatedAt = clock.now();
  return attemptId;
}

/**
 * 撤销当前工作者（转派/接管第一步）：清凭证使旧更新即刻失效，
 * 铸新 handoffId 序列化异步静默（spec §16.1 三步交接的第 1 步）。
 */
export function invalidateTaskAttempt(
  task: TeamTaskInternal,
  nextAssignee: string | undefined,
  clock: BoardClock,
  reassigning = true,
): string {
  task.attemptId = undefined;
  task.handoffId = clock.newId();
  task.status = "pending";
  task.assignee = nextAssignee;
  task.reassigning = reassigning;
  clearAttemptResult(task);
  task.updatedAt = clock.now();
  return task.handoffId;
}

/** 取消未完成任务（不回池；终态只读）。 */
export function cancelUnfinishedTask(
  task: TeamTaskInternal,
  clock: BoardClock,
  output?: string,
): boolean {
  if (isTerminalTaskStatus(task.status)) return false;
  task.status = "cancelled";
  task.attemptId = undefined;
  task.handoffId = undefined;
  task.reassigning = false;
  if (output !== undefined) task.output = output;
  task.updatedAt = clock.now();
  return true;
}

/** 成员当前持有的未完成任务（一成员至多一个，spec §2.3）。 */
export function ownedOpenTask(
  tasks: readonly TeamTaskInternal[],
  memberName: string,
): TeamTaskInternal | undefined {
  return tasks.find(
    (task) =>
      task.assignee === memberName &&
      (task.status === "claimed" || task.status === "in_progress"),
  );
}

/** 认领三态裁决（claim 只领不派，spec §16.2）。 */
export function claimTask(
  tasks: readonly TeamTaskInternal[],
  taskId: string,
  claimant: string,
  clock: BoardClock,
): { task: TeamTaskInternal | undefined; result: TeamTaskClaimResult } {
  const task = tasks.find((candidate) => candidate.taskId === taskId);
  if (task === undefined) {
    return { task: undefined, result: { status: "rejected", error: teamPortError("team_not_present") } };
  }
  if (task.reassigning) {
    return { task, result: { status: "already_taken" } };
  }
  if (task.status !== "pending") {
    return { task, result: { status: "already_taken" } };
  }
  const blockedBy = unsatisfiedDependencies(tasks, task.dependsOn);
  if (blockedBy.length > 0) {
    return { task, result: { status: "dependencies_not_ready", blockedBy } };
  }
  if (claimant !== LEAD_ASSIGNEE_KEY) {
    const busy = ownedOpenTask(tasks, claimant);
    if (busy !== undefined) {
      return {
        task,
        result: { status: "busy_with_open_task", currentTaskId: busy.taskId },
      };
    }
  }
  const attemptId = beginTaskAttempt(task, claimant, clock);
  return { task, result: { status: "claimed", taskId, attemptId, attempt: task.attempt } };
}

/**
 * 携带凭证的状态推进（错误分类即协议，spec §16.1）：
 * E1 缺 attempt_id（教学：用当前 id 重试，别重启）；E2 已失效（教学：停止工作）；
 * E4 迁移表；终态只读 + 仅署名追补（不改 verdict 不重认领）。
 */
export function applyTaskUpdate(
  tasks: readonly TeamTaskInternal[],
  input: TeamTaskUpdateInput,
  caller: string,
  clock: BoardClock,
): { task: TeamTaskInternal | undefined; error?: ReturnType<typeof teamPortError> } {
  const task = tasks.find((candidate) => candidate.taskId === input.taskId);
  if (task === undefined) {
    return { task: undefined, error: teamPortError("team_not_present") };
  }
  const presented = input.attemptId.trim();
  const terminal = isTerminalTaskStatus(task.status);
  if (!terminal) {
    // 非终态任务的一切更新必须携带有效凭证（spec §16.1）：
    // E1：没带凭证（含从未认领）——教学文案导向「用当前 assignment 的 id 重试」；
    // E2：带的凭证对不上当前世代（含凭证已被转派/接管清空）——导向「停止工作」。
    if (presented === "") {
      return { task, error: teamPortError("missing_attempt_id") };
    }
    if (task.attemptId !== presented) {
      return { task, error: teamPortError("attempt_revoked") };
    }
    if (task.assignee !== caller && caller !== LEAD_ASSIGNEE_KEY) {
      return { task, error: teamPortError("attempt_revoked") };
    }
  }

  const nextStatus = input.patch.status;
  if (nextStatus !== undefined && nextStatus !== task.status) {
    const transition = transitionError(task.status, nextStatus);
    if (transition !== undefined) {
      return { task, error: transition };
    }
  }

  if (input.acceptanceSupplement !== undefined) {
    // 署名追补：append-only，不改 verdict/状态，不重认领。
    const previous = task.acceptanceSupplement ?? {};
    task.acceptanceSupplement = {
      ...(previous.acceptanceResults === undefined && input.acceptanceSupplement.acceptanceResults === undefined
        ? {}
        : {
            acceptanceResults: [
              ...(previous.acceptanceResults ?? []),
              ...(input.acceptanceSupplement.acceptanceResults ?? []),
            ],
          }),
      ...(previous.commandsRun === undefined && input.acceptanceSupplement.commandsRun === undefined
        ? {}
        : {
            commandsRun: [
              ...(previous.commandsRun ?? []),
              ...(input.acceptanceSupplement.commandsRun ?? []),
            ],
          }),
      ...(input.acceptanceSupplement.evidenceNote === undefined
        ? {}
        : {
            evidenceNote: previous.evidenceNote === undefined
              ? input.acceptanceSupplement.evidenceNote
              : `${previous.evidenceNote}\n${input.acceptanceSupplement.evidenceNote}`,
          }),
    };
  }

  if (nextStatus !== undefined && nextStatus !== task.status) {
    task.status = nextStatus;
    if (isTerminalTaskStatus(nextStatus)) {
      // 终态：凭证关闭（结果不可再改，仅剩署名追补路径）。
      task.attemptId = undefined;
      task.handoffId = undefined;
      task.reassigning = false;
    }
  }
  if (input.patch.output !== undefined) task.output = input.patch.output;
  if (input.patch.artifactRefs !== undefined) {
    task.artifactRefs = [...task.artifactRefs, ...input.patch.artifactRefs];
  }
  task.updatedAt = clock.now();
  return { task, error: undefined };
}

// ---------- 依赖产物预算（spec §16.2：2k/项、12k 总量、最旧丢弃、环截断） ----------

export interface DependencyOutput {
  readonly taskId: string;
  readonly title: string;
  readonly output?: string;
}

/**
 * 递归收集 taskId 的已完成祖先（拓扑序：依赖在前；环只截断该分支）。
 */
export function collectCompletedDependencyOutputs(
  tasks: readonly TeamTaskInternal[],
  taskId: string,
  warn?: (message: string) => void,
): DependencyOutput[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: TeamTaskInternal[] = [];

  const walk = (id: string): void => {
    if (visiting.has(id)) {
      warn?.(`team: dependency cycle involving "${id}"; stopping this branch`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const task = byId.get(id);
    if (task !== undefined) {
      for (const dependency of task.dependsOn) walk(dependency);
      if (id !== taskId) ordered.push(task);
    }
    visiting.delete(id);
    visited.add(id);
  };

  walk(taskId);
  return ordered
    .filter((task) => task.status === "completed")
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      ...(task.output === undefined ? {} : { output: task.output }),
    }));
}

const TRUNCATION_SUFFIX = " [truncated]";

/** 单项截断 + 总量预算内从最旧开始丢弃。 */
export function formatDependencyOutputs(
  items: readonly DependencyOutput[],
  limits: { perItemChars: number; totalChars: number },
): string {
  if (items.length === 0) return "(none)";
  const formatted = items.map((item) => {
    const raw = item.output === undefined || item.output === "" ? "(no output recorded)" : item.output;
    const body =
      raw.length > limits.perItemChars
        ? raw.slice(0, limits.perItemChars) + TRUNCATION_SUFFIX
        : raw;
    return `- ${item.taskId} ${item.title}:\n  ${body}`;
  });
  let selected = formatted;
  while (selected.length > 1 && selected.join("\n").length > limits.totalChars) {
    selected = selected.slice(1); // 丢最旧
  }
  const last = selected[0];
  if (selected.length === 1 && last !== undefined && last.length > limits.totalChars) {
    return last.slice(0, limits.totalChars) + TRUNCATION_SUFFIX;
  }
  return selected.join("\n");
}
