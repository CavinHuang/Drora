import { conversationQuotesSchema } from "../conversationSelection.js";
import { botGroupInputSourceSchema } from "../bots.js";
// CLI admission 后的自包含输入事实。
// queue / guide / runtime / transcript 只能携带同一个 intent，不允许各层重建字段。
import { VOICE_INPUT_SOURCE_KIND } from "../contracts/voice.js";
import { z } from "zod";
import { timestampSchema } from "./core.js";
import { attachmentRefSchema } from "./attachment-ref.js";
import { highspeedMessageMetaSchema } from "../highspeed.js";
import { modelSelectionSchema } from "../model-selection.js";
import { submissionModeSchema } from "./submission.js";
import { sharedContextRefSchema } from "./shared-context-ref.js";
import {
  MAX_EVIDENCE_REFS_PER_INPUT,
  KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX,
} from "../knowledge-evidence.js";

/** VaultView Evidence 引用（opaque receiptId；复验事实在服务端账本，不随线传输）。 */
export const evidenceRefSchema = z
  .object({ receiptId: z.string().min(1) })
  .strict()
  .refine(
    (ref) => ref.receiptId.startsWith(KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX),
    "receiptId shape invalid",
  );
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

/**
 * 用户输入的结构化来源：插件 UI 经 `ui/message`
 * 代用户发送时带上，落库后卡片显示"来自插件 X"。缺省即用户亲自输入。
 */
const pluginUiInputSourceSchema = z
  .object({
    kind: z.literal("pluginUi"),
    pluginId: z.string().min(1),
    toolCallId: z.string().min(1),
  })
  .strict();
/**
 * 语音输入来源（specs/voice-agent-integration.md §2.2，additive）。kind 字面量引用
 * contracts/voice.ts 单一出处。`.strict()` 偏斜方向冻结为 CLI→renderer：旧 CLI 收到
 * `kind:"voice"` 会整条拒收 sendText，落地顺序必须 CLI 先行；灰度期内听写照常以纯文本
 * 发送（`conversationInputIntentSchema.source` 本就 optional），功能不受影响。
 * 不引入运行时探测/降级重发分支——桌面同仓同发 CLI，顺序门禁（PR 依赖声明）足够。
 */
export const voiceInputSourceSchema = z
  .object({
    kind: z.literal(VOICE_INPUT_SOURCE_KIND),
    /** BCP-47；听写发生时的 locale 快照（诊断面，不参与路由）。 */
    lang: z.string().min(1).max(35).optional(),
    /** 引擎标识；新增引擎 = additive 追加枚举成员，同样遵守 CLI 先行。 */
    engine: z.enum(["webSpeech", "remote"]).optional(),
  })
  .strict();
export const conversationInputSourceSchema = z.discriminatedUnion("kind", [
  pluginUiInputSourceSchema,
  z
    .object({
      kind: z.literal("genUi"),
      path: z.string().min(1).max(4096),
      title: z.string().max(250).optional(),
    })
    .strict(),
  voiceInputSourceSchema,
]);
export type ConversationInputSource = z.infer<typeof conversationInputSourceSchema>;

export const conversationInputDeliverySchema = z
  .object({
    requested: z.enum(["auto", "startNow", "queue", "guide"]),
    admitted: z.enum(["startNow", "queue", "guide"]),
    fallbackReasonCode: z.string().optional(),
  })
  .strict();

export const conversationInputOrderSchema = z
  .object({
    admissionSeq: z.number().int().nonnegative(),
    queuePosition: z.number().int().nonnegative().optional(),
  })
  .strict();

export const conversationInputSteerSchema = z
  .object({
    state: z.enum(["notRequested", "submitting", "steering", "guided", "fellBack"]),
    reasonCode: z.string().optional(),
  })
  .strict();

export const conversationInputDispatchSchema = z
  .object({
    state: z.enum(["admitted", "queued", "reserved", "promoting", "drained"]),
    reservationId: z.string().optional(),
  })
  .strict();

export const conversationInputIntentSchema = z
  .object({
    inputOrigin: z.enum(["desktop", "mobile"]).optional(),
    botGroupSource: botGroupInputSourceSchema.optional(),
    conversationQuotes: conversationQuotesSchema.optional(),
    sourceCommandId: z.string().min(1),
    queueItemId: z.string().min(1),
    clientId: z.string().min(1),
    // compact 是可排队的维护意图；消费时走 compact lifecycle，不投影为 user row。
    kind: z.enum(["sendText", "sendGoalCommand", "compact"]),
    text: z.string(),
    attachments: z.array(attachmentRefSchema).default([]),
    // optional 只服务旧 snapshot hydration；新 admission 必须填入完整 Submission。
    modelSelection: modelSelectionSchema.optional(),
    mode: submissionModeSchema.optional(),
    planEnabled: z.boolean().optional(),
    sharedContextRefs: z.array(sharedContextRefSchema).max(1).optional(),
    // VaultView Evidence 引用（W03）：admission 时从 sendText payload 固定进 intent，
    // 随 queue item 持久事实存活，sendQueuedNow 提升时由 CLI gate 执行时复验。
    // optional：旧账本/旧快照无此键；edit/retry 重建的新输入**继承**原 evidenceRefs 并在
    // canonical-intent-replay 二次复验（cli-2 勘误 2026-10-17：原注释称「不继承」与实现相反）。
    evidenceRefs: z.array(evidenceRefSchema).max(MAX_EVIDENCE_REFS_PER_INPUT).optional(),
    delivery: conversationInputDeliverySchema,
    order: conversationInputOrderSchema,
    steer: conversationInputSteerSchema,
    dispatch: conversationInputDispatchSchema,
    admittedAt: timestampSchema,
    highspeed: highspeedMessageMetaSchema.optional(),
    provenance: z
      .object({
        sourceCommandId: z.string().min(1),
        queueItemId: z.string().min(1).optional(),
        clientId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    source: conversationInputSourceSchema.optional(),
  })
  .strict();

export type ConversationInputIntent = z.infer<typeof conversationInputIntentSchema>;
