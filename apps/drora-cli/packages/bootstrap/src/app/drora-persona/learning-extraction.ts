/**
 * P1b 无工具抽取端口（specs/drora-persona-system.md §7「新 P1b 学习输入：仅 owner 提供的
 * 有界原始人类消息；无文件/shell/原始 model-io 工具」；合同 §6「有界无工具抽取」）。
 *
 * 窄接口：输入＝服务层裁剪后的有界人类消息窗口（≤8 条、合计 ≤8,000 code point），输出＝
 * 结构化候选草稿。端口形状里没有 sourceRole/origin/turnId 等身份字段——模型不得自报
 * 来源身份（合同 §6「模型不得自报 sourceRole/origin」）；来源定位（evidenceId）由服务
 * 构造并单独传递。
 *
 * 负例边界：本层校验器执行机械可判定的负例（范围声明、逐字引用、受控键值、上界）；
 * 语义负例（引用他人/假设/否定/助手建议/裸「好」/需助手上下文消歧的省略表达）属真实
 * 模型适配器的提示词与评测合同（PM38/40/48，切片 D 授权后验收），不能由字符串规则替代。
 */
import {
  PERSONA_LEARNING_BUDGET,
  PERSONA_PREFERENCE_ALLOWED_VALUES,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_PREFERENCE_LIMITS,
  type PersonaPreferenceKey,
} from "@drora/shared";

/** 单条候选草稿（模型输出的全部许可形状；多余字段即校验失败）。 */
export interface PersonaLearningCandidateDraft {
  /** 受控四键之一（契约键单一出处＝shared PERSONA_PREFERENCE_KEYS）。 */
  readonly key: string;
  /** 受控值（枚举成员或 1–40 code point 单行 preferredAddress）。 */
  readonly value: string;
  /**
   * 范围声明：必须字面量为 "global"（合同 §6「合格新轮的原话必须直接重述值与全局范围」；
   * 项目限定/临时要求的负例在机械层拒绝）。
   */
  readonly scope: "global";
  /** 逐字引用（来自输入窗口的原文片段；≤4 条、每条 ≤512 code point）。 */
  readonly evidenceRefs: readonly string[];
}

export interface PersonaLearningExtractionInput {
  /** 服务构造的稳定来源身份（模型不得生成）。 */
  readonly evidenceId: string;
  /** 有界原始人类消息窗口（已按 ≤8 条/≤8,000 code point 裁剪）。 */
  readonly messages: readonly string[];
}

export interface PersonaLearningTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type PersonaLearningExtractionOutcome =
  | {
      readonly status: "extracted";
      readonly drafts: readonly PersonaLearningCandidateDraft[];
      /** 实际用量（预算核销退差依据；缺省按预留值不退）。 */
      readonly usage?: PersonaLearningTokenUsage;
    }
  | { readonly status: "no_candidates"; readonly usage?: PersonaLearningTokenUsage };

/**
 * 抽取端口：availability="paused" 表示配置不可用（默认生产适配器）——编排器跳过预算
 * 预留、把工作置 retry_wait，不发生任何模型调用、不换模型绕过用户选择（合同 §6）。
 */
export interface PersonaLearningExtractionPort {
  readonly availability: "configured" | "paused";
  extract(input: PersonaLearningExtractionInput): Promise<PersonaLearningExtractionOutcome>;
}

/** 生产默认适配器：配置不可用暂停。零 IO、零模型调用。 */
export const pausedPersonaLearningExtractor: PersonaLearningExtractionPort = {
  availability: "paused",
  extract: async () => ({ status: "no_candidates" }),
};

// ---------------------------------------------------------------------------
// 独立校验器（编排器在模型输出与单库提交之间的最后一道机械闸）
// ---------------------------------------------------------------------------

export interface PersonaLearningValidatedCandidate {
  readonly key: PersonaPreferenceKey;
  readonly value: string;
  readonly evidenceRefs: readonly string[];
}

export type PersonaLearningDraftRejection =
  | "unknown_key"
  | "invalid_value"
  | "scope_not_global"
  | "missing_evidence"
  | "evidence_not_verbatim"
  | "draft_limit_exceeded";

export type PersonaLearningValidationResult =
  | {
      readonly status: "validated";
      readonly candidates: readonly PersonaLearningValidatedCandidate[];
    }
  | {
      readonly status: "rejected";
      readonly reason: PersonaLearningDraftRejection;
      /** 被拒草稿数（固定计数；不留正文，合同 §6「被拒候选不留正文」）。 */
      readonly rejectedCount: number;
    };

function codePoints(text: string): number {
  return [...text].length;
}

function normalizeQuote(text: string): string {
  return text.normalize("NFC");
}

/** 受控值校验（与显式保存同源规则；返回 undefined＝invalid_value，不截断不静默改写）。 */
function normalizeControlledValue(key: PersonaPreferenceKey, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (key === PERSONA_PREFERENCE_KEYS.preferredAddress) {
    const normalized = value.normalize("NFC").trim();
    if (
      normalized === "" ||
      codePoints(normalized) > PERSONA_PREFERENCE_LIMITS.preferredAddressMax ||
      [...normalized].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    ) {
      return undefined;
    }
    return normalized;
  }
  const allowed: readonly string[] | undefined =
    PERSONA_PREFERENCE_ALLOWED_VALUES[key as keyof typeof PERSONA_PREFERENCE_ALLOWED_VALUES];
  if (!allowed || !allowed.includes(value)) return undefined;
  return value;
}

/**
 * 候选草稿独立校验（合同 §6 逐条）：
 * - 草稿数 ≤ candidatesMaxPerWork；同键重复草稿拒绝（首键唯一，后续整批 rejected）。
 * - key 必须命中受控四键；value 必须通过受控值规则（未知键/自由文本＝不把任意 JSON
 *   转成指令，合同 §1.2）。
 * - scope 必须字面量 "global"（项目限定/临时要求机械拒绝）。
 * - evidenceRefs 1..4 条、每条非空 ≤512 code point，且必须逐字（NFC 后）出现在输入
 *   窗口内——模型只允许引用被提供的片段（spec §8），伪造引用/越窗引用一律拒绝。
 */
export function validateExtractionDrafts(input: {
  readonly messages: readonly string[];
  readonly drafts: readonly PersonaLearningCandidateDraft[];
}): PersonaLearningValidationResult {
  if (input.drafts.length > PERSONA_LEARNING_BUDGET.candidatesMaxPerWork) {
    return { status: "rejected", reason: "draft_limit_exceeded", rejectedCount: input.drafts.length };
  }
  const windowText = normalizeQuote(input.messages.join("\n"));
  const candidates: PersonaLearningValidatedCandidate[] = [];
  const seenKeys = new Set<string>();
  for (const draft of input.drafts) {
    const key = (PERSONA_PREFERENCE_KEYS as Readonly<Record<string, string>>)[
      typeof draft.key === "string" ? draft.key : ""
    ] as PersonaPreferenceKey | undefined;
    if (!key) {
      return { status: "rejected", reason: "unknown_key", rejectedCount: input.drafts.length };
    }
    if (seenKeys.has(key)) {
      return { status: "rejected", reason: "unknown_key", rejectedCount: input.drafts.length };
    }
    if (draft.scope !== "global") {
      return { status: "rejected", reason: "scope_not_global", rejectedCount: input.drafts.length };
    }
    const value = normalizeControlledValue(key, draft.value);
    if (value === undefined) {
      return { status: "rejected", reason: "invalid_value", rejectedCount: input.drafts.length };
    }
    const refs = draft.evidenceRefs;
    if (
      !Array.isArray(refs) ||
      refs.length === 0 ||
      refs.length > PERSONA_LEARNING_BUDGET.evidenceRefsMaxPerCandidate
    ) {
      return { status: "rejected", reason: "missing_evidence", rejectedCount: input.drafts.length };
    }
    for (const ref of refs) {
      if (
        typeof ref !== "string" ||
        ref.length === 0 ||
        codePoints(ref) > PERSONA_LEARNING_BUDGET.evidenceRefQuoteMaxCodePoints
      ) {
        return { status: "rejected", reason: "missing_evidence", rejectedCount: input.drafts.length };
      }
      if (!windowText.includes(normalizeQuote(ref))) {
        return {
          status: "rejected",
          reason: "evidence_not_verbatim",
          rejectedCount: input.drafts.length,
        };
      }
    }
    seenKeys.add(key);
    candidates.push({ key, value, evidenceRefs: [...refs] });
  }
  if (candidates.length === 0) {
    return { status: "rejected", reason: "missing_evidence", rejectedCount: input.drafts.length };
  }
  return { status: "validated", candidates };
}

/** 预算预留的输入 token 估计（无 tokenizer 的保守启发：4 code point ≈ 1 token）。 */
export function estimateLearningInputTokens(messages: readonly string[]): number {
  const totalCodePoints = messages.reduce((sum, message) => sum + codePoints(message), 0);
  return Math.ceil(totalCodePoints / 4);
}
