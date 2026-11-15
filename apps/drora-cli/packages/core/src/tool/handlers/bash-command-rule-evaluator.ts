import type { PermissionRuleBehavior, PermissionRuleValue } from "@drora/contracts";
import { wildcardToRegExp } from "../../permission/rule-matching.js";

export interface BashRuleEvaluationInput {
  allSubjectGroups: readonly (readonly string[])[];
  behavior: PermissionRuleBehavior;
  exactCommands: readonly string[];
  requiredSubjectGroups: readonly (readonly string[])[];
  rules: readonly PermissionRuleValue[];
  safe: boolean;
}

export function evaluateBashRules(input: BashRuleEvaluationInput): boolean {
  // 2026-11-14 用户裁定：整工具 allow（allowedTools 面）×P0 与上游语义冲突时以上游为
  // 基准——恢复上游 v3.18.0 的「无 ruleContent 整工具规则恒短路」；S03 洞 3「仅 safe
  // 命令短路」守卫废弃（specs/agent-write-safety.md 裁定注记、specs/drora-divergence-ledger.md 台账 33）。
  if (input.rules.some((rule) => !rule.ruleContent)) return true;
  if (
    input.exactCommands.some((command) => command.length > 0) &&
    input.rules.some((rule) => input.exactCommands.includes(rule.ruleContent ?? ""))
  ) {
    return true;
  }
  if (!input.safe) return false;

  const subjectGroups =
    input.behavior === "allow" ? input.requiredSubjectGroups : input.allSubjectGroups;
  if (subjectGroups.length === 0) return false;
  if (input.behavior !== "allow") {
    return subjectGroups.some((subjects) =>
      subjects.some((subject) =>
        input.rules.some((rule) => matchesInvocationRule(subject, rule.ruleContent)),
      ),
    );
  }
  return subjectGroups.every((subjects) =>
    subjects.some((subject) =>
      input.rules.some((rule) => matchesInvocationRule(subject, rule.ruleContent)),
    ),
  );
}

function matchesInvocationRule(subject: string, ruleContent: string | undefined): boolean {
  if (!ruleContent) return true;
  if (ruleContent.endsWith(":*")) {
    const prefix = ruleContent.slice(0, -2);
    return subject === prefix || subject.startsWith(`${prefix} `) || subject.startsWith(`${prefix}\t`);
  }
  if (ruleContent.includes("*")) return wildcardToRegExp(ruleContent).test(subject);
  return subject === ruleContent;
}
