/**
 * P9 自主节奏夹具拆件（mate-browser.fixture-service 拆出——单文件 ≤800 行纪律，
 * 先例：mate-browser.fixture-inventory.ts）。MSA16（mate-surface-ac.test.mjs）消费。
 *
 * 真实心跳/评估/建卡事务在 host 侧 services autonomy.ts——renderer 夹具按诚实边界
 * 只造快照投影事实：
 * - 节奏投影（rhythm）状态件：injectRhythm=从「旧 Host 缺席」注入一份缺省投影（验收
 *   节奏区渲染）；setAutonomyEnabled / setAutonomyIntervalMinutes=内存 setter（快照
 *   回显链验收点；真实 kv 写路径在 host 侧 configActions）。
 * - AUTONOMY_FIXTURE_BRIEF=自主 suggest 卡原文常量（MSA16 断言锚）。
 */
import type { AssistantResult, AssistantTriggerView } from "@drora/services";

/** P9 自主 suggest 卡原文（MSA16 断言锚：卡原文首行 + 自主徽标同卡验证）。 */
export const AUTONOMY_FIXTURE_BRIEF = "自主建议：为 fixture/workspace 整理待办清单并汇报差异";

/** 注入自主卡的状态容器接缝（fixture-service 闭包数组；结构化最小集防双向依赖）。 */
export interface AutonomyCardFixtureDeps {
  /** 占用下一个 decision/trigger 序号并返回。 */
  allocateId(): number;
  pushTrigger(trigger: AssistantTriggerView): void;
  pushDecision(decision: {
    id: number;
    triggerId: string;
    outcome: string;
    decidedBy: "gate" | "user";
    triggerText: string;
    decidedMs: number;
    sourceKind: string;
    strength?: string;
  }): void;
  publish(): void;
  workspaceIdentity?: string;
}

/**
 * P9 自主节奏 suggest 卡注入（MSA16 验收消费；真实建卡事务在 host 侧 autonomy.ts
 * insertAutonomySuggestCardTx——独立建卡事务不进候选卡评估循环，renderer 夹具按
 * 诚实边界只造快照事实）。卡形同构真实事务产出：source_kind=autonomy、
 * strength=autonomous（contracts ASSISTANT_AUTONOMY_STRENGTH 字面量如实标注）、
 * outcome=decision_card、decided_by=gate、无 routerState（autonomy 卡不进评估循环
 * ——routerState 天然缺席=无建议区，人工终审）。
 */
export function injectAutonomyCardFixture(
  deps: AutonomyCardFixtureDeps,
  text: string = AUTONOMY_FIXTURE_BRIEF,
): number {
  const id = deps.allocateId();
  const triggerId = `TR-${id}`;
  deps.pushTrigger({
    id: triggerId,
    sourceKind: "autonomy",
    strength: "autonomous" as AssistantTriggerView["strength"],
    identity: "fixture/user-a",
    text,
    atMs: Date.now(),
    targetWorkspaceIdentity: deps.workspaceIdentity ?? null,
  });
  deps.pushDecision({
    id,
    triggerId,
    outcome: "decision_card",
    decidedBy: "gate",
    triggerText: text,
    decidedMs: Date.now(),
    sourceKind: "autonomy",
    // strength 字面量如实标注（不伪称 explicit——09 详设 §2.2.1）。
    strength: "autonomous",
  });
  deps.publish();
  return id;
}

/** 节奏投影形状（快照 AssistantSnapshot["rhythm"] 同形）。 */
export interface FixtureRhythm {
  enabled: boolean;
  intervalMinutes: number;
  lastRoundMs: number | null;
}

export function createAutonomyRhythmFixture(publish: () => void): {
  /** 当前节奏投影（null=「旧 Host 缺席」——节奏区不渲染的诚实降级语义）。 */
  rhythm: FixtureRhythm | null;
  /** 注入缺省节奏投影（enabled=true/30min——「有节奏投影的 Host」态）。 */
  injectRhythm(): void;
  setAutonomyEnabled(input: { enabled: boolean }): Promise<AssistantResult<{ ok: true }>>;
  setAutonomyIntervalMinutes(input: { minutes: number }): Promise<AssistantResult<{ ok: true }>>;
} {
  let rhythm: FixtureRhythm | null = null;
  return {
    get rhythm() {
      return rhythm;
    },
    injectRhythm() {
      rhythm = { enabled: true, intervalMinutes: 30, lastRoundMs: null };
      publish();
    },
    // P9 节奏区两 setter 内存实现（快照回显；MSA16 验收消费——写入→推送→节奏区状态
    // 行回读闭环）。首次 setter 即落 rhythm 投影。
    async setAutonomyEnabled(input) {
      rhythm = {
        enabled: input.enabled,
        intervalMinutes: rhythm?.intervalMinutes ?? 30,
        lastRoundMs: rhythm?.lastRoundMs ?? null,
      };
      publish();
      return { ok: true, value: { ok: true } };
    },
    async setAutonomyIntervalMinutes(input) {
      rhythm = {
        enabled: rhythm?.enabled ?? true,
        intervalMinutes: input.minutes,
        lastRoundMs: rhythm?.lastRoundMs ?? null,
      };
      publish();
      return { ok: true, value: { ok: true } };
    },
  };
}
