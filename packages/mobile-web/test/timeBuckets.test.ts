// R3 P3a 分桶边界单测（specs/mobile-relay-r3-frontend.md §14 第 2 条）。
// 覆盖：今天/昨天/3 天前窗口、跨周（zh-CN 周一起 vs en-US 周日起的 startOfWeek 分歧）、
// 跨月、更早兜底、未来时间戳归 today；行归属（turnHeader.startedAt、前缀行归首个已见桶、
// 无 turnHeader 兜底 older、线性相邻分组不回并）。now 全部注入固定本地时间，测试与时区无关。
// 运行：node --import tsx --test packages/mobile-web/test/timeBuckets.test.ts
// （package.json test 脚本第二条已覆盖 test/*.test.ts；测试放 test/ 不进 tsc -b 的 src 构建，
// 与 services/relay-client 的 node:test+tsx 先例一致——mobile-web 无 @types/node 依赖面。）
import assert from "node:assert/strict";
import test from "node:test";
import {
  bucketConversationRows,
  resolveTaskTimelineBucketLabel,
  serializeTaskTimelineBucketLabel,
  taskTimelineBucketMessage,
  type TimelineBucketingRow,
} from "../src/ui/timeBuckets.js";

/** 本地时区构造（月份 1 基），缺省正午避开夏令时切沿。 */
const at = (year: number, month: number, day: number, hour = 12): number =>
  new Date(year, month - 1, day, hour, 0, 0).getTime();

const row = (rowId: number, kind: string, startedAt?: number): TimelineBucketingRow => ({
  rowId,
  kind,
  ...(startedAt === undefined ? {} : { startedAt }),
});

test("桶边界：今天 / 未来时间戳 / 昨天（now=2026-09-29 周二）", () => {
  const now = at(2026, 9, 29);
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 29, 9), now, "zh-CN").kind, "today");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 29, 23), now, "zh-CN").kind, "today");
  // 未来时间戳 dayDiff<0：上游 dayDiff<=0 → today。
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 30, 8), now, "zh-CN").kind, "today");
  // dayDiff===1 不看时刻：昨晚 23 点与今晨 0 点附近都算昨天（上游同边界）。
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 28, 23), now, "zh-CN").kind, "yesterday");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 28, 0), now, "zh-CN").kind, "yesterday");
});

test("桶边界：2/3 天前窗口（dayDiff 2..3），4 天前跌出窗口", () => {
  const now = at(2026, 9, 29);
  const twoDays = resolveTaskTimelineBucketLabel(at(2026, 9, 27), now, "zh-CN");
  assert.deepEqual(twoDays, { kind: "daysAgo", daysAgo: 2 });
  const threeDays = resolveTaskTimelineBucketLabel(at(2026, 9, 26), now, "zh-CN");
  assert.deepEqual(threeDays, { kind: "daysAgo", daysAgo: 3 });
  assert.equal(serializeTaskTimelineBucketLabel(threeDays), "daysAgo:3");
  // dayDiff=4：不再 daysAgo，落入周桶（周二 now 的 zh-CN 本周一起 09-28，09-25 归上周）。
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 25), now, "zh-CN").kind, "lastWeek");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 25), now, "en-US").kind, "lastWeek");
});

test("桶边界：跨周——startOfWeek 分歧（now=2026-10-08 周四；en-US 周日起、zh-CN 周一起）", () => {
  const now = at(2026, 10, 8);
  // 周窗口内日期先被今天/昨天/daysAgo 吸收。
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 10, 8), now, "zh-CN").kind, "today");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 10, 7), now, "zh-CN").kind, "yesterday");
  assert.deepEqual(resolveTaskTimelineBucketLabel(at(2026, 10, 6), now, "en-US"), {
    kind: "daysAgo",
    daysAgo: 2,
  });
  assert.deepEqual(resolveTaskTimelineBucketLabel(at(2026, 10, 5), now, "zh-CN"), {
    kind: "daysAgo",
    daysAgo: 3,
  });
  // 同一时间戳 10-04（周日）：en-US 本周从 10-04 起算 → thisWeek；zh-CN 本周从 10-05 起算 → lastWeek。
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 10, 4), now, "en-US").kind, "thisWeek");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 10, 4), now, "zh-CN").kind, "lastWeek");
  // 10-03（周六）：两 locale 都归上周。
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 10, 3), now, "en-US").kind, "lastWeek");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 10, 3), now, "zh-CN").kind, "lastWeek");
  // 09-27（周日）：en-US 上周窗口含它（上周日=09-27）；zh-CN 已跌出上月窗口前 → lastMonth。
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 27), now, "en-US").kind, "lastWeek");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 27), now, "zh-CN").kind, "lastMonth");
});

test("桶边界：跨月与更早（now=2026-10-29 周四）", () => {
  const now = at(2026, 10, 29);
  // 本周内近 3 天仍优先 daysAgo（10-26 周一 = dayDiff 3，不因跨周切 thisWeek）。
  assert.deepEqual(resolveTaskTimelineBucketLabel(at(2026, 10, 26), now, "zh-CN"), {
    kind: "daysAgo",
    daysAgo: 3,
  });
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 10, 10), now, "zh-CN").kind, "thisMonth");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 9, 15), now, "zh-CN").kind, "lastMonth");
  assert.equal(resolveTaskTimelineBucketLabel(at(2026, 8, 20), now, "zh-CN").kind, "older");
  assert.equal(resolveTaskTimelineBucketLabel(at(2025, 1, 1), now, "en-US").kind, "older");
});

test("桶文案：daysAgo 携带 {days} 占位，其余为 kind 直映官方键", () => {
  assert.deepEqual(taskTimelineBucketMessage({ kind: "daysAgo", daysAgo: 2 }), {
    id: "taskTimeline.daysAgo",
    values: { days: "2" },
  });
  assert.deepEqual(taskTimelineBucketMessage({ kind: "today" }), { id: "taskTimeline.today" });
  assert.deepEqual(taskTimelineBucketMessage({ kind: "older" }), { id: "taskTimeline.older" });
});

test("行归属：相邻行跟随前方最近 turnHeader，按 startedAt 落桶", () => {
  const now = at(2026, 9, 29);
  const buckets = bucketConversationRows(
    [
      row(1, "turnHeader", at(2026, 9, 29, 9)),
      row(2, "userInput"),
      row(3, "assistantText"),
      row(4, "turnHeader", at(2026, 9, 28, 10)),
      row(5, "toolCall"),
    ],
    { now, locale: "zh-CN" },
  );
  assert.deepEqual(
    buckets.map((bucket) => [bucket.key, bucket.rows.map((r) => r.rowId)]),
    [
      ["today", [1, 2, 3]],
      ["yesterday", [4, 5]],
    ],
  );
  assert.equal(buckets[1]?.label.kind, "yesterday");
});

test("行归属：无 turnHeader 前缀行并入首个已见桶（同 key 相邻段就地合并）", () => {
  const now = at(2026, 9, 29);
  const buckets = bucketConversationRows(
    [
      row(1, "timelineMarker"),
      row(2, "userInput"),
      row(3, "turnHeader", at(2026, 9, 29, 9)),
      row(4, "assistantText"),
    ],
    { now, locale: "zh-CN" },
  );
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]?.key, "today");
  assert.deepEqual(
    buckets[0]?.rows.map((r) => r.rowId),
    [1, 2, 3, 4],
  );
});

test("行归属：全程无 turnHeader → 整段 older 兜底", () => {
  const now = at(2026, 9, 29);
  const buckets = bucketConversationRows([row(1, "userInput"), row(2, "assistantText")], {
    now,
    locale: "en-US",
  });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]?.key, "older");
  assert.equal(buckets[0]?.label.kind, "older");
});

test("行归属：线性相邻分组——today→yesterday→today 不回并先前组", () => {
  const now = at(2026, 9, 29);
  const buckets = bucketConversationRows(
    [
      row(1, "turnHeader", at(2026, 9, 29, 9)),
      row(2, "turnHeader", at(2026, 9, 28, 10)),
      row(3, "turnHeader", at(2026, 9, 29, 11)),
    ],
    { now, locale: "zh-CN" },
  );
  assert.deepEqual(
    buckets.map((bucket) => bucket.key),
    ["today", "yesterday", "today"],
  );
});

test("行归属：空输入 → 空桶序列；缺 startedAt 的 turnHeader 按普通行跟随当前桶", () => {
  const now = at(2026, 9, 29);
  assert.deepEqual(bucketConversationRows([], { now, locale: "zh-CN" }), []);
  const buckets = bucketConversationRows(
    [row(1, "turnHeader"), row(2, "turnHeader", at(2026, 9, 29, 9))],
    { now, locale: "zh-CN" },
  );
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]?.key, "today");
});
