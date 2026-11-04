/**
 * P1b 真实模型抽取适配器（specs/drora-persona-system.md §13 第十四批；PM38/40/48 提示词合同）。
 *
 * 实现 `PersonaLearningExtractionPort` 的 availability="configured" 形态：把有界人类
 * 消息窗口交给模型，产出受控四键候选草稿。语义负例（引用他人/假设/否定/裸确认/
 * 项目限定/临时/需助手上下文消歧的省略表达）由本提示词承担拒学指令——按已记录
 * 合同「语义负例不能由字符串规则替代」，本文件不写任何关键词式过滤；机械闸
 * （`validateExtractionDrafts`）仍在编排器与提交之间独立生效。
 *
 * 分层边界：适配器只做「请求构造 + JSON 解析 + 形状最简检查」。解析失败或顶层形状
 * 不对 → no_candidates（不虚构、不重试）；草稿键值/引用合法性一律透传给编排器的
 * 机械闸与 owner 复验判定，本层不重复裁决（避免两个所有者）。
 *
 * 生产装配不消费本适配器：create-app 保持默认 paused 抽取器（合同 §6「不换模型
 * 绕过用户选择」）。当前唯一消费方是评测 harness（tests/persona/eval/）。
 */
import type { ModelRequest, ModelResult } from "@drora/contracts";
import {
  PERSONA_LEARNING_BUDGET,
  PERSONA_PREFERENCE_ALLOWED_VALUES,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_PREFERENCE_LIMITS,
} from "@drora/shared";
import type {
  PersonaLearningCandidateDraft,
  PersonaLearningExtractionOutcome,
  PersonaLearningExtractionPort,
  PersonaLearningTokenUsage,
} from "./learning-extraction.js";

/** 适配器依赖的最小模型面（只 consume generateText；测试与 harness 以假/真 Model 注入）。 */
export interface PersonaLearningModelCaller {
  generateText(request: ModelRequest): Promise<ModelResult>;
}

export interface ModelPersonaLearningExtractorOptions {
  readonly model: PersonaLearningModelCaller;
  /** 单次抽取输出上界（缺省按冻结实验值 1,024）。 */
  readonly maxOutputTokens?: number;
}

/** 抽取输出的严格 JSON Schema（responseJsonSchema 直传模型，结构化约束在此收口）。 */
const EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    drafts: {
      type: "array",
      maxItems: PERSONA_LEARNING_BUDGET.candidatesMaxPerWork,
      items: {
        type: "object",
        properties: {
          key: { type: "string", enum: Object.values(PERSONA_PREFERENCE_KEYS) },
          value: { type: "string" },
          scope: { type: "string", enum: ["global"] },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            maxItems: PERSONA_LEARNING_BUDGET.evidenceRefsMaxPerCandidate,
            items: { type: "string" },
          },
        },
        required: ["key", "value", "scope", "evidenceRefs"],
        additionalProperties: false,
      },
    },
  },
  required: ["drafts"],
  additionalProperties: false,
} as const;

/**
 * 提示词（PM38/40/48 合同的提示词侧）。要点：
 * - 只认消息作者本人直接、明确的自述偏好；值与全局范围必须被作者原话直接重述。
 * - 六类语义负例显式拒学：引用他人 / 假设 / 否定或未决 / 裸确认（好、嗯、ok）/
 *   项目限定或临时指令 / 需要助手上下文才能消歧的省略表达。
 * - evidenceRefs 必须逐字引用窗口原文；禁止自报来源身份与编造消息。
 */
function buildExtractionSystemPrompt(): string {
  const addressMax = PERSONA_PREFERENCE_LIMITS.preferredAddressMax;
  return [
    "You extract the author's durable communication preferences from a numbered window of raw human messages (the author is the user of an AI coding assistant).",
    "",
    "Allowed output keys and values (nothing else may be learned):",
    `- replyLanguage: ${PERSONA_PREFERENCE_ALLOWED_VALUES.replyLanguage.join(" | ")} (e.g. "always reply in Chinese" -> zh-CN; "follow whatever language I use" -> follow_user)`,
    `- explanationDetail: ${PERSONA_PREFERENCE_ALLOWED_VALUES.explanationDetail.join(" | ")} (e.g. "keep explanations brief" -> concise; "be thorough" -> detailed)`,
    `- preferredAddress: how the author asks to be addressed, 1-${addressMax} characters (e.g. "call me Lao Huang from now on" -> Lao Huang / the exact address string)`,
    `- collaborationStyle: ${PERSONA_PREFERENCE_ALLOWED_VALUES.collaborationStyle.join(" | ")} (e.g. "just give me the answer directly" -> direct_answer; "walk me through step by step" -> step_by_step)`,
    "",
    "A draft is admissible ONLY when, in the author's own words:",
    "1. the author directly states the preference for themselves (first person), AND",
    "2. the value is explicitly restated (not implied), AND",
    "3. the scope is explicitly global/durable for future sessions (not only this project, not only today, not only this one time).",
    "",
    "NEVER learn from (return no draft for these):",
    "- quoted or reported preferences of other people (a colleague/friend likes X);",
    '- hypotheticals or questions ("what if I preferred X?" without adoption);',
    '- negations, undecided or contradictory statements ("maybe", "not sure yet", "don\'t change anything");',
    '- bare confirmations or backchannel ("ok", "yes", "好", "嗯", "就这样") — the window has no assistant context, so such replies are unresolvable;',
    "- ellipsis/omitted expressions that would need the assistant's previous suggestion to interpret;",
    '- project-scoped or temporary instructions ("just for this project", "just today", "for this task only");',
    "- corrections that revoke a previous preference without restating a new global value.",
    "",
    "Rules for evidenceRefs: 1-4 items, each a verbatim quote copied exactly (character for character) from the numbered window; never fabricate, paraphrase, or quote outside the window.",
    "",
    "Also never: output more than 4 drafts, invent keys or values, or claim any source identity (no session/turn/origin fields exist).",
    "If nothing qualifies, output {\"drafts\":[]}. Output only JSON conforming to the provided schema.",
  ].join("\n");
}

function buildExtractionUserPrompt(messages: readonly string[]): string {
  const numbered = messages.map((message, index) => `[${index + 1}] ${message}`).join("\n\n");
  return `Message window (human messages only, in order):\n\n${numbered}\n\nExtract admissible preference drafts for the author. If none qualify, return an empty drafts array.`;
}

/** 顶层形状最简检查：解析失败/非对象/drafts 非数组 → 无候选（不虚构、不重试）。 */
function parseDrafts(text: string): readonly PersonaLearningCandidateDraft[] | undefined {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const drafts = (parsed as { drafts?: unknown }).drafts;
  if (!Array.isArray(drafts)) return undefined;
  const shaped: PersonaLearningCandidateDraft[] = [];
  for (const draft of drafts) {
    if (typeof draft !== "object" || draft === null) return undefined;
    const record = draft as Record<string, unknown>;
    if (
      typeof record.key !== "string" ||
      typeof record.value !== "string" ||
      typeof record.scope !== "string" ||
      !Array.isArray(record.evidenceRefs) ||
      record.evidenceRefs.some((ref) => typeof ref !== "string")
    ) {
      return undefined;
    }
    shaped.push({
      key: record.key,
      value: record.value,
      scope: record.scope as "global",
      evidenceRefs: record.evidenceRefs as readonly string[],
    });
  }
  return shaped;
}

function toUsage(usage: ModelResult["usage"]): PersonaLearningTokenUsage | undefined {
  if (usage === undefined) return undefined;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return { inputTokens, outputTokens };
}

/** 构造 configured 抽取器。模型选择、鉴权与重试由调用方（评测 harness）负责。 */
export function createModelPersonaLearningExtractor(
  options: ModelPersonaLearningExtractorOptions,
): PersonaLearningExtractionPort {
  const maxOutputTokens = options.maxOutputTokens ?? 1024;
  return {
    availability: "configured",
    async extract(input): Promise<PersonaLearningExtractionOutcome> {
      const result = await options.model.generateText({
        messages: [
          { role: "system", content: buildExtractionSystemPrompt() },
          { role: "user", content: buildExtractionUserPrompt(input.messages) },
        ],
        responseJsonSchema: EXTRACTION_RESPONSE_SCHEMA,
        options: { maxOutputTokens },
      });
      const drafts = parseDrafts(result.text);
      if (drafts === undefined || drafts.length === 0) {
        return { status: "no_candidates", usage: toUsage(result.usage) };
      }
      return { status: "extracted", drafts, usage: toUsage(result.usage) };
    },
  };
}
