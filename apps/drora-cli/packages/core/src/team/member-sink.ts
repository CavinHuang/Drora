import type { TraceContext, TurnSteerInput, TurnSteerResult } from "@drora/contracts";
import type { RuntimeTaskMessageSink } from "../runtime-task/registry.js";
import { MEMBER_STEER_PRESENTATION } from "./message-format.js";

/**
 * 团队成员消息 sink（spec §7 定稿 + 修订10；2026-10-21 缺口8 落地，§14 登记）。
 *
 * 成员注册的 sink 此前是通用 createSubagentMessageSink（message-steering.ts），
 * presentation 硬编码 coordinator_steer——渲染文案（"The coordinator sent a
 * message…"）既无 PEER_PERMISSION_GUIDANCE（peer 消息零授权禁令，spec §1）也无
 * 回信指引，buildSteerPayload 声明的 subagent_reply_steer 从未真正到达成员
 * runtime。本 sink 是运行中成员投递的 presentation 唯一承载：
 * inputPresentation = MEMBER_STEER_PRESENTATION（"subagent_reply_steer"，现有
 * 枚举零加值，渲染 = "Another Drora session sent a message…" + 禁令 + 回信指引）。
 *
 * no_active_turn 20×10ms 重试与 delivery:"guide" 复刻 message-steering.ts 语义
 * （成员回合边界的瞬时空窗内投递不失败）；重试穷尽仍无活跃回合 → rejected 抛回
 * runner，hub 侧不记送达（queued 语义，spec §16.3）。成员 sink 的唯一发送方是
 * hub dispatch 通道（成员 subagents.enabled:false，spec §2.4），presentation 可
 * 安全定死；RespondToCoordinator 走 coordinatorResponsePort 不经本 sink。
 */

interface SteerableRuntime {
  steerTurn(input: string | TurnSteerInput): Promise<TurnSteerResult>;
}

export function createTeamMemberMessageSink(
  runtime: SteerableRuntime,
  request: { traceContext: TraceContext },
): RuntimeTaskMessageSink {
  return {
    async send(message) {
      const result = await steerTeamMemberMessage(runtime, request, message);
      if (result.kind === "rejected") {
        throw new Error(`Team member message rejected: ${result.reason}`);
      }
      return "steered";
    },
  };
}

async function steerTeamMemberMessage(
  runtime: SteerableRuntime,
  request: { traceContext: TraceContext },
  message: { id: string; message: string; summary?: string; traceContext?: TraceContext },
): Promise<TurnSteerResult> {
  const input = formatTeamMemberMessage(message);
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await runtime.steerTurn({
      delivery: "guide",
      inputPresentation: MEMBER_STEER_PRESENTATION,
      input,
      inputId: message.id,
      traceContext: message.traceContext ?? request.traceContext,
    });
    if (result.kind !== "rejected" || result.reason !== "no_active_turn") {
      return result;
    }
    await sleep(10);
  }
  return runtime.steerTurn({
    delivery: "guide",
    inputPresentation: MEMBER_STEER_PRESENTATION,
    input,
    inputId: message.id,
    traceContext: message.traceContext ?? request.traceContext,
  });
}

function formatTeamMemberMessage(message: { message: string; summary?: string }): string {
  const summary = message.summary?.trim();
  if (!summary) return message.message;
  return [summary, "", message.message].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
