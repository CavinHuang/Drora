/**
 * Router 单轮输出汇聚器（P2 抽出 + 2026-11-07 dev 实机修复批强化）。
 *
 * 消费 conversation wire candidate 帧，把「一轮 Router 会话投递」的输出 settle 成
 * 双臂结果：assistantText 行 complete → {ok, output}；failed/interrupted → 失败臂。
 *
 * 修复（2026-11-07 dev 实机，评估链永久挂起根因）：轮在产出任何 assistantText 行
 * 之前失败时（provider/配置错误在 prompt 阶段抛错），CLI 只发 **turnHeader 行**的
 * 终态帧（state=failed/completedInterrupted）——旧监听只认 assistantText，output
 * Promise 永不 settle → 串行化评估队列被一轮毒化，后续所有候选卡评估永久停在
 * 「大副评估中」（实机：09:33 自主轮挂起后 10:16/10:20/10:41 三轮连 admission 表
 * 都未进）。turnHeader.sourceCommandId 是轮↔命令的权威归因（我们的 sendText
 * commandId 单出处），据此匹配本轮：
 * - failed → 失败臂（评估落 failed 降级 Tier3 问人，不重试模型）；
 * - completedInterrupted → 失败臂（用户侧中断的诚实留痕）；
 * - completedSuccess 且无 assistantText（防御：controlOnly/空轮）→ {ok, output:""}，
 *   下游 parseRouterDecisionText 对空文本诚实失败；
 * - 无 sourceCommandId 的 turnHeader（旧 CLI 兼容形态）无法归因 → 忽略（保守）。
 *
 * 双 settle 防御：首臂 settle 后后续帧全部忽略（迟到帧常态存在——行 upsert 重放）。
 */

export type RouterTurnOutcome = { ok: true; output: string } | { ok: false; reason: string };

export interface RouterTurnSink {
  /** 逐帧喂入（droraAgentService.onDynamicConversationFrame 的 candidate）。 */
  handleFrame(candidate: unknown): void;
  /** 该轮输出；双臂必 settle（事件解除，非超时兜底——帧状态即事件信号）。 */
  readonly output: Promise<RouterTurnOutcome>;
}

interface TurnSinkFrameRow {
  op?: unknown;
  row?: {
    kind?: unknown;
    state?: unknown;
    text?: unknown;
    sourceCommandId?: unknown;
  };
}

export function createRouterTurnSink(input: {
  sessionId: string;
  commandId: string;
}): RouterTurnSink {
  let settle:
    | ((result: RouterTurnOutcome) => void)
    | null = null;
  const output = new Promise<RouterTurnOutcome>((resolve) => {
    settle = resolve;
  });
  const settleOnce = (result: RouterTurnOutcome): void => {
    settle?.(result);
    settle = null;
  };
  return {
    output,
    handleFrame(candidate: unknown): void {
      if (settle === null) return; // 已 settle：迟到帧忽略
      if (typeof candidate !== "object" || candidate === null) return;
      const frame = candidate as { topic?: unknown; payload?: { kind?: unknown; deltas?: unknown } };
      if (frame.topic !== `conversation/${input.sessionId}` || frame.payload?.kind !== "deltas") {
        return;
      }
      if (!Array.isArray(frame.payload.deltas)) return;
      for (const delta of frame.payload.deltas) {
        if (typeof delta !== "object" || delta === null) continue;
        const d = delta as TurnSinkFrameRow;
        if (
          (d.op === "row.appended" || d.op === "row.upserted") &&
          typeof d.row === "object" &&
          d.row !== null
        ) {
          if (d.row.kind === "assistantText") {
            if (d.row.state === "complete" && typeof d.row.text === "string") {
              settleOnce({ ok: true, output: d.row.text });
              return;
            }
            if (d.row.state === "failed" || d.row.state === "interrupted") {
              settleOnce({
                ok: false,
                reason: `Router 该轮 turn ${d.row.state === "failed" ? "失败" : "被中断"}（assistantText ${d.row.state}）`,
              });
              return;
            }
          } else if (d.row.kind === "turnHeader") {
            // sourceCommandId 归因（见头注）：无归因的 turnHeader 不属于本轮，忽略。
            if (d.row.sourceCommandId !== input.commandId) continue;
            if (d.row.state === "failed") {
              settleOnce({ ok: false, reason: "Router 该轮失败（turnHeader failed）" });
              return;
            }
            if (d.row.state === "completedInterrupted") {
              settleOnce({ ok: false, reason: "Router 该轮被中断（turnHeader completedInterrupted）" });
              return;
            }
            if (d.row.state === "completedSuccess") {
              // 防御臂：成功终态却无 assistantText（controlOnly/空轮）——空输出交给
              // 下游解析诚实失败，绝不挂起。
              settleOnce({ ok: true, output: "" });
              return;
            }
          }
        }
      }
    },
  };
}
