/** 轮尾同源聚合与确定性分句；纯函数不持状态、不执行 IO。 */
import { VOICE_MAX_SENTENCE_CHARS } from "./voiceTuning.js";

/**
 * 轮尾正文聚合同源（§4.1 白名单）：assistantTextRows → 滤空 → join("\n\n")，
 * 与 assistantCopyText/复制文本同链（packages/ui/src/v4/assistantPreviewCards.ts:34-37）。
 * 规划器不建第二事件流、不建第二状态源——Phase 1b wiring 从 ConversationTurnGroup 同一
 * 投影取行后经本函数聚合，再作为 consumeTurnTail 输入。
 */
export function buildTurnSpeechText(assistantTextRows: readonly { text: string }[]): string {
  return assistantTextRows
    .map((row) => row.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

const SENTENCE_TERMINATORS = new Set(["。", "！", "？", "!", "?", "；", ";", "…", "\n"]);
/** 终止符后紧跟的收尾字符随句子归属（引号/括号不独立成句）。 */
const SENTENCE_CLOSERS = new Set(["」", "』", "）", "”", "’", '"', "'"]);

/**
 * 句边界切分（§4.1「整段分句播」）。确定性规则：
 * 终止标点/换行处断句；`.` 夹在数字间不切（小数保护）；单段超长按 maxChars 硬切；
 * 输出 trim 后非空段。
 */
export function splitTurnIntoSentences(
  text: string,
  maxChars: number = VOICE_MAX_SENTENCE_CHARS,
): string[] {
  const segments: string[] = [];
  let current = "";
  const push = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
    current = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char == null) {
      continue;
    }
    current += char;
    if (!SENTENCE_TERMINATORS.has(char)) {
      continue;
    }
    // 小数保护：'.' 前后均为数字时不切（3.14 / 1.5 倍）。
    if (char === "." && i > 0) {
      const prev = text[i - 1];
      const next = text[i + 1];
      if (prev != null && /\d/u.test(prev) && next != null && /\d/u.test(next)) {
        continue;
      }
    }
    // 收尾字符（引号/括号）随句归属。
    let j = i + 1;
    while (j < text.length) {
      const follower = text[j];
      if (follower == null || !SENTENCE_CLOSERS.has(follower)) {
        break;
      }
      current += follower;
      j += 1;
    }
    i = j - 1;
    push();
  }
  push();

  if (maxChars <= 0) {
    return segments;
  }
  // 超长硬切：无标点长段保持 utterance 有界（调参面 voiceTuning）。
  const bounded: string[] = [];
  for (const segment of segments) {
    if (segment.length <= maxChars) {
      bounded.push(segment);
      continue;
    }
    for (let offset = 0; offset < segment.length; offset += maxChars) {
      const chunk = segment.slice(offset, offset + maxChars).trim();
      if (chunk.length > 0) {
        bounded.push(chunk);
      }
    }
  }
  return bounded;
}
