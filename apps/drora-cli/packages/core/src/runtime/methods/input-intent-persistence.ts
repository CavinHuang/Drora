import type { SessionStorePort, SessionId } from "@drora/contracts";
import type { TurnInputIntentMetadata } from "../deps.js";

/**
 * 把 runtime 的协议无关参数组装成 transcript/ledger 共用的完整输入事实。
 *
 * 只分别保存 text 与一组 metadata 的话，恢复端必须再次推断 delivery、
 * steer 和 dispatch，容易让 live projection 与 cold snapshot 出现不同状态。这里在
 * admission/drain 边界一次性固化，后续消费者只能读取，不能重新猜测。
 */
export function buildPersistedConversationInputIntent(
  text: string,
  intent: TurnInputIntentMetadata | undefined,
  dispatchState: "queued" | "drained",
): Record<string, unknown> | undefined {
  if (!intent) return undefined;

  const steer = intent.fallbackReasonCode
    ? { state: "fellBack", reasonCode: intent.fallbackReasonCode }
    : intent.admittedDelivery === "guide"
      ? { state: dispatchState === "drained" ? "guided" : "steering" }
      : { state: "notRequested" };

  return {
    ...(intent.inputOrigin ? { inputOrigin: intent.inputOrigin } : {}),
    ...(intent.conversationQuotes ? { conversationQuotes: intent.conversationQuotes } : {}),
    // 只持久化已经过 CLI admission 校验的 opaque 回执（evidenceRefs）。冷恢复的溯源
    // 只能从这份经 schema 校验的持久 intent 重建，绝不能从模型文本、来源标签或未验证
    // 路径重建——否则 live 与 cold 会出现两套输入事实（见本文件头部不变量）。
    ...(intent.evidenceRefs?.length ? { evidenceRefs: [...intent.evidenceRefs] } : {}),
    ...(intent.botGroupSource ? { botGroupSource: intent.botGroupSource } : {}),
    sourceCommandId: intent.sourceCommandId,
    queueItemId: intent.queueItemId,
    clientId: intent.clientId,
    kind: intent.kind,
    // goal 的 message text 可以是 `/goal ...` 展示文案；admission 已持有 runtime
    // 解析后的 canonical objective，持久化必须优先使用它以保证 live/cold 等价。
    text: intent.text ?? text,
    attachments: intent.attachmentRefs ?? [],
    ...(intent.modelSelection ? { modelSelection: intent.modelSelection } : {}),
    ...(intent.mode ? { mode: intent.mode } : {}),
    ...(intent.planEnabled !== undefined ? { planEnabled: intent.planEnabled } : {}),
    ...(intent.sharedContextRefs ? { sharedContextRefs: intent.sharedContextRefs } : {}),
    delivery: {
      requested: intent.requestedDelivery,
      admitted: intent.admittedDelivery,
      ...(intent.fallbackReasonCode ? { fallbackReasonCode: intent.fallbackReasonCode } : {}),
    },
    order: {
      admissionSeq: intent.admissionSeq,
      ...(intent.queuePosition !== undefined ? { queuePosition: intent.queuePosition } : {}),
    },
    steer,
    dispatch: { state: dispatchState },
    admittedAt: intent.admittedAt,
    ...(intent.highspeed ? { highspeed: intent.highspeed } : {}),
    ...(intent.provenance ? { provenance: intent.provenance } : {}),
    ...(intent.source ? { source: intent.source } : {}),
  };
}

/** 在工具执行前收紧群任务授权；普通正文不能改变这个可信 metadata 标记。 */
export async function ensureGroupTaskPermissionScope(
  store: SessionStorePort | undefined,
  sessionId: SessionId,
  intent: TurnInputIntentMetadata | undefined,
): Promise<void> {
  if (!intent?.botGroupSource) return;
  if (!store) throw new Error("Group task permission scope requires persistence");
  const session = await store.getSession(sessionId);
  if (!session) throw new Error("Group task permission scope requires a persisted session");
  if (session.permission?.scope === "session") return;
  await store.updateSession({
    id: sessionId,
    permission: { version: 1, scope: "session", mode: "build" },
  });
}
