import type { PermissionRuleBehavior, PermissionRuleValue } from "@drora/contracts";
import { wildcardToRegExp } from "../../permission/rule-matching.js";

interface BashRuleEvaluationInput {
  allSubjectGroups: readonly (readonly string[])[];
  behavior: PermissionRuleBehavior;
  exactCommands: readonly string[];
  requiredSubjectGroups: readonly (readonly string[])[];
  rules: readonly PermissionRuleValue[];
  safe: boolean;
}

export function evaluateBashRules(input: BashRuleEvaluationInput): boolean {
  const hasWholeToolRule = input.rules.some((rule) => !rule.ruleContent);
  if (hasWholeToolRule) {
    // W08 写安全门禁（specs/write-safety-gating.md §2.4，W00 三洞 B4）：整工具 allow
    // 规则只豁免安全命令（safe=可解析、无重定向、无动态词）；不安全命令不再短路，
    // 回落内容规则匹配，仍无匹配则由调用方维持缺省 ask。deny/ask 方向保持全量匹配
    // （fail-closed 方向不变）。
    if (input.behavior !== "allow" || input.safe) return true;
  }
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
        input.rules.some((rule) => matchesInvocationRule(subject, rule.ruleContent, input.behavior)),
      ),
    );
  }
  return subjectGroups.every((subjects) =>
    subjects.some((subject) =>
      input.rules.some((rule) => matchesInvocationRule(subject, rule.ruleContent, input.behavior)),
    ),
  );
}

function matchesInvocationRule(
  subject: string,
  ruleContent: string | undefined,
  behavior: PermissionRuleBehavior,
): boolean {
  if (!ruleContent) {
    // allow 行为下空内容规则不计入逐主体匹配——否则整工具 allow 经由 subjectGroups
    // 重新短路一切命令，绕过上方「只豁免安全命令」的闸（与 specs/write-safety-gating.md
    // §2.4 同一契约的求值内层）。deny/ask 保持全量匹配。
    return behavior !== "allow";
  }
  if (ruleContent.endsWith(":*")) {
    const prefix = ruleContent.slice(0, -2);
    return (
      subject === prefix || subject.startsWith(`${prefix} `) || subject.startsWith(`${prefix}\t`)
    );
  }
  if (ruleContent.includes("*")) return wildcardToRegExp(ruleContent).test(subject);
  return subject === ruleContent;
}
