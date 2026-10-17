import { expandCustomCommandPrompt, type CustomCommandContent } from "@drora/contracts";
import { AGENTS_TEAM_SKILL_NAME } from "@drora/contracts";
import { BUILTIN_DRORA_SLASH_COMMAND_HELP_ENTRIES } from "@drora/shared";

/**
 * 内置 `/team` 命令（specs/agents-team.md §1；照 builtin-workflow-command.ts 体例——
 * 代码定义的 prompt 型内置命令：名字进 shared 帮助表保留字表，正文复用 contracts
 * 的 custom command 展开（$ARGUMENTS 替换 + `skills:` 前言），模型看到的提示词与
 * 插件形态逐字同形。2026-09-19 事故教训：命令必须与加号菜单入口同生共死，不挂插件。
 */
export const BUILTIN_TEAM_COMMAND_NAME = "team";

const helpEntry = BUILTIN_DRORA_SLASH_COMMAND_HELP_ENTRIES.find(
  (entry) => entry.name === BUILTIN_TEAM_COMMAND_NAME,
);
if (!helpEntry) {
  // 共享 help 表是保留字、TUI 候选与 App 目录的唯一来源；条目缺席时命令根本不可寻址。
  throw new Error(`Missing builtin slash command help entry: ${BUILTIN_TEAM_COMMAND_NAME}`);
}

const USAGE_PREFIX = `/${BUILTIN_TEAM_COMMAND_NAME} `;
export const BUILTIN_TEAM_COMMAND_DESCRIPTION = helpEntry.summary;
export const BUILTIN_TEAM_COMMAND_ARGUMENT_HINT = helpEntry.usage.startsWith(USAGE_PREFIX)
  ? helpEntry.usage.slice(USAGE_PREFIX.length)
  : "";

/** `$ARGUMENTS` 必须在场：否则展开会把参数追加成位置不受控的 "User arguments:" 尾块。 */
const BUILTIN_TEAM_COMMAND_BODY = [
  `Use the \`${AGENTS_TEAM_SKILL_NAME}\` skill to assemble and coordinate an agent team for this request:`,
  "",
  "$ARGUMENTS",
  "",
  "Follow the staged protocol: draft the member roster and the task DAG first — no member is",
  "spawned before the user approves the plan (TeamStage → review → approve). After approval,",
  "delegate through the shared task board and communicate via TeamSendMessage; members report",
  "with source_task_id/source_attempt_id. Results land on disk with artifact references.",
  "",
].join("\n");

export const BUILTIN_TEAM_COMMAND: CustomCommandContent = {
  bytesRead: Buffer.byteLength(BUILTIN_TEAM_COMMAND_BODY),
  content: BUILTIN_TEAM_COMMAND_BODY,
  metadata: {
    allowedTools: [],
    argumentHint: BUILTIN_TEAM_COMMAND_ARGUMENT_HINT,
    description: BUILTIN_TEAM_COMMAND_DESCRIPTION,
    disableNonInteractive: false,
    frontmatterKeys: ["description", "argument-hint", "skills"],
    name: BUILTIN_TEAM_COMMAND_NAME,
    path: `builtin:${BUILTIN_TEAM_COMMAND_NAME}`,
    rootPath: "builtin:",
    scope: "system",
    skills: [AGENTS_TEAM_SKILL_NAME],
    source: "drora",
  },
  sizeBytes: Buffer.byteLength(BUILTIN_TEAM_COMMAND_BODY),
  truncated: false,
};

export function expandBuiltinTeamCommandPrompt(args: string): string {
  return expandCustomCommandPrompt({ args, command: BUILTIN_TEAM_COMMAND }).prompt;
}
