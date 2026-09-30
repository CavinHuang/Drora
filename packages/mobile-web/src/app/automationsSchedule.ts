// R3 P6 automations 日程构造器（specs/mobile-relay-r3-frontend.md §23）。
// 官方取证逐字节还原（upstream index chunk，2026-09-30 取证）：
//   eX = String(v).padStart(2, "0")；$Y = [1,2,3,4,5,6,0]（周一起始序）；
//   rX(day,t) = formatMessage(`automations.weekday.${day}`)；
//   iX(e,t) 七分支：hourly/daily/weekdays/weekly/monthly/custom×6子形态/default→rawExpr；
//   nX(e) 九分支 cron→schedule：minute/hourly/daily 步进×3 → hourly/daily/weekdays/weekly/
//     yearly(月字段非*优先)/monthly，非 5 段→默认形状；
//   mUt(e,t) 三形态：`*/N * * * *`→customMinutes；`M H D * *`/`M H D */N *`→frequency.custom；
//     其余 nX 解析后 custom→frequency.custom、否则 iX。
// 官方双分隔符形态如实：weekly 硬编码"、"（不走键），customWeekly 走 weekday.separator 键；
// customMonthlyDates join 硬编码", "。intl 经形参注入（与官方 iX(e,t) 同构，本模块不持 intl）。
// 未还原（官方值不可得不臆造）：hUt 的 tX（schedule→cron 反序列化）、gUt GMT 尾段——归下轮取证。

/** 官方默认形状（nX 首行逐字段）。 */
export interface AutomationSchedule {
  frequency: "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";
  hour: number;
  minute: number;
  weekdays: number[];
  dayOfMonth: number;
  rawExpr: string;
  customInterval: number;
  customUnit: "minute" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  customWeekdays: number[];
  customMonthDays: number[];
  customMonth: number;
  customMonthlyMode: "date" | "weekday";
}

export type FormatMessage = (
  descriptor: { id: string },
  values?: Record<string, string>,
) => string;

/** 官方 eX：时分补零（String(v).padStart(2,"0")）。 */
export const pad2 = (value: number): string => String(value).padStart(2, "0");

/** 官方 $Y：周一起始星期序（weekly 分支排序基准）。 */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** 官方 rX：星期名（weekday.{0-6} 七键，0=周日）。 */
export function weekdayName(day: number, formatMessage: FormatMessage): string {
  return formatMessage({ id: `automations.weekday.${day}` });
}

/** 官方默认形状（nX 的 t 逐字段；customMonth 依赖当前月，测试可注入 now）。 */
export function defaultSchedule(rawExpr: string, now: Date = new Date()): AutomationSchedule {
  return {
    frequency: "custom",
    hour: 9,
    minute: 0,
    weekdays: [1],
    dayOfMonth: 1,
    rawExpr,
    customInterval: 1,
    customUnit: "daily",
    customWeekdays: [1],
    customMonthDays: [1],
    customMonth: now.getMonth() + 1,
    customMonthlyMode: "date",
  };
}

/** 官方 iX：schedule → 日程描述（七分支 + custom 六子形态 + default→rawExpr）。 */
export function describeSchedule(
  schedule: AutomationSchedule,
  formatMessage: FormatMessage,
): string {
  const time = `${pad2(schedule.hour)}:${pad2(schedule.minute)}`;
  switch (schedule.frequency) {
    case "hourly":
      return formatMessage({ id: "automations.schedule.hourly" }, { minute: pad2(schedule.minute) });
    case "daily":
      return formatMessage({ id: "automations.schedule.daily" }, { time });
    case "weekdays":
      return formatMessage({ id: "automations.schedule.weekdays" }, { time });
    case "weekly": {
      // 官方：按 $Y 周一起始序排序，分隔符硬编码"、"（不走 weekday.separator 键）。
      const days = [...schedule.weekdays]
        .sort((a, b) => WEEKDAY_ORDER.indexOf(a as 1) - WEEKDAY_ORDER.indexOf(b as 1))
        .map((day) => weekdayName(day, formatMessage))
        .join("、");
      return formatMessage({ id: "automations.schedule.weekly" }, { days, time });
    }
    case "monthly":
      return formatMessage(
        { id: "automations.schedule.monthly" },
        { day: String(schedule.dayOfMonth), time },
      );
    case "custom": {
      const interval = String(schedule.customInterval);
      if (schedule.customUnit === "minute") {
        return formatMessage({ id: "automations.schedule.customMinutes" }, { interval });
      }
      if (schedule.customUnit === "hourly") {
        return formatMessage(
          { id: "automations.schedule.customHourly" },
          { interval, time: pad2(schedule.minute) },
        );
      }
      if (schedule.customUnit === "weekly") {
        // 官方：分隔符走 weekday.separator 键（与 weekly 硬编码"、"双形态并存）。
        const days = schedule.customWeekdays
          .map((day) => weekdayName(day, formatMessage))
          .join(formatMessage({ id: "automations.weekday.separator" }));
        return formatMessage({ id: "automations.schedule.customWeekly" }, { interval, days, time });
      }
      if (schedule.customUnit === "monthly") {
        return schedule.customMonthlyMode === "weekday"
          ? formatMessage(
              { id: "automations.schedule.customMonthlyWeekday" },
              { interval, day: weekdayName(schedule.customWeekdays[0] ?? 1, formatMessage), time },
            )
          : formatMessage(
              { id: "automations.schedule.customMonthlyDates" },
              // 官方：join 硬编码", "（非 locale 键）。
              { interval, days: schedule.customMonthDays.join(", "), time },
            );
      }
      if (schedule.customUnit === "yearly") {
        return formatMessage(
          { id: "automations.schedule.customYearly" },
          {
            interval,
            month: String(schedule.customMonth),
            day: String(schedule.customMonthDays[0] ?? 1),
            time,
          },
        );
      }
      // 官方兜底：unit 固定取 customRepeat.unit.day（天）。
      return formatMessage(
        { id: "automations.schedule.custom" },
        { interval, unit: formatMessage({ id: "automations.customRepeat.unit.day" }), time },
      );
    }
    default:
      return schedule.rawExpr;
  }
}

const isDigits = (segment: string): boolean => /^\d+$/.test(segment);
const stepOf = (segment: string): number | null => {
  const match = /^\*\/(\d+)$/.exec(segment);
  return match ? Number(match[1]) : null;
};

/** 官方 nX：cron → schedule（九分支，非 5 段→默认形状；yearly 优先于 monthly）。 */
export function parseCron(expr: string, now: Date = new Date()): AutomationSchedule {
  const base = defaultSchedule(expr, now);
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return base;
  // length===5 已守卫——五段均存在（TS 索引收窄需显式）。
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string];
  const minuteNum = Number(minute);
  const hourNum = Number(hour);
  // 1. */N * * * * → custom/minute
  const minuteStep = /^\*\/([1-9]\d*)$/.exec(minute);
  if (minuteStep && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return { ...base, frequency: "custom", customInterval: Number(minuteStep[1]), customUnit: "minute" };
  }
  // 2. M */N * * * → custom/hourly {minute:M, interval:max(1,N)}
  const hourStep = stepOf(hour);
  if (isDigits(minute) && hourStep !== null && day === "*" && month === "*" && weekday === "*") {
    return {
      ...base,
      frequency: "custom",
      minute: minuteNum,
      customInterval: Math.max(1, hourStep),
      customUnit: "hourly",
    };
  }
  // 3. M H */N * * → custom/daily {hour, minute, interval:max(1,N)}
  const dayStep = stepOf(day);
  if (isDigits(minute) && isDigits(hour) && dayStep !== null && month === "*" && weekday === "*") {
    return {
      ...base,
      frequency: "custom",
      hour: hourNum,
      minute: minuteNum,
      customInterval: Math.max(1, dayStep),
      customUnit: "daily",
    };
  }
  // 4. M * * * * → hourly
  if (isDigits(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return { ...base, frequency: "hourly", minute: minuteNum };
  }
  // 5. M H * * * → daily
  if (isDigits(minute) && isDigits(hour) && day === "*" && month === "*" && weekday === "*") {
    return { ...base, frequency: "daily", hour: hourNum, minute: minuteNum };
  }
  // 6. M H * * 1-5 → weekdays
  if (isDigits(minute) && isDigits(hour) && day === "*" && month === "*" && weekday === "1-5") {
    return { ...base, frequency: "weekdays", hour: hourNum, minute: minuteNum };
  }
  // 7. M H * * w1,w2,… → weekly（0-6 有效值过滤）
  if (isDigits(minute) && isDigits(hour) && day === "*" && month === "*" && weekday !== "*") {
    const weekdays = weekday
      .split(",")
      .map(Number)
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
    if (weekdays.length > 0) {
      return { ...base, frequency: "weekly", hour: hourNum, minute: minuteNum, weekdays };
    }
  }
  // 8. M H D m *（m∈1-12）→ custom/yearly（官方：yearly 先于 monthly 判定）
  if (isDigits(minute) && isDigits(hour) && isDigits(day) && isDigits(month) && weekday === "*") {
    const monthNum = Number(month);
    if (monthNum >= 1 && monthNum <= 12) {
      return {
        ...base,
        frequency: "custom",
        hour: hourNum,
        minute: minuteNum,
        customUnit: "yearly",
        customMonth: monthNum,
        customMonthDays: [Number(day)],
      };
    }
  }
  // 9. M H D * * → monthly
  return isDigits(minute) && isDigits(hour) && isDigits(day) && month === "*" && weekday === "*"
    ? { ...base, frequency: "monthly", hour: hourNum, minute: minuteNum, dayOfMonth: Number(day) }
    : base;
}

/** 官方 mUt：cron → 描述（三形态；custom → frequency.custom 键，其余走 iX）。 */
export function describeCron(expr: string, formatMessage: FormatMessage): string {
  const normalized = expr.trim().replace(/\s+/g, " ");
  const everyMinutes = /^\*\/([1-9]\d*) \* \* \* \*$/.exec(normalized);
  if (everyMinutes?.[1]) {
    return formatMessage(
      { id: "automations.schedule.customMinutes" },
      { interval: everyMinutes[1] },
    );
  }
  // 官方：数字四段 + `*/N` 月步进两形态 → 自定义频率原样键。
  if (/^\d+ \d+ \d+ \d+ \*$/.test(normalized) || /^\d+ \d+ \d+ \*\/\d+ \*$/.test(normalized)) {
    return formatMessage({ id: "automations.frequency.custom" });
  }
  const schedule = parseCron(normalized);
  return schedule.frequency === "custom"
    ? formatMessage({ id: "automations.frequency.custom" })
    : describeSchedule(schedule, formatMessage);
}

// —— P6 续还原（2026-09-30 第二轮取证，22/22 结构化断言全过）：tX/gUt/aX 三件套 ——
// 官方取证逐字节（抗劣化协议：grep 落盘 → node 22 布尔摘要 → 与已提交 nX 字段族交叉）：
//   tX(e) 单参 schedule→cron：六 case + custom 六子形态（步进越界守卫 t<=59/24/31 → 全通配
//     退化 `*`）+ monthly weekday→`DOW#1` nth 语法 + yearly 月位 min(12,max(1,floor)) 且
//     **interval 不参与 yearly cron**（t 仅前三分支用）+ 日位 customMonthDays[0]??今日兜底 +
//     default→rawExpr.trim()。
//   **weekly 排序双形态并存实锤**：tX 用数值升序 (a,b)=>a-b；iX（describeSchedule）用 $Y
//     周一起始序——两函数排序不同，均官方逐字节，不归一。
//   gUt(e=-new Date().getTimezoneOffset())：0→`GMT`；符号 e>0?`+`:`-`；时=floor(|e|/60)；
//     分=|e|%60 非 0 → `:${pad2(分)}` 尾段（pad2 复用 eX）。
//   aX(e)：日期时间 `YYYY-MM-DD HH:MM`（月/日/时/分全 pad2；空值→`-`）。

/** 官方 tX：schedule → cron 表达式（单参；weekly 数值升序——与 describeSchedule 的 $Y 序双形态并存）。 */
export function serializeSchedule(schedule: AutomationSchedule): string {
  const { frequency, hour, minute, weekdays, dayOfMonth, rawExpr } = schedule;
  switch (frequency) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      // 官方：数值升序排序（非 $Y 周一起始序）；空集 → `*`。
      return `${minute} ${hour} * * ${
        weekdays.length > 0 ? [...weekdays].sort((a, b) => a - b).join(",") : "*"
      }`;
    case "monthly":
      return `${minute} ${hour} ${dayOfMonth} * *`;
    case "custom": {
      const interval = Math.max(1, Math.floor(schedule.customInterval));
      if (schedule.customUnit === "minute") {
        return interval <= 59 ? `*/${interval} * * * *` : "* * * * *";
      }
      if (schedule.customUnit === "hourly") {
        return interval <= 24 ? `${minute} */${interval} * * *` : `${minute} * * * *`;
      }
      if (schedule.customUnit === "daily") {
        return interval <= 31 ? `${minute} ${hour} */${interval} * *` : `${minute} ${hour} * * *`;
      }
      if (schedule.customUnit === "weekly") {
        // 官方：原序 join（无排序，与 weekly case 数值升序不同）；空集 → `1` 兜底。
        return `${minute} ${hour} * * ${
          schedule.customWeekdays.length > 0 ? schedule.customWeekdays.join(",") : "1"
        }`;
      }
      if (schedule.customUnit === "monthly") {
        // 官方：weekday 模式走 cron nth-weekday 语法 `DOW#1`；date 模式日列表。
        return schedule.customMonthlyMode === "weekday"
          ? `${minute} ${hour} * * ${schedule.customWeekdays[0] ?? 1}#1`
          : `${minute} ${hour} ${
              schedule.customMonthDays.length > 0 ? schedule.customMonthDays.join(",") : "1"
            } * *`;
      }
      // 官方 yearly：月位 clamp(1..12)；interval 不参与 yearly cron；日位 ?? 今日兜底。
      const month = Math.min(12, Math.max(1, Math.floor(schedule.customMonth)));
      return `${minute} ${hour} ${schedule.customMonthDays[0] ?? new Date().getDate()} ${month} *`;
    }
    default:
      return rawExpr.trim();
  }
}

/** 官方 gUt：UTC 偏移 → `GMT±H[:MM]`（0 → `GMT`；分非零 → pad2 补零尾段）。 */
export function formatGmtOffset(offset: number = -new Date().getTimezoneOffset()): string {
  if (offset === 0) return "GMT";
  const sign = offset > 0 ? "+" : "-";
  const total = Math.abs(offset);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `GMT${sign}${hours}${minutes > 0 ? `:${pad2(minutes)}` : ""}`;
}

/** 官方 aX：时间戳 → `YYYY-MM-DD HH:MM`（空值 → `-`；月/日/时/分全 pad2）。 */
export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}
