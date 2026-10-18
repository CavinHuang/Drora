import { join } from "node:path";
import {
  BUILTIN_TEAM_COMMAND_NAME,
  expandBuiltinTeamCommandPrompt,
} from "./builtin-team-command.js";
import {
  BUILTIN_WORKFLOW_COMMAND_NAME,
  expandBuiltinWorkflowCommandPrompt,
} from "./builtin-workflow-command.js";
import { resolveAgentsTeamEnabled } from "./app/drora-team/install.js";

const BUILTIN_PROMPT_COMMAND_PATTERN = /^\/([^\s]+)(?:\s+([\s\S]*))?$/;
const INIT_COMMAND_NAME = "init";

export interface ResolveDroraBuiltinPromptCommandOptions {
  /**
   * 动态工作流灰度门（docs/dynamic-workflow/launch.md「Gray release」）。**只有显式 false 才挡下**
   * `/workflow`：TUI / headless 从不设置该字段，那里的功能始终开启。挡下时返回 undefined，
   * 与「命令不存在」同形——`workflow` 是保留名，后续的自定义命令解析同样拒绝展开，于是原文作为
   * 普通 prompt 交给模型，与目录侧剔除它的结论一致（DWG-03）。
   */
  dynamicWorkflowEnabled?: boolean;
  /** Agents Team 灰度(create-app 从 settings agentsTeam.enabled 传入;缺省回落 env)。 */
  agentsTeamEnabled?: boolean;
  workingDirectory?: string;
}

export interface ResolvedDroraBuiltinPromptCommand {
  /** 命中的内置命令名（`init` / `workflow`），调用方据此挂命令特有的副作用（如 onDemand 激活）。 */
  name: string;
  prompt: string;
}

export function resolveDroraBuiltinPromptCommand(
  input: string,
  options: ResolveDroraBuiltinPromptCommandOptions = {},
): string | undefined {
  return resolveDroraBuiltinPromptCommandInvocation(input, options)?.prompt;
}

export function resolveDroraBuiltinPromptCommandInvocation(
  input: string,
  options: ResolveDroraBuiltinPromptCommandOptions = {},
): ResolvedDroraBuiltinPromptCommand | undefined {
  const invocation = parseBuiltinPromptCommandInvocation(input);
  if (!invocation) {
    return undefined;
  }

  if (invocation.name === INIT_COMMAND_NAME) {
    const workingDirectory = options.workingDirectory ?? process.cwd();
    return {
      name: INIT_COMMAND_NAME,
      prompt: buildInitAgentsPrompt({
        args: invocation.args,
        targetPath: join(workingDirectory, "AGENTS.md"),
        workingDirectory,
      }),
    };
  }

  if (invocation.name === BUILTIN_WORKFLOW_COMMAND_NAME) {
    if (options.dynamicWorkflowEnabled === false) {
      return undefined;
    }
    return {
      name: BUILTIN_WORKFLOW_COMMAND_NAME,
      prompt: expandBuiltinWorkflowCommandPrompt(invocation.args),
    };
  }

  if (invocation.name === BUILTIN_TEAM_COMMAND_NAME) {
    // 灰度与装配接缝同门(resolveAgentsTeamEnabled:显式值优先于 env DRORA_AGENTS_TEAM=1,
    // specs/agents-team.md §11 v1 过渡;帮助表条目与命令注册同门,01-design §1.1);
    // settings 键 agentsTeam.enabled 的设置面 M2 接入后改走同一来源(只改调用点传值)。
    if (!resolveAgentsTeamEnabled()) {
      return undefined;
    }
    return {
      name: BUILTIN_TEAM_COMMAND_NAME,
      prompt: expandBuiltinTeamCommandPrompt(invocation.args),
    };
  }

  return undefined;
}

function parseBuiltinPromptCommandInvocation(input: string): { args: string; name: string } | null {
  const match = BUILTIN_PROMPT_COMMAND_PATTERN.exec(input.trim());
  if (!match?.[1]) {
    return null;
  }
  return {
    args: match[2]?.trim() ?? "",
    name: match[1].toLowerCase(),
  };
}

function buildInitAgentsPrompt(params: {
  args: string;
  targetPath: string;
  workingDirectory: string;
}): string {
  const additionalInstructions = params.args
    ? [
        "",
        "Additional user instructions supplied with /init:",
        "```text",
        params.args,
        "```",
      ].join("\n")
    : "";

  return [
    "You are running Drora's built-in /init command.",
    "",
    "Your task is to create or update a concise workspace instruction file for future Drora agents.",
    "",
    "Target:",
    `- Workspace directory: ${params.workingDirectory}`,
    `- Instruction file: ${params.targetPath}`,
    `- Existing hidden instruction candidates: ${join(params.workingDirectory, ".drora", "AGENTS.md")} and ${join(params.workingDirectory, ".agents", "AGENTS.md")}`,
    "- File name must be exactly AGENTS.md.",
    "- This command targets the current workspace only. Do not write ~/.drora/AGENTS.md.",
    additionalInstructions,
    "",
    "Process:",
    "1. First check whether .drora/AGENTS.md or .agents/AGENTS.md exists in the workspace. If either exists, tell the user they already have an instructions file, mention the path found, and stop without creating a new AGENTS.md.",
    "2. Inspect the repository before writing. Prefer Read, Glob, Grep, and safe Bash commands such as ls, find, git status, and package-manager script inspection.",
    "3. If AGENTS.md already exists, read it first and update it with Edit instead of replacing it wholesale.",
    "4. If AGENTS.md does not exist, create it at the workspace root.",
    "5. Keep the file practical and short enough for future agents to read quickly.",
    "6. Include only project-specific facts future Drora agents would otherwise miss.",
    "7. Ask the user only if a repository-specific decision cannot be inferred and would materially change the file.",
    "",
    "Recommended AGENTS.md content:",
    "- Repository purpose and major directories.",
    "- Build, typecheck, lint, and focused test commands discovered from the repo.",
    "- Architecture boundaries and layer rules that matter for edits.",
    "- Coding conventions, import/path rules, logging rules, UI/design rules, and platform compatibility constraints if present.",
    "- Known gotchas for desktop app, web, remote, stdio, protocols, or agent runtime if this repo has them.",
    "- Any documentation files that agents should read before changing sensitive areas.",
    "",
    "After creating or editing AGENTS.md, summarize the main sections you wrote and mention the file path.",
  ].join("\n");
}
