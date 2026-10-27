import type { TeamPortError, TeamPortErrorCode } from "@drora/contracts";

/**
 * TeamPort 错误文案表（设计 00-master-design §3.1.2；错误文案即协议——
 * E1「缺 attempt_id」与 E2「attempt 已撤销」的区分是教学式分类，模型照错误
 * 信息行动而不是猜。文案英文面向模型；code 单一出处见本文件。）
 */

export type { TeamPortError, TeamPortErrorCode } from "@drora/contracts";

/** 中央工厂：保证每个错误码的文案单一出处（单测断言入口）。 */
export function teamPortError(
  code: TeamPortErrorCode,
  params: Readonly<Record<string, string>> = {},
): TeamPortError {
  switch (code) {
    case "missing_attempt_id":
      return {
        code,
        message: "Task update requires the attempt_id from your current assignment.",
        hint: "Retry this update with the attempt_id you received when claiming or being dispatched this task. Do not restart the work.",
      };
    case "attempt_revoked":
      return {
        code,
        message: "This task has been reassigned away from your attempt.",
        hint: "The task is no longer yours. Stop working on it; do not re-claim or continue.",
      };
    case "attempt_generation_mismatch":
      return {
        code,
        message: "This task has moved to a newer attempt.",
        hint: "Your attempt is stale. Stop working on it; do not re-claim or continue.",
      };
    // 2026-10-22 spec §16 契约 2（终态不可变补齐；dsh terminal-immutability-append-
    // evidence）：终态结果不可改写，署名追补（acceptance_supplement）是唯一合法通道
    // （spec §16.1）。不复用 attempt_revoked——其文案「已被转派」对已完工任务是错误
    // 陈述，会把模型导向「任务被抢走」的错误行动模型；教学文案必须导向追补通道。
    case "terminal_read_only":
      return {
        code,
        message: `Task '${params.id ?? "?"}' is already finished; its output and artifact refs are immutable.`,
        hint: "Do not rewrite a finished task. Submit additional evidence via acceptance_supplement instead of patching output or artifact_refs.",
      };
    case "invalid_transition":
      return {
        code,
        message: `Task status transition not allowed: ${params.from ?? "?"} → ${params.to ?? "?"}. Valid paths: pending → claimed → in_progress → terminal.`,
      };
    case "name_redirect":
      return {
        code,
        message: `Member name '${params.name ?? "?"}' now resolves to a different agent.`,
        hint: "Use the agentId from the roster, or the member's current name.",
      };
    case "member_removed":
      return {
        code,
        message: "You are no longer a member of this team.",
      };
    case "team_not_present":
      return {
        code,
        message: "No active team in this session.",
      };
    case "team_halted":
      return {
        code,
        message: "This team is halted.",
        hint: "The user stopped the team. Work stays frozen until an explicit resume with a reason; do not retry or work around it.",
      };
    case "board_limit_reached":
      return {
        code,
        message: `Task board is full (${params.limit ?? "?"}).`,
        hint: "Merge or complete tasks before creating new ones.",
      };
    case "team_lead_only":
      return {
        code,
        message: "This action is reserved for the team lead.",
      };
    case "message_target_terminal_retired":
      return {
        code,
        message: `Member '${params.name ?? "?"}' is retired and cannot be revived.`,
        hint: "Ask the lead to reassign the task instead.",
      };
    case "mailbox_persist_failed":
      return {
        code,
        message: "Mailbox write failed; message NOT sent.",
        hint: "Sending is only acknowledged after durable persistence. You may retry the send.",
      };
    case "message_too_large":
      return {
        code,
        message: `Message exceeds the ${params.limit ?? "?"} character limit.`,
        hint: "Shorten the message; put large content on disk and send a file reference.",
      };
    // E13/E14（2026-10-18 team UI 审查修复）：草案校验在 stageTeam 源头拦截——
    // 重名成员会让 wire 面所有按 memberName 的关系联接（assignee/下钻/邮箱）失位，
    // 悬空 assignee 会让任务卡显示不存在的负责人；两者都必须改草案而不是静默落库。
    case "draft_duplicate_member":
      return {
        code,
        message: `Draft contains duplicate member name '${params.name ?? "?"}'.`,
        hint: "Member names must be unique; rename one of the duplicates in the draft before staging.",
      };
    case "draft_unknown_assignee":
      return {
        code,
        message: `Draft task assigns '${params.name ?? "?"}' who is not a draft member.`,
        hint: "Assign tasks only to draft member names, or leave the assignee empty for the shared pool.",
      };
    // 2026-10-21 缺口6（Approve & Run 原子 spawn）：spawn 失败与邮箱持久化失败（E12）
    // 分开——前者是成员进程创建失败（hub 已回滚草案、零成员，该修订后重批），后者是
    // 消息未发出（该重发消息）。混用会让调用方按错误文案走错恢复路径。
    case "member_spawn_failed":
      return {
        code,
        message: "Spawning team members failed; the staged draft is intact with zero members.",
        hint: "No member was created. Fix the cause (e.g. member profile or provider availability) and approve the draft again.",
      };
    // 2026-10-21 缺口5（spec §14）：草案 taskId 身份保持 + 依赖三道校验——悬空/成环的
    // DAG 会让任务永久 pending 且静默无提示，必须在入库源头拦截并给出可行动文案。
    case "draft_duplicate_task":
      return {
        code,
        message: `Draft contains duplicate task id '${params.id ?? "?"}'.`,
        hint: "Task ids must be unique inside a draft; keep one or assign a fresh id (omit task_id) for the new task.",
      };
    case "unknown_dependency":
      return {
        code,
        message: `Dependency '${params.id ?? "?"}' does not match any task on the board.`,
        hint: "depends_on must reference existing task ids. Remove the dangling reference or stage the missing task first.",
      };
    case "dependency_cycle":
      return {
        code,
        message: `Draft task dependencies form a cycle: ${params.path ?? "?"}.`,
        hint: "Cyclic tasks can never become ready. Break the cycle by removing one depends_on edge.",
      };
    // §17 契约 4（2026-10-23）：草案字段与 wire 限额同门。超限草案一旦落库，投影
    // 一 emit 就烧帧（fail-closed 白屏），所以必须在源头拒绝并给出可行动文案。
    case "draft_field_too_long":
      return {
        code,
        message: `Draft field '${params.field ?? "?"}' exceeds the wire limit of ${params.limit ?? "?"} characters.`,
        hint: "Shorten the field (member names and profiles ≤128 chars; task title/goal/acceptance items ≤8000) and stage the draft again. Nothing was stored.",
      };
    // 2026-10-27 L7：reassign 目标忙闲校验——「一成员至多一个开放任务」（spec §2.3）
    // 在转派侧的拒绝（认领面同义状态 taskClaim busy_with_open_task）；教学式分类：
    // 改选空闲成员，不静默堆第二个开放任务。
    case "member_busy":
      return {
        code,
        message: `Member '${params.name ?? "?"}' already holds an open task.`,
        hint: "A member may hold at most one open task. Reassign to an idle member, or wait for their current task to reach a terminal state.",
      };
    // 2026-10-27 L10：草案空白名拒绝——memberName 是 wire 面 agent↔task 关系的联接键
    // （E13 同族），空白不能像空白 profile 那样归一为键缺席；与超限同门在 stageTeam
    // 源头拒绝（§17 契约 4 烧帧防护），管 port 直调绕过工具 schema min(1) 的形态。
    case "draft_blank_name":
      return {
        code,
        message: `Draft field '${params.field ?? "?"}' must not be blank.`,
        hint: "Give the manager a non-empty name (the roster joins tasks, mailbox and drill-downs by member name) and stage the draft again. Nothing was stored.",
      };
  }
}
