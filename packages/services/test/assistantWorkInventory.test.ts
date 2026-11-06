/**
 * P8 全域工作台账 host 侧单测（09 详设 §1.8 v2 落点标注）：
 * - workInventory 纯函数矩阵：bootstrap 集合推导（工单 ∪ tasks-index/14d 窗/去重/
 *   截断界）/订阅集对账（补订阅/LRU 退订界）/三源合并（分组/managed/有界/幂等）；
 * - 快照 inventory 投影/缺席语义（buildAssistantSnapshot extras + 服务 publish 读
 *   provider，provider null/抛错=整体缺席）；
 * - 刷新环路节流（refreshInventory 前沿节流 + 尾沿补一拍，kv 可调）。
 * 登记清单：scripts/drora-isolated-test-files.json（照 mateWatchdogCron.test 先例）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_INVENTORY_DEFAULTS,
  ASSISTANT_SNAPSHOT_LIMITS,
  mateWorkInventorySchema,
} from "@drora/shared";
import {
  assembleWorkInventory,
  deriveInventoryBootstrapTargets,
  reconcileInventoryTargets,
  type WorkInventoryOffpeakTaskRow,
  type WorkInventorySessionRow,
  type WorkInventoryTicketRow,
} from "../src/assistant-tickets/workInventory.js";
import { setAssistantInventoryProvider } from "../src/assistant-tickets/assistantPorts.js";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { buildAssistantSnapshot } from "../src/assistant-tickets/assistantSnapshot.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  ASSISTANT_KV_KEYS,
  readAssistantConfig,
} from "../src/assistant-tickets/assistantConfig.js";

const DAY = 24 * 60 * 60 * 1000;

function ticketRow(overrides: Partial<WorkInventoryTicketRow> = {}): WorkInventoryTicketRow {
  return {
    ticketId: "t1",
    title: "修复登录页",
    status: "running",
    targetWorkspaceIdentity: "D:/ws/a",
    sessionId: null,
    hostPath: null,
    updatedAtMs: 1000,
    staleSinceMs: null,
    ...overrides,
  };
}

function sessionRow(overrides: Partial<WorkInventorySessionRow> = {}): WorkInventorySessionRow {
  return {
    sessionId: "s1",
    title: "会话一",
    phase: "working",
    sessionEnded: false,
    updatedAtMs: 1000,
    ...overrides,
  };
}

function offpeakRow(
  overrides: Partial<WorkInventoryOffpeakTaskRow> = {},
): WorkInventoryOffpeakTaskRow {
  return {
    taskId: "op1",
    title: "夜间回归",
    workspacePath: "D:/ws/a",
    updatedAtMs: 1000,
    ...overrides,
  };
}

afterEach(() => {
  // 模块级 provider 端口复位（防泄漏进其它用例/文件）。
  setAssistantInventoryProvider(null);
  vi.useRealTimers();
});

describe("deriveInventoryBootstrapTargets（09 §1.3 步 1：工单 ∪ 项目集）", () => {
  it("14d 窗外的工单不进集合；窗内工单 target 进集合", () => {
    const now = 100 * DAY;
    const targets = deriveInventoryBootstrapTargets({
      tickets: [
        ticketRow({
          ticketId: "fresh",
          targetWorkspaceIdentity: "D:/ws/a",
          updatedAtMs: now - DAY,
        }),
        ticketRow({
          ticketId: "stale",
          targetWorkspaceIdentity: "D:/ws/old",
          updatedAtMs: now - 15 * DAY,
        }),
      ],
      offpeakTasks: [],
      nowMs: now,
      windowMs: ASSISTANT_INVENTORY_DEFAULTS.bootstrapTicketWindowMs,
      setMax: 16,
    });
    expect(targets).toEqual([{ identity: "D:/ws/a" }]);
  });

  it("工单 hostPath 精确进订阅目标（incarnation 落位）", () => {
    const targets = deriveInventoryBootstrapTargets({
      tickets: [
        ticketRow({ targetWorkspaceIdentity: "D:/ws/a", hostPath: "D:/ws/a/.drora/mate/t1" }),
      ],
      offpeakTasks: [],
      nowMs: 2000,
      windowMs: 14 * DAY,
      setMax: 16,
    });
    expect(targets).toEqual([{ identity: "D:/ws/a", hostPath: "D:/ws/a/.drora/mate/t1" }]);
  });

  it("tasks-index 项目集并集：无 identity 的行按路径回落（AGENTS 键规则）", () => {
    const targets = deriveInventoryBootstrapTargets({
      tickets: [ticketRow({ targetWorkspaceIdentity: "D:/ws/a" })],
      offpeakTasks: [
        offpeakRow({ workspacePath: "D:/ws/b", workspaceIdentity: undefined }),
        offpeakRow({ workspacePath: "D:/ws/c", workspaceIdentity: "ident-c" }),
      ],
      nowMs: 2000,
      windowMs: 14 * DAY,
      setMax: 16,
    });
    expect(targets).toEqual([
      expect.objectContaining({ identity: "D:/ws/a" }),
      expect.objectContaining({ identity: "D:/ws/b", hostPath: "D:/ws/b" }),
      expect.objectContaining({ identity: "ident-c", hostPath: "D:/ws/c" }),
    ]);
  });

  it("(identity, hostPath) 相同的目标去重且 recency 取 max；超 setMax 按最近活动截断", () => {
    const targets = deriveInventoryBootstrapTargets({
      tickets: [
        ticketRow({ ticketId: "t1", targetWorkspaceIdentity: "D:/ws/a", updatedAtMs: 100 }),
        ticketRow({ ticketId: "t2", targetWorkspaceIdentity: "D:/ws/a", updatedAtMs: 500 }),
        ticketRow({ ticketId: "t3", targetWorkspaceIdentity: "D:/ws/b", updatedAtMs: 300 }),
      ],
      offpeakTasks: [],
      nowMs: 10 * DAY,
      windowMs: 14 * DAY,
      setMax: 1,
    });
    // D:/ws/a recency=500 > D:/ws/b 300，界 1 只留 a。
    expect(targets).toEqual([{ identity: "D:/ws/a" }]);
  });
});

describe("reconcileInventoryTargets（09 §1.3 步 3：补订阅 + LRU 退订界）", () => {
  const keyOf = (identity: string, hostPath?: string) => `${identity}\u0000${hostPath ?? ""}`;

  it("desired 缺者补订阅；未超界不退订", () => {
    const plan = reconcileInventoryTargets({
      desired: [{ identity: "D:/ws/a" }, { identity: "D:/ws/b", hostPath: "D:/ws/b" }],
      current: new Map([[keyOf("D:/ws/a"), 100]]),
      setMax: 16,
    });
    expect(plan.subscribe).toEqual([{ identity: "D:/ws/b", hostPath: "D:/ws/b" }]);
    expect(plan.evictKeys).toEqual([]);
  });

  it("超界只退 desired 之外最久未活动者；desired 域不被挤掉", () => {
    const desired = [{ identity: "D:/ws/new" }];
    const current = new Map([
      [keyOf("D:/ws/old1"), 100], // 最久未活动
      [keyOf("D:/ws/old2"), 200],
      [keyOf("D:/ws/keep"), 300], // desired 之外但较新
    ]);
    const plan = reconcileInventoryTargets({ desired, current, setMax: 3 });
    // 3+1=4 > 3 → 退 1 个：extras 中 LRU=old1。
    expect(plan.subscribe).toEqual([{ identity: "D:/ws/new" }]);
    expect(plan.evictKeys).toEqual([keyOf("D:/ws/old1")]);
  });
});

describe("assembleWorkInventory（09 §1.4：合并/managed/有界/幂等）", () => {
  it("三源合并进同一 workspace 组；无目标工单不产出", () => {
    const view = assembleWorkInventory({
      tickets: [
        ticketRow({ ticketId: "t1", targetWorkspaceIdentity: "D:/ws/a", updatedAtMs: 900 }),
        ticketRow({ ticketId: "t-none", targetWorkspaceIdentity: null }),
      ],
      sessionGroups: [
        {
          identity: "D:/ws/a",
          sessions: [sessionRow({ sessionId: "s1", updatedAtMs: 800 })],
        },
      ],
      offpeakTasks: [offpeakRow({ taskId: "op1", workspacePath: "D:/ws/a", updatedAtMs: 700 })],
      activeTicketSessionIds: new Set(),
    });
    expect(view.workspaces).toHaveLength(1);
    expect(view.workspaces[0]?.key).toBe("D:/ws/a");
    expect(view.workspaces[0]?.rows.map((row) => row.kind)).toEqual([
      "ticket",
      "session",
      "offpeak",
    ]);
  });

  it("managed 标记：sessionId ∈ 活动工单集 → true；未命中不携带", () => {
    const view = assembleWorkInventory({
      tickets: [],
      sessionGroups: [
        {
          identity: "D:/ws/a",
          sessions: [
            sessionRow({ sessionId: "mate-s", updatedAtMs: 900 }),
            sessionRow({ sessionId: "user-s", updatedAtMs: 800 }),
          ],
        },
      ],
      offpeakTasks: [],
      activeTicketSessionIds: new Set(["mate-s"]),
    });
    const rows = view.workspaces[0]?.rows ?? [];
    expect(rows[0]).toMatchObject({ kind: "session", sessionId: "mate-s", managed: true });
    expect(rows[1]).toMatchObject({ kind: "session", sessionId: "user-s" });
    expect("managed" in (rows[1] ?? {})).toBe(false);
  });

  it("有界截断：workspace ≤6、行全局预算 ≤20（最近组优先，耗尽的组丢弃）", () => {
    const tickets: WorkInventoryTicketRow[] = [];
    for (let index = 0; index < 10; index += 1) {
      // 10 个 workspace，各 1 行；最近活动的 6 个在视图内。
      tickets.push(
        ticketRow({
          ticketId: `t${index}`,
          targetWorkspaceIdentity: `D:/ws/${index}`,
          updatedAtMs: 1000 + index,
        }),
      );
    }
    const view = assembleWorkInventory({
      tickets,
      sessionGroups: [],
      offpeakTasks: [],
      activeTicketSessionIds: new Set(),
    });
    expect(view.workspaces).toHaveLength(ASSISTANT_SNAPSHOT_LIMITS.inventoryWorkspaceMax);
    expect(view.workspaces[0]?.key).toBe("D:/ws/9"); // recency=1009 最新在前
    expect(view.workspaces[5]?.key).toBe("D:/ws/4");

    // 行预算：6 个 workspace 各 4 行=24 > 20 → 最近组拿满，最末组丢行。
    const groups = [9, 8, 7, 6, 5, 4].map((index) => ({
      identity: `D:/ws/${index}`,
      sessions: [0, 1, 2, 3].map((sub) =>
        sessionRow({ sessionId: `s-${index}-${sub}`, updatedAtMs: 2000 - sub }),
      ),
    }));
    const bounded = assembleWorkInventory({
      tickets: [],
      sessionGroups: groups,
      offpeakTasks: [],
      activeTicketSessionIds: new Set(),
    });
    const totalRows = bounded.workspaces.reduce((sum, workspace) => sum + workspace.rows.length, 0);
    expect(totalRows).toBe(ASSISTANT_SNAPSHOT_LIMITS.inventoryRowMax);
    // 前 4 组各拿满 4 行，第 5 组得剩余 4 行，第 6 组 0 行 → 丢弃（不出现零行组）。
    expect(bounded.workspaces).toHaveLength(5);
    expect(bounded.workspaces.at(-1)?.rows.length).toBe(4);
  });

  it("标题截断到 inventoryTitleMax；teamStatus 投影进会话行", () => {
    const longTitle = "长".repeat(300);
    const view = assembleWorkInventory({
      tickets: [ticketRow({ title: longTitle, updatedAtMs: 2000 })],
      sessionGroups: [{ identity: "D:/ws/a", sessions: [sessionRow({ teamStatus: "running" })] }],
      offpeakTasks: [],
      activeTicketSessionIds: new Set(),
    });
    expect(view.workspaces[0]?.rows[0]).toMatchObject({
      kind: "ticket",
      title: "长".repeat(ASSISTANT_SNAPSHOT_LIMITS.inventoryTitleMax),
    });
    expect(view.workspaces[0]?.rows[1]).toMatchObject({ kind: "session", teamStatus: "running" });
  });

  it("组序=最近活动 desc、行序=updatedAtMs desc；同输入幂等；输出过 contract schema", () => {
    const build = () =>
      assembleWorkInventory({
        tickets: [
          ticketRow({ ticketId: "t-b", targetWorkspaceIdentity: "D:/ws/b", updatedAtMs: 500 }),
          ticketRow({ ticketId: "t-a", targetWorkspaceIdentity: "D:/ws/b", updatedAtMs: 900 }),
          ticketRow({ ticketId: "t-c", targetWorkspaceIdentity: "D:/ws/a", updatedAtMs: 100 }),
        ],
        sessionGroups: [
          { identity: "D:/ws/a", sessions: [sessionRow({ sessionId: "s-a", updatedAtMs: 1200 })] },
        ],
        offpeakTasks: [],
        activeTicketSessionIds: new Set(),
      });
    const first = build();
    expect(first).toEqual(build());
    // b 组 recency=900 > a 组 1200? a 的会话行 1200 更新 → a 组在前。
    expect(first.workspaces[0]?.key).toBe("D:/ws/a");
    expect(first.workspaces[1]?.rows.map((row) => ("ticketId" in row ? row.ticketId : ""))).toEqual(
      ["t-a", "t-b"],
    );
    expect(mateWorkInventorySchema.safeParse(first).success).toBe(true);
  });
});

describe("快照 inventory 投影/缺席语义（09 §1.2：全有或全无）", () => {
  it("buildAssistantSnapshot：extras.inventory 有值挂载、缺席不携带", () => {
    const db = openAssistantDatabase(":memory:");
    try {
      const config = readAssistantConfig(db.raw, "local-user");
      const view = assembleWorkInventory({
        tickets: [ticketRow()],
        sessionGroups: [],
        offpeakTasks: [],
        activeTicketSessionIds: new Set(),
      });
      const withInventory = buildAssistantSnapshot(db.raw, config, { inventory: view });
      expect(withInventory.inventory).toEqual(view);
      const without = buildAssistantSnapshot(db.raw, config, {});
      expect("inventory" in without).toBe(false);
      const explicitNull = buildAssistantSnapshot(db.raw, config, { inventory: null });
      expect("inventory" in explicitNull).toBe(false);
    } finally {
      db.close();
    }
  });

  it("服务 publish 读 provider：视图挂载 / null 缺席 / 抛错缺席且 publish 照旧", async () => {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: "local-user",
      database: db,
    });
    try {
      const snapshots: unknown[] = [];
      service.onDidChange((snapshot) => snapshots.push(snapshot));
      const view = assembleWorkInventory({
        tickets: [],
        sessionGroups: [{ identity: "D:/ws/a", sessions: [sessionRow()] }],
        offpeakTasks: [],
        activeTicketSessionIds: new Set(),
      });
      setAssistantInventoryProvider(() => view);
      await service.setMode("observe");
      let last = snapshots.at(-1) as { inventory?: unknown } | undefined;
      expect(last?.inventory).toEqual(view);

      setAssistantInventoryProvider(() => null);
      await service.setMode("off");
      last = snapshots.at(-1) as { inventory?: unknown } | undefined;
      expect("inventory" in (last ?? {})).toBe(false);

      setAssistantInventoryProvider(() => {
        throw new Error("provider boom");
      });
      await service.setMode("observe");
      last = snapshots.at(-1) as { inventory?: unknown } | undefined;
      // 抛错=诚实缺席，publish 不失败（快照仍产出）。
      expect("inventory" in (last ?? {})).toBe(false);
      expect(snapshots.length).toBe(3);
    } finally {
      service.dispose();
      db.close();
    }
  });

  // P8b（09 §1.7 三态区分的结构性信号）：provider 装配即携带 inventoryReady=true——
  // UI 据此区分「投影就绪中」（true+inventory 缺席）与「旧 Host」（字段缺席→卡不渲染）。
  it("快照 inventoryReady 信号：provider 装配即 true（含 null 视图）；未装配不携带", async () => {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: "local-user",
      database: db,
    });
    try {
      const snapshots: Array<{ inventoryReady?: boolean }> = [];
      service.onDidChange((snapshot) => snapshots.push(snapshot));
      // 未装配 provider：信号不携带（旧装配语义，UI 卡不渲染）。
      await service.setMode("observe");
      expect(snapshots.at(-1)?.inventoryReady).toBeUndefined();

      // 装配 provider（即便仍返回 null=就绪中）：信号恒 true。
      setAssistantInventoryProvider(() => null);
      await service.setMode("off");
      expect(snapshots.at(-1)?.inventoryReady).toBe(true);

      setAssistantInventoryProvider(null);
      await service.setMode("observe");
      expect(snapshots.at(-1)?.inventoryReady).toBeUndefined();
    } finally {
      service.dispose();
      db.close();
    }
  });
});

describe("refreshInventory 刷新环路节流（09 §1.2：前沿节流+尾沿补一拍）", () => {
  it("interval 内重复 refresh 只落尾沿一拍；interval 过后前沿直发；kv 可调", async () => {
    vi.useFakeTimers();
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: "local-user",
      database: db,
    });
    try {
      // kv 提高节流间隔（可调语义验证；键=ASSISTANT_KV_KEYS.inventoryRefreshIntervalMs）。
      db.raw
        .prepare(
          "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(ASSISTANT_KV_KEYS.inventoryRefreshIntervalMs, "5000", 0);

      let publishCount = 0;
      service.onDidChange(() => {
        publishCount += 1;
      });
      await service.setMode("observe"); // publish #1（事件路径）
      expect(publishCount).toBe(1);

      service.refreshInventory(); // 前沿：距上次 publish 0ms < 5s → 不直发，挂尾沿
      expect(publishCount).toBe(1);
      service.refreshInventory(); // 已有尾沿定时器 → 不叠加
      expect(publishCount).toBe(1);

      await vi.advanceTimersByTimeAsync(5_000); // 尾沿补一拍
      expect(publishCount).toBe(2);

      await vi.advanceTimersByTimeAsync(6_000); // 距上次 publish > 5s
      service.refreshInventory(); // 前沿直发
      expect(publishCount).toBe(3);
    } finally {
      service.dispose();
      db.close();
    }
  });
});
