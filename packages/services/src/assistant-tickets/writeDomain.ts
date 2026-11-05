/**
 * 写域 W1/W2/W3 规划与冲突判定（specs/drora-personal-assistant.md §9；02 详设 §4）。
 *
 * - W1：git 仓库且用户未关闭 → worktree `.drora/mate/<ticketId>` + 分支 `mate/<ticketId>`
 *   （分支/路径字面量为 02 §4 设计原文；worktree 实建/清理经 AssistantGitWorktreePort，
 *   本模块只产出计划）；
 * - W2：非 git 根或用户关闭 W1 → 声明域 paths[]（决策卡可编辑；P2 host 内核默认空集，
 *   语义=整域待声明）；比对同 workspace 其他活动工单，重叠→进 budget 队列；
 * - W3：Mode C 附着用户会话不隔离（用户自己的工作目录）→ domain={kind:"workspace"}，
 *   仍与 W1/W2 活动工单比对冲突（随 §2 Mode C 交付）；
 * - 软预算=同 workspace 活动工单 3（ASSISTANT_DEFAULTS），超出排队（queued）+告知卡，
 *   释放即 FIFO 派发。
 *
 * 纯模块：无 IO；probe 结果由装配层注入（identity→workspacePath/isGitRoot 解析在 host）。
 */
import { join } from "node:path";
import { ASSISTANT_DEFAULTS } from "@drora/shared";

/** W1 路径/分支字面量（02 §4 设计原文；测试锁定）。 */
export const MATE_WORKTREE_DIR_SEGMENTS = [".drora", "mate"] as const;
export const MATE_WORKTREE_BRANCH_PREFIX = "mate/" as const;

/** 写域三态（02 §4；决策卡/汇报卡的「未隔离」明示由 UI 依 kind 判定）。 */
export type AssistantWriteDomain =
  | { readonly kind: "workspace" }
  | { readonly kind: "worktree"; readonly path: string; readonly branch: string }
  | { readonly kind: "paths"; readonly paths: readonly string[] };

/** workspace 探测结果（装配层 AssistantWorkspaceProbePort 的产出）。 */
export type WorkspaceProbe =
  | { readonly ok: true; readonly workspacePath: string; readonly isGitRoot: boolean }
  | { readonly ok: false; readonly reason: string };

export interface WriteDomainPlanInput {
  readonly ticketId: string;
  readonly probe: WorkspaceProbe;
  /** 用户关闭 W1（W2 兜底）；缺省=开启。 */
  readonly worktreeDisabled?: boolean;
}

export type WriteDomainPlan =
  | {
      readonly ok: true;
      readonly domain: AssistantWriteDomain;
      /** W1 时=worktree 实建请求（装配层据此调 git）；W2/W3 时=undefined。 */
      readonly worktreeRequest?: { readonly path: string; readonly branch: string };
    }
  | { readonly ok: false; readonly reason: string };

/** 规划工单写域：probe ok + git 根 + W1 开 → worktree；非 git/关 W1 → 声明域。 */
export function planWriteDomain(input: WriteDomainPlanInput): WriteDomainPlan {
  if (!input.probe.ok) {
    return { ok: false, reason: `workspace 探测失败：${input.probe.reason}` };
  }
  if (input.worktreeDisabled) {
    return { ok: true, domain: { kind: "paths", paths: [] } };
  }
  if (!input.probe.isGitRoot) {
    return { ok: true, domain: { kind: "paths", paths: [] } };
  }
  const path = join(input.probe.workspacePath, ...MATE_WORKTREE_DIR_SEGMENTS, input.ticketId);
  const branch = `${MATE_WORKTREE_BRANCH_PREFIX}${input.ticketId}`;
  return {
    ok: true,
    domain: { kind: "worktree", path, branch },
    worktreeRequest: { path, branch },
  };
}

/** 换代重派：该路径已检出则续用（不重复 add；02 §4）。 */
export function isSameWorktreeDomain(a: AssistantWriteDomain, b: AssistantWriteDomain): boolean {
  return a.kind === "worktree" && b.kind === "worktree" && a.path === b.path && a.branch === b.branch;
}

/** ticket.write_domain JSON 列解析（坏 JSON/未知形状 → undefined 诚实降级）。 */
export function parseWriteDomainColumn(raw: string | null): AssistantWriteDomain | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<AssistantWriteDomain>;
    if (
      parsed.kind === "worktree" &&
      typeof parsed.path === "string" &&
      typeof parsed.branch === "string"
    ) {
      return { kind: "worktree", path: parsed.path, branch: parsed.branch };
    }
    if (parsed.kind === "paths" && Array.isArray(parsed.paths)) {
      return { kind: "paths", paths: parsed.paths.filter((p): p is string => typeof p === "string") };
    }
    if (parsed.kind === "workspace") return { kind: "workspace" };
    return undefined;
  } catch {
    return undefined;
  }
}

/** 路径重叠判定：相等或一方为另一方前缀（含分隔符边界，避免 mate2 误配 mate）。 */
function pathOverlaps(left: string, right: string): boolean {
  const l = left.replace(/[\\/]+$/, "");
  const r = right.replace(/[\\/]+$/, "");
  if (!l || !r) return false;
  const lowerL = l.toLowerCase();
  const lowerR = r.toLowerCase();
  return (
    lowerL === lowerR ||
    lowerL.startsWith(`${lowerR}\\`) ||
    lowerL.startsWith(`${lowerR}/`) ||
    lowerR.startsWith(`${lowerL}\\`) ||
    lowerR.startsWith(`${lowerL}/`)
  );
}

/**
 * 两写域是否冲突（02 §4 派发桥比对；不变式「Mate 派生活动工单两两写域不相交」）：
 * - worktree vs 任意域：不冲突——git worktree 是独立检出目录，与主检出/声明域物理不相交
 *   （W1 的隔离即为此设计）；两个不同工单的 worktree 恒不冲突；
 * - workspace（整域/W3 附着/W2 未声明）vs workspace：冲突（同目录双写不可证伪）；
 * - workspace vs paths：冲突（paths 空集=待声明整域；非空按路径比对）。
 */
export function detectWriteDomainOverlap(a: AssistantWriteDomain, b: AssistantWriteDomain): boolean {
  if (a.kind === "worktree" || b.kind === "worktree") return false;
  if (a.kind === "workspace" || b.kind === "workspace") return true;
  // 空声明集=待声明整域（P2 host 内核缺省）→ 与任何声明域冲突（同目录双写不可证伪）。
  if (a.paths.length === 0 || b.paths.length === 0) return true;
  return a.paths.some((l) => b.paths.some((r) => pathOverlaps(l, r)));
}

export interface BudgetQueueInput {
  /** 同 workspace 活动工单（status ∈ dispatched/running）计数。 */
  readonly activeCount: number;
  /** 软预算（config kv；缺席回落 ASSISTANT_DEFAULTS）。 */
  readonly budgetMaxActivePerWorkspace?: number;
}

export type BudgetQueueVerdict =
  | { readonly action: "admit" }
  | { readonly action: "queue"; readonly reason: string };

/** 软预算判定（spec §9：超出排队+告知卡；无硬上限、无全局锁）。 */
export function planBudgetAdmission(input: BudgetQueueInput): BudgetQueueVerdict {
  const budget = input.budgetMaxActivePerWorkspace ?? ASSISTANT_DEFAULTS.budgetMaxActivePerWorkspace;
  if (input.activeCount >= budget) {
    return {
      action: "queue",
      reason: `同 workspace 活动工单 ${input.activeCount} 已达软预算 ${budget}，进入 queued 等待释放`,
    };
  }
  return { action: "admit" };
}

/** 活动工单判定（预算计数口径；queued 不占预算）。 */
export function isBudgetActiveStatus(status: string): boolean {
  return status === "dispatched" || status === "running";
}
