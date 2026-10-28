/**
 * 打断词表与语音命令判定（specs/voice-agent-integration.md §4.5，UI 交互判定，不进 wire；
 * 也不进 shared contracts——词表是交互加速器不是协议事实）。
 *
 * 判定语义（§4.5 冻结 + EG-5）：
 * - zh-CN：转写（trim 后）与词表项精确相等 → 打断；否则正常听写注入。
 * - en-US：精确相等（大小写不敏感）→ 打断；词数 < 3 且未命中词表 → 视为噪声，丢弃
 *   （不注入、不打断，AnnPaused 正常续播）；≥3 词 → 正常听写注入。
 * - 第三语言回退（EG-5，建议待拍板）：locale 非 zh-CN/en-US 时整体回退 en-US 规则与词表；
 *   新增语言 = 词表 map 加一项 + spec 补记（OQ-6：词表定稿需真机数据，keptOpen）。
 * - 「取消」∈通用词表 → 仅层①停播报，不映射 UI 取消/任务取消/关闭弹层（§4.8-2）。
 * - 「停掉任务」属独立短语表（层③），完整短语精确命中直接执行（§4.8-1，EG-8）。
 * - 命中的 final 不注入 composer（打断词被语音命令通道消费，§3.3）。
 */

export const VOICE_INTERRUPT_WORDS: Record<string, { exact: string[]; minWords?: number }> = {
  "zh-CN": { exact: ["停", "停下", "停止", "别说了", "取消"] }, // 1-2 字精确匹配即打断
  "en-US": { exact: ["stop", "stop it", "quiet", "cancel"], minWords: 3 },
};

export const VOICE_CANCEL_TASK_PHRASES: Record<string, string[]> = {
  "zh-CN": ["停掉任务"],
  "en-US": ["stop the task", "cancel the task"], // 建议，待拍板
};

export const VOICE_INTERRUPT_FALLBACK = "en-US";

/** ASR final 的语音命令分类结果。 */
export type VoiceInterruptDecision =
  /** 正常听写注入（mode=append）。 */
  | { action: "inject" }
  /** 层①：停播报不续播；不注入 composer。 */
  | { action: "interruptAnnouncement" }
  /** 层③：发既有 v4 stop（带 expectedForegroundExecutionId）；不注入 composer。 */
  | { action: "cancelTask" }
  /** en 词数阈值下的噪声丢弃：不注入、不打断（§4.5）。 */
  | { action: "dropNoise" };

function countEnglishWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/u).length;
}

function exactHit(candidates: readonly string[], normalized: string, caseInsensitive: boolean): boolean {
  return candidates.some((candidate) => {
    const target = caseInsensitive ? candidate.toLowerCase() : candidate;
    return target === normalized;
  });
}

/**
 * 对一条 ASR final 转写作语音命令分类。纯函数，无副作用；
 * locale 缺席/未知时按 EG-5 回退 en-US 规则与词表。
 */
export function classifyVoiceDictationFinal(
  finalText: string,
  locale: string | null | undefined,
): VoiceInterruptDecision {
  const rulesLocale =
    locale != null && Object.prototype.hasOwnProperty.call(VOICE_INTERRUPT_WORDS, locale)
      ? locale
      : VOICE_INTERRUPT_FALLBACK;
  // en-US 语义大小写不敏感；zh 词表精确匹配（不做全角/标点折叠，保持确定性）。
  const caseInsensitive = rulesLocale === "en-US";
  const normalized = caseInsensitive ? finalText.trim().toLowerCase() : finalText.trim();

  // 层③短语表优先于通用打断词表：两者不相交，但先判更明确的任务取消指令。
  const cancelPhrases = VOICE_CANCEL_TASK_PHRASES[rulesLocale] ?? [];
  if (exactHit(cancelPhrases, normalized, caseInsensitive)) {
    return { action: "cancelTask" };
  }

  const interruptRules = VOICE_INTERRUPT_WORDS[rulesLocale] ?? VOICE_INTERRUPT_WORDS[VOICE_INTERRUPT_FALLBACK];
  if (interruptRules && exactHit(interruptRules.exact, normalized, caseInsensitive)) {
    return { action: "interruptAnnouncement" };
  }

  if (interruptRules?.minWords != null) {
    // en 阈值兜底（语义为本 spec 自定义，MinWordsUserTurnStartStrategy 本仓零命中）：
    // 未命中词表且词数不足 → 噪声丢弃；达到词数 → 正常注入。
    const words = countEnglishWords(finalText);
    return words < interruptRules.minWords ? { action: "dropNoise" } : { action: "inject" };
  }

  return { action: "inject" };
}
