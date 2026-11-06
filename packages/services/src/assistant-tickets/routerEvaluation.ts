/**
 * Router 候选卡评估循环（02 详设 §1.3；从 assistantTicketsService 抽出——单文件 ≤800
 * 行纪律）。fire-and-forget 语义保持：决策卡产出即送 Router（端口未注入=无建议，Tier3
 * 语义）；输出经 routerDecision zod 严格校验；失败/不命中 schema → state=failed
 * （诚实降级，不重试模型、不猜测）。写 router_evaluation 表（v2 迁移；一决策至多一份
 * 评估，主键幂等）。
 */
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import { getAssistantPorts } from "./assistantPorts.js";
import {
  ASSISTANT_OUTCOMES,
  ASSISTANT_REPLY_LIMITS,
} from "@drora/shared";
import { parseRouterDecisionText } from "./routerDecision.js";
import { composeLedgerDigest, composeQueryReply, type QueryReplyLocale } from "./queryReply.js";
import {
  composeCandidateCard,
  composeChatTurnInput,
  filterAttachCandidates,
  type RouterAttachCandidate,
} from "./routerShell.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

/**
 * P10a（10 号详设 §2.2）：聊天轮答复截断——≤ASSISTANT_REPLY_LIMITS.replyTextMax code
 * points，超界加省略号（与 queryReply.ts 的 cap 同式；聊天输出是自由文本，只截断
 * 不解析——无 zod 失败态）。
 */
function capChatReplyText(text: string): string {
  const chars = [...text];
  return chars.length > ASSISTANT_REPLY_LIMITS.replyTextMax
    ? `${chars.slice(0, ASSISTANT_REPLY_LIMITS.replyTextMax).join("")}…`
    : text;
}

/**
 * P8b（09 详设 §1.6）：读装配层台账 provider（同端口纪律：未注入/抛错 → null=缺席，
 * 消费侧回落语义同 publish）。评估链内读一次、候选卡速览与 query 应答共用同一视图
 * ——同轮评估内的账本口径一致（30s 节流的新鲜度由刷新环路保证）。
 * P9：autonomy.ts 同读点复用本函数（同端口同缺席语义，不建第二条读路径）。
 */
export function readAssistantInventoryView(): import("@drora/shared").MateWorkInventoryView | null {
  const provider = getAssistantPorts().inventory;
  if (!provider) return null;
  try {
    return provider();
  } catch (error) {
    logger.warn("assistant-tickets 台账 provider 读取失败（评估链缺席台账）", error);
    return null;
  }
}

/**
 * Tier2 候选集生成（02 §2；P2 审查修复接线——此前 listSessions 端口零调用方、候选卡
 * 无候选清单，Router 的 attach 臂 sessionId 无真实来源，真实链路不可达）：
 * 目标 workspace 的 sessions-index 快照 → filterAttachCandidates 硬过滤纯函数产出
 * 有界候选。触发目标缺省（identity=null）或通道未装配/不可用 → 空候选（候选卡不含
 * 【附着候选】段，Router 按约言禁输出 attach 臂——诚实降级 Tier3 问人）。
 */
async function collectAttachCandidates(
  targetWorkspaceIdentity: string | null,
): Promise<RouterAttachCandidate[]> {
  const { sessionsIndex } = getAssistantPorts();
  if (!sessionsIndex || !targetWorkspaceIdentity) return [];
  try {
    const result = await sessionsIndex.listSessions(targetWorkspaceIdentity);
    if (!result.ok) return [];
    return filterAttachCandidates({ sessions: result.sessions, nowMs: nowMs() });
  } catch (error) {
    logger.warn("assistant-tickets Tier2 候选集获取失败（诚实降级 Tier3）", error);
    return [];
  }
}

export interface RouterEvaluationDeps {
  readonly db: AssistantDatabase;
  /** 评估落账后推送快照（服务闭包的 publish）。 */
  readonly publish: () => void;
  /**
   * P4 auto 信任门钩子（04 详设 §2）：评估落账为 suggested 后同步回调（服务闭包
   * 复核 mode=auto + dispatch/attach 臂 + evidence ≥1 + 探测通过才自动建票）。
   * 钩子内部异常只记日志——评估事实已落账，不影响人工决策卡路径。缺席=无自动臂
   * （observe 模式行为原样）。
   */
  readonly onSuggested?: (input: { decisionId: number; verdictJson: string }) => void;
  /** P7（08 号详设 §3.3）：query_status 臂的本机用户 identity（应答器模板占位用）。 */
  readonly localIdentity: string;
  /** P7：答复语言（面板/Source 缺省 zh；Source 事件原语言后续批接入）。 */
  readonly replyLocale?: QueryReplyLocale;
}

export interface RouterEvaluationTrigger {
  readonly decisionId: number;
  readonly trigger: {
    readonly id: string;
    readonly text: string;
    readonly strength: string;
    readonly identity: string;
    readonly atMs: number;
    readonly workspaceIdentity: string | null;
  };
}

export function createRouterEvaluation(deps: RouterEvaluationDeps): {
  /** 决策卡产出后调度评估（fire-and-forget；异常只落账+warn）。 */
  scheduleRouterEvaluation(input: RouterEvaluationTrigger): void;
} {
  const { db } = deps;

  function scheduleRouterEvaluation(input: RouterEvaluationTrigger): void {
    const { router } = getAssistantPorts();
    if (!router) return; // 通道未装配：决策卡无建议（Tier3 语义），P1 行为原样
    try {
      deps.db.transaction((raw: AssistantDatabaseRaw) => {
        raw
          .prepare(
            "INSERT INTO router_evaluation(decision_id, state, decided_ms) VALUES (?, 'pending', ?) ON CONFLICT(decision_id) DO NOTHING",
          )
          .run(input.decisionId, nowMs());
      });
    } catch (error) {
      logger.warn("assistant-tickets router 评估登记失败", error);
      return;
    }
    void (async () => {
      // Tier2 候选集在评估链内采集（事件驱动；通道失败/缺席→空候选，不阻断评估）。
      const attachCandidates = await collectAttachCandidates(input.trigger.workspaceIdentity);
      // P7 批 2（08 号详设 §4 方案乙）：候选卡附带有界台账速览——Router 无工具即可
      // 感知账本（查询意图判定/attach 佐证）；空台账缺席（不出现速览段）。
      // P8b（09 §1.6）：传入全域台账视图——速览段追加速览段全域会话/teams/闲时事实。
      const inventory = readAssistantInventoryView();
      const ledgerDigest = composeLedgerDigest(db.raw, deps.localIdentity, nowMs, input.decisionId, inventory);
      const card = composeCandidateCard({
        triggerId: input.trigger.id,
        text: input.trigger.text,
        strength: input.trigger.strength,
        identity: input.trigger.identity,
        atMs: input.trigger.atMs,
        targetWorkspaceIdentity: input.trigger.workspaceIdentity,
        ...(ledgerDigest ? { digest: ledgerDigest } : {}),
        ...(attachCandidates.length > 0 ? { attachCandidates } : {}),
      });
      const result = await router({ card: card.input });
      // P7（08 号详设 §3.3）：query_status 臂 → host 直答——同事务落 answer_text +
      // decision 翻 outcome=status_replied（不建票、不派 worker、不进决策卡集；answer
      // 界 replyTextMax）。decision 配额计数在触发时已落，翻转不回冲（decision 类永不
      // 抑制，统计偏差 ≤1 有界——contracts 注释即对账点）。reason_code 两态：
      // - query_replied：确定性四 scope（status/ticket/usage/digest/work）——应答器
      //   零 LLM 加工，答案与账本结构性恒一致；
      // - chat_replied（P10a，10 号详设 §2.2）：scope kind="chat"——不走 composeQueryReply，
      //   改调 router port 聊天轮入口（同一 Router 会话追加自由作答轮：互扰标记+
      //   countTowardsRotation=false 不计轮转），输出仅截断 ≤800（无失败解析态）。
      //   聊天轮通道缺席/失败=诚实降级 failed（决策卡降级 Tier3 问人，不猜答案不重试）。
      let reply: { text: string; reasonCode: "query_replied" | "chat_replied" } | null = null;
      // 既有臂（dispatch/attach/hold/reject/确定性 query）的落账保持**同步**路径（无额外
      // 微任务跳——assistantP2Flows 评估时序既有锁定）；chat 臂是唯一含异步等待的分支
      // （聊天轮通道）。
      let finalize: { state: "suggested" | "failed"; verdict?: string; error?: string };
      if (!result.ok) {
        finalize = { state: "failed", error: result.reason };
      } else {
        const parsed = parseRouterDecisionText(result.output);
        if (!parsed.ok) {
          finalize = { state: "failed", error: parsed.reason };
        } else if (
          parsed.decision.kind === "query_status" &&
          parsed.decision.arm.scope.kind === "chat"
        ) {
          const chatPort = getAssistantPorts().routerChat;
          if (!chatPort) {
            finalize = { state: "failed", error: "chat 通道未装配（聊天轮不可达）" };
          } else {
            const chatTurn = await chatPort({
              text: composeChatTurnInput(input.trigger.text),
              countTowardsRotation: false,
            });
            if (!chatTurn.ok) {
              finalize = { state: "failed", error: `聊天轮失败：${chatTurn.reason}` };
            } else {
              reply = { text: capChatReplyText(chatTurn.output), reasonCode: "chat_replied" };
              finalize = { state: "suggested", verdict: JSON.stringify(parsed.decision) };
            }
          }
        } else {
          if (
            parsed.decision.kind === "query_status" &&
            parsed.decision.arm.scope.kind !== "chat"
          ) {
            const composed = composeQueryReply({
              // 正向条件收窄 kind（展开重建使字面量类型随分支收窄——应答器类型面
              // 不收 chat 是有意防误用）。
              scope: { ...parsed.decision.arm.scope, kind: parsed.decision.arm.scope.kind },
              raw: db.raw,
              localIdentity: deps.localIdentity,
              // P8b（09 详设 §1.6）：work scope 读全域台账（与候选卡速览同视图）。
              inventory,
              ...(deps.replyLocale ? { locale: deps.replyLocale } : {}),
            });
            reply = {
              text: composed.text.slice(0, ASSISTANT_REPLY_LIMITS.replyTextMax),
              reasonCode: "query_replied",
            };
          }
          finalize = { state: "suggested", verdict: JSON.stringify(parsed.decision) };
        }
      }
      db.transaction((raw: AssistantDatabaseRaw) => {
        raw
          .prepare(
            "UPDATE router_evaluation SET state = ?, verdict = ?, error = ?, answer_text = ?, decided_ms = ? WHERE decision_id = ? AND state = 'pending'",
          )
          .run(finalize.state, finalize.verdict ?? null, finalize.error ?? null, reply?.text ?? null, nowMs(), input.decisionId);
        if (reply !== null) {
          raw
            .prepare(
              "UPDATE admission_decision SET outcome = ?, reason_code = ? WHERE id = ? AND outcome = ?",
            )
            .run(
              ASSISTANT_OUTCOMES.statusReplied,
              reply.reasonCode,
              input.decisionId,
              ASSISTANT_OUTCOMES.decisionCard,
            );
        }
      });
      if (finalize.state === "suggested" && finalize.verdict && deps.onSuggested) {
        try {
          deps.onSuggested({ decisionId: input.decisionId, verdictJson: finalize.verdict });
        } catch (error) {
          logger.warn("assistant-tickets router suggested 钩子失败（决策卡留人工）", error);
        }
      }
      deps.publish();
    })().catch((error) => {
      logger.warn("assistant-tickets router 评估异常（决策卡降级 Tier3）", error);
      try {
        db.transaction((raw: AssistantDatabaseRaw) => {
          raw
            .prepare(
              "UPDATE router_evaluation SET state = 'failed', error = ?, decided_ms = ? WHERE decision_id = ? AND state = 'pending'",
            )
            .run(String(error), nowMs(), input.decisionId);
        });
        deps.publish();
      } catch (recordError) {
        logger.warn("assistant-tickets router 评估异常落账失败", recordError);
      }
    });
  }

  return { scheduleRouterEvaluation };
}
