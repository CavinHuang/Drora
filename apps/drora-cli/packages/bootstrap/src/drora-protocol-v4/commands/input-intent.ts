import type { TurnInputIntentMetadata } from "@drora/contracts";
import type { ModelSelection } from "@drora/shared";
import type {
  AttachmentRef,
  CommandEnvelope,
  CommandPayloadMap,
  QueueItem,
  SubmissionMode,
} from "@drora/shared/drora-protocol-v4";
import { commandAdmissionOf } from "./executor.js";

export interface CanonicalCommandIntent {
  inputOrigin?: "desktop" | "mobile";
  conversationQuotes?: import("@drora/contracts").TurnInputIntentMetadata["conversationQuotes"];
  botGroupSource?: TurnInputIntentMetadata["botGroupSource"];
  kind: "sendText" | "sendGoalCommand";
  text: string;
  modelSelection?: ModelSelection;
  mode?: SubmissionMode;
  planEnabled?: boolean;
  sourceCommandId?: string;
  clientId?: string;
  queueItemId?: string;
  requestedDelivery?: TurnInputIntentMetadata["requestedDelivery"];
  admittedDelivery?: TurnInputIntentMetadata["admittedDelivery"];
  fallbackReasonCode?: string;
  attachmentRefs?: readonly AttachmentRef[];
  genUiContext?: TurnInputIntentMetadata["genUiContext"];
  sharedContextRefs?: TurnInputIntentMetadata["sharedContextRefs"];
  provenance?: TurnInputIntentMetadata["provenance"];
  source?: TurnInputIntentMetadata["source"];
}

export function inputIntentMetadata(
  envelope: CommandEnvelope,
  options: {
    text: string;
    inputOrigin?: "desktop" | "mobile";
    conversationQuotes?: import("@drora/contracts").TurnInputIntentMetadata["conversationQuotes"];
    botGroupSource?: TurnInputIntentMetadata["botGroupSource"];
    requestedDelivery: TurnInputIntentMetadata["requestedDelivery"];
    admittedDelivery?: TurnInputIntentMetadata["admittedDelivery"];
    fallbackReasonCode?: string;
    attachmentRefs?: readonly AttachmentRef[];
    modelSelection?: ModelSelection;
    mode?: SubmissionMode;
    planEnabled?: boolean;
    genUiContext?: TurnInputIntentMetadata["genUiContext"];
    sharedContextRefs?: TurnInputIntentMetadata["sharedContextRefs"];
    source?: TurnInputIntentMetadata["source"];
    },
): TurnInputIntentMetadata {
  const admission = commandAdmissionOf(envelope);
  const highspeed =
    envelope.type === "sendText"
      ? (envelope.payload as CommandPayloadMap["sendText"]).highspeedMeta
      : undefined;
  return {
    ...((envelope.inputOrigin ?? options.inputOrigin)
      ? { inputOrigin: envelope.inputOrigin ?? options.inputOrigin }
      : {}),
    ...(options.conversationQuotes ? { conversationQuotes: options.conversationQuotes } : {}),
    ...(options.botGroupSource ? { botGroupSource: options.botGroupSource } : {}),
    sourceCommandId: envelope.commandId,
    queueItemId: admission.queueItemId,
    clientId: envelope.clientId || "cli",
    kind:
      envelope.type === "compact"
        ? "compact"
        : envelope.type === "sendGoalCommand"
          ? "sendGoalCommand"
          : "sendText",
    // live intent 过去只带 kind/来源，projection 只能回退可见 command 文案；
    // goal 的 displayText（如 `/GoAl replace X`）不是 runtime 已解析的 canonical objective。
    text: options.text,
    ...(options.modelSelection ? { modelSelection: options.modelSelection } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.planEnabled !== undefined ? { planEnabled: options.planEnabled } : {}),
    admissionSeq: admission.admissionSeq,
    admittedAt: admission.admittedAt,
    requestedDelivery: options.requestedDelivery,
    admittedDelivery:
      options.admittedDelivery ??
      (options.requestedDelivery === "guide"
        ? "guide"
        : options.requestedDelivery === "queue"
          ? "queue"
          : "startNow"),
    ...(options.fallbackReasonCode ? { fallbackReasonCode: options.fallbackReasonCode } : {}),
    ...(options.attachmentRefs ? { attachmentRefs: [...options.attachmentRefs] } : {}),
    ...(options.genUiContext !== undefined ? { genUiContext: options.genUiContext } : {}),
    ...(options.sharedContextRefs ? { sharedContextRefs: [...options.sharedContextRefs] } : {}),
    ...(highspeed ? { highspeed } : {}),
    ...(options.source ? { source: options.source } : {}),
    // P7 本体清除（spec §1-C6）：evidenceRefs 写入路径删除——新 canonical intent 不再
    // 携带证据引用（wire 字段 deprecated；旧账本 refs 条目由 evidence-admission
    // legacy 探测器在 admission/提升边界拒绝）。
  };
}

/** edit/retry 以新 commandId 重建，但保留原 canonical kind/delivery/cause。 */
export function inputIntentMetadataFromCanonical(
  envelope: CommandEnvelope,
  canonical: CanonicalCommandIntent,
  text = canonical.text,
): TurnInputIntentMetadata {
  const admission = commandAdmissionOf(envelope);
  const originalSourceCommandId =
    canonical.provenance?.sourceCommandId ?? canonical.sourceCommandId;
  return {
    ...((envelope.inputOrigin ?? canonical.inputOrigin)
      ? { inputOrigin: envelope.inputOrigin ?? canonical.inputOrigin }
      : {}),
    ...(canonical.conversationQuotes ? { conversationQuotes: canonical.conversationQuotes } : {}),
    // P7（spec §1-C6）：edit/retry 重建不再继承 evidenceRefs——重建仅在 legacy 探测器
    // 通过（原 intent refs 为空）后发生，旧带 refs 条目在 fork-edit-retry 边界即被拒。
    ...(canonical.botGroupSource ? { botGroupSource: canonical.botGroupSource } : {}),
    sourceCommandId: envelope.commandId,
    queueItemId: admission.queueItemId,
    clientId: envelope.clientId || canonical.clientId || "cli",
    kind: canonical.kind,
    text,
    ...(canonical.modelSelection ? { modelSelection: canonical.modelSelection } : {}),
    ...(canonical.mode ? { mode: canonical.mode } : {}),
    ...(canonical.planEnabled !== undefined ? { planEnabled: canonical.planEnabled } : {}),
    admissionSeq: admission.admissionSeq,
    admittedAt: admission.admittedAt,
    requestedDelivery: canonical.requestedDelivery ?? "startNow",
    admittedDelivery: canonical.admittedDelivery ?? "startNow",
    ...(canonical.fallbackReasonCode ? { fallbackReasonCode: canonical.fallbackReasonCode } : {}),
    ...(canonical.attachmentRefs ? { attachmentRefs: [...canonical.attachmentRefs] } : {}),
    ...(canonical.genUiContext !== undefined ? { genUiContext: canonical.genUiContext } : {}),
    ...(canonical.sharedContextRefs ? { sharedContextRefs: [...canonical.sharedContextRefs] } : {}),
    ...(canonical.source ? { source: canonical.source } : {}),
    ...(originalSourceCommandId
      ? {
          provenance: canonical.provenance ?? {
            sourceCommandId: originalSourceCommandId,
            ...(canonical.queueItemId ? { queueItemId: canonical.queueItemId } : {}),
            ...(canonical.clientId ? { clientId: canonical.clientId } : {}),
          },
        }
      : {}),
  };
}

/** sendQueuedNow 只能转换原 QueueItem，禁止用 promotion commandId 重建来源。 */
export function inputIntentMetadataFromQueueItem(
  item: QueueItem,
  canonicalText: string,
): TurnInputIntentMetadata {
  return {
    ...(item.inputOrigin ? { inputOrigin: item.inputOrigin } : {}),
    ...(item.conversationQuotes ? { conversationQuotes: item.conversationQuotes } : {}),
    ...(item.botGroupSource ? { botGroupSource: item.botGroupSource } : {}),
    sourceCommandId: item.sourceCommandId,
    queueItemId: item.queueItemId,
    clientId: item.clientId,
    kind: item.kind,
    text: canonicalText,
    ...(item.modelSelection ? { modelSelection: item.modelSelection } : {}),
    ...(item.mode ? { mode: item.mode } : {}),
    ...(item.planEnabled !== undefined ? { planEnabled: item.planEnabled } : {}),
    admissionSeq: item.order.admissionSeq,
    admittedAt: item.admittedAt,
    requestedDelivery: item.delivery.requested,
    admittedDelivery: item.delivery.admitted,
    ...(item.order.queuePosition !== undefined ? { queuePosition: item.order.queuePosition } : {}),
    ...(item.delivery.fallbackReasonCode
      ? { fallbackReasonCode: item.delivery.fallbackReasonCode }
      : {}),
    attachmentRefs: item.attachments,
    ...(item.genUiContext !== undefined ? { genUiContext: item.genUiContext } : {}),
    ...(item.sharedContextRefs ? { sharedContextRefs: [...item.sharedContextRefs] } : {}),
    ...(item.highspeed ? { highspeed: item.highspeed } : {}),
    ...(item.source ? { source: item.source } : {}),
    // P7（spec §1-C6）：提升不再复制 evidenceRefs——带 refs 的旧队列项在
    // sendQueuedNow reserve 前已被 legacy 探测器拒绝，本重建只会承接空 refs 条目。
    // 提升只改变调度状态；重试／编辑原始输入的来源关联不能在此丢失。
    ...(item.provenance ? { provenance: { ...item.provenance } } : {}),
  };
}
