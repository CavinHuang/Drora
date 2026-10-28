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
  // 「team.panel.title」已随反向守卫删除（唯一消费面是 aria，title 无消费方）。
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
  // 缺口10：成员详情/下钻「移除成员」二次确认文案（TeamSelectionDetails/TeamSidePane）。
  "team.ui.stopMember",
  "team.ui.stopMemberAria",
  "team.ui.stopMemberConfirmTitle",
  "team.ui.stopMemberConfirmBody",
  "team.ui.stopMemberConfirmLabel",
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
  // 2026-10-22 问句表头（spec §10 呈现规则1）：问句行键；stagedSummary 移作表头计数。
  "team.stagedEditor.question",
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
  // 2026-10-22 三动作失败出显（spec §10 呈现规则4）：line 为动作+原因壳，原因键由
  // TeamStagedEditor 的 TEAM_STAGED_FAILURE_REASON_I18N_KEYS 动态消费（静态清单之外，
  // 映射表守卫见 TeamStagedEditor.test.tsx）。
  "team.stagedEditor.failure.line",
  "team.stagedEditor.failure.transport",
  "team.stagedEditor.failure.fallback",
  "team.stagedEditor.failure.teamNotPresent",
  "team.stagedEditor.failure.teamLeadOnly",
  "team.stagedEditor.failure.memberSpawnFailed",
  "team.stagedEditor.failure.draftInvalid",
  "team.stagedEditor.failure.hubUnavailable",
  "team.stagedEditor.abandonConfirmTitle",
  "team.stagedEditor.abandonConfirmBody",
  "team.stagedEditor.abandonConfirmLabel",
  // 缺口10：成员行「改名」入口文案（DraftMemberRename）。
  "team.stagedEditor.renameLabel",
  "team.stagedEditor.renameApply",
  "team.stagedEditor.renameCancel",
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

// ---------------------------------------------------------------------------
// §19 契约 6 守护升级（2026-10-23，评审 Low-18）：手写迁移清单只覆盖
// TeamPanel/TeamStagedEditor 两家族——stagedDock/memberPane 等后来家族不在
// CONSUMED_KEYS，且键集一致断言以 zh 为基准、两侧同删无报警（组件渲染裸键）。
// 升级为源码扫描：从 team 目录（+app-shell/TeamSidePane 挂载点）的 formatMessage
// 字面量提取消费键，正向（键必有词典值）+ 反向（词典键必被静态或动态消费）双守。
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { teamHistoryEntrySchema } from "@drora/shared/drora-protocol-v4";
import { TEAM_STAGED_FAILURE_REASON_I18N_KEYS } from "./TeamStagedEditor.js";
import { TEAM_REVISE_PREFILL_PROMPT_KEY } from "./revise-prefill.js";

/**
 * 递归收集 team 目录源文件（§21 A10，2026-10-24）：readdirSync 此前非递归，team
 * 目录将来出现子目录即静默漏扫（正向守漏裸键、反向守误判死键）——改递归遍历。
 */
function collectTeamSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTeamSourceFiles(path));
      continue;
    }
    if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.includes(".test.")) files.push(path);
  }
  return files;
}

function teamSourceFiles(): string[] {
  const teamDir = fileURLToPath(new URL("./", import.meta.url));
  const files = collectTeamSourceFiles(teamDir);
  // 挂载点在 team 目录之外也消费 team.* 键（下钻返回/移除确认/引用任务等）。
  files.push(fileURLToPath(new URL("../app-shell/TeamSidePane.tsx", import.meta.url)));
  // §21 A10（2026-10-24）：v4/ConversationStatusPanel.tsx 的 team 分区标题行消费
  // `team.ui.title`（§19 契约 6）——此前不在目录外清单：正向守不查它（漏裸键）、
  // 反向守可把它判成死键（误删）。
  files.push(fileURLToPath(new URL("../v4/ConversationStatusPanel.tsx", import.meta.url)));
  return files;
}

/**
 * 源码里 formatMessage 消费的 team.* 字面量键（模板键由动态家族单独枚举）。直接扫
 * 源码里的 `"team.*"` 字符串字面量——不止 `id:` 直写：①TeamStageRail 的相位表把键存进
 * label 字段再交给 formatMessage；②三元形态 `id: cond ? "a" : "b"`（投递态三键）。
 * 两种形态都只是「源码里出现的 team 点分字面量」，正扫宽进（反向守再兜底）。
 */
function staticallyConsumedTeamKeys(): Set<string> {
  const consumed = new Set<string>();
  for (const file of teamSourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/"(team\.[a-zA-Z0-9.]+)"/g)) {
      consumed.add(match[1]!);
    }
  }
  return consumed;
}

/** 动态消费的键与键族（模板拼接/映射表；静态扫描扫不到，逐一登记出处）。 */
function dynamicallyConsumedTeamKeys(): Set<string> {
  const consumed = new Set<string>();
  // 状态徽标（TEAM_STATUS_I18N_KEYS）与五命令拒绝码（§19 契约 5 扩圈查表）。
  for (const key of Object.values(TEAM_STATUS_I18N_KEYS)) consumed.add(key);
  for (const key of Object.values(TEAM_STAGED_FAILURE_REASON_I18N_KEYS)) consumed.add(key);
  // 成员状态词（TeamPanel 的 MEMBER_STATE_I18N_KEYS）。
  for (const state of ["spawning", "working", "terminal", "removed"]) {
    consumed.add(`team.member.state.${state}`);
  }
  // 失败行动作标签（team.stagedEditor.failure.line 的 {action}）与面板动作标签
  // （team.panel.commandFailure.line 的 {action}）——模板拼接。
  for (const action of ["approve", "revise", "abandon", "rename"]) {
    consumed.add(`team.stagedEditor.${action}`);
  }
  for (const action of ["halt", "resume", "stop"]) {
    consumed.add(`team.panel.action.${action}`);
  }
  // 工作区视图 tab（TeamWorkspaceViews 的 `team.ui.${view}`）与协作关系层切换钮
  // （TeamCollaborationPanel 的 `team.ui.${value}`，values = dependencies/messages/handoffs）。
  for (const view of ["overview", "process", "collaboration"]) {
    consumed.add(`team.ui.${view}`);
  }
  for (const layer of ["dependencies", "messages", "handoffs"]) {
    consumed.add(`team.ui.${layer}`);
  }
  // 成员权限模式标签（§10 增补三：TeamStagedEditor 的 `team.permission.mode.${mode}`，
  // mode 全集 = teamPermissionModeSchema.options）。
  for (const mode of ["build", "edit", "yolo", "guarded", "auto"]) {
    consumed.add(`team.permission.mode.${mode}`);
  }
  // 门占位文案（TeamMemberSidePane 的 `${view.id}.title/.body`，基名是源码字面量）。
  for (const base of TITLE_BODY_KEY_BASES) {
    consumed.add(`${base}.title`);
    consumed.add(`${base}.body`);
  }
  // §22 契约 3（2026-10-27 审查 M13）：终态汇报两 kind 的历史标签键——TeamProcessPanel
  // 经 `team.history.kind.${entry.kind}` 模板拼接消费（前缀族已放行），此处显式登记
  // 并在下方「终局事实标签」用例中逐键断言双语在场——前缀族只守「不判死键」，
  // 逐键存在性由用例锁定，双侧同删可被发现。
  consumed.add("team.history.kind.final_report_dispatched");
  consumed.add("team.history.kind.final_report_delivered");
  // 「回对话修改」预填追问（常量键，revise-prefill.ts 单一出处）。
  consumed.add(TEAM_REVISE_PREFILL_PROMPT_KEY);
  return consumed;
}

/** 键族前缀（journal 事件种类与任务状态词由服务端事实枚举，UI 不穷举）。 */
const DYNAMIC_KEY_PREFIXES = ["team.history.kind.", "team.task.status."] as const;

/**
 * 门占位文案的键基（TeamMemberSidePane 的 not-started/member-absent/team-absent）：
 * 源码字面量是基名，真实消费键是 `${base}.title`/`${base}.body`。
 */
const TITLE_BODY_KEY_BASES = [
  "team.memberPane.notStarted",
  "team.memberPane.memberAbsent",
  "team.memberPane.teamAbsent",
] as const;

describe("team i18n 源码扫描双守（§19 契约 6，评审 Low-18）", () => {
  it("源码 formatMessage 的每个 team.* 字面量键在双语词典非空（漏一侧即裸键）", () => {
    const consumed = staticallyConsumedTeamKeys();
    // 至少覆盖 stagedDock/memberPane 家族——本测试存在的理由（原清单不含它们）。
    expect([...consumed].some((key) => key.startsWith("team.stagedDock."))).toBe(true);
    expect([...consumed].some((key) => key.startsWith("team.memberPane."))).toBe(true);
    for (const key of consumed) {
      const titleBody = (TITLE_BODY_KEY_BASES as readonly string[]).indexOf(key);
      if (titleBody !== -1) {
        // 门占位文案的键基（源码字面量是基名，真实键是 .title/.body）。
        for (const suffix of [".title", ".body"]) {
          expect(zhCN[key + suffix], `zh-CN ${key + suffix}`).toBeTruthy();
          expect(enUS[key + suffix], `en-US ${key + suffix}`).toBeTruthy();
        }
        continue;
      }
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });

  it("词典 team.* 键全部被消费（静态字面量、动态映射或动态键族）——双侧同删可被发现", () => {
    const consumed = staticallyConsumedTeamKeys();
    for (const key of dynamicallyConsumedTeamKeys()) consumed.add(key);
    for (const key of teamKeys(zhCN)) {
      const covered =
        consumed.has(key) || DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
      expect(covered, `未被消费的词典键：${key}`).toBe(true);
    }
  });

  // §22 契约 3（2026-10-27 审查 M13）：终态汇报两 kind 补进 shared
  // teamHistoryEntrySchema 后，TeamProcessPanel 经 team.history.kind.* 动态键族渲染
  // 标签——前缀族守卫只防「误判死键」，逐键存在性在此锁定（漏一侧即渲染裸键）。
  it("终局事实标签双语在场：final_report_dispatched/delivered 两 kind 的 team.history.kind.* 键在 zh-CN 与 en-US 均非空", () => {
    expect(teamHistoryEntrySchema.shape.kind.options).toContain("final_report_dispatched");
    expect(teamHistoryEntrySchema.shape.kind.options).toContain("final_report_delivered");
    for (const key of [
      "team.history.kind.final_report_dispatched",
      "team.history.kind.final_report_delivered",
    ]) {
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });
});
