/**
 * P1b 学习管理面的纯辅助（校验/摘要/概览组合）。从 persona-app-service 拆出满足
 * max-file-lines（同批 7「学习运行时拆出」先例）；编排（runManaged 错误通道/计时）与
 * 存储访问仍属服务类，本文件零 IO。语义依据 docs/design/drora-persona-data-contracts-2026-10-29.md
 * §3 allowLearningForKey 与读侧概览（新增读侧方法，偏差记录见 spec §13 实施跟踪）。
 */
import {
  type PersonaAllowLearningInput,
  type PersonaLearningOverview,
  type PersonaLearningOverviewBudgetUsage,
  type PersonaLearningOverviewSource,
  type PersonaPolicyFacts,
  PERSONA_PREFERENCE_KEYS,
} from "@drora/shared";
import type { PersonaLearningCounters } from "./learning-contract.js";

export function isValidAllowLearningInput(
  input: PersonaAllowLearningInput,
  isValidMutationId: (mutationId: unknown) => mutationId is string,
): boolean {
  if (!isValidMutationId(input.mutationId) || typeof input.expectedGeneration !== "number") {
    return false;
  }
  if (!Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) {
    return false;
  }
  return (
    typeof input.key === "string" &&
    Object.values(PERSONA_PREFERENCE_KEYS).includes(
      input.key as (typeof PERSONA_PREFERENCE_KEYS)[keyof typeof PERSONA_PREFERENCE_KEYS],
    )
  );
}

/** requestDigest 只由规范请求内容（op＋key＋expectedGeneration）决定（合同 §2/PM53）。 */
export function allowLearningRequestDigest(
  sha256Canonical: (value: unknown) => string,
  input: PersonaAllowLearningInput,
): string {
  return sha256Canonical({
    op: "allowLearningForKey",
    key: input.key,
    expectedGeneration: input.expectedGeneration,
  });
}

/**
 * 概览组合：行形状与 store 只读方法逐键对齐——policy 取自 readSnapshot 的 policy 行、
 * budget 取自 readLearningBudgetUsage、sources 取自 readInferredSlotSources（只保留
 * 定位四元组，省略 messageBoundary/sourceRevision 复验内部定位，无正文）；counters 是
 * 本 CLI 进程学习消费者计数（跨进程不聚合）。per-work 队列行不在快照内：仓储无 per-work
 * 只读方法，工作状态概览以计数呈现（设计级缺口见 deviations）。
 */
export function composeLearningOverview(
  policy: PersonaPolicyFacts,
  budget: PersonaLearningOverviewBudgetUsage,
  sources: readonly PersonaLearningOverviewSource[],
  counters: PersonaLearningCounters,
): PersonaLearningOverview {
  return {
    state: "initialized",
    policy: {
      usePreferences: policy.usePreferences,
      autoLearn: policy.autoLearn,
      policyRevision: policy.policyRevision,
      policyEpoch: policy.policyEpoch,
      learningGeneration: policy.learningGeneration,
    },
    budget: {
      day: budget.day,
      attemptsUsed: budget.attemptsUsed,
      inputTokensUsed: budget.inputTokensUsed,
      outputTokensUsed: budget.outputTokensUsed,
    },
    sources: sources.map((binding) => ({
      key: binding.key,
      evidenceId: binding.evidenceId,
      workspaceKey: binding.workspaceKey,
      sessionId: binding.sessionId,
    })),
    counters: { ...counters },
  };
}
