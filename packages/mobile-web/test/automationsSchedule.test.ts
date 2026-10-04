import assert from "node:assert/strict";
import test from "node:test";
import { zhCN } from "../src/intl/zh-CN.js";
import {
  WEEKDAY_ORDER,
  defaultSchedule,
  describeCron,
  describeSchedule,
  formatDateTime,
  formatGmtOffset,
  pad2,
  parseCron,
  serializeSchedule,
  weekdayName,
  type AutomationSchedule,
  type FormatMessage,
} from "../src/app/automationsSchedule.js";

// 真实 zh-CN 字典构造 formatMessage（与 IntlProvider 同源插值语义 {name} 逐字替换）。
const fmt: FormatMessage = (descriptor, values) => {
  const template = zhCN[descriptor.id] ?? descriptor.id;
  if (!values) return template;
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
};

const NOW = new Date(2026, 8, 30); // 2026-09（getMonth()+1 = 9，注入 customMonth 断言）

test("eX 补零：官方 String(v).padStart(2,'0')", () => {
  assert.equal(pad2(9), "09");
  assert.equal(pad2(0), "00");
});

test("$Y 官方周一起始序 [1,2,3,4,5,6,0]", () => {
  assert.deepEqual([...WEEKDAY_ORDER], [1, 2, 3, 4, 5, 6, 0]);
});

test("rX 星期名：weekday.{0-6} 官方 zh 逐字（日/一/…/六）", () => {
  assert.equal(weekdayName(0, fmt), "日");
  assert.equal(weekdayName(1, fmt), "一");
  assert.equal(weekdayName(6, fmt), "六");
});

test("iX hourly/daily/weekdays：官方逐字（第 {minute} 分 / 每天 / 每工作日）", () => {
  const schedule = { ...defaultSchedule("30 9 * * *", NOW), hour: 9, minute: 5 };
  assert.equal(describeSchedule({ ...schedule, frequency: "hourly" }, fmt), "每小时的第 05 分");
  assert.equal(describeSchedule({ ...schedule, frequency: "daily" }, fmt), "每天 09:05");
  assert.equal(describeSchedule({ ...schedule, frequency: "weekdays" }, fmt), "每工作日 09:05");
});

test("iX weekly：$Y 序排序 + 硬编码'、'分隔（不走 separator 键）", () => {
  assert.equal(
    describeSchedule(
      {
        ...defaultSchedule("30 9 * * *", NOW),
        hour: 9,
        minute: 5,
        frequency: "weekly",
        weekdays: [3, 1],
      },
      fmt,
    ),
    "每周一、三 09:05",
  );
});

test("iX monthly：{day} 号 + HH:MM", () => {
  assert.equal(
    describeSchedule(
      {
        ...defaultSchedule("30 9 * * *", NOW),
        hour: 9,
        minute: 5,
        frequency: "monthly",
        dayOfMonth: 15,
      },
      fmt,
    ),
    "每月 15 号 09:05",
  );
});

test("iX custom 六子形态：minute/hourly/weekly/monthly×2/yearly/兜底 unit=day", () => {
  const base = {
    ...defaultSchedule("30 9 * * *", NOW),
    hour: 9,
    minute: 5,
    frequency: "custom" as const,
  };
  assert.equal(
    describeSchedule({ ...base, customInterval: 5, customUnit: "minute" }, fmt),
    "每 5 分钟",
  );
  assert.equal(
    describeSchedule({ ...base, customInterval: 2, customUnit: "hourly" }, fmt),
    "每 2 小时的第 05 分",
  );
  assert.equal(
    describeSchedule(
      { ...base, customInterval: 2, customUnit: "weekly", customWeekdays: [5, 1] },
      fmt,
    ),
    // 官方取证：customWeekly 不按 $Y 排序（原序 map），分隔符走 weekday.separator 键
    //（"、"），模板尾段为"，{time}"（与 weekly 硬编码"、"双形态并存）。
    "每 2 周的周五、一，09:05",
  );
  assert.equal(
    describeSchedule(
      {
        ...base,
        customInterval: 2,
        customUnit: "monthly",
        customMonthlyMode: "weekday",
        customWeekdays: [1],
      },
      fmt,
    ),
    "每 2 个月的第一个周一，09:05",
  );
  assert.equal(
    describeSchedule(
      {
        ...base,
        customInterval: 2,
        customUnit: "monthly",
        customMonthlyMode: "date",
        customMonthDays: [1, 15],
      },
      fmt,
    ),
    "每 2 个月的 1, 15 日，09:05",
    "customMonthlyDates join 硬编码', '",
  );
  assert.equal(
    describeSchedule(
      { ...base, customInterval: 1, customUnit: "yearly", customMonth: 3, customMonthDays: [1] },
      fmt,
    ),
    "每 1 年的 3 月 1 日，09:05",
  );
  // 官方兜底：未知 customUnit → unit 固定取 customRepeat.unit.day。
  assert.equal(
    describeSchedule({ ...base, customInterval: 1, customUnit: "quarter" as never }, fmt),
    "每 1 天，09:05",
  );
});

test("iX default → rawExpr 直出（官方兜底）", () => {
  assert.equal(
    describeSchedule(
      {
        ...defaultSchedule("30 9 * * *", NOW),
        frequency: "biweekly" as never,
        rawExpr: "0 12 * * 0",
      },
      fmt,
    ),
    "0 12 * * 0",
  );
});

test("nX 九分支：步进×3 + hourly/daily/weekdays/weekly/yearly/monthly（白名单投影）", () => {
  assert.deepEqual(pick(parseCron("*/5 * * * *", NOW), ["customUnit", "customInterval"]), {
    frequency: "custom",
    customUnit: "minute",
    customInterval: 5,
  });
  assert.deepEqual(
    pick(parseCron("30 */2 * * *", NOW), ["minute", "customUnit", "customInterval"]),
    { frequency: "custom", minute: 30, customUnit: "hourly", customInterval: 2 },
  );
  assert.deepEqual(
    pick(parseCron("15 9 */3 * *", NOW), ["hour", "minute", "customUnit", "customInterval"]),
    { frequency: "custom", hour: 9, minute: 15, customUnit: "daily", customInterval: 3 },
  );
  assert.deepEqual(pick(parseCron("30 * * * *", NOW), ["minute"]), {
    frequency: "hourly",
    minute: 30,
  });
  assert.deepEqual(pick(parseCron("30 9 * * *", NOW), ["hour", "minute"]), {
    frequency: "daily",
    hour: 9,
    minute: 30,
  });
  assert.deepEqual(pick(parseCron("30 9 * * 1-5", NOW), ["hour", "minute"]), {
    frequency: "weekdays",
    hour: 9,
    minute: 30,
  });
  assert.deepEqual(pick(parseCron("30 9 * * 1,3,5", NOW), ["hour", "minute", "weekdays"]), {
    frequency: "weekly",
    hour: 9,
    minute: 30,
    weekdays: [1, 3, 5],
  });
  assert.deepEqual(
    pick(parseCron("0 9 1 3 *", NOW), [
      "hour",
      "minute",
      "customUnit",
      "customMonth",
      "customMonthDays",
    ]),
    {
      frequency: "custom",
      hour: 9,
      minute: 0,
      customUnit: "yearly",
      customMonth: 3,
      customMonthDays: [1],
    },
  );
  assert.deepEqual(pick(parseCron("30 9 15 * *", NOW), ["hour", "minute", "dayOfMonth"]), {
    frequency: "monthly",
    hour: 9,
    minute: 30,
    dayOfMonth: 15,
  });
});

test("nX 边界：非 5 段→默认形状；weekday 无效值过滤；yearly 先于 monthly", () => {
  const fallback = parseCron("abc", NOW);
  assert.equal(fallback.frequency, "custom");
  assert.equal(fallback.customUnit, "daily");
  assert.equal(fallback.hour, 9);
  assert.equal(fallback.minute, 0);
  assert.equal(fallback.rawExpr, "abc");
  assert.equal(fallback.customMonth, 9, "customMonth = now.getMonth()+1");
  // weekday 值过滤：1 有效、9 越界剔除 → weekly [1]。
  assert.deepEqual(pick(parseCron("30 9 * * 1,9", NOW), ["hour", "minute", "weekdays"]), {
    frequency: "weekly",
    hour: 9,
    minute: 30,
    weekdays: [1],
  });
  // 全无效（7 越界）→ 空数组 → 不进 weekly，day/month 均 * → 落默认形状。
  assert.equal(parseCron("30 9 * * 7", NOW).frequency, "custom");
});

test("mUt 三形态：*/N 直译 / 分时日月四数字→自定义键 / 其余 nX+iX", () => {
  assert.equal(describeCron("*/5 * * * *", fmt), "每 5 分钟");
  // 官方早退正则 /^\d+ \d+ \d+ \d+ \*$/：分/时/日/**月**四段全数字（月字段非 *）→ 自定义键。
  assert.equal(describeCron("30 9 15 6 *", fmt), "自定义");
  assert.equal(
    describeCron("30 9 15 * *", fmt),
    "每月 15 号 09:30",
    "月=* 不早退，走 nX→monthly→iX",
  );
  assert.equal(describeCron("30 9 * * 1-5", fmt), "每工作日 09:30");
});

/** 断言投影（白名单模式：每分支显式声明关心键；不做默认值剔除——解析结果可与默认形状同值）。 */
function pick(
  schedule: AutomationSchedule,
  keys: readonly (keyof AutomationSchedule)[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { frequency: schedule.frequency };
  for (const key of keys) out[key] = schedule[key];
  return out;
}

// —— P6 续还原（第二轮取证 22/22）：tX/gUt/aX 三件套官方逐字节断言 ——

// defaultSchedule 返回官方默认形状（minute:0 硬编码、**不解析** rawExpr——cron 解析归 nX）。
// tX 断言基座显式补 hour/minute，使序列化输出与断言文案的 "30 9" 分时位对齐。
const txBase = { ...defaultSchedule("30 9 * * *", NOW), hour: 9, minute: 30 };

test("tX 五基础频率：官方逐字节形态", () => {
  assert.equal(serializeSchedule({ ...txBase, frequency: "hourly" }), "30 * * * *");
  assert.equal(serializeSchedule({ ...txBase, frequency: "daily" }), "30 9 * * *");
  assert.equal(serializeSchedule({ ...txBase, frequency: "weekdays" }), "30 9 * * 1-5");
  assert.equal(
    serializeSchedule({ ...txBase, frequency: "weekly", weekdays: [1, 3, 5] }),
    "30 9 * * 1,3,5",
  );
  assert.equal(serializeSchedule({ ...txBase, frequency: "weekly", weekdays: [] }), "30 9 * * *");
  assert.equal(
    serializeSchedule({ ...txBase, frequency: "monthly", dayOfMonth: 15 }),
    "30 9 15 * *",
  );
});

test("tX weekly 数值升序（与 describeSchedule $Y 序双形态并存实锤）", () => {
  assert.equal(
    serializeSchedule({ ...txBase, frequency: "weekly", weekdays: [5, 1, 3] }),
    "30 9 * * 1,3,5",
  );
  assert.equal(
    describeSchedule({ ...txBase, frequency: "weekly", weekdays: [0, 6] }, fmt),
    "每周六、日 09:30",
    "$Y 序：6(六) 先于 0(日)；时/分走 pad2（txBase minute=30）",
  );
});

test("tX custom 六子：步进越界退化全通配 + weekly 原序 + nth/dates/yearly", () => {
  assert.equal(
    serializeSchedule({ ...txBase, frequency: "custom", customInterval: 5, customUnit: "minute" }),
    "*/5 * * * *",
  );
  assert.equal(
    serializeSchedule({ ...txBase, frequency: "custom", customInterval: 60, customUnit: "minute" }),
    "* * * * *",
    "官方越界守卫 t<=59 → 全通配",
  );
  assert.equal(
    serializeSchedule({
      ...txBase,
      frequency: "custom",
      customInterval: 25,
      customUnit: "hourly",
      minute: 30,
    }),
    "30 * * * *", // 官方越界守卫 t<=24 → 全通配退化
  );
  assert.equal(
    serializeSchedule({ ...txBase, frequency: "custom", customInterval: 32, customUnit: "daily" }),
    "30 9 * * *",
    "官方越界守卫 t<=31",
  );
  assert.equal(
    serializeSchedule({
      ...txBase,
      frequency: "custom",
      customInterval: 2,
      customUnit: "weekly",
      customWeekdays: [5, 1],
    }),
    "30 9 * * 5,1",
    "customWeekly 官方原序（无排序）",
  );
  assert.equal(
    serializeSchedule({
      ...txBase,
      frequency: "custom",
      customInterval: 1,
      customUnit: "weekly",
      customWeekdays: [],
    }),
    "30 9 * * 1",
    "空集 → 1 兜底",
  );
  assert.equal(
    serializeSchedule({
      ...txBase,
      frequency: "custom",
      customInterval: 1,
      customUnit: "monthly",
      customMonthlyMode: "weekday",
      customWeekdays: [5],
    }),
    "30 9 * * 5#1",
    "官方 nth-weekday 语法 DOW#1",
  );
  assert.equal(
    serializeSchedule({
      ...txBase,
      frequency: "custom",
      customInterval: 1,
      customUnit: "monthly",
      customMonthlyMode: "date",
      customMonthDays: [1, 15],
    }),
    "30 9 1,15 * *",
  );
  assert.equal(
    serializeSchedule({
      ...txBase,
      frequency: "custom",
      customInterval: 1,
      customUnit: "yearly",
      customMonth: 15,
      customMonthDays: [1],
    }),
    "30 9 1 12 *",
    "官方月位 clamp(1..12) + interval 不参与 yearly",
  );
});

test("tX default → rawExpr.trim()（官方兜底）", () => {
  assert.equal(
    serializeSchedule({ ...txBase, frequency: "biweekly" as never, rawExpr: "  0 12 * * 0  " }),
    "0 12 * * 0",
  );
});

test("gUt 三态：GMT / GMT+8 / GMT-5:30（分非零 pad2 尾段）", () => {
  assert.equal(formatGmtOffset(0), "GMT");
  assert.equal(formatGmtOffset(480), "GMT+8");
  assert.equal(formatGmtOffset(-330), "GMT-5:30");
});

test("aX 日期时间：YYYY-MM-DD HH:MM 全 pad2 + 空值 → `-`", () => {
  assert.equal(formatDateTime(new Date(2026, 8, 30, 9, 5).getTime()), "2026-09-30 09:05");
  assert.equal(formatDateTime(null), "-");
  assert.equal(formatDateTime(0), "-");
});

test("roundtrip：nX→tX 对五基础频率 + 步进三分支恒等（hUt 官方往返语义）", () => {
  for (const expr of [
    "30 * * * *",
    "30 9 * * *",
    "30 9 * * 1-5",
    "30 9 15 * *",
    "*/5 * * * *",
    "30 */2 * * *",
    "30 9 */3 * *",
  ]) {
    assert.equal(serializeSchedule(parseCron(expr, NOW)), expr, `roundtrip: ${expr}`);
  }
});
