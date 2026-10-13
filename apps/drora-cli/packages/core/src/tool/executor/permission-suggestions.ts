import { PermissionCapabilityGroup, type PermissionUpdate } from "@drora/contracts";
import { OFFICIAL_CUA_PERMISSION_RULE_TOOL_NAME } from "@drora/shared";
import { isP0WriteTarget } from "../../permission/write-tier-policy.js";

const PROJECT_RULE_INPUT_KEYS = ["command", "url", "file_path", "path", "pattern"] as const;

export function buildDefaultPermissionUpdates(
  toolName: string,
  input: unknown,
  capabilityGroup?: PermissionCapabilityGroup,
  capability?: { permissionName?: string; readOnly?: boolean },
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
  // S03 洞 2 建议侧（specs/agent-write-safety.md §2）：P0 工具（Bash/js/未自报 readOnly
  // 的 MCP）提取不到内容时不给「总是允许」建议——整工具持久 allow 是被禁的通道，确认窗
  // 不应该提供它。Bash 走自有 rulePolicy（内容级建议），正常到不了这里。
  if (!ruleContent && isP0WriteTarget({ toolName, ...capability })) {
    return [];
  }
  return [
    {
      behavior: "allow",
      rules: [
        {
          toolName,
          ...(ruleContent ? { ruleContent } : {}),
        },
      ],
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
