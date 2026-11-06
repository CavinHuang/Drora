/**
 * P9 自主节奏——kv 读点与通知区投影件（autonomy.ts 拆件，破依赖环：
 * assistantSnapshot → 本文件；本文件零依赖 assistant-tickets 业务模块，只依赖
 * shared 常量与 db 类型。autonomy.ts（评估循环/建卡事务）经本文件取 kv 键与通知区
 * 读写——单向边，架构检查即对账点）。
 *
 * - kv 配置键（mate.sqlite kv 表；存储键单出处，键名即 kv.key 字面量；模块内自产自读，
 *   写入口 configActions.setAutonomyEnabled/setAutonomyIntervalMinutes 引用同名常量）；
 * - 心跳间隔/总闸/节奏投影读取（坏/缺值逐键回落 contracts 缺省——readAssistantConfig
 *   同纪律）；
 * - 自主通知区（与 watchdog_notices 同形同界）：单写者分键——watchdog 轮的「判据解除
   出清」按 ticket 事实维护，autonomy 条目混写会被下一轮 watchdog 出清，故独立键、
 *   快照投影合并（assistantSnapshot watchdogNotices 面，MateDigestCard 零改动）。
 *
 * 纯模块：无 IO（raw 连接由调用方传入）。
 */
import {
  ASSISTANT_AUTONOMY_DEFAULTS,
  ASSISTANT_CONFIG_LIMITS,
  ASSISTANT_AUTONOMY_NOTICE_KINDS,
  ASSISTANT_SNAPSHOT_LIMITS,
} from "@drora/shared";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";
import type { AssistantWatchdogNotice } from "./watchdog.js";

/** kv 配置键（mate.sqlite kv 表；存储键单出处，键名即 kv.key 字面量）。 */
export const ASSISTANT_AUTONOMY_KV_KEYS = {
  /** 心跳节流间隔 ms（缺省 ASSISTANT_AUTONOMY_DEFAULTS.intervalMs；坏值回落缺省）。 */
  intervalMs: "autonomy_interval_ms",
  /** 总闸（"true"/"false"；缺/坏值=true——用户裁定「大副自己决定」即期望开启）。 */
  enabled: "autonomy_enabled",
  /** 上轮执行时刻（节流记账）。 */
  lastRoundMs: "autonomy_last_round_ms",
  /** 自主通知区（JSON 数组，与 watchdog_notices 同形同界；快照投影合并源）。 */
  notices: "autonomy_notices",
  /** 速览指纹登记（JSON {hash, atMs}；闸 2 去重基准）。 */
  fingerprint: "autonomy_fingerprint",
  /** 一次性首启告知已产标记（值=时刻 ms）。 */
  firstNoticeMs: "autonomy_first_notice_ms",
  /** 对象冷却键前缀（完整键=`autonomy_muted:<对象hash>`；值=解封时刻 ms）。 */
  mutedPrefix: "autonomy_muted:",
  /** 建卡对象 hash 登记（完整键=`autonomy_object:<triggerId>`；值=hash——闸 4 否定
   * 记忆的再计算锚点：suggest 的对象 hash 含 sessionId，而 trigger 行只留
   * workspace/brief，忽略侧经本登记取回同 hash，不猜不重算）。 */
  objectHashPrefix: "autonomy_object:",
} as const;

/** 心跳间隔读取（坏/缺值回落 contracts 缺省；越界/≤0 视为坏值不采纳）。 */
export function readAssistantAutonomyIntervalMs(
  kvGet: (key: string) => string | undefined,
): number {
  const raw = kvGet(ASSISTANT_AUTONOMY_KV_KEYS.intervalMs);
  if (raw === undefined) return ASSISTANT_AUTONOMY_DEFAULTS.intervalMs;
  const parsed = Number(raw);
  const limits = ASSISTANT_CONFIG_LIMITS.autonomyIntervalMinutes;
  if (
    Number.isSafeInteger(parsed) &&
    parsed >= limits.min * 60_000 &&
    parsed <= limits.max * 60_000
  ) {
    return parsed;
  }
  return ASSISTANT_AUTONOMY_DEFAULTS.intervalMs;
}

/** 总闸读取（缺/坏值=true；写入侧只落 "true"/"false" 两字面量）。 */
export function readAssistantAutonomyEnabled(kvGet: (key: string) => string | undefined): boolean {
  const raw = kvGet(ASSISTANT_AUTONOMY_KV_KEYS.enabled);
  if (raw === undefined) return true;
  return raw !== "false";
}

/** 节奏投影读取（快照 rhythm? 投影与设置区同口径；坏值逐键回落缺省）。 */
export function readAssistantRhythmView(kvGet: (key: string) => string | undefined): {
  enabled: boolean;
  intervalMinutes: number;
  lastRoundMs: number | null;
} {
  const lastRaw = kvGet(ASSISTANT_AUTONOMY_KV_KEYS.lastRoundMs);
  const lastParsed = lastRaw !== undefined ? Number(lastRaw) : NaN;
  return {
    enabled: readAssistantAutonomyEnabled(kvGet),
    intervalMinutes: readAssistantAutonomyIntervalMs(kvGet) / 60_000,
    lastRoundMs: Number.isFinite(lastParsed) ? lastParsed : null,
  };
}

/** kv 单键读（autonomy.ts 评估循环共用；缺行 → undefined）。 */
export function autonomyKvGet(raw: AssistantDatabaseRaw, key: string): string | undefined {
  const row = raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** kv upsert 写（autonomy.ts 记账/冷却同款；调用方持事务）。 */
export function autonomyKvSet(
  raw: AssistantDatabaseRaw,
  key: string,
  value: string,
  atMs: number,
): void {
  raw
    .prepare(
      "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
    )
    .run(key, value, atMs);
}

/**
 * 自主通知 kind 封闭集（2026-11-06 复审上收 shared/contracts 单出处——该 kind 值随
 * 快照 watchdogNotices 跨包传递，UI petProjection 同引 shared 常量；本文件再导出维持
 * autonomy.ts 既有 import 路径稳定）。
 */
export { ASSISTANT_AUTONOMY_NOTICE_KINDS };

/** autonomy 通知条目（复用 watchdog 通知同形——ticketId 承载自主标记常量）。 */
export type AssistantAutonomyNotice = AssistantWatchdogNotice;

/** 通知区 ticketId 字段的自主标记值（MateDigestCard mono 列展示为来源而非工单号）。 */
export const ASSISTANT_AUTONOMY_NOTICE_TICKET_ID = "autonomy";

/** 通知区读取（坏/缺值 → 空数组；条目形状校验照 readAssistantWatchdogNotices）。 */
export function readAssistantAutonomyNotices(raw: AssistantDatabaseRaw): AssistantAutonomyNotice[] {
  const rowValue = autonomyKvGet(raw, ASSISTANT_AUTONOMY_KV_KEYS.notices);
  if (!rowValue) return [];
  try {
    const parsed = JSON.parse(rowValue) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is AssistantAutonomyNotice =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as AssistantAutonomyNotice).ticketId === "string" &&
        typeof (entry as AssistantAutonomyNotice).kind === "string" &&
        typeof (entry as AssistantAutonomyNotice).summary === "string" &&
        typeof (entry as AssistantAutonomyNotice).atMs === "number",
    );
  } catch {
    return [];
  }
}

/** 通知区追加（事务体内调用；新→旧保序，容量同 watchdogNoticesMax 截断）。 */
export function appendAutonomyNoticeTx(
  raw: AssistantDatabaseRaw,
  notice: AssistantAutonomyNotice,
  atMs: number,
): void {
  const next = [notice, ...readAssistantAutonomyNotices(raw)].slice(
    0,
    ASSISTANT_SNAPSHOT_LIMITS.watchdogNoticesMax,
  );
  autonomyKvSet(raw, ASSISTANT_AUTONOMY_KV_KEYS.notices, JSON.stringify(next), atMs);
}

function mutedKey(hash: string): string {
  return `${ASSISTANT_AUTONOMY_KV_KEYS.mutedPrefix}${hash}`;
}

/** 对象冷却读取（键缺=未冷却；值坏=null（不猜残余冷却），值=解封时刻 ms）。 */
export function readAutonomyMutedUntil(raw: AssistantDatabaseRaw, hash: string): number | null {
  const rawValue = autonomyKvGet(raw, mutedKey(hash));
  if (rawValue === undefined) return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 冷却键写（闸 3 建卡即写/闸 4 否定记忆共用；调用方持事务）。 */
export function writeAutonomyMutedUntilTx(
  raw: AssistantDatabaseRaw,
  hash: string,
  untilMs: number,
  atMs: number,
): void {
  autonomyKvSet(raw, mutedKey(hash), String(untilMs), atMs);
}
