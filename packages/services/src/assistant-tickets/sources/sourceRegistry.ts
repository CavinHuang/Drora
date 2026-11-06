/**
 * Source 注册表（03 详设 §1）：register 各 Source 工厂产物；按 kv 配置 enabled 惰性
 * 启停（reconcile 于每次台账快照推送时执行——配置变更即生效，无轮询）；emit 统一送
 * 服务 ingestSourceEvent（channelRef 直通优先，否则真实强度规则 gate）。
 *
 * 终态回复（03 §2/§4 回复路径）：订阅台账快照差分，工单首次进入 done/failed 且有
 * channel_ref 绑定 → AssistantSourceReplyPort 一句话+工单 id（fire-and-forget；端口
 * 缺席=诚实降级 warn 一次，不重试、不用超时兜底）。
 *
 * 分层纪律：本文件不 import bots/fetch——事件源（assistantForwarder/HTTP/凭证）全部
 * 由各 Source 工厂经装配层注入；单测以 fake Source/port 驱动。
 */

import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import type { AssistantSnapshot } from "../assistantTickets.js";
import { isSourceEnabled, readSourcesConfig, type SourceKvGet } from "./sourceConfig.js";
import type { AssistantSourceReplyPort, MateSource, MateSourceEvent } from "./contract.js";

const logger = createServiceLogger("assistant-tickets");

/** 快照推送句柄（服务实例 onDidChange 的返回；注册表 dispose 时退订）。 */
export interface SnapshotSubscription {
  dispose(): void;
}

export interface MateSourceRegistryDeps {
  /** kv 读取（装配层注入的 mate.sqlite kv 单键读）。 */
  readonly kvGet: SourceKvGet;
  /** Source 事件统一入口（服务 host 内部方法；直通+gate 全在其内）。 */
  readonly ingestSourceEvent: (event: MateSourceEvent) => Promise<unknown>;
  /** 台账快照订阅（reconcile 启停 + 终态回复差分的事实源）。 */
  readonly subscribeSnapshot: (
    listener: (snapshot: AssistantSnapshot) => void,
  ) => SnapshotSubscription;
  /** 工单终态回复端口（缺席=诚实降级，仅 warn 一次）。 */
  readonly replyPort?: AssistantSourceReplyPort;
}

export interface MateSourceRegistry {
  /** 登记一个 Source（工厂产物；同 kind 重复登记拒绝——单一事件源纪律）。 */
  register(source: MateSource): void;
  /** 台账快照入口（reconcile 启停 + 终态回复差分；attach 助手订阅它）。 */
  handleSnapshot(snapshot: AssistantSnapshot): void;
  /** 装配层/Source 工厂的事件投递（运行态 Source 才放行；未启用静默丢弃）。 */
  emit(event: MateSourceEvent): void;
  /** 按当前 kv 配置启停各 Source（快照推送时自动调用；测试可直调）。 */
  reconcile(): void;
  /** 停全部 Source（快照退订由 attach 助手负责）。 */
  dispose(): void;
}

export function createMateSourceRegistry(deps: MateSourceRegistryDeps): MateSourceRegistry {
  const byKind = new Map<string, MateSource>();
  /** kind → 运行态（emit 句柄存在=已启用；惰性启停的唯一事实）。 */
  const running = new Set<string>();
  /** ticketId → 上次快照 status（终态差分；仅 channel 绑定工单参与回复）。 */
  const lastStatusByTicket = new Map<string, string>();
  /** 终态已回复工单（幂等：终态只回一次，快照重推不重发）。 */
  const repliedTickets = new Set<string>();
  let replyPortWarned = false;
  let disposed = false;

  function ingest(event: MateSourceEvent): void {
    void deps.ingestSourceEvent(event).catch((error) => {
      logger.warn("assistant-tickets source 事件入口失败（不重试，事件驱动）", error);
    });
  }

  /** 按当前 kv 配置启停各 Source（快照推送/测试直调；改配后停启一次即生效）。 */
  function reconcile(): void {
    if (disposed) return;
    const config = readSourcesConfig(deps.kvGet);
    for (const [kind, source] of byKind) {
      const desired = isSourceEnabled(config, kind as "feishu" | "phone" | "github");
      const isRunning = running.has(kind);
      if (desired && !isRunning) {
        // 03 详设 §1 原形：start(emit, config)——配置快照随启动下发。
        source.start((event) => ingest(event), config);
        running.add(kind);
        logger.info("assistant-tickets source 已启用", { kind });
      } else if (!desired && isRunning) {
        running.delete(kind);
        source.stop();
        logger.info("assistant-tickets source 已停用", { kind });
      }
    }
  }

  /**
   * 终态回复差分（03 §2/§4）：首次进入 done/failed 且有 channel_ref → 端口一句话。
   * 状态从非终态进入终态才触发（快照重放同终态不重发——repliedTickets 幂等集）。
   */
  function notifyTerminalReplies(snapshot: AssistantSnapshot): void {
    const port = deps.replyPort;
    if (!port) {
      if (!replyPortWarned && snapshot.tickets.some((t) => t.channelRef)) {
        replyPortWarned = true;
        logger.warn("assistant-tickets Source 回复端口未接线（诚实降级：终态不回 channel）");
      }
      // 无端口也要推进差分基线，否则接线后首帧会把历史终态全部重放。
      for (const ticket of snapshot.tickets) lastStatusByTicket.set(ticket.id, ticket.status);
      return;
    }
    for (const ticket of snapshot.tickets) {
      const previous = lastStatusByTicket.get(ticket.id);
      lastStatusByTicket.set(ticket.id, ticket.status);
      if (!ticket.channelRef) continue;
      const terminal =
        ticket.status === ASSISTANT_TICKET_STATUSES.done
          ? ("done" as const)
          : ticket.status === ASSISTANT_TICKET_STATUSES.failed
            ? ("failed" as const)
            : null;
      if (!terminal || previous === terminal || repliedTickets.has(ticket.id)) continue;
      repliedTickets.add(ticket.id);
      // 一句话摘要（03 §2：回原会话一句话+工单卡片链接；P3 无卡片 URL，工单 id 即锚点），
      // 摘要截断 300 字（channel 文面有界；诚实截断不改写事实）。
      const detail = (terminal === "done" ? ticket.outputSummary : ticket.failReason) ?? "";
      const text = `大副工单 ${ticket.id} ${terminal === "done" ? "完成" : "失败"}：${detail.slice(0, 300)}`;
      void port
        .reply({
          channelRef: ticket.channelRef,
          ticketId: ticket.id,
          status: terminal,
          summary: text,
        })
        .then((result) => {
          if (!result.ok) {
            logger.warn("assistant-tickets Source 终态回复失败（不重试）", result.reason);
          }
        })
        .catch((error) => {
          logger.warn("assistant-tickets Source 终态回复异常（不重试）", error);
        });
    }
  }

  // P7（08 号详设 §3.5）：查询直答复外发——快照差分 status_replied 决策（幂等键
  // decisionId；channel 经 triggers 回查），答复经既有 replyPort 外发原通道。
  const repliedDecisions = new Set<number>();
  function notifyQueryReplies(snapshot: AssistantSnapshot): void {
    const port = deps.replyPort;
    if (!port) return;
    for (const decision of snapshot.decisions) {
      if (decision.outcome !== "status_replied" || repliedDecisions.has(decision.id)) continue;
      const channelRef = snapshot.triggers.find((t) => t.id === decision.triggerId)?.channelRef;
      repliedDecisions.add(decision.id);
      if (!channelRef || !decision.answer) continue;
      void port
        .reply({
          channelRef,
          ticketId: decision.triggerId,
          status: "query",
          summary: decision.answer.slice(0, 300),
        })
        .then((result) => {
          if (!result.ok) {
            logger.warn("assistant-tickets Source 查询答复外发失败（不重试）", result.reason);
          }
        })
        .catch((error) => {
          logger.warn("assistant-tickets Source 查询答复外发异常（不重试）", error);
        });
    }
  }

  return {
    register(source) {
      if (byKind.has(source.kind)) {
        throw new Error(`assistant-tickets source kind 重复登记：${source.kind}`);
      }
      byKind.set(source.kind, source);
    },

    handleSnapshot(snapshot) {
      if (disposed) return;
      try {
        reconcile();
        notifyTerminalReplies(snapshot);
        notifyQueryReplies(snapshot);
      } catch (error) {
        // 快照推送路径的异常不能打断服务 publish 循环。
        logger.warn("assistant-tickets source registry 快照处理失败", error);
      }
    },

    emit(event) {
      // 事件是否放行由对应 Source 的运行态决定（emit 句柄存在=已启用）；未启用时
      // 静默丢弃（注册表惰性启停语义，bots 回调出口/手机桥无感）。
      if (disposed || !running.has(event.kind)) return;
      ingest(event);
    },

    reconcile,

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of byKind.values()) {
        try {
          source.stop();
        } catch (error) {
          logger.warn("assistant-tickets source 停止失败（dispose 链继续）", error);
        }
      }
      running.clear();
    },
  };
}

/**
 * 注册表+快照订阅一体装配（node.ts/测试共用）：dispose 先退订快照再停 Source——
 * 退订晚于停源会让差分在停源后误推一轮（顺序即语义）。
 */
export function attachMateSourceRegistry(
  deps: MateSourceRegistryDeps,
): MateSourceRegistry & { dispose(): void } {
  const registry = createMateSourceRegistry(deps);
  const subscription = deps.subscribeSnapshot((snapshot) => registry.handleSnapshot(snapshot));
  const originalDispose = registry.dispose.bind(registry);
  registry.dispose = () => {
    subscription.dispose();
    originalDispose();
  };
  return registry;
}
