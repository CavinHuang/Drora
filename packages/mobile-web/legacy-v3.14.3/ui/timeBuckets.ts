// R3 P3a 富时间线分桶（specs/mobile-relay-r3-frontend.md §14 第 2 条）。
// 桶算法自包含移植自 packages/ui/src/lib/taskTimelineGroups.ts（D6 冻结 ui，本包自持），
// 常量与判定逐字对齐上游：DAY_MS=86400000、dayDiff<=0 today、==1 yesterday、<=3 daysAgo、
// startOfWeek en-US 周日(0)/其余周一(1)、thisWeek/lastWeek/thisMonth/lastMonth/older 兜底序。
// 与上游的两点有意分歧（本仓自研，记录于本文件头）：
// 1. 分桶对象是 ConversationRow 的 turnHeader.startedAt（按轮次分组），不是 tasks 列表的
//    createdAt/updatedAt——后者是任务粒度时间，语义不同；相邻行归属其前方最近的
//    turnHeader 桶，无 turnHeader 前缀的行归入首个已见桶，全程无 turnHeader 时整段归 older。
// 2. 上游 groupTaskTimelineItems 是任务列表分组，同 key 非相邻条目会并回先前组；时间线是
//    线性流，这里按相邻 key 变化开新组（相邻同 key 段就地合并），保证分隔标题随时间轴
//    单调出现、不回跳。
// 本模块保持零运行时依赖（渲染侧的 ConversationRow 仅作结构兼容面，不产生 import），
// 便于 node:test + tsx 直测。

const DAY_MS = 24 * 60 * 60 * 1000;

/** 八桶（对齐上游 TaskTimelineGroupKind 闭集）。 */
export type TaskTimelineBucketKind =
  | "today"
  | "yesterday"
  | "daysAgo"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "older";

/** 桶 label；kind=daysAgo 时携带天数（2/3，上游同值域）。 */
export interface TaskTimelineBucketLabel {
  kind: TaskTimelineBucketKind;
  daysAgo?: number;
}

/**
 * 分桶 locale 语义（与 mobile MobileLocale 同值集）：en-US 周日起、其余（zh-CN）周一起，
 * 与上游 startOfWeek 的 `locale === "en-US" ? 0 : 1` 一致。
 */
export type TaskTimelineBucketLocale = "zh-CN" | "en-US";

/** 一个桶：相邻同 key 行段；rows 保持传入顺序（rowId 升序由 store 保证）。 */
export interface TaskTimelineBucket<TRow> {
  key: string;
  label: TaskTimelineBucketLabel;
  rows: TRow[];
}

/** 分桶入参的最小结构面（ConversationRow 天然满足；测试可传最小对象，免 zod 构造）。 */
export interface TimelineBucketingRow {
  rowId: number;
  kind: string;
  /** 仅 turnHeader 行需要：轮次开始时间（v4 timestampSchema = epoch ms）。 */
  startedAt?: number;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function startOfMonth(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function startOfWeek(timestamp: number, locale: TaskTimelineBucketLocale): number {
  const date = new Date(startOfDay(timestamp));
  const day = date.getDay();
  const weekStartsOn = locale === "en-US" ? 0 : 1;
  const offset = (day - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

/** 八桶核心判定（逐字移植上游 resolveTaskTimelineGroupKey；本地时区）。 */
export function resolveTaskTimelineBucketLabel(
  timestamp: number,
  now: number,
  locale: TaskTimelineBucketLocale,
): TaskTimelineBucketLabel {
  const todayStart = startOfDay(now);
  const itemDayStart = startOfDay(timestamp);
  const dayDiff = Math.floor((todayStart - itemDayStart) / DAY_MS);

  if (dayDiff <= 0) {
    return { kind: "today" };
  }
  if (dayDiff === 1) {
    return { kind: "yesterday" };
  }
  if (dayDiff <= 3) {
    return { kind: "daysAgo", daysAgo: dayDiff };
  }

  const thisWeekStart = startOfWeek(now, locale);
  if (itemDayStart >= thisWeekStart) {
    return { kind: "thisWeek" };
  }

  const lastWeekStart = thisWeekStart - 7 * DAY_MS;
  if (itemDayStart >= lastWeekStart) {
    return { kind: "lastWeek" };
  }

  const thisMonthStart = startOfMonth(now);
  if (itemDayStart >= thisMonthStart) {
    return { kind: "thisMonth" };
  }

  const nowDate = new Date(now);
  const lastMonthStart = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1).getTime();
  if (itemDayStart >= lastMonthStart) {
    return { kind: "lastMonth" };
  }

  return { kind: "older" };
}

/** 桶 key（daysAgo 携带天数，其余即 kind；上游 serialize 语义）。 */
export function serializeTaskTimelineBucketLabel(label: TaskTimelineBucketLabel): string {
  return label.kind === "daysAgo" ? `${label.kind}:${label.daysAgo ?? 0}` : label.kind;
}

/** 桶 label → 官方 taskTimeline.* 文案描述（{days} 占位由调用方经 intl 插值）。 */
export function taskTimelineBucketMessage(label: TaskTimelineBucketLabel): {
  id: string;
  values?: Record<string, string>;
} {
  if (label.kind === "daysAgo") {
    return {
      id: "taskTimeline.daysAgo",
      values: { days: String(label.daysAgo ?? 0) },
    };
  }
  return { id: `taskTimeline.${label.kind}` };
}

/**
 * ConversationRow → 线性桶序列。行归属规则见文件头分歧 1：
 * turnHeader 以自身 startedAt 落桶并切换当前桶；其余行跟随当前桶；
 * 无 turnHeader 前缀行归首个已见桶（首个 turnHeader 的 key，两遍扫描预取），
 * 全程无 turnHeader 时归 older 兜底。
 */
export function bucketConversationRows<TRow extends TimelineBucketingRow>(
  rows: readonly TRow[],
  options: { now: number; locale: TaskTimelineBucketLocale },
): TaskTimelineBucket<TRow>[] {
  // pass 1：首个 turnHeader 的桶（前缀行的归属目标）。
  let firstTurnKey: string | null = null;
  let firstTurnLabel: TaskTimelineBucketLabel | null = null;
  for (const row of rows) {
    if (row.kind === "turnHeader" && typeof row.startedAt === "number") {
      firstTurnLabel = resolveTaskTimelineBucketLabel(row.startedAt, options.now, options.locale);
      firstTurnKey = serializeTaskTimelineBucketLabel(firstTurnLabel);
      break;
    }
  }
  const fallbackLabel: TaskTimelineBucketLabel = firstTurnLabel ?? { kind: "older" };
  const fallbackKey = firstTurnKey ?? serializeTaskTimelineBucketLabel(fallbackLabel);

  // pass 2：顺序归属 + 相邻同 key 合并（前缀段与首个 turnHeader 段同 key，就地合一段）。
  const buckets: TaskTimelineBucket<TRow>[] = [];
  let currentKey: string | null = null;
  let currentLabel: TaskTimelineBucketLabel | null = null;
  let current: TaskTimelineBucket<TRow> | null = null;

  for (const row of rows) {
    let key: string;
    let label: TaskTimelineBucketLabel;
    if (row.kind === "turnHeader" && typeof row.startedAt === "number") {
      label = resolveTaskTimelineBucketLabel(row.startedAt, options.now, options.locale);
      key = serializeTaskTimelineBucketLabel(label);
      currentKey = key;
      currentLabel = label;
    } else {
      key = currentKey ?? fallbackKey;
      label = currentLabel ?? fallbackLabel;
    }
    if (current === null || current.key !== key) {
      current = { key, label, rows: [] };
      buckets.push(current);
    }
    current.rows.push(row);
  }

  return buckets;
}
