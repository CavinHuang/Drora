import { createExploreSubagentPort } from "../subagent/runner.js";
import type { SubagentPort } from "@drora/contracts";
import { createTeamMemberRunExploreAgent, type TeamMemberBinding } from "./member-runtime.js";
import type { AgentRuntimeInternal } from "../runtime/internal.js";
import type { AgentRuntimeDeps } from "../runtime/types.js";
import type { ToolRegistry } from "../tool/registry.js";
import type { RuntimeTaskRegistry } from "../runtime-task/registry.js";

/**
 * TeamHub 私有 team 化 SubagentPort（v2 核心，spec §11）：
 * `createExploreSubagentPort` 的 `runExploreAgent` 是必传构造回调——传我们的
 * member-runtime 构造回调，复用 runner.ts 全部未修改生命周期（后台结算/消息复活/
 * abort 级联/watchdog）。团队性由「走哪个端口」承载：Agent 工具走的默认端口一字不动。
 */

export interface TeamMemberPortFactoryInput {
  lead: AgentRuntimeInternal;
  leadDeps: AgentRuntimeDeps;
  registry: ToolRegistry;
  resolveMemberBinding: (agentId: string) => TeamMemberBinding | undefined;
  runtimeTaskRegistry?: RuntimeTaskRegistry;
}

export function createTeamMemberPort(input: TeamMemberPortFactoryInput): SubagentPort {
  const { lead, leadDeps } = input;
  return createExploreSubagentPort({
    logger: lead.logger,
    inactivityTimeoutMs: lead.config.subagents?.inactivityTimeoutMs,
    autoBackgroundMs: lead.config.subagents?.autoBackgroundMs,
    outputRootDir: lead.config.subagents?.outputRootDir,
    getAgentDefinitions: lead.getAgentDefinitions,
    ...(lead.config.subagents?.builtInModelSelectionOverrides === undefined
      ? {}
      : { builtInModelSelectionOverrides: lead.config.subagents.builtInModelSelectionOverrides }),
    runtimeTaskRegistry: input.runtimeTaskRegistry,
    emitParentEvent: async (event, traceContext) => {
      const { isStaleBranchRuntimeTaskEvent } = await import("../runtime/methods/runtime-command-generation.js");
      if (isStaleBranchRuntimeTaskEvent(lead, event)) return;
      await lead.appendEvent(event, traceContext);
    },
    enqueueParentTaskNotification: (notification) => {
      lead.enqueueBackgroundTaskNotification({
        originMeta: notification.originMeta,
        taskId: notification.taskId,
        text: notification.text,
        traceContext: notification.traceContext,
      });
      return undefined;
    },
    runExploreAgent: createTeamMemberRunExploreAgent({
      lead,
      leadDeps,
      registry: input.registry,
      resolveMemberBinding: input.resolveMemberBinding,
    }),
  });
}
