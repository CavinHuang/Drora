import type { SubagentRunOptions } from "@drora/contracts";
// §21 A6（2026-10-24 常量接线）：长寿命策略兜底改引登记常量（原 ?? 40 手写）。
import { TEAM_MEMBER_DEFAULT_MAX_TURNS } from "@drora/contracts";
import type {
  ExploreSubagentRuntimeRequest,
  ExploreSubagentRuntimeResult,
} from "../subagent/runner.js";
import type { ToolRegistry } from "../tool/registry.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import type { AgentRuntimeInternal } from "../runtime/internal.js";
import { cloneModelSelection } from "../runtime/model-selection.js";
import { resolveSubagentSelection } from "../runtime/helpers/subagent-selection.js";
import type { AgentRuntimeDeps } from "../runtime/types.js";
import {
  createInheritedSubagentModelFactory,
  modelSelectionFromActiveModel,
} from "../runtime/methods/subagent.js";
import { getSessionShellEnvironment } from "../runtime/methods/session-shell-environment.js";
import { deriveChildClientPorts } from "../runtime/helpers/child-client-ports.js";
import { createCoordinatorResponsePort } from "../subagent/coordinator-response.js";
// 2026-10-21 缺口8（spec §7/§14）：成员消息 sink 换 team 自有实现——通用 sink 硬编码
// coordinator_steer（无 PEER_PERMISSION_GUIDANCE 禁令渲染）；team sink 经
// MEMBER_STEER_PRESENTATION（subagent_reply_steer）注入，禁令 + 回信指引随渲染携带。
import { createTeamMemberMessageSink } from "./member-sink.js";
import { mirrorSubagentToolEvent } from "../subagent/tool-event-mirror.js";
import { isBuiltInExploreAgentProfile } from "../subagent/profile.js";

/**
 * teammate 子 runtime 构造回调（v2 路线 1：对 methods/subagent.ts 装配区的**有意复制**，
 * 上游镜像文件零编辑；失败模式 = 上游改装配签名时本文件 typecheck 显式报错）。
 *
 * v1 收窄（决策登记，PR-1.6 补齐）：成员不带 MCP / skills / CUA / 持久记忆——
 * 这四域的原装配依赖 subagent.ts 模块私有 helper（约 400 行，不可导入）。
 * 其余完整复刻：模型继承链、deriveChildClientPorts 交互回路由、事件镜像、
 * resume/persist 双路、消息 sink、executeTurn。
 *
 * 团队增量（本文件存在的理由）：
 * - deps.toolRegistry = hub 自建注册表（团队工具闭包已注册，team-tools.ts）；
 * - mode = 成队时定死的记录值（profile permissionMode 链不生效，spec §8.1），planEnabled=false；
 * - maxTurns = 花名册记录值（长寿命策略，spec §2.4）；
 * - taskType 保持 "subagent_child"（22 处行为门全继承，spec §9）。
 */

export interface TeamMemberBinding {
  memberName: string;
  permissionMode?: "build" | "edit" | "yolo" | "guarded" | "auto";
  memberMaxTurns?: number;
}

export interface TeamMemberRuntimeFactoryInput {
  lead: AgentRuntimeInternal;
  leadDeps: AgentRuntimeDeps;
  /** hub 自建并预注册团队工具的注册表实例（构造注入 → 内建装配与 22 门照常）。 */
  registry: ToolRegistry;
  /** agentId → 花名册绑定（hub 花名册是唯一事实源）。 */
  resolveMemberBinding: (agentId: string) => TeamMemberBinding | undefined;
}

export type TeamMemberRunExploreAgent = (
  request: ExploreSubagentRuntimeRequest,
  options?: SubagentRunOptions,
) => Promise<ExploreSubagentRuntimeResult>;

export function createTeamMemberRunExploreAgent(
  input: TeamMemberRuntimeFactoryInput,
): TeamMemberRunExploreAgent {
  const { lead, leadDeps, registry, resolveMemberBinding } = input;
  return async (request, options) => {
    request.reportActivity?.();
    const builtInExplore = isBuiltInExploreAgentProfile(request.profile);
    const binding = resolveMemberBinding(request.agentId);
    const agentsMdInstructions =
      request.profile.injectAgentsMd !== false
        ? lead.contextSourceSnapshot?.userInstructions
        : undefined;
    // §21 C：hasConcreteModel 解构未用（死解构清除）——selection 即本函数消费值。
    const { selection: profileChildSelection } = resolveSubagentSelection({
      profileSelection: request.profile.modelSelection,
      parentSelection: lead.getSessionModelSelection(),
      overrideSelection: options?.modelOverride?.selection,
      resolveSelection: leadDeps.resolveEffectiveModelSelection,
    });
    const inheritedModel = options?.modelOverride === undefined ? options?.model : undefined;
    const childSelection = inheritedModel
      ? modelSelectionFromActiveModel(inheritedModel)
      : profileChildSelection;
    const baseChildEnvInfo = lead.contextSourceSnapshot?.envInfo ??
      lead.config.envInfo ?? {
        cwd: request.workingDirectory,
        platform: "unknown",
        shell: "unknown",
        osVersion: "unknown",
        nodeVersion: "unknown",
      };
    const shellEnvironment = getSessionShellEnvironment(lead);
    const childEnvInfo = {
      ...baseChildEnvInfo,
      ...(shellEnvironment ? { shell: shellEnvironment.promptShell } : {}),
    };
    const agentPrompt =
      request.systemPrompt?.trim() === "" ? undefined : request.systemPrompt?.trim();
    const childRuntimeEnvInfo = { ...childEnvInfo, cwd: request.workingDirectory };
    const baseChildModelFactory =
      options?.modelOverride !== undefined
        ? undefined // v1 收窄：成员不支持临时模型覆写（路由快照见 spec §8.7）
        : inheritedModel !== undefined
          ? createInheritedSubagentModelFactory(childSelection, inheritedModel, lead.modelFactory)
          : lead.modelFactory;
    if (baseChildModelFactory === undefined) {
      throw new Error(
        `Team member model cannot resolve ${childSelection.providerId}/${childSelection.modelId}`,
      );
    }
    const childModel = baseChildModelFactory({ selection: childSelection });
    const childModelFactory: NonNullable<AgentRuntimeDeps["modelFactory"]> = (target) =>
      target.selection.providerId === childSelection.providerId &&
      target.selection.modelId === childSelection.modelId &&
      target.selection.options?.reasoningLevel === childSelection.options?.reasoningLevel
        ? childModel
        : baseChildModelFactory(target);
    // 模板的 traceStringAttribute(trace, "parentToolCallId") 依赖私有 helper；
    // 等价稳定键：agentId 即 runner 分配的成员唯一标识（deriveChildClientPorts 只用于展示/路由）。
    const parentToolCallId = `team:${request.agentId}`;
    const childClientPorts = deriveChildClientPorts(
      {
        permissionBroker: lead.permissionBroker,
        ...(lead.providerRuntimeHeadersPort === undefined
          ? {}
          : { providerRuntimeHeadersPort: lead.providerRuntimeHeadersPort }),
      },
      {
        agentId: request.agentId,
        agentType: request.agentType,
        childSessionId: request.sessionId,
        description: request.description,
        parentSessionId: lead.sessionId,
        parentToolCallId,
        ...(request.traceContext.turnId === undefined
          ? {}
          : { parentTurnId: request.traceContext.turnId }),
      },
    );
    const childBrowserControlPort =
      lead.browserControlPort?.forChildSession?.({
        childSessionId: request.sessionId,
        parentSessionId: lead.sessionId,
        tabOwner: "parent",
      }) ?? lead.browserControlPort;
    const mirroredToolNameByChildToolCallId = new Map<string, string>();
    let sessionReadyNotified = false;
    const notifySessionReady = async () => {
      if (sessionReadyNotified) return;
      await request.onSessionReady?.();
      sessionReadyNotified = true;
    };
    const permissionMode = binding?.permissionMode ?? lead.config.mode;
    // §21 A6：兜底改引 contracts TEAM_MEMBER_DEFAULT_MAX_TURNS（与 install 装配值同源）。
    const memberMaxTurns =
      binding?.memberMaxTurns ?? request.maxTurns ?? TEAM_MEMBER_DEFAULT_MAX_TURNS;
    const childRuntime = new AgentRuntime(
      request.sessionId,
      {
        mode: permissionMode,
        planEnabled: false, // spec §8.1：plan 不带入——team 总在执行
        modelSelection: cloneModelSelection(childSelection),
        modelContextBudgetStrategy: lead.config.modelContextBudgetStrategy,
        workingDirectory: request.workingDirectory,
        envInfo: childRuntimeEnvInfo,
        modelStreaming: lead.config.modelStreaming,
        bashTimeoutPolicy: lead.config.bashTimeoutPolicy,
        midConversationSystem: lead.config.midConversationSystem,
        bashShellSelection: shellEnvironment?.selection,
        currentDate: lead.contextSourceSnapshot?.currentDate ?? lead.config.currentDate,
        subagentContext: {
          agentPrompt: agentPrompt ?? "",
          ...(agentsMdInstructions ? { userInstructions: agentsMdInstructions } : {}),
        },
        agentName: `drora-team-${binding?.memberName ?? request.agentType}`,
        maxTurns: memberMaxTurns,
        parentSessionId: lead.sessionId,
        taskType: "subagent_child",
        dynamicWorkflowEnabled: lead.config.dynamicWorkflowEnabled,
        dynamicWorkflowToolsOnDemand:
          lead.config.dynamicWorkflowToolsOnDemand === true && !lead.dynamicWorkflowToolsActivated,
        toolset: builtInExplore ? "explore" : "main",
        embeddedSearchBackend: lead.config.embeddedSearchBackend,
        nativeSearchEnhancementsEnabled: lead.config.nativeSearchEnhancementsEnabled,
        subagents: {
          backgroundBashMaxMs: lead.config.subagents?.backgroundBashMaxMs,
          enabled: false,
        },
      },
      {
        agentTelemetry: lead.agentTelemetry.port,
        agentTelemetryCausation: lead.agentTelemetry.captureCausation(),
        agentTelemetryCausationMode: request.background ? "linked_root" : "child",
        eventStore: lead.eventStore,
        sessionStore: leadDeps.sessionStore,
        modelRequestAdmission: lead.modelRequestAdmission,
        modelFactory: childModelFactory,
        resolveEffectiveModelSelection: leadDeps.resolveEffectiveModelSelection,
        ...childClientPorts,
        ...(childBrowserControlPort === undefined
          ? {}
          : { browserControlPort: childBrowserControlPort }),
        coordinatorResponsePort: createCoordinatorResponsePort({
          agentId: request.agentId,
          agentType: request.agentType,
          childSessionId: request.sessionId,
          parentToolCallId,
          enqueue: (coordinatorInput) => lead.enqueueSubagentMessage(coordinatorInput),
        }),
        permissionService: lead.permissionService,
        toolScheduler: leadDeps.toolScheduler,
        executionPort: leadDeps.executionPort,
        fileSystemPort: leadDeps.fileSystemPort,
        httpClientPort: leadDeps.httpClientPort,
        imageProcessorPort: leadDeps.imageProcessorPort,
        pdfDocumentPort: leadDeps.pdfDocumentPort,
        // v2 核心增量：团队工具注册表（TeamTask*/TeamSendMessage 闭包，team-tools.ts）。
        toolRegistry: registry,
        logger: lead.logger,
        traceContext: request.traceContext,
        eventSink: {
          onSessionEvent: async (event) => {
            request.reportActivity?.();
            await lead.notifyEventSinks(event, {
              ...request.traceContext,
              sessionId: request.sessionId,
            });
            const mirroredEvent = mirrorSubagentToolEvent(event, {
              agentId: request.agentId,
              agentType: request.agentType,
              background: request.background,
              childSessionId: request.sessionId,
              description: request.description,
              parentSessionId: lead.sessionId,
              parentToolCallId,
              parentTurnId: request.traceContext.turnId,
              toolNameByChildToolCallId: mirroredToolNameByChildToolCallId,
            });
            if (!mirroredEvent) return;
            await lead.notifyEventSinks(mirroredEvent, {
              ...request.traceContext,
              sessionId: lead.sessionId,
            });
          },
        },
      },
    );

    const resumesExistingChild = request.resumeFromStore === true;
    if (resumesExistingChild) {
      const persistedMessages = await leadDeps.sessionStore?.messages({
        sessionID: request.sessionId,
      });
      if (persistedMessages === undefined || persistedMessages.length === 0) {
        throw new Error(`No transcript found for team member ${request.agentId}`);
      }
      await childRuntime.resumeFromStore({ persistedMessages, traceContext: request.traceContext });
    } else {
      await childRuntime.ensureSessionPersistedForExternalActivity(request.prompt, {
        traceContext: request.traceContext,
      });
    }
    await notifySessionReady();
    request.registerMessageSink?.(createTeamMemberMessageSink(childRuntime, request));
    return await childRuntime.executeTurn(request.prompt, undefined, {
      inputSource: "subagent",
      inputPresentation: "coordinator_input",
    });
  };
}
