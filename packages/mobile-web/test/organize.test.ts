// R3 P3c 整理任务纯函数单测（specs/mobile-relay-r3-frontend.md §16 第 1 条，验收「分桶/排序
// 纯函数单测」）。覆盖：偏好解析闭集校验回默认（parseHomeOrganizePreferences 纯函数直测，
// storage 不注入——node 无 window 时 load 走默认的防御面同测）、任务排序比较器
// （created/updated 降序 + 并列回退另一字段 + 双并列 taskId 后排，官方 Fle :6757 同向）、
// 任务粒度八桶分桶（今天/昨天/更早，固定 now；同 key 非相邻并回首次组，官方 Trn :185188）。
// 运行：node --import tsx --test packages/mobile-web/test/organize.test.ts
// （package.json test 脚本第二条覆盖 test/*.test.ts；node:test + tsx 先例同 timeBuckets.test.ts。）
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HOME_ORGANIZE_PREFERENCES,
  bucketHomeTasksByTime,
  compareHomeTasks,
  loadHomeOrganizePreferences,
  parseHomeOrganizePreferences,
  type HomeOrganizeTask,
} from "../src/ui/OrganizeMenu.js";

/** 本地时区构造（月份 1 基），缺省正午避开夏令时切沿（同 timeBuckets.test.ts）。 */
const at = (year: number, month: number, day: number, hour = 12): number =>
  new Date(year, month - 1, day, hour, 0, 0).getTime();

const task = (
  sessionId: string,
  createdAtMs: number | null,
  updatedAtMs: number | null,
): HomeOrganizeTask => ({
  sessionId,
  createdAtMs,
  updatedAtMs,
});

test("偏好默认值：官方 B0 = { organizeBy: workspace, sortBy: updated }（bundle :185391 取证）", () => {
  assert.deepEqual(DEFAULT_HOME_ORGANIZE_PREFERENCES, {
    organizeBy: "workspace",
    sortBy: "updated",
  });
});

test("偏好解析：两字段闭集内原样通过", () => {
  assert.deepEqual(parseHomeOrganizePreferences({ organizeBy: "workspace", sortBy: "updated" }), {
    organizeBy: "workspace",
    sortBy: "updated",
  });
  assert.deepEqual(parseHomeOrganizePreferences({ organizeBy: "timeline", sortBy: "created" }), {
    organizeBy: "timeline",
    sortBy: "created",
  });
});

test("偏好解析：出闭集/缺键/非对象 → 回默认（官方 Urn/Wrn 同语义）", () => {
  // 出闭集（桌面侧栏的 project/chronological 是另一套值域，不得混入）。
  assert.deepEqual(parseHomeOrganizePreferences({ organizeBy: "project", sortBy: "updated" }), {
    ...DEFAULT_HOME_ORGANIZE_PREFERENCES,
  });
  assert.deepEqual(parseHomeOrganizePreferences({ organizeBy: "workspace", sortBy: "alpha" }), {
    ...DEFAULT_HOME_ORGANIZE_PREFERENCES,
  });
  // 缺键。
  assert.deepEqual(parseHomeOrganizePreferences({ organizeBy: "timeline" }), {
    ...DEFAULT_HOME_ORGANIZE_PREFERENCES,
  });
  assert.deepEqual(parseHomeOrganizePreferences({ sortBy: "created" }), {
    ...DEFAULT_HOME_ORGANIZE_PREFERENCES,
  });
  // 非对象。
  assert.deepEqual(parseHomeOrganizePreferences(null), { ...DEFAULT_HOME_ORGANIZE_PREFERENCES });
  assert.deepEqual(parseHomeOrganizePreferences("workspace"), {
    ...DEFAULT_HOME_ORGANIZE_PREFERENCES,
  });
  assert.deepEqual(parseHomeOrganizePreferences(42), { ...DEFAULT_HOME_ORGANIZE_PREFERENCES });
  assert.deepEqual(parseHomeOrganizePreferences(["workspace"]), {
    ...DEFAULT_HOME_ORGANIZE_PREFERENCES,
  });
});

test("偏好解析：合法输入携带多余键 → 只保留两字段净对象", () => {
  assert.deepEqual(
    parseHomeOrganizePreferences({ organizeBy: "timeline", sortBy: "created", pinned: true }),
    { organizeBy: "timeline", sortBy: "created" },
  );
});

test("偏好读取防御：node 无 window 环境 → 回默认（不抛错）", () => {
  assert.deepEqual(loadHomeOrganizePreferences(), { ...DEFAULT_HOME_ORGANIZE_PREFERENCES });
});

test("排序比较器：created 主键 createdAtMs 降序，并列回退 updatedAtMs 降序", () => {
  const newer = task("t-new", at(2026, 9, 29), at(2026, 9, 28));
  const older = task("t-old", at(2026, 9, 20), at(2026, 9, 29));
  // created：createdAtMs 新者在先（降序），即便 updatedAt 更旧。
  assert.ok(compareHomeTasks(newer, older, "created") < 0);
  assert.ok(compareHomeTasks(older, newer, "created") > 0);
  // 主键并列：updatedAtMs 降序兜底。
  const sameCreatedA = task("a", at(2026, 9, 20), at(2026, 9, 25));
  const sameCreatedB = task("b", at(2026, 9, 20), at(2026, 9, 21));
  assert.ok(compareHomeTasks(sameCreatedA, sameCreatedB, "created") < 0);
});

test("排序比较器：updated 主键 updatedAtMs 降序，并列回退 createdAtMs 降序", () => {
  const newer = task("t-new", at(2026, 9, 1), at(2026, 9, 29));
  const older = task("t-old", at(2026, 9, 28), at(2026, 9, 20));
  assert.ok(compareHomeTasks(newer, older, "updated") < 0);
  const sameUpdatedA = task("a", at(2026, 9, 25), at(2026, 9, 20));
  const sameUpdatedB = task("b", at(2026, 9, 21), at(2026, 9, 20));
  assert.ok(compareHomeTasks(sameUpdatedA, sameUpdatedB, "updated") < 0);
});

test("排序比较器：双并列 → taskId 后排（官方 Fle `t.taskId.localeCompare(e.taskId)` 同向）", () => {
  const a = task("task-a", 100, 100);
  const b = task("task-b", 100, 100);
  // 官方 comparator(e=a, t=b) = b.taskId.localeCompare(a.taskId) = 1 → a 排在 b 后（id 降序）。
  assert.ok(compareHomeTasks(a, b, "created") > 0);
  assert.ok(compareHomeTasks(b, a, "created") < 0);
  assert.equal(compareHomeTasks(a, b, "created"), "task-b".localeCompare("task-a"));
});

test("排序比较器：null/非有限时间戳按 0（最旧）参与降序", () => {
  const withNull = task("t-null", null, null);
  const normal = task("t-normal", at(2026, 9, 1), at(2026, 9, 1));
  assert.ok(compareHomeTasks(normal, withNull, "created") < 0);
  assert.ok(compareHomeTasks(normal, withNull, "updated") < 0);
  // 双 null 与 epoch 0 双并列 → 落到 taskId 兜底，不抛错。
  assert.equal(compareHomeTasks(withNull, withNull, "updated"), 0);
});

test("端到端排序：数组经 compareHomeTasks 排序后首项 = 最新任务", () => {
  const sorted = [
    task("t1", at(2026, 9, 1), at(2026, 9, 1)),
    task("t2", at(2026, 9, 29), at(2026, 9, 29)),
    task("t3", at(2026, 9, 15), at(2026, 9, 20)),
  ].sort((a, b) => compareHomeTasks(a, b, "updated"));
  assert.deepEqual(
    sorted.map((entry) => entry.sessionId),
    ["t2", "t3", "t1"],
  );
});

test("分桶：今天/昨天/更早三桶，桶序 = 排序后首次出现序（now=2026-09-29 固定）", () => {
  const now = at(2026, 9, 29);
  const buckets = bucketHomeTasksByTime(
    [
      task("t-today", at(2026, 9, 29, 9), at(2026, 9, 29, 9)),
      task("t-yesterday", at(2026, 9, 20), at(2026, 9, 28, 10)),
      task("t-older", at(2026, 7, 1), at(2026, 7, 15)),
    ],
    { sortBy: "updated", now, locale: "zh-CN" },
  );
  assert.deepEqual(
    buckets.map((bucket) => [bucket.key, bucket.tasks.map((entry) => entry.sessionId)]),
    [
      ["today", ["t-today"]],
      ["yesterday", ["t-yesterday"]],
      ["older", ["t-older"]],
    ],
  );
  assert.equal(buckets[0]?.label.kind, "today");
  assert.equal(buckets[1]?.label.kind, "yesterday");
  assert.equal(buckets[2]?.label.kind, "older");
});

test("分桶：时间戳随 sortBy 取 createdAt/updatedAt（官方 Trn 同口径）", () => {
  const now = at(2026, 9, 29);
  const entry = task("t-mixed", at(2026, 9, 29, 8), at(2026, 7, 1));
  const byCreated = bucketHomeTasksByTime([entry], { sortBy: "created", now, locale: "zh-CN" });
  assert.equal(byCreated[0]?.key, "today");
  const byUpdated = bucketHomeTasksByTime([entry], { sortBy: "updated", now, locale: "zh-CN" });
  assert.equal(byUpdated[0]?.key, "older");
});

test("分桶：同 key 非相邻任务并回首次组（官方 Trn Map 合并，区别于线性会话分桶）", () => {
  const now = at(2026, 9, 29);
  const buckets = bucketHomeTasksByTime(
    [
      task("t1", at(2026, 9, 1), at(2026, 9, 29, 9)), // today
      task("t2", at(2026, 7, 1), at(2026, 7, 20)), // older
      task("t3", at(2026, 9, 2), at(2026, 9, 29, 8)), // today（非相邻同 key）
    ],
    { sortBy: "updated", now, locale: "zh-CN" },
  );
  assert.deepEqual(
    buckets.map((bucket) => bucket.key),
    ["today", "older"],
  );
  assert.deepEqual(
    buckets[0]?.tasks.map((entry) => entry.sessionId),
    ["t1", "t3"],
  );
  assert.deepEqual(
    buckets[1]?.tasks.map((entry) => entry.sessionId),
    ["t2"],
  );
});

test("分桶：主时间戳缺失 → older 兜底；空输入 → 空桶序列", () => {
  const now = at(2026, 9, 29);
  const buckets = bucketHomeTasksByTime([task("t-null", null, at(2026, 9, 29, 9))], {
    sortBy: "created",
    now,
    locale: "zh-CN",
  });
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]?.key, "older");
  assert.deepEqual(bucketHomeTasksByTime([], { sortBy: "updated", now, locale: "zh-CN" }), []);
});
