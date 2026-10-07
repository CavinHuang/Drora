// R3 P5b 宽视口全壳单测（specs/mobile-relay-r3-frontend.md §19/P5b 验收）：纯函数面
// node:test 直测（先例同 searchPalette.test.ts）。覆盖：
// - 断点判定 isWideViewport：官方字面 query、命中/未命中取反、matchMedia 缺失/抛错
//   回落窄壳（零回归默认）；
// - 侧栏折叠持久化：Drora 化键字面、storage 缺失防御、注入 storage 往返、闭集防御
//   （仅 "1" 视为折叠）；
// - 项目树分组计数：工作区保序分组、任务数/运行中数推导、组内 updated 降序；
// - 问候时段桶：P5b 五桶边界（morning 5-11 / noon 11-13 / afternoon 13-18 /
//   evening 18-23 / lateNight 23-5）与跨天下一边界延迟。
// 运行：node --import tsx --test packages/mobile-web/test/wideShellModel.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_WIDE_BREAKPOINT_QUERY,
  WIDE_SIDEBAR_COLLAPSED_STORAGE_KEY,
  buildSidebarProjectTree,
  isWideViewport,
  loadSidebarCollapsed,
  nextGreetingBoundaryDelayMs,
  resolveGreetingSlot,
  storeSidebarCollapsed,
  type WideShellWorkspace,
} from "../src/ui/wide/wideShellModel.js";

// —— 断点判定（matchMedia mock） ——

test("断点判定：query 为官方字面 (max-width: 767px)（width-only）", () => {
  assert.equal(MOBILE_WIDE_BREAKPOINT_QUERY, "(max-width: 767px)");
});

test("断点判定：query 未命中（≥768px）→ 宽壳；命中（≤767px）→ 窄壳", () => {
  const queries: string[] = [];
  const matchMedia = (query: string) => {
    queries.push(query);
    return { matches: false };
  };
  assert.equal(isWideViewport(matchMedia), true);
  assert.deepEqual(queries, [MOBILE_WIDE_BREAKPOINT_QUERY]);
  assert.equal(
    isWideViewport(() => ({ matches: true })),
    false,
  );
});

test("断点判定：matchMedia 缺失或抛错 → 窄壳（回落单列壳零回归）", () => {
  assert.equal(isWideViewport(null), false);
  assert.equal(isWideViewport(undefined), false);
  assert.equal(
    isWideViewport(() => {
      throw new Error("old webview");
    }),
    false,
  );
  // mql 形状异常（无 matches 字段）按未命中兜底为宽壳之外的安全读取不炸。
  assert.equal(
    isWideViewport(() => ({}) as { matches: boolean }),
    true,
  );
});

// —— 侧栏折叠持久化（注入 storage 往返 + 闭集防御） ——

test("折叠持久化：键为 Drora 化单键 drora-mobile-sidebar-collapsed", () => {
  assert.equal(WIDE_SIDEBAR_COLLAPSED_STORAGE_KEY, "drora-mobile-sidebar-collapsed");
});

test("折叠持久化：storage 缺失（node 无 window）→ 读回展开；写入不抛", () => {
  assert.equal(loadSidebarCollapsed(null), false);
  assert.equal(loadSidebarCollapsed(), false);
  assert.doesNotThrow(() => storeSidebarCollapsed(true, null));
});

test("折叠持久化：注入 storage 往返（true/false 同值读回）", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, value),
  };
  assert.equal(loadSidebarCollapsed(storage), false);
  storeSidebarCollapsed(true, storage);
  assert.equal(store.get(WIDE_SIDEBAR_COLLAPSED_STORAGE_KEY), "1");
  assert.equal(loadSidebarCollapsed(storage), true);
  storeSidebarCollapsed(false, storage);
  assert.equal(store.get(WIDE_SIDEBAR_COLLAPSED_STORAGE_KEY), "0");
  assert.equal(loadSidebarCollapsed(storage), false);
});

test('折叠持久化：脏值闭集防御（仅字面 "1" 视为折叠）', () => {
  const storageOf = (raw: string | null) => ({
    getItem: () => raw,
    setItem: () => undefined,
  });
  assert.equal(loadSidebarCollapsed(storageOf("yes")), false);
  assert.equal(loadSidebarCollapsed(storageOf("true")), false);
  assert.equal(loadSidebarCollapsed(storageOf("")), false);
  assert.equal(loadSidebarCollapsed(storageOf("01")), false);
  assert.equal(loadSidebarCollapsed(storageOf("1")), true);
});

// —— 项目树分组计数 ——

function workspace(
  key: string,
  tasks: Array<{ sessionId: string; updatedAtMs: number | null; status?: "running" | "completed" }>,
): WideShellWorkspace {
  return {
    workspaceKey: key,
    name: `ws-${key}`,
    kind: "local",
    path: `C:/${key}`,
    updatedAtMs: null,
    tasks: tasks.map((task) => ({
      sessionId: task.sessionId,
      title: task.sessionId,
      createdAtMs: null,
      updatedAtMs: task.updatedAtMs,
      status: task.status ?? "completed",
    })),
  };
}

test("项目树：按工作区保序分组，任务数/运行中数自投影推导", () => {
  const groups = buildSidebarProjectTree([
    workspace("a", [
      { sessionId: "a1", updatedAtMs: 100 },
      { sessionId: "a2", updatedAtMs: 300, status: "running" },
    ]),
    workspace("b", []),
  ]);
  assert.deepEqual(
    groups.map((group) => group.workspaceKey),
    ["a", "b"],
  );
  assert.equal(groups[0]?.taskCount, 2);
  assert.equal(groups[0]?.runningCount, 1);
  assert.equal(groups[1]?.taskCount, 0);
  assert.equal(groups[1]?.runningCount, 0);
});

test("项目树：组内任务按 updated 降序（官方比较器同源；null 时间戳排后）", () => {
  const groups = buildSidebarProjectTree([
    workspace("a", [
      { sessionId: "old", updatedAtMs: 10 },
      { sessionId: "new", updatedAtMs: 900, status: "running" },
      { sessionId: "mid", updatedAtMs: 500 },
      { sessionId: "nodate", updatedAtMs: null },
    ]),
  ]);
  assert.deepEqual(
    groups[0]?.tasks.map((task) => task.sessionId),
    ["new", "mid", "old", "nodate"],
  );
});

test("项目树：空投影 → 空树", () => {
  assert.deepEqual(buildSidebarProjectTree([]), []);
});

// —— 问候时段桶（P5b 五桶边界） ——

test("问候时段桶：morning 5-11 / noon 11-13 / afternoon 13-18 / evening 18-23 / lateNight 23-5", () => {
  const expectations: Array<[number, string]> = [
    [4, "lateNight"],
    [5, "morning"],
    [10, "morning"],
    [11, "noon"],
    [12, "noon"],
    [13, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [22, "evening"],
    [23, "lateNight"],
    [0, "lateNight"],
  ];
  for (const [hour, slot] of expectations) {
    assert.equal(resolveGreetingSlot(hour), slot, `hour=${hour}`);
  }
});

test("问候边界延迟：距下一档边界为正且不超过 24h；同档内取最近边界", () => {
  const atNoon = new Date(2026, 8, 29, 12, 30);
  const delayTo13 = nextGreetingBoundaryDelayMs(atNoon);
  assert.equal(delayTo13, 30 * 60 * 1000);
  // 23:30 → 次日 5:00 跨天边界。
  const lateNight = new Date(2026, 8, 29, 23, 30);
  const delayToTomorrow5 = nextGreetingBoundaryDelayMs(lateNight);
  assert.equal(delayToTomorrow5, 5.5 * 60 * 60 * 1000);
  assert.equal(nextGreetingBoundaryDelayMs(new Date(2026, 8, 29, 5, 0)) > 0, true);
});
