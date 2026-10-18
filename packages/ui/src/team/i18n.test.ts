import { describe, expect, it } from "vitest";

import enUS from "../i18n/locales/en-US.js";
import zhCN from "../i18n/locales/zh-CN.js";
import { TEAM_STATUS_I18N_KEYS } from "./team-status-presentation.js";

/**
 * team 模块 i18n 键守护（M2.5；design 01 §4「全部文案走 locales zh-CN/en-US 双语全量
 * （含状态标签/动态摘要/无障碍文案）」、§7 验收 4「zh/en 切换后无裸键」）。
 *
 * M2.5 前组件用 zh 内联常量（TEAM_PANEL_COPY/TEAM_STAGED_EDITOR_COPY/STATUS_LABEL/
 * MEMBER_STATE_LABEL），已整体迁入词典；本测试锁三件事：
 * 1. 双语对齐——zh-CN 与 en-US 的 team.* 键集完全一致（漏一侧就渲染另一侧或裸键）；
 * 2. 消费键存在——组件 formatMessage 的每个键在两侧词典都有非空值（IntlProvider
 *    缺键回退渲染键名本身，即 E2E 说的「裸键」）；
 * 3. 占位符同构——同键双语 {placeholder} 集合一致（formatMessage 是字符串替换，
 *    占位符名不一致会把 {name} 原样渲染出来）。
 */

/** TeamPanel/TeamStagedEditor 组件内 formatMessage 消费的全部键（M2.5 迁移清单）。 */
const TEAM_PANEL_KEYS = [
  "team.panel.title",
  "team.panel.aria",
  "team.panel.permission",
  "team.panel.memberProgress",
  "team.panel.stagedReadonlySummary",
  "team.panel.stagedReadonlyFeedback",
  "team.panel.membersAria",
  "team.panel.taskAttempt",
  "team.panel.halt",
  "team.panel.haltHint",
  "team.panel.haltConfirmTitle",
  "team.panel.haltConfirmBody",
  "team.panel.haltConfirmLabel",
  "team.panel.resume",
  "team.panel.resumeReasonLabel",
  "team.panel.resumeReasonPlaceholder",
  "team.panel.resumeHint",
  "team.panel.escalationTitle",
  "team.panel.escalationBody",
  "team.board.pending",
  "team.board.inProgress",
  "team.board.completed",
  "team.member.state.spawning",
  "team.member.state.working",
  "team.member.state.terminal",
  "team.member.state.removed",
] as const;

const TEAM_STAGED_EDITOR_KEYS = [
  "team.stagedEditor.title",
  "team.stagedEditor.stagedSummary",
  "team.stagedEditor.awaitingFeedback",
  "team.stagedEditor.membersHeading",
  "team.stagedEditor.tasksHeading",
  "team.stagedEditor.roleNone",
  "team.stagedEditor.routingLabel",
  "team.stagedEditor.routingNone",
  "team.stagedEditor.assigneeNone",
  "team.stagedEditor.dependsOnLabel",
  "team.stagedEditor.dependsOnNone",
  "team.stagedEditor.dependsOnSeparator",
  "team.stagedEditor.noteLabel",
  "team.stagedEditor.notePlaceholder",
  "team.stagedEditor.approve",
  "team.stagedEditor.revise",
  "team.stagedEditor.abandon",
  "team.stagedEditor.abandonConfirmTitle",
  "team.stagedEditor.abandonConfirmBody",
  "team.stagedEditor.abandonConfirmLabel",
] as const;

const CONSUMED_KEYS: readonly string[] = [...TEAM_PANEL_KEYS, ...TEAM_STAGED_EDITOR_KEYS];

function teamKeys(dictionary: Record<string, string>): string[] {
  return Object.keys(dictionary).filter((key) => key.startsWith("team."));
}

function placeholders(message: string): string[] {
  const found = message.match(/\{([a-zA-Z]+)\}/g) ?? [];
  return found.map((token) => token.slice(1, -1)).sort();
}

describe("team i18n keys", () => {
  it("keeps zh-CN and en-US team.* key sets identical", () => {
    expect(teamKeys(zhCN).sort()).toEqual(teamKeys(enUS).sort());
  });

  it("has a non-empty entry for every consumed key in both dictionaries", () => {
    for (const key of CONSUMED_KEYS) {
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });

  it("keeps placeholders identical across locales for interpolated keys", () => {
    const interpolated = CONSUMED_KEYS.filter((key) => placeholders(zhCN[key] ?? "").length > 0);
    // 迁移清单里带插值的键：memberProgress/taskAttempt/aria/title/permission/
    // stagedReadonlySummary/stagedSummary——至少存在，防止清单腐化成空断言。
    expect(interpolated.length).toBeGreaterThanOrEqual(5);
    for (const key of interpolated) {
      expect(placeholders(enUS[key] ?? ""), `en-US ${key}`).toEqual(placeholders(zhCN[key] ?? ""));
    }
  });

  it("resolves every TEAM_STATUS_I18N_KEYS entry in both dictionaries", () => {
    // team-status-presentation 的键是动态消费（TEAM_STATUS_I18N_KEYS[status]），
    // 静态扫描扫不到，在这里补上存在性守护（zh 值即面板状态徽标文字）。
    for (const key of Object.values(TEAM_STATUS_I18N_KEYS)) {
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });
});
