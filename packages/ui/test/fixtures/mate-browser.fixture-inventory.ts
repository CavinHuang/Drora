/**
 * P8b 全域台账 canned 视图（mate-browser.fixture-service 拆件，单文件 ≤800 行纪律）。
 * MSA15（mate-surface-ac.test.mjs）消费：真实三源组装在 host 侧 workInventoryBootstrap，
 * renderer 夹具按诚实边界只造快照投影事实——本文件只提供台账视图形状与实体 id/文案
 * 常量（工单实体在 fixture-service 落 snapshot.tickets，支撑行点击下钻断言——总览卡
 * 工单行点击=selectTicket，详情视图按快照工单集渲染），不伪造组装链路。
 *
 * 视图内容（覆盖 MSA15 断言点）：
 * - 本组（ownKey=夹具 tab 身份键）：工单行（引用 T-inv-1）、代管会话行（managed=true）、
 *   带 teams 会话行、闲时任务行（导航不可达=禁用+提示语义）；
 * - 跨项目组 fixture/workspace-b：一条会话行（跨组导航传组键作路径的既有通道断言）。
 */
import { ASSISTANT_TICKET_STATUSES, type MateWorkInventoryView } from "@drora/shared";

/** 台账工单行的快照实体 id（injectInventory 幂等登记 + MSA15 行点击断言锚）。 */
export const INVENTORY_FIXTURE_TICKET_ID = "T-inv-1";

/** 台账工单行的 brief（快照实体与视图行同文案——两处渲染断言同锚）。 */
export const INVENTORY_FIXTURE_TICKET_BRIEF = "台账验收工单：全域总览卡行点击下钻";

/** 跨项目组的组键（fixture tab 身份键之外的第二个组；跨组导航断言用）。 */
export const INVENTORY_FIXTURE_CROSS_GROUP_KEY = "fixture/workspace-b";

/** 组装 canned 台账视图（ownKey=本组组键=夹具 tab 身份键）。 */
export function buildMateInventoryFixtureView(ownKey: string): MateWorkInventoryView {
  const now = Date.now();
  return {
    workspaces: [
      {
        key: ownKey,
        rows: [
          {
            kind: "ticket",
            ticketId: INVENTORY_FIXTURE_TICKET_ID,
            title: INVENTORY_FIXTURE_TICKET_BRIEF,
            status: "queued",
            updatedAtMs: now - 60_000,
            staleSinceMs: now - 40 * 60_000,
          },
          {
            kind: "session",
            sessionId: "sess-inv-managed",
            title: "大副当代执行会话（代管）",
            phase: "running",
            sessionEnded: false,
            updatedAtMs: now - 30_000,
            managed: true,
          },
          {
            kind: "session",
            sessionId: "sess-inv-open",
            title: "用户手开的会话（带 teams）",
            phase: "idle",
            sessionEnded: false,
            updatedAtMs: now - 120_000,
            teamStatus: "team-1 running",
          },
          {
            kind: "offpeak",
            taskId: "task-inv-1",
            title: "闲时索引重建（任务中心域）",
            status: "pending",
            updatedAtMs: now - 300_000,
          },
        ],
      },
      {
        key: INVENTORY_FIXTURE_CROSS_GROUP_KEY,
        rows: [
          {
            kind: "session",
            sessionId: "sess-inv-cross",
            title: "跨项目会话（另一 workspace）",
            phase: "idle",
            sessionEnded: false,
            updatedAtMs: now - 240_000,
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// P8b 注入状态件（mate-browser.fixture-service 拆出——单文件 ≤800 行纪律）：
// 三态切换（有视图/就绪中/无工作）的内存态与注入动作，publish 闭包由服务工厂传入。
// ---------------------------------------------------------------------------

/** 注入工单行的最小容器接缝（fixture-service 闭包数组；工单实体须落 snapshot.tickets）。 */
export interface InventoryInjectDeps {
  hasTicket(ticketId: string): boolean;
  pushTicket(ticket: {
    id: string;
    brief: string;
    briefFull: string;
    status: string;
    targetWorkspaceIdentity: string;
    sessionId: string;
    outputSummary: null;
    failReason: null;
    usage: { inputTokens: number; outputTokens: number };
    updatedAtMs: number;
    queuedReason: string;
    generationCount: number;
  }): void;
  publish(): void;
  workspaceKey: string;
}

export function createInventoryInjectFixture(deps: InventoryInjectDeps): {
  view: MateWorkInventoryView | null;
  ready: boolean;
  inject(): void;
  clear(): void;
  empty(): void;
} {
  let view: MateWorkInventoryView | null = null;
  let ready = false;
  return {
    get view() {
      return view;
    },
    get ready() {
      return ready;
    },
    /** 注入视图+工单实体（同点重复注入幂等——实体已在即只刷视图引用）。 */
    inject() {
      if (!deps.hasTicket(INVENTORY_FIXTURE_TICKET_ID)) {
        deps.pushTicket({
          id: INVENTORY_FIXTURE_TICKET_ID,
          brief: INVENTORY_FIXTURE_TICKET_BRIEF,
          briefFull: INVENTORY_FIXTURE_TICKET_BRIEF,
          status: ASSISTANT_TICKET_STATUSES.queued,
          targetWorkspaceIdentity: deps.workspaceKey,
          sessionId: "sess-inv-managed",
          outputSummary: null,
          failReason: null,
          usage: { inputTokens: 0, outputTokens: 0 },
          updatedAtMs: Date.now() - 60_000,
          queuedReason: "MSA15 台账验收排队",
          generationCount: 0,
        });
      }
      view = buildMateInventoryFixtureView(deps.workspaceKey);
      ready = true;
      deps.publish();
    },
    /** 清空视图（ready 保持 true）→「投影就绪中」态。 */
    clear() {
      view = null;
      ready = true;
      deps.publish();
    },
    /** 空台账视图（workspaces 空）→「无工作」空态。 */
    empty() {
      view = { workspaces: [] };
      ready = true;
      deps.publish();
    },
  };
}
