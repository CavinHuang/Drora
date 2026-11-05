/**
 * 每日打扰配额中心——数据与判定面（04 详设 §4；spec §2.3 P4 落地注记）。
 *
 * 记账：mate.sqlite kv 日记录，键 `quota:<yyyy-mm-dd>`（本地日），值 JSON：
 *   { decision, report, bubble, digest: string[], digestDelivered: boolean }
 * 事件=决策卡推送/汇报推送/桌宠气泡三类，三端同源经 IAssistantTicketService 统一
 * 计数接口（admitDisturbance）进出，不建第二计数器（P3 桌宠注记兑现）。
 * 生产接线（04 详设 §4 修复批注记；spec §2.3）：decision=gate 落卡事务（recordTrigger/
 * sourceIngest 落 decision_card 同事务计数）；report=watchdog 通知（watchdog.ts）；
 * bubble=MatePetSync 气泡闸。工单终态汇报卡为快照被动呈现、无主动推送动作，其
 * report 计数生产接线随主动推送通道批次补齐（spec §14 遗留登记）——桌面现状
 * 「汇报到达」的打扰语义由 bubble 闸承接。
 *
 * 判定：三类事件都计数；decision 类永不抑制（allowed 恒 true——安全优先于安静）；
 * report/bubble 类当日累计 > 配额 → allowed=false，summary 聚合进当日 digest
 * （=次日摘要；条数/单条长度有界）。配额值来自 AppSettings `droraMateDailyQuota`
 * （装配层注入 settings 端口实时读；判定不经缓存，快照投影才用闭包缓存值）。
 *
 * 纯模块：无 IO（raw 连接与端口由调用方传入；事务纪律归服务闭包）。
 */
import {
  ASSISTANT_DISTURBANCE_DEFAULTS,
  ASSISTANT_DISTURBANCE_KINDS,
  ASSISTANT_SNAPSHOT_LIMITS,
  type AssistantDisturbanceKind,
} from "@drora/shared";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";

/** kv 日记录键前缀（完整键=`quota:<yyyy-mm-dd>`；键格式单出处）。 */
export const ASSISTANT_QUOTA_KV_PREFIX = "quota:";

/** 单日打扰账本（kv JSON；坏/缺值回落干净记录）。 */
export interface AssistantQuotaDayRecord {
  readonly decision: number;
  readonly report: number;
  readonly bubble: number;
  /** 超额聚合的次日摘要（旧→新，有界）。 */
  readonly digest: readonly string[];
  /** 摘要已投递回执（markDailyDigestDelivered 写入）。 */
  readonly digestDelivered: boolean;
}

/** admitDisturbance 判定臂（04 详设 §4）。 */
export interface AssistantDisturbanceVerdict {
  readonly allowed: boolean;
  /** true=本次未放行且已聚合进次日摘要。 */
  readonly aggregated: boolean;
  readonly record: AssistantQuotaDayRecord;
}

/** 本地日键 yyyy-mm-dd（配额按用户本地日界；不依赖 TZ 数据库）。 */
export function formatAssistantQuotaDayKey(atMs: number): string {
  const date = new Date(atMs);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isQuotaDayRecord(value: unknown): value is AssistantQuotaDayRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<AssistantQuotaDayRecord>;
  return (
    typeof record.decision === "number" &&
    typeof record.report === "number" &&
    typeof record.bubble === "number" &&
    Array.isArray(record.digest) &&
    record.digest.every((item) => typeof item === "string")
  );
}

/** 单日记录读取（缺/坏值 → 空记录，诚实缺省照 readAssistantConfig 纪律）。 */
export function readAssistantQuotaDay(
  raw: AssistantDatabaseRaw,
  dayKey: string,
): AssistantQuotaDayRecord {
  const row = raw
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(`${ASSISTANT_QUOTA_KV_PREFIX}${dayKey}`) as { value: string } | undefined;
  if (!row) {
    return { decision: 0, report: 0, bubble: 0, digest: [], digestDelivered: false };
  }
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (isQuotaDayRecord(parsed)) {
      return {
        decision: Math.max(0, Math.trunc(parsed.decision)),
        report: Math.max(0, Math.trunc(parsed.report)),
        bubble: Math.max(0, Math.trunc(parsed.bubble)),
        digest: parsed.digest.slice(0, ASSISTANT_SNAPSHOT_LIMITS.disturbanceDigestItemsMax),
        digestDelivered: parsed.digestDelivered === true,
      };
    }
    return { decision: 0, report: 0, bubble: 0, digest: [], digestDelivered: false };
  } catch {
    return { decision: 0, report: 0, bubble: 0, digest: [], digestDelivered: false };
  }
}

/** 单日记录写回（kv upsert；调用方持事务）。 */
export function writeAssistantQuotaDay(
  raw: AssistantDatabaseRaw,
  dayKey: string,
  record: AssistantQuotaDayRecord,
  updatedAtMs: number,
): void {
  raw
    .prepare(
      "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
    )
    .run(
      `${ASSISTANT_QUOTA_KV_PREFIX}${dayKey}`,
      JSON.stringify(record),
      updatedAtMs,
    );
}

function kindCountOf(record: AssistantQuotaDayRecord, kind: AssistantDisturbanceKind): number {
  switch (kind) {
    case ASSISTANT_DISTURBANCE_KINDS.decision:
      return record.decision;
    case ASSISTANT_DISTURBANCE_KINDS.report:
      return record.report;
    case ASSISTANT_DISTURBANCE_KINDS.bubble:
      return record.bubble;
  }
}

function withKindCount(
  record: AssistantQuotaDayRecord,
  kind: AssistantDisturbanceKind,
): AssistantQuotaDayRecord {
  switch (kind) {
    case ASSISTANT_DISTURBANCE_KINDS.decision:
      return { ...record, decision: record.decision + 1 };
    case ASSISTANT_DISTURBANCE_KINDS.report:
      return { ...record, report: record.report + 1 };
    case ASSISTANT_DISTURBANCE_KINDS.bubble:
      return { ...record, bubble: record.bubble + 1 };
  }
}

/** 三类累计（配额判定基准：全端事件共用一条配额线）。 */
export function assistantQuotaDayTotal(record: AssistantQuotaDayRecord): number {
  return record.decision + record.report + record.bubble;
}

/**
 * 记账+判定（事务体内调用；04 详设 §4 判定规则）：
 * - decision 类：永不抑制，allowed=true（安全优先于安静）；
 * - report/bubble 类：累计后当日 total > 配额 → allowed=false + summary 入 digest；
 * - 摘要条数有界（超出丢弃最旧——摘要本身是降级通道，不再无界增长）。
 */
export function admitAssistantDisturbanceTx(
  raw: AssistantDatabaseRaw,
  input: {
    kind: AssistantDisturbanceKind;
    summary?: string;
    atMs: number;
    quota: number;
  },
): AssistantDisturbanceVerdict {
  const dayKey = formatAssistantQuotaDayKey(input.atMs);
  const before = readAssistantQuotaDay(raw, dayKey);
  const counted = withKindCount(before, input.kind);
  const total = assistantQuotaDayTotal(counted);
  const overQuota = total > input.quota;
  const suppressible = input.kind !== ASSISTANT_DISTURBANCE_KINDS.decision;
  const aggregated = suppressible && overQuota;
  let record = counted;
  if (aggregated && input.summary && input.summary.trim()) {
    const truncated = input.summary.trim().slice(
      0,
      ASSISTANT_SNAPSHOT_LIMITS.disturbanceDigestItemMax,
    );
    const digest = [...record.digest, truncated].slice(
      -ASSISTANT_SNAPSHOT_LIMITS.disturbanceDigestItemsMax,
    );
    record = { ...record, digest };
  }
  writeAssistantQuotaDay(raw, dayKey, record, input.atMs);
  return { allowed: !aggregated, aggregated, record };
}

/** 配额值归一（settings 端口读取值 → 生效配额；坏值回落缺省，不猜测）。 */
export function resolveAssistantDailyQuota(value: number | undefined | null): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 200) {
    return value;
  }
  return ASSISTANT_DISTURBANCE_DEFAULTS.dailyQuota;
}

/** AppSettings 键的 settings 端口读取形态（装配层注入；服务不直接依赖 SettingService）。 */
export type AssistantDailyQuotaReader = () => Promise<number | undefined>;

/**
 * 未投递摘要收集（查询接口用；近 ≤N 日回扫，旧→新，跳过已投递与当日——
 * 当日聚合的摘要按定义「次日」投递，不提前结清）。
 */
export function collectPendingAssistantDigest(
  raw: AssistantDatabaseRaw,
  nowMs: number,
): { date: string; items: readonly string[] }[] {
  const todayKey = formatAssistantQuotaDayKey(nowMs);
  const pending: { date: string; items: readonly string[] }[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let back = 1; back <= ASSISTANT_SNAPSHOT_LIMITS.disturbanceDigestDaysMax; back += 1) {
    const dayKey = formatAssistantQuotaDayKey(nowMs - back * dayMs);
    if (dayKey === todayKey) break;
    const record = readAssistantQuotaDay(raw, dayKey);
    if (record.digestDelivered || record.digest.length === 0) continue;
    pending.push({ date: dayKey, items: [...record.digest] });
  }
  return pending;
}

/** 摘要投递回执（结清今日之前的未投递日；事务体内调用）。 */
export function markAssistantDigestDeliveredTx(raw: AssistantDatabaseRaw, nowMs: number): number {
  const todayKey = formatAssistantQuotaDayKey(nowMs);
  const dayMs = 24 * 60 * 60 * 1000;
  let cleared = 0;
  for (let back = 1; back <= ASSISTANT_SNAPSHOT_LIMITS.disturbanceDigestDaysMax; back += 1) {
    const dayKey = formatAssistantQuotaDayKey(nowMs - back * dayMs);
    if (dayKey === todayKey) break;
    const record = readAssistantQuotaDay(raw, dayKey);
    if (record.digestDelivered || record.digest.length === 0) continue;
    writeAssistantQuotaDay(raw, dayKey, { ...record, digestDelivered: true }, nowMs);
    cleared += 1;
  }
  return cleared;
}

/** kind 计数投影（查询接口/快照共用口径）。 */
export function assistantQuotaKindCounts(record: AssistantQuotaDayRecord): {
  decision: number;
  report: number;
  bubble: number;
} {
  return {
    decision: kindCountOf(record, ASSISTANT_DISTURBANCE_KINDS.decision),
    report: kindCountOf(record, ASSISTANT_DISTURBANCE_KINDS.report),
    bubble: kindCountOf(record, ASSISTANT_DISTURBANCE_KINDS.bubble),
  };
}
