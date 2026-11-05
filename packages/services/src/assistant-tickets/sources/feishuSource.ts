/**
 * 飞书 Source（03 详设 §2）：消费 bots `assistantForwarder` 回调出口的入站通道消息，
 * 映射为 MateSourceEvent（mention=Provider 核验的 actor.mentionedBot，不是正文解析）；
 * 事件面=既有 channelRuntime 事件流的出口，bots 服务零内部逻辑改动。
 *
 * 过滤（Source 侧，不动 bots）：bot 命令（commandText）/群卡片交互（groupCardAction）/
 * 结构化补答（elicitationResponse）不是 Mate 触发——它们是 bot 既有交互面，进 gate 会
 * 污染 observe 信任数据（would-accept 噪声）。
 *
 * 身份：open_id 经 kv 映射（resolveMappedIdentity）→ 本地 identity；未映射原样透传，
 * gate 拒绝并记录（名单外机器语义）。
 *
 * 通道绑定（03 §5）：群聊=线程粒度 chatId+threadId；私聊=会话粒度 chatId——
 * 群聊只认被 @ 的线程（回复/直通同口径）。
 *
 * 纯适配：无 IO（映射经注入的 resolveIdentity 读取）。
 */

import { ASSISTANT_SOURCE_KINDS } from "@drora/shared";
import { serializeChannelRef } from "./channelRef.js";
import type { MateChannelMessageEvent, MateSource, MateSourceEvent } from "./contract.js";

export interface FeishuSourceDeps {
  /** open_id → 本地 identity（kv 映射读取；装配层注入 sourceConfig.resolveMappedIdentity）。 */
  readonly resolveIdentity: (openId: string) => string;
}

export function createFeishuSource(deps: FeishuSourceDeps): MateSource & {
  /** bots assistantForwarder 出口的接入口（装配层闭包调用）。 */
  handleChannelMessage(event: MateChannelMessageEvent): void;
} {
  let emit: ((event: MateSourceEvent) => void) | null = null;

  function isFeishuProvider(provider: string): boolean {
    // bot provider 封闭集合中的飞书家族（feishu/lark 双域，bots isFeishuBotProvider 同口径）。
    return provider === "feishu" || provider === "lark";
  }

  return {
    kind: ASSISTANT_SOURCE_KINDS.feishu,
    isRunning: () => emit !== null,
    start(emitHandle) {
      emit = emitHandle;
    },
    stop() {
      emit = null;
    },

    handleChannelMessage(event) {
      if (!emit) return;
      // 非飞书家族：telegram/webhook/weixin 的 channel 消息不属于本 Source（未来
      // Source 按 03 §1 注册表扩展，不混入 feishu 事件面）。
      if (!isFeishuProvider(event.provider)) return;
      // 交互面过滤（见文件头）：命令/卡片交互/结构化补答不进 gate。
      if (event.commandText != null) return;
      if (event.groupCardAction === true) return;
      if (event.elicitationResponse != null) return;
      const identity = deps.resolveIdentity(event.actor.providerUserId);
      const text = event.text;
      if (!text.trim()) return;
      const atMs = event.receivedAt ?? Date.now();
      emit({
        kind: ASSISTANT_SOURCE_KINDS.feishu,
        identity,
        text,
        mention: event.mentionedBot === true,
        atMs,
        ...(event.actor.chatId
          ? {
              channelRef: {
                kind: "feishu" as const,
                chatId: event.actor.chatId,
                ...(event.actor.threadId ? { threadId: event.actor.threadId } : {}),
              },
            }
          : {}),
      });
    },
  };
}

/** 序列化飞书通道绑定（装配层/测试用；直通匹配前的一致性出口）。 */
export function serializeFeishuChannelRef(chatId: string, threadId?: string): string | null {
  return serializeChannelRef({
    kind: "feishu",
    chatId,
    ...(threadId ? { threadId } : {}),
  });
}
