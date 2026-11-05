/**
 * 准入门纯函数（specs/drora-personal-assistant.md §6 矩阵；01 详设 §1.1）。
 * harness 所有：名单/模式从 Config 传入，消息永远不能改变权限（Mandate 不变式）。
 * P1 仅 local Source：strength 由 UI 双按钮模拟；P3 起由真实 Source 判定
 * （mention && allowlist → explicit，否则 inferred）后本函数零改动消费。
 */

import {
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_STRENGTHS,
  type AssistantMode,
  type AssistantOutcome,
  type AssistantStrength,
} from "@drora/shared";

export interface AdmissionGateConfig {
  readonly mode: AssistantMode;
  readonly allowlist: readonly string[];
}

export interface AdmissionGateInput {
  readonly strength: AssistantStrength;
  /** 触发者 identity；P1 local=本机用户，且必须已在 allowlist（P1 名单即本机用户）。 */
  readonly identity: string;
}

export interface AdmissionGateVerdict {
  readonly strength: AssistantStrength;
  readonly outcome: AssistantOutcome;
  /** 拒绝原因码（outcome=rejected/ignored 时有值）。 */
  readonly reasonCode?: string;
}

export function evaluateAdmission(
  input: AdmissionGateInput,
  config: AdmissionGateConfig,
): AdmissionGateVerdict {
  // 名单外触发（P3 的 unlisted 来源）：拒绝并记录——即使自称 explicit 也不放行
  //（"消息不能改变权限"：mention/正文只是输入）。
  const listed = config.allowlist.includes(input.identity);
  if (!listed) {
    return {
      strength: input.strength,
      outcome: ASSISTANT_OUTCOMES.rejected,
      reasonCode: "identity_not_in_allowlist",
    };
  }

  if (config.mode === ASSISTANT_MODES.off) {
    return {
      strength: input.strength,
      outcome: ASSISTANT_OUTCOMES.ignored,
      reasonCode: "mode_off",
    };
  }

  // observe（P1 唯一开放模式，P4 起与 auto 并列）：全量零执行。
  //   explicit → 决策卡（人工放行才执行）；inferred → would-accept 记录。
  // auto（P4 信任门解锁后可达，spec §6 矩阵行；04 详设 §2 落地注记）：
  //   explicit → auto_notice（告知卡=直接执行的自动事件；目标缺席/探测失败由服务侧
  //   在落库时降级 decision_card 问人——本纯函数不看目标，只判强度×模式）；
  //   inferred → decision_card 进候选卡循环，Router 建议（dispatch/attach 臂+evidence
  //   ≥1）经服务侧 onSuggested 钩子复核后自动建票，否则留卡问人。执行时点服务侧复核
  //   mode（gate 与派发之间切回 observe → 不自动执行）。
  if (config.mode === ASSISTANT_MODES.observe) {
    return input.strength === ASSISTANT_STRENGTHS.explicit
      ? { strength: input.strength, outcome: ASSISTANT_OUTCOMES.decisionCard }
      : { strength: input.strength, outcome: ASSISTANT_OUTCOMES.wouldAccept };
  }
  return input.strength === ASSISTANT_STRENGTHS.explicit
    ? { strength: input.strength, outcome: ASSISTANT_OUTCOMES.autoNotice }
    : { strength: input.strength, outcome: ASSISTANT_OUTCOMES.decisionCard };
}
