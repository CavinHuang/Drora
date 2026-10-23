import type { TeamTaskClaimResult, TeamTaskStatus, TeamTaskUpdateInput } from "@drora/contracts";
import { teamPortError } from "./errors.js";
import { LEAD_ASSIGNEE_KEY, type TeamTaskInternal } from "./types.js";

/**
 * 任务板纯内核（PR-1.2；spec §2.3 + §16.1/§16.2 机器规则）。
 * 全部纯函数：id/时间由参数注入，便于故障矩阵参数化测试。
 * hub 是唯一调用方（单所有者串行裁决）；这里的「并发」在裁决外，
 * 串行进入后天然原子。
 */

/**
 * 严格迁移表：completed/cancelled 终态无出边；claimed 不得直接 completed（E4）。
 * failed → pending 是唯一受控出边（spec §16 契约 5，2026-10-23 登记）：只由 lead
 * 专用端口 reopenTask 消费（板级执行 reopenFailedTask）；通用更新面对终态任务的
 * status 写即便迁移合法也拒绝（见 applyTaskUpdate 的 wasTerminal 守卫），
 * reassign 的终态拒绝语义不变。
 */
export const TASK_TRANSITIONS: Readonly<Record<TeamTaskStatus, readonly TeamTaskStatus[]>> = {
  pending: ["claimed", "cancelled"],
  claimed: ["in_progress", "failed", "cancelled"],
  in_progress: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["pending"],
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

// ---------- lead 显式重开 failed 任务（spec §16 契约 5，2026-10-23 登记） ----------

/**
 * failed → pending 受控出边的板级执行（唯一调用方 hub.reopenTask，lead 专用端口；
 * 通用更新面在 applyTaskUpdate 的 wasTerminal 守卫处被拒）。重开 = 开新世代槽位：
 * 回共享池（assignee 清空，定向指派经既有 reassign）、证据清空（output/
 * acceptanceSupplement，「重试必须自证」clearAttemptResult 同语义；artifactRefs 是
 * 历史产出引用，保留）、recoveryRetried 重置（人工重开与自动冷恢复两预算独立，
 * 新世代仍享恰一次冷恢复）。attempt 计数不动——+1 与新 attemptId 由再认领时的
 * beginTaskAttempt 延续重铸，旧代更新即失效（attempt_revoked）。重开无异步静默
 * 半边（失败成员已终态），不铸 handoffId。completed/cancelled 无出边，非 failed
 * 一律 no-op 返回 false（hub 侧先行拒绝并给出 invalid_transition 教学文案）。
 */
export function reopenFailedTask(task: TeamTaskInternal, clock: BoardClock): boolean {
  if (task.status !== "failed") return false;
  task.status = "pending";
  task.assignee = undefined;
  task.attemptId = undefined;
  task.handoffId = undefined;
  task.reassigning = false;
  task.recoveryRetried = undefined;
  clearAttemptResult(task);
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
      task.assignee === memberName && (task.status === "claimed" || task.status === "in_progress"),
  );
}

// ---------- 成员终态失败处置分类器（spec §16 契约 1，2026-10-22 登记；dsh members.ts 三分语义） ----------

/**
 * 失败事件现场携带的世代凭证（registry 快照可得族；缺项 = 无从核对，
 * 不参与失配判定——生产路径 install 从快照 parentToolCallId 取派发 attemptId）。
 */
export interface MemberFailureObserved {
  memberName: string;
  /** 事件所属 agentId（换代核对：花名册记录已换 id 即迟到失败）。 */
  agentId?: string;
  taskId?: string;
  attemptId?: string;
  assignee?: string;
}

/** 分类对照面：花名册当前记录 + 该成员当前开放任务（ownedOpenTask 的产物）。 */
export interface MemberFailureCurrent {
  member?: { agentId?: string; removed?: boolean };
  task?: Pick<TeamTaskInternal, "taskId" | "attemptId" | "assignee" | "status">;
}

export type MemberFailureDisposition = "ignored" | "noted" | "failed_attempt";

/**
 * 三分裁决（spec §16 契约 1；迟到失败不误伤新代）：
 * - `ignored`：成员已移除/换代，或 observed 的 taskId/attemptId/assignee 任一与
 *   当前开放任务不符——全静默；
 * - `noted`：无开放任务（含任务已终态）——板零改动，仅通知；
 * - `failed_attempt`：精确匹配（taskId/attemptId/assignee 一致，任务
 *   claimed/in_progress）→ 仅该代置 failed（claimed→failed 与 in_progress→failed
 *   均为 TASK_TRANSITIONS 合法边）。
 */
export function classifyMemberFailure(
  observed: MemberFailureObserved,
  current: MemberFailureCurrent,
): MemberFailureDisposition {
  const member = current.member;
  if (member === undefined || member.removed === true) return "ignored";
  if (
    observed.agentId !== undefined &&
    member.agentId !== undefined &&
    member.agentId !== observed.agentId
  ) {
    return "ignored"; // 换代：花名册记录的 agentId 已换
  }
  const task = current.task;
  if (task === undefined || (task.status !== "claimed" && task.status !== "in_progress")) {
    return "noted"; // 无开放任务：板零改动，仅通知
  }
  if (observed.taskId !== undefined && observed.taskId !== task.taskId) return "ignored";
  if (observed.attemptId !== undefined && observed.attemptId !== task.attemptId) return "ignored";
  if (observed.assignee !== undefined && observed.assignee !== task.assignee) return "ignored";
  return "failed_attempt";
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
    return {
      task: undefined,
      result: { status: "rejected", error: teamPortError("team_not_present") },
    };
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
  // 终态不可变（spec §16 契约 2，2026-10-22 登记；dsh terminal-immutability-append-
  // evidence）：wasTerminal 取**迁移前旧态**，保证「同一次更新内置 completed+output」
  // 的合法派发/提交流不受影响（凭证按迁移前状态核对）。已终态任务的 output/artifactRefs
  // 写一律整体拒绝——无论 attempt_id 携带何值（空/错/恰好同值），凭证校验在终态面无意义；
  // acceptanceSupplement 署名追补是唯一合法终态通道（spec §16.1，下方 append-only 保留）。
  // 携带非法写字段时整次更新拒绝（含同时携带的追补），与函数其余拒绝路径一致，不做部分应用。
  const wasTerminal = isTerminalTaskStatus(task.status);
  if (wasTerminal && (input.patch.output !== undefined || input.patch.artifactRefs !== undefined)) {
    return { task, error: teamPortError("terminal_read_only", { id: task.taskId }) };
  }
  if (!wasTerminal) {
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
    if (wasTerminal) {
      // 受控出边仅 lead 专用端口可消费（spec §16 契约 5，2026-10-23 登记）：
      // TASK_TRANSITIONS 的 failed→pending 是 reopenTask 唯一通道的板级依据；通用
      // 更新面（含 lead 的 taskUpdate）即便迁移合法也整次拒绝——否则在场成员可无
      // 凭证把 failed 任务拉回 pending，绕过重开的 lead 权与预算语义。复用
      // team_lead_only：其文案「reserved for the team lead」对本场景是正确陈述
      // （契约 2 先例：文案与场景不符才新增错误码）。非出边的终态迁移仍走上方
      // invalid_transition；混带的追补一并整次拒绝（不做部分应用，与其余拒绝路径一致）。
      return { task, error: teamPortError("team_lead_only") };
    }
  }

  if (input.acceptanceSupplement !== undefined) {
    // 署名追补：append-only，不改 verdict/状态，不重认领。
    const previous = task.acceptanceSupplement ?? {};
    task.acceptanceSupplement = {
      ...(previous.acceptanceResults === undefined &&
      input.acceptanceSupplement.acceptanceResults === undefined
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
            evidenceNote:
              previous.evidenceNote === undefined
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
    const raw =
      item.output === undefined || item.output === "" ? "(no output recorded)" : item.output;
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
