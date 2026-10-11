import { PermissionCapabilityGroup, type PermissionUpdate } from "@drora/contracts";
import { OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME } from "@drora/shared";

const PROJECT_RULE_INPUT_KEYS = ["command", "url", "file_path", "path", "pattern", "code"] as const;

export function buildDefaultPermissionUpdates(
  toolName: string,
  input: unknown,
  capabilityGroup?: PermissionCapabilityGroup,
): PermissionUpdate[] {
  if (capabilityGroup) {
    if (capabilityGroup !== PermissionCapabilityGroup.OfficialCua) {
      throw new Error(`Unsupported permission capability group: ${capabilityGroup}`);
    }
    return [
      {
        behavior: "allow",
        rules: [{ toolName: OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME }],
        type: "addRules",
      },
    ];
  }

  const ruleContent = ruleContentFromInput(input);
  if (!ruleContent) {
    // W08 写安全门禁（specs/write-safety-gating.md §2.3，W00 三洞 P5/P6）：找不到可限定
    // 内容键时不再建议整工具 allow——原实现一次「总是允许」即持久化全权规则。本次调用
    // 的批准不受影响（走逐次批准路径），只是不产生持久规则。OfficialCua 能力组例外保留
    // （上方分支：宿主验证后的可信能力）。
    return [];
  }
  return [
    {
      behavior: "allow",
      rules: [{ toolName, ruleContent }],
      type: "addRules",
    },
  ];
}

function ruleContentFromInput(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim().length > 0) return input;
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  for (const key of PROJECT_RULE_INPUT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}
