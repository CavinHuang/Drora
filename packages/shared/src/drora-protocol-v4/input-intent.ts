import { genUiModelContextSchema } from "../gen-ui/contract.js";
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
// ---------------------------------------------------------------------------
// P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C6）：
// knowledge-evidence.ts 已删除（实现契约随 C1 迁插件包）。以下 wire 侧证据词表是
// **deprecated 兼容面**：schema 字段定义保留使 .strict() 仍能解析旧持久化账本（删定义
// 会让旧账本硬解析失败、破坏会话恢复）；生产端写入路径已全部删除，旧账本携带 refs
// 的条目由 CLI intent 层 D9 legacy 探测器拒绝（结构化 legacy_evidence_unverifiable，
// fail-closed，A17 延续）。禁止在新代码中生产这些字段。
// ---------------------------------------------------------------------------

/** @deprecated 兼容旧持久化账本的 opaque 证据引用形状；生产端已停止写入。 */
export interface KnowledgeEvidenceRef {
  receiptId: string;
}

/** @deprecated 单条输入的旧证据引用上限（旧账本解析边界）。 */
export const MAX_EVIDENCE_REFS_PER_INPUT = 8;

/** @deprecated opaque receipt id 前缀（形状校验；receipt 账本本体已迁插件数据目录）。 */
export const KNOWLEDGE_EVIDENCE_RECEIPT_ID_PREFIX = "evr_";

/**
 * @deprecated CLI ACK failed.reasonCode 的 guard 词表。P7 后唯一活跃拒绝是 D9 legacy
 * 探测器（guard.evidenceForbidden + legacy_evidence_unverifiable）；其余成员保留给
 * 历史会话错误码的 UI 消费端（knowledgeEvidenceSendFailure）识别。
 */
export const KNOWLEDGE_EVIDENCE_GUARD_PREFIX = "guard.evidence" as const;
export const KNOWLEDGE_EVIDENCE_GUARDS = {
  stale: "guard.evidenceStale",
  missing: "guard.evidenceMissing",
  forbidden: "guard.evidenceForbidden",
  unknown: "guard.evidenceUnknown",
  unavailable: "guard.evidenceUnavailable",
  guideForbidden: "guard.evidenceGuideForbidden",
} as const;
export type KnowledgeEvidenceGuard =
  (typeof KNOWLEDGE_EVIDENCE_GUARDS)[keyof typeof KNOWLEDGE_EVIDENCE_GUARDS];

/**
 * @deprecated 结构化拒绝原因词表；legacyEvidenceUnverifiable（"legacy_evidence_
 * unverifiable"）为 P7 D9 新增——旧账本带 refs 条目一律拒绝且不再静默容忍。
 */
export const KNOWLEDGE_EVIDENCE_REASONS = {
  unknownReceipt: "unknown_receipt",
  crossSession: "cross_session",
  sourceUnconfigured: "source_unconfigured",
  vaultSwitched: "vault_switched",
  sourceReauthorized: "source_reauthorized",
  fileDeleted: "file_deleted",
  fileModified: "file_modified",
  quoteMoved: "quote_moved",
  gateUnavailable: "gate_unavailable",
  legacyEvidenceUnverifiable: "legacy_evidence_unverifiable",
} as const;
export type KnowledgeEvidenceReason =
  (typeof KNOWLEDGE_EVIDENCE_REASONS)[keyof typeof KNOWLEDGE_EVIDENCE_REASONS];

/** 旧 VaultView Evidence 引用（opaque receiptId；deprecated，生产端已停止写入）。 */
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
    genUiContext: genUiModelContextSchema.optional(),
    sharedContextRefs: z.array(sharedContextRefSchema).max(1).optional(),
    // @deprecated P7 本体清除（spec §1-C6）：旧 VaultView Evidence 引用（W03）。
    // 字段定义保留仅为解析旧持久化账本/快照（.strict() 兼容）；生产端写入路径已全删，
    // 携带 refs 的旧账本条目由 CLI intent 层 legacy 探测器拒绝
    // （legacy_evidence_unverifiable，fail-closed）。
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
