import { describe, expect, it } from "vitest";

import enUS from "../i18n/locales/en-US.js";
import zhCN from "../i18n/locales/zh-CN.js";
import {
  buildTeamReviseComposerPrefill,
  TEAM_REVISE_PREFILL_PROMPT_KEY,
} from "./revise-prefill.js";

/**
 * 「回对话修改」会话输入框预填文案构造断言（design 01 §3.1「会话输入框预填
 * 『要调整什么？』」；拼接/携带规则见 revise-prefill.ts 头注）。
 *
 * 重点锁三件事：
 * 1. 无 note → 预填 = 追问文案本身（design 01 §3.1 的字面行为）；
 * 2. note 在场 → 随行进预填（v1 边界：bootstrap reviseTeamPlan handler 不消费
 *    wire note，面板输入不进预填就丢了）；
 * 3. 追问文案键双语在册（zh 逐字对齐 design 01 §3.1 的「要调整什么？」）。
 */

const QUESTION_ZH = zhCN[TEAM_REVISE_PREFILL_PROMPT_KEY];

describe("buildTeamReviseComposerPrefill", () => {
  it("无 note：预填 = 追问文案本身（design 01 §3.1 字面行为）", () => {
    expect(buildTeamReviseComposerPrefill({ question: "要调整什么？" })).toBe("要调整什么？");
  });

  it("note 在场：追问文案 + 换行 + note（用户可续写/直接发送）", () => {
    expect(
      buildTeamReviseComposerPrefill({
        question: "要调整什么？",
        note: "把 alice 的路由换成 deepseek",
      }),
    ).toBe("要调整什么？\n把 alice 的路由换成 deepseek");
  });

  it("空白 note 视同缺席（与 TeamStagedEditor 的 trim 语义一致）", () => {
    expect(buildTeamReviseComposerPrefill({ question: "要调整什么？", note: "   " })).toBe(
      "要调整什么？",
    );
  });

  it("两端 trim：词典/输入框带出的空白不进 composer", () => {
    expect(buildTeamReviseComposerPrefill({ question: "  要调整什么？  " })).toBe("要调整什么？");
    expect(
      buildTeamReviseComposerPrefill({ question: " 要调整什么？ ", note: " 加两个成员 " }),
    ).toBe("要调整什么？\n加两个成员");
  });

  it("TeamSidePane revise 接线的实参形状：payload.note 缺席时不携带 note 键的组合输出", () => {
    // 接线处（TeamSidePane handlePanelCommand）按 exactOptionalPropertyTypes 条件展开：
    // note 缺席 → { question }；note 在场 → { question, note }。这里锁两种展开的输出。
    const payloadWithoutNote: { note?: string } = {};
    const payloadWithNote: { note?: string } = { note: "砍掉 bob" };
    expect(
      buildTeamReviseComposerPrefill({
        question: QUESTION_ZH ?? "",
        ...(payloadWithoutNote.note === undefined ? {} : { note: payloadWithoutNote.note }),
      }),
    ).toBe("要调整什么？");
    expect(
      buildTeamReviseComposerPrefill({
        question: QUESTION_ZH ?? "",
        ...(payloadWithNote.note === undefined ? {} : { note: payloadWithNote.note }),
      }),
    ).toBe("要调整什么？\n砍掉 bob");
  });
});

describe("team.revise.prefillPrompt i18n key", () => {
  it("双语词典非空在册（缺一侧即裸键，i18n.test.ts 的键集对齐断言同源兜底）", () => {
    expect(QUESTION_ZH).toBeTruthy();
    expect(enUS[TEAM_REVISE_PREFILL_PROMPT_KEY]).toBeTruthy();
  });

  it("zh 值逐字对齐 design 01 §3.1 的追问文案「要调整什么？」", () => {
    expect(QUESTION_ZH).toBe("要调整什么？");
  });
});
