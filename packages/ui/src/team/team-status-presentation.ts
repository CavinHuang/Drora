import type { TeamUiStatus } from "./contract.js";

/**
 * team 状态机徽标的展示映射（PR-2.4c 面板开态徽标用；design 01 §4 token 纪律：
 * 「状态色语义化（pending=neutral、working=accent、idle=muted、completed=success、
 * failed=error、halted/escalated=warning）且色+文字并行」）。
 *
 * 色点很小，**不以色独行**：文字由消费方用 TEAM_STATUS_I18N_KEYS 走 i18n（sr-only 或
 * tooltip），两表键集必须同构——auto-open 之外的测试锁这一点。
 */

/** 语义色点 tone（Tailwind 语义 token；与 styles.css 的 --color-* 对应）。 */
export type TeamStatusDotTone =
  | "accent"
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "confirmation";

export const TEAM_STATUS_DOT_TONE: Record<TeamUiStatus, TeamStatusDotTone> = {
  // 统一设计 02：审批使用 confirmation，运行状态使用 workflow 同款 warning 灯。
  staged: "confirmation",
  active: "warning",
  idle: "neutral",
  completed: "success",
  halted: "warning",
  escalated: "warning",
  cancelled: "neutral",
  archived: "neutral",
};

/** 状态文字的 i18n 键（locales zh-CN/en-US `team.status.*`；单一出处，勿内联复制）。 */
export const TEAM_STATUS_I18N_KEYS: Record<TeamUiStatus, string> = {
  staged: "team.status.staged",
  active: "team.status.active",
  idle: "team.status.idle",
  completed: "team.status.completed",
  halted: "team.status.halted",
  escalated: "team.status.escalated",
  cancelled: "team.status.cancelled",
  archived: "team.status.archived",
};

/** tone → 色点类名（消费方直接拼；集中在此避免散落各处映射不一致）。 */
export const TONE_DOT_CLASS: Record<TeamStatusDotTone, string> = {
  confirmation: "bg-[var(--color-interaction-confirmation-foreground)]",
  accent: "bg-accent",
  neutral: "bg-neutral-foreground/40",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};
