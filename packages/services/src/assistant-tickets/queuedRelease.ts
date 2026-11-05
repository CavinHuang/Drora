/**
 * queued FIFO 释放子侧（specs/drora-personal-assistant.md §9；02 详设 §4 P2 审查修复
 * 语义原样迁移 + P4 第二棒 awaiting 活动集扩充）。
 *
 * 从 dispatchEngine 抽出（单文件 ≤800 行纪律；generationRollover 同款拆分先例）：
 * - 活动工单判定与写域清单（软预算/W2 冲突比对原料）；
 * - 软预算/写域冲突排队（queued + 告知文案）；
 * - queued FIFO 释放（预算复检 → 队头写域冲突复检 → 按落库 dispatch_intent 重放派发）。
 *
 * 纯模块：无 IO——db/配置/派发执行由引擎注入；台账写经同一 db 连接（单一写者不变）。
 */
import { ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import type { AssistantDispatchResult } from "./assistantPorts.js";
import { parseDispatchIntent } from "./dispatchIntent.js";
import { composeTeamLeadBrief } from "./routerShell.js";
import { ASSISTANT_BUDGET_ACTIVE_STATUSES } from "./writeDomain.js";
import {
  detectWriteDomainOverlap,
  parseWriteDomainColumn,
  type AssistantWriteDomain,
} from "./writeDomain.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

// 活动状态集=writeDomain 单一出处（ASSISTANT_BUDGET_ACTIVE_STATUSES；2026-11-05
// 全链审查修复——此前本地数组与其分叉，本模块三处 SQL 改引同一常量）。
const ACTIVE_STATUSES = ASSISTANT_BUDGET_ACTIVE_STATUSES;

export interface QueuedReleaseDeps {
  readonly db: AssistantDatabase;
  /** kv 配置读取（软预算上限；引擎闭包注入避免双份实现）。 */
  readonly readConfig: (raw: AssistantDatabaseRaw) => {
    readonly budgetMaxActivePerWorkspace: number;
    readonly worktreeDisabled: boolean;
  };
  /** 释放/排队后推送快照（服务闭包 publish）。 */
  readonly publish: () => void;
  /** 引擎的派发执行（释放重放 Mode A/B；依赖注入照 generationRollover 先例）。 */
  readonly dispatchNewTicket: (input: {
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: "build" | "guarded";
    mode: "A" | "B";
    hostPath?: string;
    domain?: AssistantWriteDomain;
  }) => Promise<AssistantDispatchResult>;
  /** 引擎的附着执行（释放重放 Mode C；附着校验在 attachDispatch 内）。 */
  readonly attachDispatch: (input: {
    ticketId: string;
    text: string;
    targetIdentity: string;
    sessionId: string;
  }) => Promise<AssistantDispatchResult>;
}

export function createQueuedRelease(deps: QueuedReleaseDeps): {
  /** 软预算口径活动工单数（dispatched/running/awaiting；excludeTicketId 用于放行闸自查）。 */
  activeCountFor(identity: string, excludeTicketId?: string): number;
  /** 同 workspace 活动工单的写域清单（W2/W3 冲突比对原料；queued 不参与）。 */
  listActiveWriteDomains(
    identity: string,
  ): Array<{ ticketId: string; domain: AssistantWriteDomain }>;
  /** 软预算/写域冲突排队（spec §9：超出排队+告知卡；reason 进 queued_reason 供告知卡）。 */
  queueTicket(ticketId: string, reason: string): void;
  /** queued FIFO 释放（语义见函数头注释）。 */
  releaseNextQueued(identity: string): void;
} {
  const { db } = deps;

  function activeCountFor(identity: string, excludeTicketId?: string): number {
    // P4 第二棒：awaiting_output 计入活动位——核验滞留工单的 worktree 未清理，终态
    // （核验通过/人工确认）才释放（04 详设 §3 落地注记；UI isMateActiveTicket 同步）。
    const rows = db.raw
      .prepare(
        `SELECT id FROM ticket WHERE target_workspace_identity = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})`,
      )
      .all(identity, ...ACTIVE_STATUSES) as Array<{ id: string }>;
    return rows.filter((row) => row.id !== excludeTicketId).length;
  }

  function listActiveWriteDomains(
    identity: string,
  ): Array<{ ticketId: string; domain: AssistantWriteDomain }> {
    const rows = db.raw
      .prepare(
        `SELECT id, write_domain FROM ticket WHERE target_workspace_identity = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})`,
      )
      .all(identity, ...ACTIVE_STATUSES) as Array<{
      id: string;
      write_domain: string | null;
    }>;
    const result: Array<{ ticketId: string; domain: AssistantWriteDomain }> = [];
    for (const row of rows) {
      const domain = parseWriteDomainColumn(row.write_domain) ?? { kind: "workspace" as const };
      result.push({ ticketId: row.id, domain });
    }
    return result;
  }

  function queueTicket(ticketId: string, reason: string): void {
    try {
      db.transaction((raw) => {
        raw
          .prepare("UPDATE ticket SET status = ?, queued_reason = ?, updated_ms = ? WHERE id = ?")
          .run(ASSISTANT_TICKET_STATUSES.queued, reason, nowMs(), ticketId);
      });
      logger.info("assistant-tickets 工单进入 queued（软预算/写域冲突）", { ticketId });
      deps.publish();
    } catch (error) {
      logger.error("assistant-tickets 排队落账异常", error);
    }
  }

  /**
   * queued FIFO 释放（spec §9；P2 审查修复后语义）：
   * - 预算复检（原有）：活动工单仍满 → 不释放；
   * - 写域冲突复检（修复审查发现：此前只在放行闸判定，无关工单终态即可让与仍在活动
   *   的对手并存的队头直接派发，破坏「两两写域不相交」不变式）：队头与当前活动工单
   *   仍重叠 → 该工单保持 queued 并终止本轮释放（FIFO 不越位跳过，后续终态再试）；
   * - 按落库 dispatch_intent 重放派发形态（修复审查发现：此前按派发成功才写入的
   *   dispatch_mode 判型——queued 行恒 NULL → Mode B 建队退化为 Mode A 直派、
   *   Mode C 附着退化为开新会话、放行权限档降为 build）：
   *   B → composeTeamLeadBrief 幂等重套 /team 指示后 Mode B 派发；
   *   C → attachDispatch 附着原目标（attachDispatch 内先重过 Tier2 校验，失败诚实落 failed）；
   *   A/缺列（v2 旧行）→ Mode A 直派原文。
   */
  function releaseNextQueued(identity: string): void {
    void (async () => {
      const config = deps.readConfig(db.raw);
      if (activeCountFor(identity) >= config.budgetMaxActivePerWorkspace) return;
      const released = db.transaction(
        (raw):
          | {
              id: string;
              brief: string;
              write_domain: string | null;
              intent: ReturnType<typeof parseDispatchIntent>;
            }
          | null => {
          const next = raw
            .prepare(
              "SELECT id, brief, dispatch_intent, write_domain FROM ticket WHERE status = ? AND target_workspace_identity = ? ORDER BY created_ms ASC LIMIT 1",
            )
            .get(ASSISTANT_TICKET_STATUSES.queued, identity) as
            | { id: string; brief: string; dispatch_intent: string | null; write_domain: string | null }
            | undefined;
          if (!next) return null;
          // 写域冲突复检（同 evaluateQueueGate 的 overlap 分支口径；活动集与
          // activeCountFor/listActiveWriteDomains 同一 ACTIVE_STATUSES——P4 第二棒收入
          // awaiting_output，核验滞留工单的写域不与队头并存）：队头写域沿用建票时落列。
          // 冲突 → 不出队（保持 queued），终止本轮释放（FIFO 不越位）。
          const ownDomain = parseWriteDomainColumn(next.write_domain) ?? { kind: "workspace" as const };
          const rows = raw
            .prepare(
              `SELECT id, write_domain FROM ticket WHERE target_workspace_identity = ? AND status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})`,
            )
            .all(identity, ...ACTIVE_STATUSES) as Array<{
            id: string;
            write_domain: string | null;
          }>;
          const conflict = rows.some((entry) => {
            if (entry.id === next.id) return false;
            const domain = parseWriteDomainColumn(entry.write_domain) ?? { kind: "workspace" as const };
            return detectWriteDomainOverlap(domain, ownDomain);
          });
          if (conflict) {
            logger.info("assistant-tickets queued 队头写域仍与活动工单重叠，保持排队", {
              ticketId: next.id,
            });
            return null;
          }
          raw
            .prepare("UPDATE ticket SET status = ?, queued_reason = NULL, updated_ms = ? WHERE id = ?")
            .run(ASSISTANT_TICKET_STATUSES.dispatched, nowMs(), next.id);
          return { ...next, intent: parseDispatchIntent(next.dispatch_intent) };
        },
      );
      if (!released) return;
      // 释放派发不重过预算闸（已复检）；写域沿用建票时规划（worktree 已检出则 git 端口幂等续用）。
      const domain = parseWriteDomainColumn(released.write_domain);
      const intent = released.intent;
      const tier = intent?.tier ?? "build";
      const result =
        intent?.mode === "C" && intent.attachSessionId
          ? await deps.attachDispatch({
              ticketId: released.id,
              text: released.brief,
              targetIdentity: identity,
              sessionId: intent.attachSessionId,
            })
          : await deps.dispatchNewTicket({
              ticketId: released.id,
              // Mode B：释放重套建队指示（brief 列恒存原文，指示不落库、幂等重套——02 §5）。
              brief: intent?.mode === "B" ? composeTeamLeadBrief(released.brief) : released.brief,
              targetIdentity: identity,
              tier,
              mode: intent?.mode === "B" ? "B" : "A",
              ...(domain?.kind === "worktree" ? { hostPath: domain.path } : {}),
              ...(domain && intent?.mode !== "C" ? { domain } : {}),
            });
      if (!result.ok) {
        logger.warn("assistant-tickets queued 释放派发失败", { ticketId: released.id });
      } else {
        logger.info("assistant-tickets queued 工单按 FIFO 释放", {
          ticketId: released.id,
          mode: intent?.mode ?? "A",
        });
      }
      deps.publish();
    })().catch((error) => logger.warn("assistant-tickets queued 释放异常", error));
  }

  return { activeCountFor, listActiveWriteDomains, queueTicket, releaseNextQueued };
}
