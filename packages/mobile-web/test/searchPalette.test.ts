// R3 P3d 首页任务搜索单测（specs/mobile-relay-r3-frontend.md §18 验收「listTaskList 契约
// node 单测（脚本化 accessor）」+ 搜索历史纯函数 + 本地投影过滤纯函数）。覆盖：
// - searchTasks：listTaskList 查询契约形状（kind/sortBy/search/limit + workspaceScopes
//   身份贯穿）、空 query 省略 search 键（host 侧按普通 active 列表收敛）、结果行映射
//   （snippet 优先级/空白归 null/时间防御/标题回退/定位字段）、失败收敛 []；
// - searchHistory：storage 缺失防御、往返、大小写不敏感去重去旧、max 截断（默认 5 与
//   自定义）、脏 JSON / 非数组 / 条目形状不符回空或过滤；
// - collectHomeSearchTasks：首页投影平铺排序（复用官方比较器 updated 降序）、标题大小写
//   不敏感过滤、workspace 身份字段归一携带、limit 截断、空标题回退 taskId。
// 运行：node --import tsx --test packages/mobile-web/test/searchPalette.test.ts
// （node:test + tsx 先例同 organize.test.ts；window.localStorage 以进程内假体注入做往返。）
import assert from "node:assert/strict";
import test from "node:test";
import { searchTasks } from "../src/app/taskSession.js";
import {
  MOBILE_SEARCH_HISTORY_MAX,
  MOBILE_SEARCH_HISTORY_STORAGE_KEY,
  addSearchHistory,
  clearSearchHistory,
  loadSearchHistory,
} from "../src/ui/searchHistory.js";
import { collectHomeSearchTasks } from "../src/ui/TaskSearchPanel.js";
import type { IServiceAccessor } from "@zcode/services";

// —— 脚手架：脚本化 accessor（spec §18 验收口径）与进程内 localStorage 假体 ——

function scriptedAccessor(
  listTaskList: (query: unknown) => Promise<unknown>,
): IServiceAccessor {
  return { windowControllerService: { listTaskList } } as unknown as IServiceAccessor;
}

/** 注入 window.localStorage 假体（返回底层 Map 供脏数据预置），返回卸载函数。 */
function installFakeStorage(): { store: Map<string, string>; uninstall: () => void } {
  const store = new Map<string, string>();
  const fake = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
  };
  (globalThis as { window?: unknown }).window = { localStorage: fake };
  return {
    store,
    uninstall: () => {
      (globalThis as { window?: unknown }).window = undefined;
    },
  };
}

// —— searchTasks：listTaskList 契约 ——

test("searchTasks 契约：kind/sortBy/limit 固定，search trim 后上行，身份随 scope 贯穿", async () => {
  let captured: unknown;
  const accessor = scriptedAccessor(async (query) => {
    captured = query;
    return { items: [], total: 0, hasMore: false };
  });
  const rows = await searchTasks(
    accessor,
    [
      { workspacePath: "C:/g1", workspaceIdentity: "id-g1" },
      { workspacePath: "C:/g2" },
    ],
    "  fix login  ",
  );
  assert.deepEqual(rows, []);
  assert.deepEqual(captured, {
    kind: "active",
    workspaceScopes: [
      { workspacePath: "C:/g1", workspaceIdentity: "id-g1" },
      { workspacePath: "C:/g2" },
    ],
    sortBy: "updated",
    search: "fix login",
    limit: 20,
  });
});

test("searchTasks 契约：空 query 省略 search 键（host 按普通 active 列表收敛）", async () => {
  let captured: unknown;
  const accessor = scriptedAccessor(async (query) => {
    captured = query;
    return { items: [], total: 0, hasMore: false };
  });
  await searchTasks(accessor, [{ workspacePath: "C:/g1" }], "   ");
  assert.deepEqual(captured, {
    kind: "active",
    workspaceScopes: [{ workspacePath: "C:/g1" }],
    sortBy: "updated",
    limit: 20,
  });
});

test("searchTasks 映射：snippet 优先 searchSnippet，回落 searchSnippets[0]，空白归 null", async () => {
  const accessor = scriptedAccessor(async () => ({
    items: [
      {
        taskId: "t1",
        title: "任务一",
        traceId: "trace-1",
        workspacePath: "C:/g1",
        createdAt: 1,
        updatedAt: 100,
        mode: "interactive",
        searchSnippet: "命中片段 A",
      },
      {
        taskId: "t2",
        title: "",
        traceId: "trace-2",
        workspacePath: "C:/g1",
        workspaceIdentity: "id-g1",
        createdAt: 2,
        updatedAt: Number.NaN,
        searchSnippets: ["片段 B1", "片段 B2"],
      },
      {
        taskId: "t3",
        title: "任务三",
        traceId: "trace-3",
        workspacePath: "C:/g2",
        createdAt: 3,
        updatedAt: 300,
        searchSnippet: "   ",
      },
    ],
    total: 3,
    hasMore: false,
  }));
  const rows = await searchTasks(accessor, [{ workspacePath: "C:/g1" }], "x");
  assert.deepEqual(rows, [
    {
      taskId: "t1",
      title: "任务一",
      snippet: "命中片段 A",
      updatedAtMs: 100,
      workspacePath: "C:/g1",
    },
    // 空标题回退 taskId；非有限 updatedAt 归 null；identity 原样透传。
    {
      taskId: "t2",
      title: "t2",
      snippet: "片段 B1",
      updatedAtMs: null,
      workspacePath: "C:/g1",
      workspaceIdentity: "id-g1",
    },
    {
      taskId: "t3",
      title: "任务三",
      snippet: null,
      updatedAtMs: 300,
      workspacePath: "C:/g2",
    },
  ]);
});

test("searchTasks 失败语义：listTaskList 抛错（桥断开/拒绝）→ 返回 [] 不上抛", async () => {
  const accessor = scriptedAccessor(async () => {
    throw new Error("workspace bridge error: attachment-missing");
  });
  assert.deepEqual(await searchTasks(accessor, [{ workspacePath: "C:/g1" }], "x"), []);
});

// —— searchHistory：纯函数防御面与往返 ——

test("搜索历史：storage 缺失（node 无 window）→ 读回空；写入返回内存结果、不持久化不抛", () => {
  assert.deepEqual(loadSearchHistory(MOBILE_SEARCH_HISTORY_STORAGE_KEY), []);
  // 返回值 = 计算后列表（桌面 pushCommandCenterSearchHistory 同语义），存储为 best-effort：
  // 无 storage 时返回值仍可用于回灌 UI state，但后续 load 不回放（未落盘）。
  const after = addSearchHistory(MOBILE_SEARCH_HISTORY_STORAGE_KEY, "alpha");
  assert.deepEqual(
    after.map((entry) => entry.query),
    ["alpha"],
  );
  assert.deepEqual(loadSearchHistory(MOBILE_SEARCH_HISTORY_STORAGE_KEY), []);
});

test("搜索历史：默认键 = ZCode 化单键 zcode-mobile-search-history，默认上限 5", () => {
  assert.equal(MOBILE_SEARCH_HISTORY_STORAGE_KEY, "zcode-mobile-search-history");
  assert.equal(MOBILE_SEARCH_HISTORY_MAX, 5);
});

test("搜索历史：往返（写入后读回同序同形状）", () => {
  const { uninstall } = installFakeStorage();
  try {
    const after = addSearchHistory(MOBILE_SEARCH_HISTORY_STORAGE_KEY, "alpha");
    assert.equal(after.length, 1);
    assert.equal(after[0]?.query, "alpha");
    assert.equal(typeof after[0]?.updatedAt, "number");
    assert.deepEqual(loadSearchHistory(MOBILE_SEARCH_HISTORY_STORAGE_KEY), after);
  } finally {
    uninstall();
  }
});

test("搜索历史：大小写不敏感去重 + 命中条目移到首位（去旧留新）", () => {
  const { uninstall } = installFakeStorage();
  try {
    const key = MOBILE_SEARCH_HISTORY_STORAGE_KEY;
    addSearchHistory(key, "alpha");
    addSearchHistory(key, "beta");
    const after = addSearchHistory(key, "ALPHA ");
    assert.deepEqual(
      after.map((entry) => entry.query),
      ["ALPHA", "beta"],
    );
    assert.deepEqual(loadSearchHistory(key).map((entry) => entry.query), ["ALPHA", "beta"]);
  } finally {
    uninstall();
  }
});

test("搜索历史：默认上限 5，超出去旧（最新在前）", () => {
  const { uninstall } = installFakeStorage();
  try {
    const key = MOBILE_SEARCH_HISTORY_STORAGE_KEY;
    let last: ReturnType<typeof loadSearchHistory> = [];
    for (const query of ["q1", "q2", "q3", "q4", "q5", "q6", "q7"]) {
      last = addSearchHistory(key, query);
    }
    assert.equal(last.length, 5);
    assert.deepEqual(
      last.map((entry) => entry.query),
      ["q7", "q6", "q5", "q4", "q3"],
    );
  } finally {
    uninstall();
  }
});

test("搜索历史：自定义 max 截断（max=2）", () => {
  const { uninstall } = installFakeStorage();
  try {
    const key = "zcode-mobile-search-history:test-custom-max";
    addSearchHistory(key, "a");
    addSearchHistory(key, "b");
    const after = addSearchHistory(key, "c", 2);
    assert.deepEqual(
      after.map((entry) => entry.query),
      ["c", "b"],
    );
  } finally {
    uninstall();
  }
});

test("搜索历史：空白搜索词不入历史（返回现值，不写 storage）", () => {
  const { store, uninstall } = installFakeStorage();
  try {
    const key = MOBILE_SEARCH_HISTORY_STORAGE_KEY;
    addSearchHistory(key, "keep");
    const after = addSearchHistory(key, "   ");
    assert.deepEqual(
      after.map((entry) => entry.query),
      ["keep"],
    );
    assert.equal(store.has(key), true);
  } finally {
    uninstall();
  }
});

test("搜索历史：脏 JSON / 非数组 / 形状不符条目 → 回空或过滤（闭集防御）", () => {
  const { store, uninstall } = installFakeStorage();
  try {
    const key = MOBILE_SEARCH_HISTORY_STORAGE_KEY;
    store.set(key, "{not json");
    assert.deepEqual(loadSearchHistory(key), []);
    store.set(key, JSON.stringify({ query: "a", updatedAt: 1 }));
    assert.deepEqual(loadSearchHistory(key), []);
    store.set(
      key,
      JSON.stringify([
        { query: "ok", updatedAt: 1 },
        "junk",
        null,
        42,
        { query: "", updatedAt: 2 },
        { query: "no-date" },
        { query: "bad-date", updatedAt: Number.NaN },
      ]),
    );
    assert.deepEqual(loadSearchHistory(key), [{ query: "ok", updatedAt: 1 }]);
  } finally {
    uninstall();
  }
});

test("搜索历史：clearSearchHistory 清空；key 缺省用 ZCode 化单键", () => {
  const { uninstall } = installFakeStorage();
  try {
    addSearchHistory("zcode-mobile-search-history:custom", "a");
    clearSearchHistory("zcode-mobile-search-history:custom");
    assert.deepEqual(loadSearchHistory("zcode-mobile-search-history:custom"), []);
    addSearchHistory("zcode-mobile-search-history:default", "b");
    clearSearchHistory("zcode-mobile-search-history:default");
    assert.deepEqual(loadSearchHistory("zcode-mobile-search-history:default"), []);
  } finally {
    uninstall();
  }
});

// —— collectHomeSearchTasks：首页投影本地过滤（host 执行器缺位降级面） ——

const HOME_WORKSPACES = [
  {
    workspaceKey: "id-a",
    path: "C:/a",
    tasks: [
      { sessionId: "t1", title: "Fix login flow", createdAtMs: 10, updatedAtMs: 100 },
      { sessionId: "t2", title: "Add search", createdAtMs: 20, updatedAtMs: 300 },
    ],
  },
  {
    workspaceKey: "C:/b",
    path: "C:/b",
    tasks: [
      { sessionId: "t3", title: "fix login backend", createdAtMs: 30, updatedAtMs: 200 },
    ],
  },
];

test("本地投影：无 query 列最近任务（官方比较器 updated 降序跨工作区平铺）", () => {
  const rows = collectHomeSearchTasks(HOME_WORKSPACES, "");
  assert.deepEqual(
    rows.map((row) => row.taskId),
    ["t2", "t3", "t1"],
  );
  // 身份字段归一携带：workspaceKey 与 path 不同（远程身份）才带 workspaceIdentity。
  assert.equal(rows.find((row) => row.taskId === "t1")?.workspaceIdentity, "id-a");
  assert.equal(rows.find((row) => row.taskId === "t3")?.workspaceIdentity, undefined);
  assert.deepEqual(rows.map((row) => row.workspacePath), ["C:/a", "C:/b", "C:/a"]);
});

test("本地投影：标题大小写不敏感包含过滤 + 结果仍按 updated 降序", () => {
  const rows = collectHomeSearchTasks(HOME_WORKSPACES, "  FIX LOGIN ");
  assert.deepEqual(
    rows.map((row) => row.taskId),
    ["t3", "t1"],
  );
  assert.equal(rows.every((row) => row.snippet === null), true);
});

test("本地投影：limit 截断与空标题回退 taskId", () => {
  const rows = collectHomeSearchTasks(HOME_WORKSPACES, "", 2);
  assert.deepEqual(
    rows.map((row) => row.taskId),
    ["t2", "t3"],
  );
  const untitled = collectHomeSearchTasks(
    [
      {
        workspaceKey: "C:/c",
        path: "C:/c",
        tasks: [{ sessionId: "t9", title: "", createdAtMs: 1, updatedAtMs: 1 }],
      },
    ],
    "",
  );
  assert.equal(untitled[0]?.title, "t9");
});

test("本地投影：空投影 → 空列表（面板呈现空态文案）", () => {
  assert.deepEqual(collectHomeSearchTasks([], ""), []);
});
