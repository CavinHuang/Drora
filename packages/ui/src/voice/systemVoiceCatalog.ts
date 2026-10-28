/**
 * 系统音色枚举目录（specs/voice-agent-integration.md §9.7.2）。
 *
 * 设置面 system 音色 Select 的枚举来源：`speechSynthesis.getVoices()` 快照 +
 * `voiceschanged` 异步刷新（Windows/Chrome 首帧常返回空表——复审缺口 #2）。经
 * speechSynthesisTtsAdapter.ts 既有 SpeechSynthesisLike 端口形状，不绕过抽象直摸
 * window；播报腿运行时零改动（speak 时同步取一次 + 失配 warn 回落保持兜底）。
 */

import type { SpeechSynthesisLike, SpeechSynthesisVoiceLike } from "./speechSynthesisTtsAdapter.js";

/**
 * voiceschanged 订阅所需的合成器形状（DOM SpeechSynthesis 本身是 EventTarget；
 * 在既有端口形状上 additive 扩展，测试注入 fake）。
 */
export interface SpeechSynthesisVoiceCatalogSource extends SpeechSynthesisLike {
  addEventListener(type: "voiceschanged", listener: () => void): void;
  removeEventListener(type: "voiceschanged", listener: () => void): void;
}

/** 当前系统音色快照（空合成器 → 空表；不做任何过滤）。 */
export function listSystemVoices(
  synth: SpeechSynthesisVoiceCatalogSource | null,
): SpeechSynthesisVoiceLike[] {
  if (!synth) {
    return [];
  }
  try {
    return synth.getVoices();
  } catch {
    // 引擎侧异常（如已销毁）：按空表处理，设置面回落「自动」+加载占位。
    return [];
  }
}

/**
 * 订阅系统音色集变化（voiceschanged）；返回退订函数。synth 缺席（无
 * speechSynthesis 环境）时返回 no-op 退订——设置面不因平台能力缺失崩溃。
 */
export function subscribeSystemVoices(
  synth: SpeechSynthesisVoiceCatalogSource | null,
  onChange: () => void,
): () => void {
  if (!synth) {
    return () => undefined;
  }
  synth.addEventListener("voiceschanged", onChange);
  return () => {
    synth.removeEventListener("voiceschanged", onChange);
  };
}

/**
 * 播报音色枚举过滤（§9.7.2）：`voice.lang` 小写前缀 zh/en 两语言面（= §6.3 locale
 * 仅 zh-CN/en-US 的既有产品面）；**过滤结果为空时回落全量列表**（防「系统无 zh/en
 * 音色 → 空死控件」）。
 */
export function filterVoicesForAnnouncement(
  voices: readonly SpeechSynthesisVoiceLike[],
): SpeechSynthesisVoiceLike[] {
  const filtered = voices.filter(
    (voice) => voice.lang.toLowerCase().startsWith("zh") || voice.lang.toLowerCase().startsWith("en"),
  );
  return filtered.length > 0 ? filtered : [...voices];
}

/**
 * 设置面取合成器（照 speechSynthesisTtsAdapter.ts 缺省 getter 同型；唯一 window
 * 接触点收口在此，组件不直摸 window.speechSynthesis）。
 */
export function getSpeechSynthesisForCatalog(): SpeechSynthesisVoiceCatalogSource | null {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return null;
  }
  return window.speechSynthesis as unknown as SpeechSynthesisVoiceCatalogSource;
}
