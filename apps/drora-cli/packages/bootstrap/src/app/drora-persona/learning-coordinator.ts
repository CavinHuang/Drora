/**
 * P1b 学习机会通知消费者（specs/drora-persona-system.md §8「只在普通成功轮获得有界机会
 * 通知；不阻塞 TurnComplete、不写旧库 outbox；通知丢失/队列满允许漏学」；合同 §6
 * 「通知最多 64 个待接收项/进程，超出丢机会并计数」）。
 *
 * 事件顺序（显式时间）：
 * 1. Runtime 普通成功轮完成 → notifyLearningOpportunity（同步、非阻塞）：入进程内队列
 *    （满 64 丢弃并计数），排一个微任务 drain；不 await、不向轮次抛错。
 * 2. drain 串行消费：acceptLearningSource（全门+owner 复验+evidenceId 入库）→ accepted
 *    后驱动工作循环直至无可领取工作（每 authority 并发 1 由库租约保证；同进程单飞 drain）。
 * 3. 循环内任何错误只记固定类别日志并计数，绝不出港到通知调用方。
 *
 * 绑定：每个 Runtime 的端口由 createNotificationPort 按该 Runtime 冻结的 E 与 workspaceKey
 * 生成（与 capturePortForPermission 同构）；所有端口共享同一队列/计数/drain（进程级单例）。
 *
 * 不做的事：不等待轮次、不写任务活动时间、不写旧库 outbox、不扫描历史（只处理通知到的
 * 机会；未 accepted 允许漏学）。
 */
import { PERSONA_LEARNING_BUDGET } from "@drora/shared";
import type {
  PersonaLearningNotificationPort,
  PersonaTurnLearningOpportunity,
} from "@drora/core/persona";
import type {
  PersonaInternalLearning,
  PersonaLearningCoordinatorDeps,
  PersonaLearningCounters,
} from "./learning-contract.js";
import { createPersonaLearningCounters } from "./learning-contract.js";

/** 已绑定装配期事实（E、workspaceKey）的机会条目；Runtime 只提供会话/轮边界事实。 */
interface PersonaLearningQueuedOpportunity {
  readonly opportunity: PersonaTurnLearningOpportunity;
  readonly personaPermission: boolean;
  readonly workspaceKey: string;
}

export interface PersonaLearningCoordinator {
  /**
   * 为一个 Runtime 绑定生成通知端口（E off 或 workspaceKey 缺席由工厂调用方先行拦截，
   * 返回 undefined，不进入本协调器）。
   */
  readonly createNotificationPort: (input: {
    readonly personaPermission: boolean;
    readonly workspaceKey: string;
  }) => PersonaLearningNotificationPort;
  /** 进程内计数快照（门矩阵/丢弃证据；固定类别，无正文）。 */
  readonly snapshotCounters: () => PersonaLearningCounters;
  /** 仅供测试：等待队列清空与在飞处理落定。生产代码不得调用。 */
  readonly drainForTests: () => Promise<void>;
}

export function createPersonaLearningCoordinator(
  deps: PersonaLearningCoordinatorDeps,
): PersonaLearningCoordinator {
  const learning: PersonaInternalLearning = deps.learning;
  const counters: PersonaLearningCounters = createPersonaLearningCounters();
  const queue: PersonaLearningQueuedOpportunity[] = [];
  let draining = false;

  function scheduleDrain(): void {
    if (draining) return;
    draining = true;
    queueMicrotask(() => {
      void drain();
    });
  }

  async function drain(): Promise<void> {
    try {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) continue;
        await processOpportunity(entry);
      }
    } catch {
      counters.orchestrationErrors += 1;
      deps.logger?.warn("persona learning drain failed unexpectedly", {
        event: "persona.learning.drain_failed",
        module: "drora-persona",
      });
    } finally {
      draining = false;
      // 处理期间新通知可能入队：补一轮 drain（finally 后再排，避免递归栈）。
      if (queue.length > 0) scheduleDrain();
    }
  }

  async function processOpportunity(entry: PersonaLearningQueuedOpportunity): Promise<void> {
    const acceptance = await learning.acceptLearningSource({
      boundary: {
        boundaryMessageId: entry.opportunity.boundaryMessageId,
        userMessageId: entry.opportunity.userMessageId,
      },
      personaPermission: entry.personaPermission,
      sessionId: entry.opportunity.sessionId,
      turnId: entry.opportunity.turnId,
      workspaceKey: entry.workspaceKey,
    });
    if (acceptance.kind === "skipped") {
      counters.acceptSkipped[acceptance.reason] =
        (counters.acceptSkipped[acceptance.reason] ?? 0) + 1;
      deps.logger?.info("persona learning opportunity skipped", {
        event: "persona.learning.accept_skipped",
        module: "drora-persona",
        reason: acceptance.reason,
      });
      return;
    }
    if (acceptance.kind === "already_accepted") {
      counters.acceptAlreadyAccepted += 1;
      return;
    }
    counters.acceptAccepted += 1;
    // accepted 后至少一次处理（合同 §6）：驱动工作循环直至无可领取。
    for (;;) {
      const progressed = await learning.processLearningWork();
      if (progressed !== "claimed") break;
    }
  }

  return {
    createNotificationPort: (input): PersonaLearningNotificationPort => {
      const bound: Pick<PersonaLearningQueuedOpportunity, "personaPermission" | "workspaceKey"> =
        { personaPermission: input.personaPermission, workspaceKey: input.workspaceKey };
      return {
        notifyLearningOpportunity: (opportunity: PersonaTurnLearningOpportunity): void => {
          counters.received += 1;
          if (queue.length >= PERSONA_LEARNING_BUDGET.processPendingNotificationsMax) {
            // 进程内 64 待接收满：丢机会并计数（合同 §6），绝不阻塞轮次、绝不落旧库。
            counters.droppedQueueFull += 1;
            deps.logger?.info("persona learning notification queue full; opportunity dropped", {
              droppedTotal: counters.droppedQueueFull,
              event: "persona.learning.queue_full",
              module: "drora-persona",
            });
            return;
          }
          queue.push({ opportunity, ...bound });
          scheduleDrain();
        },
      };
    },
    snapshotCounters: () => counters,
    drainForTests: async () => {
      while (draining || queue.length > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
      }
    },
  };
}
