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
  "Follow the staged protocol: call TeamSpawn once with a manager plus the member roster and",
  "the task DAG — no one is spawned before the user approves the plan (TeamSpawn → review →",
  "approve). The team structure starts with the manager: name a manager yourself first (it",
  "coordinates tasks, consumes member reports, reassigns work, and delivers exactly one final",
  "report), then list worker members, then the DAG. After approval, workers report to the",
  "manager via TeamSendMessage (to=manager, with source_task_id/source_attempt_id) — never to",
  "the lead. Results land on disk with artifact references.",
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

/**
 * 灰度关时的 `/team` 展开产物（specs/agents-team.md §17 契约 2）：确定性「未开启」提示，
 * 替代 DWG-03 形态的原文透传——**仅 team 的有意分歧**（workflow 保持透传不变，其工具门是
 * 「显式 false 才挡」且 TUI/headless 恒开）。透传曾让模型拿着 agents-team 技能（现随 §17
 * 契约 1 同门隐藏）即兴扮演团队：AskUserQuestion 假审批、谎称建队。这条提示把剩余的即兴
 * 空间一并关死，再按普通任务处理请求本体。无 skills 前言——本会话不该再加载任何团队技能。
 */
const BUILTIN_TEAM_DISABLED_NOTICE_BODY = [
  "The `/team` command is unavailable: the Agents Team feature is not enabled for this session.",
  "",
  "Tell the user:",
  "- Agents Team is disabled. Enable it in Settings → \"Agents Team\"; it takes effect for agent",
  "  processes created afterwards — restart the app (or open a new window), then start a new",
  "  session. Sessions in already-running windows stay disabled.",
  "",
  "Do not simulate an agent team: do not use AskUserQuestion to fake a team plan approval, do not",
  "claim any team or team member was created, and do not try to load the `agents-team` skill (it is",
  "unavailable in this session).",
  "",
  "Then help with the rest of the request as a normal task unless the user says otherwise:",
  "",
  "$ARGUMENTS",
  "",
].join("\n");

export function expandBuiltinTeamDisabledNoticePrompt(args: string): string {
  // 函数形式替换：args 里的 `$&`/`$1` 等序列不得被当成替换模式解释。
  return BUILTIN_TEAM_DISABLED_NOTICE_BODY.replace("$ARGUMENTS", () => args);
}
