/**
 * P4 配额中心/打扰闸/watchdog 通知区夹具状态件（mate-browser.fixture-service 拆出——
 * 单文件 ≤800 行纪律，先例：mate-browser.fixture-inventory.ts）。mate-p4-ui.test.mjs
 * 与 mate-surface-ac.test.mjs 消费。
 *
 * 真实配额记账/聚合判定在 host 侧 quotaCenter+admitDisturbanceTx——renderer 夹具按
 * 诚实边界只造同构简化的内存事实：
 * - decision 永不抑制仍计数；report/bubble 超日配额转当日 digest 聚合；
 * - quotaView=快照 quota 投影（日切在读取时结算）；
 * - watchdogNotices=快照 watchdogNotices ≤5 投影源（injectNotice 注入）；
 * - lastAdmit=上次闸判定读点（气泡闸 e2e 实时断言 `kind:summary:allowed`）。
 */

/** 注入状态件的最小容器接缝（publish 闭包由服务工厂传入；结构化最小集防双向依赖）。 */
export interface QuotaFixtureDeps {
  publish(): void;
  /** 闸判定读点回调（bubble 气泡闸 e2e 实时断言 admit 到达且带摘要）。 */
  onAdmit?(record: string): void;
}

/** 快照 quota 投影形状（AssistantSnapshot["quota"] 同形）。 */
export interface FixtureQuotaView {
  date: string;
  quota: number;
  used: { decision: number; report: number; bubble: number };
  total: number;
  remaining: number;
  pendingDigest: Array<{ date: string; items: string[] }>;
}

/** admitDisturbance 判定返回形状（IAssistantTicketService 同构）。 */
export interface FixtureAdmitResult {
  ok: true;
  value: {
    allowed: boolean;
    date: string;
    used: number;
    quota: number;
    aggregated: boolean;
  };
}

export function createQuotaFixture(deps: QuotaFixtureDeps): {
  /** 快照 quota 投影（读取时日切结算；getDisturbanceQuota 与 buildSnapshot 共用）。 */
  quotaView(): FixtureQuotaView;
  /** 快照 watchdogNotices 投影（≤5，新→旧拷贝）。 */
  watchdogNoticesView(): Array<{ ticketId: string; kind: string; summary: string; atMs: number }>;
  admitDisturbance(input: {
    kind: "decision" | "report" | "bubble";
    summary?: string;
  }): Promise<FixtureAdmitResult>;
  markDailyDigestDelivered(): Promise<{ ok: true; value: { ok: true } }>;
  /** 注入一条 watchdog 通知（快照 watchdogNotices 投影源）。 */
  injectNotice(ticketId: string, kind: string, summary: string): void;
  /** 连续推送 N 条 report 类打扰（超额即聚合 digest；e2e 断言摘要卡与配额行）。 */
  pushReports(count: number, summary: string): void;
  /** 上次闸判定读点（`kind:summary:allowed`）。 */
  lastAdmit(): string;
} {
  const quotaDay = {
    date: "",
    decision: 0,
    report: 0,
    bubble: 0,
    digest: [] as string[],
    digestDelivered: false,
  };
  let dailyQuota = 5;
  // P4 第二棒：watchdog 通知区内存版（snapshot.watchdogNotices 投影源）+ 上次闸判定读点。
  const watchdogNotices: Array<{ ticketId: string; kind: string; summary: string; atMs: number }> =
    [];
  let lastAdmitRecord = "";

  /**
   * 日切（本地日 yyyy-mm-dd 变更即清零）。resetDelivered 与原 fixture 逐行为等价：
   * 记账路径（admitDisturbance）日切重置 digestDelivered；投影读取路径（quotaView）
   * 日切不重置——原 buildSnapshot 日切只清计数与 digest。
   */
  function rolloverDay(today: string, resetDelivered: boolean): void {
    if (quotaDay.date === today) return;
    quotaDay.date = today;
    quotaDay.decision = 0;
    quotaDay.report = 0;
    quotaDay.bubble = 0;
    quotaDay.digest = [];
    if (resetDelivered) quotaDay.digestDelivered = false;
  }

  /** 打扰闸判定（内存版同构简化；decision 永不抑制仍计数，超额聚合当日 digest）。 */
  function admit(input: {
    kind: "decision" | "report" | "bubble";
    summary?: string;
  }): FixtureAdmitResult {
    rolloverDay(new Date().toISOString().slice(0, 10), true);
    quotaDay[input.kind] += 1;
    const total = quotaDay.decision + quotaDay.report + quotaDay.bubble;
    const aggregated = input.kind !== "decision" && total > dailyQuota;
    if (aggregated && input.summary) {
      quotaDay.digest.push(input.summary.slice(0, 200));
    }
    lastAdmitRecord = `${input.kind}:${input.summary ?? ""}:${!aggregated}`;
    deps.onAdmit?.(lastAdmitRecord);
    deps.publish();
    return {
      ok: true,
      value: {
        allowed: !aggregated,
        date: quotaDay.date,
        used: total,
        quota: dailyQuota,
        aggregated,
      },
    };
  }

  return {
    quotaView() {
      rolloverDay(new Date().toISOString().slice(0, 10), false);
      const total = quotaDay.decision + quotaDay.report + quotaDay.bubble;
      return {
        date: quotaDay.date,
        quota: dailyQuota,
        used: { decision: quotaDay.decision, report: quotaDay.report, bubble: quotaDay.bubble },
        total,
        remaining: Math.max(0, dailyQuota - total),
        pendingDigest: quotaDay.digestDelivered
          ? []
          : [{ date: quotaDay.date, items: [...quotaDay.digest] }],
      };
    },
    watchdogNoticesView() {
      return watchdogNotices.slice(-5).map((notice) => ({ ...notice }));
    },
    async admitDisturbance(input) {
      return admit(input);
    },
    async markDailyDigestDelivered() {
      quotaDay.digestDelivered = true;
      deps.publish();
      return { ok: true as const, value: { ok: true as const } };
    },
    injectNotice(ticketId, kind, summary) {
      watchdogNotices.push({ ticketId, kind, summary, atMs: Date.now() });
      deps.publish();
    },
    pushReports(count, summary) {
      for (let index = 0; index < count; index += 1) {
        admit({ kind: "report", summary });
      }
      deps.publish();
    },
    lastAdmit() {
      return lastAdmitRecord;
    },
  };
}
