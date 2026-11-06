import { describe, expect, it } from "vitest";

import enUS from "../i18n/locales/en-US.js";
import zhCN from "../i18n/locales/zh-CN.js";

/**
 * mate 模块 i18n 键守护（照 src/team/i18n.test.ts 三断言；键清单=01 详设 §5 + 组件步骤
 * 增补，唯一出处 i18n/mateMessages.ts，经 locales zh-CN/en-US 顶部 spread 合入）。
 * 三件事：
 * 1. 双语对齐——zh-CN 与 en-US 的 mate.*（含 sidePane.mate tab 标题）键集完全一致；
 * 2. 消费键存在——组件 formatMessage 的每个键在两侧词典都有非空值（缺键渲染键名即裸键）；
 * 3. 占位符同构——同键双语 {placeholder} 集合一致（formatMessage 是字符串替换）。
 */

/** Mate 面板组件消费的全部 mate.* 键（MatePaneHeader/MateTrustBar/MateDecisionCard/
 *  MateTicketRow/MateReportCard/MateObserveRow/MateAutoNoticeRow/MateConfigSection/
 *  MateSidePane）。 */
const MATE_CONSUMED_KEYS: readonly string[] = [
  // 独立 mate.title 键经两轮核真（2026-11-05/06）确认零组件消费（面板标题由
  // sidePane.mate/sidePane.launcher.mate 承载，见 MATE_TAB_KEYS）——键清理专项
  // 已自 zh/en 词典与本清单同步移除，勿再回填「预留位」。
  "mate.filter.decision",
  "mate.filter.running",
  "mate.filter.observe",
  "mate.filter.all",
  "mate.budget.count",
  "mate.budget.full",
  "mate.trust.title",
  "mate.trust.wouldAccept",
  "mate.trust.released",
  "mate.trust.hint",
  "mate.card.approve",
  "mate.card.ignore",
  "mate.card.edit",
  "mate.card.origin",
  "mate.card.estimate",
  "mate.card.tier.build",
  "mate.card.tier.guarded",
  "mate.card.p1.unisolated",
  "mate.card.p1.unisolated.hint",
  "mate.report.done",
  "mate.report.failed",
  "mate.report.openSession",
  "mate.report.cost",
  "mate.observe.wouldAccept",
  "mate.config.mode",
  "mate.config.mode.observe",
  "mate.config.mode.auto.locked",
  "mate.config.allowlist",
  "mate.config.allowlistPlaceholder",
  "mate.config.trigger.explicit",
  "mate.config.trigger.inferred",
  "mate.config.triggerPlaceholder",
  "mate.error.store.busy",
  "mate.error.store.migration",
  "mate.error.yolo",
  "mate.error.auto",
  "mate.error.validation",
  "mate.error.dispatchRejected",
  "mate.error.generic",
  "mate.error.read",
  "mate.workspace.untargeted",
  "mate.empty.title",
  "mate.empty.body",
  "mate.unavailable.title",
  "mate.unavailable.body",

  // ---- P4 第二棒（04 详设 §3/§4）：汇报卡完整版 + 配额中心 UI ----
  "mate.status.quota",
  "mate.report.awaiting",
  "mate.report.awaiting.since",
  "mate.report.confirmOutput",
  "mate.report.increment",
  "mate.report.increment.confirm",
  "mate.ticket.stale",
  "mate.watchdog.kind.running_stall",
  "mate.watchdog.kind.awaiting_unverified",
  "mate.watchdog.kind.queued_starve",
  "mate.digest.title",
  "mate.digest.quotaUsed",
  "mate.digest.markDelivered",
  "mate.config.quota.label",
  "mate.config.quota.hint",
  "mate.config.quota.invalid",
  "mate.detail.timeline.awaiting",
  "mate.detail.timeline.awaiting.since",
  "mate.detail.evidence.briefFull",
  "mate.detail.evidence.artifacts",
  "mate.detail.evidence.artifacts.worktree",
  "mate.detail.evidence.artifacts.paths",
  "mate.detail.evidence.artifacts.none",
  "mate.detail.cost.generation",
  "mate.detail.cost.duration",
  "mate.detail.cost.duration.current",
  "mate.detail.cost.duration.seconds",
  "mate.detail.cost.duration.minutes",
  "mate.detail.cost.duration.hours",
  // P2-P4 批次消费键增补（run dwfrun-e8aa12b4 跨阶段审计登记：守卫清单曾停驻 P1，
  // docstring 声称覆盖「组件 formatMessage 的每个键」但漏 55 键；词典侧经审计确认零缺口，
  // 此处补齐使断言 2 的覆盖面与 docstring 一致）。
  // P2 Router 预填决策卡与 Surface A 状态条。
  "mate.router.pending",
  "mate.router.failed",
  "mate.router.evidence",
  "mate.router.reason",
  "mate.router.session",
  "mate.router.target",
  "mate.router.briefBase.verbatim",
  "mate.router.briefBase.appendix",
  "mate.status.line",
  "mate.status.mode.off",
  "mate.status.mode.observe",
  "mate.status.mode.auto",
  // P2 Surface C 工单详情四页签与时间线代际站。
  "mate.detail.title",
  "mate.detail.back",
  "mate.detail.tab.timeline",
  "mate.detail.tab.report",
  "mate.detail.tab.evidence",
  "mate.detail.tab.cost",
  "mate.detail.timeline.anchor",
  "mate.detail.timeline.anchorNone",
  "mate.detail.timeline.current",
  "mate.detail.timeline.dispatch",
  "mate.detail.timeline.queued",
  "mate.detail.timeline.channel",
  "mate.detail.report.none",
  "mate.detail.report.output",
  "mate.detail.report.failedReason",
  "mate.detail.evidence.trigger",
  "mate.detail.evidence.brief",
  "mate.detail.evidence.none",
  "mate.detail.cost.perGeneration",
  // P2 工单行/卡片与写域配置区。
  "mate.ticket.generation",
  "mate.ticket.queued",
  "mate.ticket.mode.a.hint",
  "mate.ticket.mode.b.hint",
  "mate.ticket.mode.c.hint",
  "mate.ticket.workspace.hint",
  "mate.ticket.worktree.hint",
  "mate.ticket.paths.hint",
  "mate.card.approveAsTeam",
  "mate.card.queueNotice",
  "mate.config.worktree.label",
  "mate.config.worktree.hint",
  "mate.config.worktree.on",
  "mate.config.worktree.off",
  // P5 设置中心（06 号详设）：模型偏好/高级区/Source 设置。
  "mate.config.model.label",
  "mate.config.model.default",
  "mate.config.model.loading",
  "mate.config.model.hint",
  "mate.config.advanced.title",
  "mate.config.advanced.budget",
  "mate.config.advanced.minRate",
  "mate.config.advanced.minSamples",
  "mate.config.advanced.interval",
  "mate.config.advanced.budgetInvalid",
  "mate.config.advanced.rateInvalid",
  "mate.config.advanced.samplesInvalid",
  "mate.config.advanced.intervalInvalid",
  "mate.config.source.title",
  "mate.config.source.feishu",
  "mate.config.source.phone",
  "mate.config.source.github",
  "mate.config.source.githubRepo",
  "mate.config.source.githubMention",
  "mate.config.source.githubPatHint",
  "mate.config.source.identityMap",
  "mate.config.source.externalId",
  "mate.config.source.localIdentity",
  "mate.config.source.addRow",
  "mate.config.source.removeRow",
  "mate.config.source.save",
  "mate.config.source.saved",
  // P7 查询直答卡（08 号详设）。
  "mate.query.reply.title",
  "mate.query.reply.dismiss",
  "mate.query.reply.hint",
  "mate.router.suggested.query_status",
  // P3 桌宠/任务行徽标通道。
  "mate.sessionLine.active",
  "mate.sessionLine.pending",
  "mate.sessionLine.aria",
  // P4 auto 信任门与配额摘要卡。
  "mate.trust.autoSwitch",
  "mate.trust.autoSwitch.title",
  "mate.trust.autoSwitch.list",
  "mate.trust.autoSwitch.confirm",
  "mate.trust.autoSwitch.irreversible",
  "mate.trust.autoSwitch.failed",
  "mate.trust.gate.progress",
  // G5 补齐（2026-11-06 审查；显式清单曾漏 9 个 formatMessage 可达键——均经 view-model
  // 封闭映射函数出键，词典侧 zh/en 均在，此处补齐使断言 2 覆盖面与 docstring 一致）：
  // 权限档 yolo（matePermissionTierMessageId——决策卡建议档徽标可达）。
  "mate.card.tier.yolo",
  // Router 建议四臂（mateRouterSuggestionKindMessageId）。
  "mate.router.suggested.dispatch",
  "mate.router.suggested.attach",
  "mate.router.suggested.hold",
  "mate.router.suggested.reject",
  // 触发来源四枚举（mateSourceKindMessageId——决策卡/观察行来源徽标）。
  "mate.source.local",
  "mate.source.feishu",
  "mate.source.phone",
  "mate.source.github",
  // F2（2026-11-06 审查）：触发成功反馈行（MateConfigSection role=status；
  // mateTriggerOutcomeFeedbackMessageId 三态封闭映射）。
  "mate.trigger.feedback.decisionCard",
  "mate.trigger.feedback.wouldAccept",
  "mate.trigger.feedback.ignored",
  // F4（2026-11-06 审查）：auto 告知卡（MateAutoNoticeRow；spec §6「执行（出告知卡）」）。
  "mate.autoNotice.label",
  "mate.autoNotice.ticket",
  // P8b 全域工作总览卡（09 详设 §1.7；MateWorkOverview formatMessage 全量键）。
  "mate.work.title",
  "mate.work.pending",
  "mate.work.empty",
  "mate.work.kind.ticket",
  "mate.work.kind.session",
  "mate.work.kind.session.teams",
  "mate.work.kind.offpeak",
  "mate.work.stale",
  "mate.work.stale.hint",
  "mate.work.managed",
  "mate.work.managed.hint",
  "mate.work.session.managed",
  "mate.work.offpeak.disabled",
  // P9 自主节奏（09 详设 §2）：来源徽标（mateSourceKindMessageId 第五枚举）、自主
  // 通知区 kind（MateDigestCard kind 徽标映射）、节奏区（MateConfigSection 节奏两键
  // +状态/提示/间隔校验——快照 rhythm? 缺席=区不渲染，键仍在词典守护）。
  "mate.source.autonomy",
  "mate.watchdog.kind.autonomy_report",
  "mate.watchdog.kind.autonomy_first_notice",
  "mate.config.rhythm.title",
  "mate.config.rhythm.toggle",
  "mate.config.rhythm.on",
  "mate.config.rhythm.off",
  "mate.config.rhythm.hint",
  "mate.config.rhythm.interval",
  "mate.config.rhythm.intervalInvalid",
];

/** tab 条与 launcher 消费（sidePaneTabPresentation / AnimatedSidePanePanel launcher）。 */
const MATE_TAB_KEYS: readonly string[] = ["sidePane.mate", "sidePane.launcher.mate"];

const CONSUMED_KEYS: readonly string[] = [...MATE_CONSUMED_KEYS, ...MATE_TAB_KEYS];

function mateKeys(dictionary: Record<string, string>): string[] {
  return Object.keys(dictionary).filter((key) => key.startsWith("mate."));
}

function placeholders(message: string): string[] {
  const found = message.match(/\{([a-zA-Z]+)\}/g) ?? [];
  return found.map((token) => token.slice(1, -1)).sort();
}

describe("mate i18n keys", () => {
  it("keeps zh-CN and en-US mate.* key sets identical (incl. sidePane.mate tab keys)", () => {
    expect(mateKeys(zhCN).sort()).toEqual(mateKeys(enUS).sort());
    for (const key of MATE_TAB_KEYS) {
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });

  it("has a non-empty entry for every consumed key in both dictionaries", () => {
    for (const key of CONSUMED_KEYS) {
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });

  it("keeps placeholders identical across locales for interpolated keys", () => {
    const interpolated = CONSUMED_KEYS.filter((key) => placeholders(zhCN[key] ?? "").length > 0);
    // 带插值的键：budget.count/full、trust.wouldAccept/released、report.cost——至少 5 个，
    // 防止清单腐化成空断言。
    expect(interpolated.length).toBeGreaterThanOrEqual(5);
    for (const key of interpolated) {
      expect(placeholders(enUS[key] ?? ""), `en-US ${key}`).toEqual(placeholders(zhCN[key] ?? ""));
    }
  });
});
