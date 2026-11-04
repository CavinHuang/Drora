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
 *  MateTicketRow/MateReportCard/MateObserveRow/MateConfigSection/MateSidePane）。 */
const MATE_CONSUMED_KEYS: readonly string[] = [
  // 面板标题（tab 条经 sidePane.mate 消费；本键预留给 P2 Surface A/C 标题位）。
  "mate.title",
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
  "mate.error.generic",
  "mate.error.read",
  "mate.workspace.untargeted",
  "mate.empty.title",
  "mate.empty.body",
  "mate.unavailable.title",
  "mate.unavailable.body",
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
