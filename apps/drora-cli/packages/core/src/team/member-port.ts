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
  /**
   * agentId 预分配工厂（透传 runner 的 createAgentId）。install 在 launch 前预分配
   * agentId 并预登记装配期绑定：成员首回合构造（roster 尚未 confirmMemberSpawned）
   * 才能按 spec §8.1 读到成队定死的权限模式，而不是回退 lead 当前模式。缺省由
   * runner 自行生成（测试注入路径行为不变）。
   */
  createAgentId?: () => string;
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
    ...(input.createAgentId === undefined ? {} : { createAgentId: input.createAgentId }),
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
