/**
 * 手机 Source（03 详设 §3 + 探查回填）：手机（web-remote-replayable attachment）在
 * 现实代码中没有可订阅的「入站消息总线」——手机输入经 attachment 端口直接调用窗口
 * Host 的服务 channel（webRemoteControlSharedHostAttachments.ts:42-206 → host/index.ts
 * :2740-2915 连接上下文；droraAgentConnectionScope trusted carrier 注入不可伪造的
 * clientMode）。等价意图：手机大副入口经既有 IAssistantTicketService channel 进入，
 * 事件面由本 Source 定型——`emitPhoneInput` 是装配层/手机接线（P3 下一棒 UI 入口）
 * 的唯一桥，identity 由 host 侧决定（本机用户），remoteSessionId 贯穿。
 *
 * 手机端不建 runtime（replayable 红线）：触发/决策/汇报全部走既有快照推送通道
 * （onDidChange + assistantActivity 透传），本 Source 不新增任何推送面。
 *
 * 纯适配：无 IO。
 */

import { ASSISTANT_SOURCE_KINDS } from "@drora/shared";
import { parseChannelRef } from "./channelRef.js";
import type { MateSource, MateSourceEvent } from "./contract.js";

export interface PhoneInputEvent {
  /** 手机用户原文 verbatim。 */
  readonly text: string;
  /** 手机入口的点名事实（UI 大副入口=点名；普通消息=未指名）。 */
  readonly mention: boolean;
  /** attachment 远控会话 id（贯穿；落 trigger.remote_session_id）。 */
  readonly remoteSessionId?: string;
  /** 目标 workspace（attachment 作用域 workspace identity；缺席=决策卡问人）。 */
  readonly targetWorkspaceIdentity?: string;
  /** 手机通道绑定（phone:<remoteSessionId>；同会话 follow-up 直通键）。 */
  readonly channelRef?: string;
  readonly atMs?: number;
}

export function createPhoneSource(): MateSource & {
  /** 手机接线的投递桥（host 内部；identity=host 本机用户由注册表/服务侧决定）。 */
  emitPhoneInput(input: PhoneInputEvent, identity: string): void;
} {
  let emit: ((event: MateSourceEvent) => void) | null = null;

  return {
    kind: ASSISTANT_SOURCE_KINDS.phone,
    isRunning: () => emit !== null,
    start(emitHandle) {
      emit = emitHandle;
    },
    stop() {
      emit = null;
    },

    emitPhoneInput(input, identity) {
      if (!emit) return;
      if (!input.text.trim()) return;
      // channelRef 入参=已串接字符串（channel 可见面不暴露结构类型）；反解回结构形态
      // 进事件（parse 失败=非法格式，按无绑定处置，直通匹配自然不命中）。
      const channelRef = input.channelRef ? parseChannelRef(input.channelRef) : null;
      emit({
        kind: ASSISTANT_SOURCE_KINDS.phone,
        identity,
        text: input.text,
        mention: input.mention,
        atMs: input.atMs ?? Date.now(),
        ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
        ...(input.targetWorkspaceIdentity
          ? { workspaceIdentity: input.targetWorkspaceIdentity }
          : {}),
        ...(channelRef ? { channelRef } : {}),
      });
    },
  };
}
