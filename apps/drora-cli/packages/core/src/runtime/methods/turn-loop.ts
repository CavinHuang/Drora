import { getTurnTools } from "./turn-tool-visibility.js";
import { refreshOffPeakTurnAfterTakeover } from "../off-peak/turn.js";
import { appendRuntimeAgentListing } from "../helpers/agent-listing.js";
import { beginLocalTurnPreparation } from "@drora/contracts";
import { buildToolSearchAnnouncement } from "../../tool/search/exposure.js";
import {
  CompactPhase,
  CompactReason,
  createMessageId,
  traceContextToLogContext,
  TurnMachineImpl,
} from "../deps.js";
import {
  buildRuntimeModeReminderBody,
  buildPlanModeExitReminderBody,
  buildRuntimeOutputStyleReminderBody,
  buildTodoReminderBody,
  buildRuntimeProviderRequestMessages,
  prepareRuntimeProviderRequest,
  createCompactRapidRefillError,
  throwIfTurnAborted,
  shouldBuildTodoReminder,
} from "../helpers/index.js";
import {
  systemReminderAttachmentEntry,
  todoReminderRuntimeMetadata,
} from "../../agent/message-history.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { PersonaTurnApplicationQuery } from "../../persona/index.js";
import { runModelBackedTurnStep } from "./turn-model-step.js";
import { persistRuntimeReminderMessage } from "./runtime-reminder-persistence.js";
import { buildProjectionAnchor } from "./projection-anchor.js";
import {
  evaluateRapidRefill,
  MAX_CONSECUTIVE_RAPID_REFILLS,
  RAPID_REFILL_TOOL_TURN_THRESHOLD,
  recordCompactHistoryRound,
  recordCompactSuccess,
} from "./turn-loop-state.js";
import type { RegularTurnLoopState } from "./turn-loop-state.js";
import { consumeSettledProjectMemoryRecall } from "../helpers/project-memory-recall.js";
import { consumePendingProjectMemoryUpdate } from "../helpers/project-memory-dream.js";
import { ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH } from "../../memory/project-memory-retrieval-branch.js";
import {
  appendTurnRequestEntries,
  commitTurnRequestEntries,
  filterOutputTokenContinuationEntries,
} from "./turn-output-token-continuation.js";

/**
 * P0a 轮内人格捕获编排（spec §6）：资格已在 admission 同步冻结；这里只在首个合格主请求前
 * 通过可选端口捕获一次，结果整轮冻结——重试、工具续跑、输出 token continuation 与同轮
 * compact 后的主请求都复用同一值，不重新捕获。端口缺席即功能关闭，保持原请求路径。
 * 取消沿原 AbortSignal 路径传播，不能被转换成 omitted 后继续请求；人格故障只降级扩展，
 * 此处不存在原 session/provider 错误，不会吞掉它们。生产服务与执行许可门属于后续切片，
 * 该编排届时由独立 Persona 服务模块承接。
 */
async function capturePersonaContributionForTurn(
  this: AgentRuntimeInternal,
  state: RegularTurnLoopState,
): Promise<void> {
  if (state.personaCaptureSettled || state.modelStepCount !== 0) return;
  // 捕获机会一次性结算：omitted 后同轮迟到结果不再生效，同一轮不会突然出现另一个身份。
  state.personaCaptureSettled = true;
  const port = this.personaCapturePort;
  if (!port || !state.personaMainRequestEligible) return;
  try {
    const outcome = await port.captureContribution({
      sessionId: this.sessionId,
      signal: state.turnAbortSignal,
      turnId: state.turnId,
    });
    if (outcome.status === "applied") {
      state.personaContribution = outcome.contribution;
      // 结算事实入 Runtime 内存记录（切片 C 查询口）；只描述本存活 Runtime，重启即消失。
      this.personaTurnApplication = { status: "applied", turnId: state.turnId };
      this.logger?.info("Persona contribution captured for turn", {
        coreRevision: outcome.contribution.coreRevision,
        event: "persona.capture.applied",
        module: "core.runtime",
        status: "completed",
        turnId: state.turnId,
      });
    } else if (outcome.status === "cancelled") {
      // spec §6「不能将 cancelled 当 omitted 继续请求」：cancelled 不落任何应用记录、
      // 不冒充省略。信号已中止时由下方 throwIfTurnAborted 穿出原取消路径（轮次被取消，
      // 查询口对取消轮如实 not_available）；端口在信号未中止时自行判 cancelled（仅非
      // 生产端口会出现）时，本轮按无贡献继续、查询口 not_available，不伪造省略事实。
      this.logger?.info("Persona capture cancelled for turn", {
        event: "persona.capture.cancelled",
        module: "core.runtime",
        status: "completed",
        turnId: state.turnId,
      });
    } else {
      // 端口明确省略：结算事实（含省略原因）入 Runtime 内存记录（切片 C 查询口）。
      this.personaTurnApplication = {
        status: "omitted",
        turnId: state.turnId,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
      };
      this.logger?.info("Persona contribution not applied for turn", {
        event: "persona.capture.omitted",
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        captureStatus: outcome.status,
        module: "core.runtime",
        status: "completed",
        turnId: state.turnId,
      });
    }
  } catch (error) {
    this.logger?.warn("Persona capture failed; omitting contribution for this turn", {
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "persona.capture.failed",
      module: "core.runtime",
      status: "failed",
      turnId: state.turnId,
    });
    // 端口抛错＝本轮执行过且贡献已省略：如实落 omitted（原因未知），查询口不再把
    // 「执行过且省略」的轮误报成 not_available（合同 §3 三态）。signal 已中止时不落
    // 记录：取消不伪装成省略（spec §6），交还下方 throwIfTurnAborted 穿出原取消路径。
    if (!state.turnAbortSignal.aborted) {
      this.personaTurnApplication = { status: "omitted", turnId: state.turnId };
    }
  }
  // 信号在捕获等待期间中止时取消必须穿出，交还原轮次取消路径。
  throwIfTurnAborted(state.turnAbortSignal);
}

/**
 * 切片 C 应用状态查询口（合同 §3 getPersonaApplication 的 Runtime 侧事实）：
 * 只回喂当前存活 Runtime 的最近结算记录；turnId 不匹配或重启后无记录一律
 * not_available，不伪造冷历史。独立查询方法，不进旧 snapshot/delta/index。
 */
export function getPersonaTurnApplication(
  this: AgentRuntimeInternal,
  input: { turnId: string },
): PersonaTurnApplicationQuery {
  const settled = this.personaTurnApplication;
  if (!settled || settled.turnId !== input.turnId) {
    return { status: "not_available" };
  }
  return settled;
}

export async function runRegularTurnLoop(
  this: AgentRuntimeInternal,
  state: RegularTurnLoopState,
): Promise<void> {
  while (true) {
    throwIfTurnAborted(state.turnAbortSignal);
    refreshOffPeakTurnAfterTakeover(this, state);
    const outputTokenRecoveryActive = state.turnRequestState.outputTokenContinuationCount > 0;
    // guide 只允许由完整 tool result batch 设置这个一次性诊断；普通 queue 不在
    // model roundtrip 起点消费，避免把未来 turn 错并入当前 product turn。
    const drainedSteerForNextRequest = state.drainedSteerForNextRequest;
    state.drainedSteerForNextRequest = undefined;

    if (state.modelStepCount > 0 && !outputTokenRecoveryActive) {
      const drainedRuntimeCommands = await this.drainPendingRuntimeCommandsForActiveLoop();
      state.backgroundSubagentResultConsumed ||=
        drainedRuntimeCommands.backgroundSubagentResultConsumed;
      state.workflowResultConsumed ||= drainedRuntimeCommands.workflowResultConsumed;
      appendTurnRequestEntries(state.turnRequestState, drainedRuntimeCommands.runtimeEntries);
      if (drainedRuntimeCommands.drained > 0) {
        state.repeatedToolCallSignature = undefined;
        state.repeatedToolCallStreakCount = 0;
      }
    }

    if (state.completedRealToolResultBatch && !outputTokenRecoveryActive) {
      state.completedRealToolResultBatch = false;
      const recallEntry = consumeSettledProjectMemoryRecall(
        this,
        ACTIVE_PROJECT_MEMORY_RETRIEVAL_BRANCH,
      );
      appendTurnRequestEntries(state.turnRequestState, recallEntry ? [recallEntry] : []);
    }

    const compactPhase =
      state.modelStepCount === 0 ? CompactPhase.PreRequest : CompactPhase.MidTurn;
    await this.microcompactIfNeeded(state.turnTraceContext, state.events, state.turnAbortSignal, {
      model: state.model,
      modelStepIndex: state.modelStepCount,
      phase: compactPhase,
      turnRequestState: state.turnRequestState,
    });
    throwIfTurnAborted(state.turnAbortSignal);

    const rapidRefill = evaluateRapidRefill(state.compactTracking);
    const autoCompactOutcome = await this.autoCompactIfNeeded(
      state.turnTraceContext,
      state.events,
      state.turnAbortSignal,
      {
        getAgentListingTools: () => getTurnTools(this, state),
        compactReason: CompactReason.ContextLimit,
        modelStepIndex: state.modelStepCount,
        phase: compactPhase,
        rapidRefill,
        model: state.model,
        turnRequestState: state.turnRequestState,
        getContinuationTools: () => getTurnTools(this, state),
      },
    );
    if (autoCompactOutcome === "rapid_refill_blocked") {
      throw createCompactRapidRefillError({
        consecutiveRapidRefills: rapidRefill.consecutiveRapidRefills,
        maxConsecutiveRapidRefills: MAX_CONSECUTIVE_RAPID_REFILLS,
        toolTurnThreshold: RAPID_REFILL_TOOL_TURN_THRESHOLD,
        toolTurnsSinceCompact: rapidRefill.toolTurnsSinceCompact,
      });
    }
    if (autoCompactOutcome === "compacted") {
      recordCompactSuccess(state, rapidRefill);
      recordCompactHistoryRound(state);
    }
    throwIfTurnAborted(state.turnAbortSignal);

    const finishMcp = beginLocalTurnPreparation(state.turnTraceContext, "mcp");
    await this.initializeMcp(state.turnTraceContext);
    // tools/list_changed 只在回合开始前生效。
    await this.refreshMcpToolsIfChanged(state.turnTraceContext);
    finishMcp();
    throwIfTurnAborted(state.turnAbortSignal);
    const finishTools = beginLocalTurnPreparation(state.turnTraceContext, "tools");
    const tools = getTurnTools(this, state);
    finishTools();
    if (!outputTokenRecoveryActive) {
      await appendRuntimeAgentListing(this, state.turnRequestState, tools, state.turnTraceContext);
    }
    if (!outputTokenRecoveryActive && this.needsPlanModeExitReminder) {
      this.needsPlanModeExitReminder = false;
      commitTurnRequestEntries(this, state.turnRequestState, [
        systemReminderAttachmentEntry("plan_mode_exit", buildPlanModeExitReminderBody()),
      ]);
    }
    const runtimeModeReminderBody = outputTokenRecoveryActive
      ? null
      : buildRuntimeModeReminderBody(
          state.turnRequestState.entries,
          this.getMode(),
          this.getPlanEnabled(),
        );
    if (runtimeModeReminderBody) {
      commitTurnRequestEntries(this, state.turnRequestState, [
        systemReminderAttachmentEntry("runtime_mode", runtimeModeReminderBody),
      ]);
    }
    if (
      !outputTokenRecoveryActive &&
      tools.some((tool) => tool.name === "TodoWrite") &&
      shouldBuildTodoReminder(state.turnRequestState.entries)
    ) {
      const currentTodos = await this.readSessionTodosForContext(state.turnTraceContext);
      const reminderBody = buildTodoReminderBody(currentTodos);
      commitTurnRequestEntries(this, state.turnRequestState, [
        systemReminderAttachmentEntry("todo_reminder", reminderBody),
      ]);
      await this.persistSyntheticUserNoticeForSession({
        messageID: createMessageId(),
        metadata: { runtimeMessage: todoReminderRuntimeMetadata() },
        sessionId: this.sessionId,
        source: "todo_reminder",
        text: reminderBody,
        traceContext: state.turnTraceContext,
      });
    }
    const outputStyleReminderBody =
      state.modelStepCount === 0
        ? buildRuntimeOutputStyleReminderBody(state.turnOutputStyle)
        : null;
    if (outputStyleReminderBody) {
      // output_style 是 provider-visible 的当前 turn runtime attachment，
      // 需要进入内存历史参与后续 request 的增量轨迹；但不把它落 session。
      commitTurnRequestEntries(this, state.turnRequestState, [
        systemReminderAttachmentEntry("output_style", outputStyleReminderBody),
      ]);
    }
    if (!outputTokenRecoveryActive) {
      const announcement = buildToolSearchAnnouncement({
        model: state.model,
        mode: this.config.toolSearch?.mode,
        tools,
        registry: this.getToolRegistry(),
        entries: state.turnRequestState.entries,
      });
      if (announcement) {
        // 公告正文和增量事实必须先一起落盘；否则 fork/resume 会把已公告工具重新当成首次出现。
        const messageId = await persistRuntimeReminderMessage.call(
          this,
          announcement,
          state.turnTraceContext,
          {
            model: state.model,
            anchor: buildProjectionAnchor(state.turnTraceContext, "synthetic"),
          },
        );
        if (messageId) this.latestConversationMessageId = messageId;
        commitTurnRequestEntries(this, state.turnRequestState, [announcement]);
      }
    }
    // （2026-09-12）：原"回合开始注入 plugin_ui_state reminder"已删除，插件给模型的信息
    // 一律走 ui/update-model-context。
    const providerEntries = [...state.turnRequestState.entries];
    // Dream 可能在同一 turn 的首个模型请求期间完成；每次 attachment collection 都检查，
    // 才能把一次性更新放进紧随其后的模型请求，而不是延迟到下一次用户输入。
    const memoryUpdate = outputTokenRecoveryActive
      ? undefined
      : consumePendingProjectMemoryUpdate(this);
    const requestEntries = memoryUpdate ? [...providerEntries, memoryUpdate] : providerEntries;
    // 首个合格主请求前一次性捕获；omitted/applied 后整轮冻结，见 turn-persona-capture.ts。
    await capturePersonaContributionForTurn.call(this, state);
    const prepared = prepareRuntimeProviderRequest(this, {
      model: state.model,
      tools,
      registry: this.getToolRegistry(),
      entries: requestEntries,
      applyCacheControl: true,
      contribution: state.personaContribution,
    });
    this.logger?.debug("ToolSearch request exposure", {
      event: "tool.search.exposure",
      enabled: prepared.toolSearch.enabled,
      mode: prepared.toolSearch.mode,
      reason: prepared.reason,
      catalogSize: prepared.toolSearch.catalog.length,
      schemaCount: prepared.request.tools.length,
    });
    // 修复原因：provider-visible user ordering projection 会改变最终 latest user 落点，
    // cache-control 必须在 projection 后统一设置，避免 raw synthetic entry 抢占缓存锚点。
    const providerProjection = prepared.projection;
    const { messages } = prepared.request;
    const recordableEntries = filterOutputTokenContinuationEntries(prepared.entries);
    const recordableProjection =
      recordableEntries === prepared.entries
        ? providerProjection
        : buildRuntimeProviderRequestMessages(this, {
            entries: recordableEntries,
            loadedToolCallIds: prepared.loadedToolCallIds,
            applyCacheControl: true,
            model: state.model,
            // 记录投影与实际请求使用同一冻结贡献（PM36：二次渲染内容一致）。
            contribution: state.personaContribution,
          });
    state.turnMachine = new TurnMachineImpl(
      state.turnMachine.startModelRequest(
        `${state.model.providerId}/${state.model.modelId}`,
        recordableProjection.messages,
      ),
    );

    // 生产包需要知道 Turn 是否已经跨过 provider 边界；这里只记录请求元数据，
    // 不记录 prompt、消息内容或 streaming chunk，避免泄露内容并控制日志量。
    this.logger?.info("Model request started", {
      ...traceContextToLogContext(state.turnTraceContext),
      event: "model.request.started",
      module: "core.runtime",
      status: "started",
      messageCount: messages.length,
      iteration: state.toolCallCount === 0 ? 0 : Math.ceil(state.toolCallCount / 10),
    });

    const result = await runModelBackedTurnStep.call(this, state, {
      drainedSteerForNextRequest,
      latestRealUserMessageIndex: providerProjection.diagnostics.latestRealUserMessageIndex,
      messages,
      sourceEntries: providerProjection.sourceEntries,
      requestEntries,
      recordedMessages: recordableProjection.messages,
      tools: prepared.request.tools,
      toolSearch: prepared.toolSearch,
    });

    if (result === "break") {
      break;
    }
  }
}
