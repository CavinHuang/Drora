/**
 * 工具简报规划器（specs/voice-agent-integration.md §4.2 六规则 EG-1 / §9.6.7-1）。
 *
 * 职责：消费 ToolCall 行「从无到有」提交事件（wiring 喂当前快照，消费现有 conversation
 * 投影，不建第二事件流），按六规则产出就绪简报文本：
 * 1) 触发源收窄——同一 toolCallId 只在首见（从无到有）生成候选，进度级更新被 seen 集
 *    合挡住不生成（§4.2-1）；
 * 2) 同类时间窗合并——同名工具在 sameToolMergeWindowMs 窗内的后续候选不生成新简报，
 *    只更新「最新目标」（连续编辑 5 个文件 → 只保留最新一条，§4.2-2/§4.2-4）；
 * 3) 最小间隔——任意两条已播简报间隔 < minGapMs → 丢弃不排队（§4.2-3）；
 * 4) 只播最新（§4.2-4，随规则 2）；
 * 5) 上限——每 turn ≤ maxPerTurn 条，超出静默丢弃（§4.2-6）；
 * 6) 开关关闭 → 候选照常被 seen 消化但不产出（避免开启瞬间旧工具行涌入，§9.6.7-1）。
 *
 * 播报时机（FD-3 权限>正文>简报）不在此判定：就绪简报经 onBriefReady 上交 wiring →
 * turnSpeechPlanner.consumeBriefSegment（仅 AnnIdle 或正文句间且无待播权限段插播）。
 * 纯逻辑零副作用（时间经 now 注入），文案组装归 wiring（i18n）。
 */

export interface ToolCallBriefSource {
  toolCallId: string;
  toolName: string;
  turnId: string;
  status: string;
  /** 工具输入首段（文件路径/命令），wiring 从 inputText 预提取；可缺省。 */
  target?: string;
}

/** DI deps 形状（wiring 注入 enabled/上交回调/时钟，测试 fake）。@lintignore */
export interface ToolBriefPlannerDeps {
  /** §6.1 voiceToolBriefEnabled reader 收口（false = 零简报，§9.6.8-S5）。 */
  isBriefEnabled(): boolean;
  /** 就绪简报上交（briefId 供下游去重；toolName/target 供 §4.2-7 模板组装，文案在调用方 i18n）。 */
  consumeBrief(briefId: string, toolName: string, target: string): void;
  now?(): number;
}

/** 阈值集合形状（TOOL_BRIEF_THRESHOLDS 的类型；wiring 透传 voiceTuning）。@lintignore */
export interface ToolBriefPlannerThresholds {
  /** 同类时间窗合并（§4.2-2，ms）。 */
  sameToolMergeWindowMs: number;
  /** 最小播报间隔（§4.2-3，ms）。 */
  minGapMs: number;
  /** 每 turn 上限（§4.2-6）。 */
  maxPerTurn: number;
  /** 目标截断长度（§4.2-7，字符）——由 wiring 组装文本时使用，此处仅供文档导出。 */
  targetMaxChars: number;
}

/** §4.2 阈值常量（ EG-1 冻结初值；调参面不冻值，与 voiceTuning.ts 同批调参）。@lintignore */
export const TOOL_BRIEF_THRESHOLDS: ToolBriefPlannerThresholds = {
  sameToolMergeWindowMs: 10_000,
  minGapMs: 5_000,
  maxPerTurn: 6,
  targetMaxChars: 40,
};

/** 规划器能力面（wiring 消费 consumeToolCallSnapshot/resetTurnCounters）。@lintignore */
export interface ToolBriefPlanner {
  /**
   * 喂入当前 ToolCall 行快照（每 tick 由 wiring 从 conversation 投影展开）；
   * 内部 diff「从无到有」并按六规则产出 onBriefReady。
   */
  consumeToolCallSnapshot(rows: readonly ToolCallBriefSource[]): void;
  /** turn 切换（wiring 会话/轮次变更）时清 per-turn 计数（§4.2-6）。 */
  resetTurnCounters(): void;
}

export function createToolBriefPlanner(
  deps: ToolBriefPlannerDeps,
): ToolBriefPlanner {
  const now = deps.now ?? (() => Date.now());
  const seenToolCallIds = new Set<string>();
  /**
   * 规则 2 合并窗基准（EG-1 拍板）：toolName → 最近一次**实际播出**该工具类简报的时间。
   * 拍板理由（防机关枪是本规则的目的）：若以「候选到达」为基准，首条候选即时上交后
   * 基准并不前移，同类后续候选每满 minGap 就各播一条——编辑 5 个文件会以 5s 间隔连报
   * 5 条（机关枪）。以播出时刻为基准后，同类简报至多每 sameToolMergeWindowMs 一条。
   */
  const lastBriefAtByTool = new Map<string, number>();
  /**
   * 规则 2/4：待上交候选（每 toolName 至多一条，后到替换先到——目标取最新）。
   * 窗内候选保留在此等窗过期，窗过期后由 drainPending 上交（C1 修复）。
   */
  const pendingByTool = new Map<
    string,
    {
      briefId: string;
      turnId: string;
      toolName: string;
      target: string;
      at: number;
    }
  >();
  /** 规则 3：最近一条已上交简报时间（全局最小间隔基准）。 */
  let lastAnnouncedAt = Number.NEGATIVE_INFINITY;
  /**
   * 终审角落修复：drain 时刻的「当前 turn」= 最近一次快照见到的 turnId。
   * EG-1 允许跨 turn 挂起合并（pendingByTool 不随 resetTurnCounters 清空），此类
   * pending 在窗过期后上交时按当前 turn 计数——否则计入旧 turn（已清零）账面，
   * 新 turn 的实际播报数可比 maxPerTurn 多 1（规则 6 账面失真）。
   */
  let currentTurnId: string | null = null;
  /** 规则 6：turnId → 本 turn 已上交条数。 */
  const announcedCountByTurn = new Map<string, number>();

  const drainPending = (): void => {
    // 规则 2 强制（C1 修复，EG-1 拍板基准=最近一次实际播出）：同类合并窗
    // （sameToolMergeWindowMs=10s，基准=该工具类播出时刻）内的候选**不上交**，
    // 保留 pending 只持续刷新最新目标——这是防机关枪的核心：窗内到达多少条
    // 同类候选都只会替换 pending 目标，窗过期后才由下一次快照驱动上交一条。
    // 规则 3：距全局最近播报 <minGapMs 的候选直接丢弃（不排队，§4.2-3）。
    for (const [toolName, pending] of Array.from(pendingByTool)) {
      const base = lastBriefAtByTool.get(toolName);
      if (
        base != null &&
        now() - base < TOOL_BRIEF_THRESHOLDS.sameToolMergeWindowMs
      ) {
        continue; // 合并窗内：保留最新目标，等窗过期（不删除 pending）。
      }
      pendingByTool.delete(toolName);
      if (now() - lastAnnouncedAt < TOOL_BRIEF_THRESHOLDS.minGapMs) {
        continue;
      }
      lastAnnouncedAt = now();
      // EG-1 拍板：播出时刻前移该工具类的合并窗基准（防机关枪的核心机制）。
      lastBriefAtByTool.set(toolName, now());
      // 规则 6：每 turn 上限（上交时递增；上限判定在候选生成处前置挡掉）。
      // 终审角落修复：按 drain 时刻的当前 turn 计数（跨 turn 挂起候选归属新 turn）。
      const countTurnId = currentTurnId ?? pending.turnId;
      announcedCountByTurn.set(
        countTurnId,
        (announcedCountByTurn.get(countTurnId) ?? 0) + 1,
      );
      deps.consumeBrief(pending.briefId, pending.toolName, pending.target);
    }
  };

  return {
    consumeToolCallSnapshot(rows) {
    for (const row of rows) {
      currentTurnId = row.turnId;
      if (seenToolCallIds.has(row.toolCallId)) {
        continue; // 规则 1：进度级更新不生成候选。
      }
        seenToolCallIds.add(row.toolCallId);
        // 首见任何状态都算「从无到有」（快速完成的调用也是一次工具调用开始）；
        // 同一 toolCallId 的后续进度/终态更新不重复生成（规则 1）。
        if (!deps.isBriefEnabled()) {
          continue;
        }
        // 规则 6：每 turn 上限，超出静默丢弃。
        const announced = announcedCountByTurn.get(row.turnId) ?? 0;
        if (announced >= TOOL_BRIEF_THRESHOLDS.maxPerTurn) {
          continue;
        }
        // 候选统一进 pending（每 toolName 至多一条，后到替换先到——目标取最新）。
        // 是否可上交由 drainPending 按合并窗/全局间隔在 drain 时刻统一裁决，
        // 快照本身不区分窗内外（窗过期后的上交也由每次快照触发的 drain 驱动）。
        pendingByTool.set(row.toolName, {
          briefId: row.toolCallId,
          turnId: row.turnId,
          toolName: row.toolName,
          target: row.target ?? row.toolName,
          at: now(),
        });
      }
      drainPending();
    },
    resetTurnCounters() {
      announcedCountByTurn.clear();
    },
  };
}
