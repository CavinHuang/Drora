/**
 * ASR 引擎选型纯函数（specs/voice-agent-integration.md §9.6.6 回退树，§9.6.8-S3）。
 *
 * 职责：把「设置引擎 × 厂商档完整 × 双侧能力探测」收敛为一个确定性选择；
 * 回退树运行时分支（remote start 失败→本次以 webSpeech 起录 + warn）在
 * useVoiceDictation 的编排层，不在本函数（选型先于起录）。
 */

/** 选型输入形状（useVoiceDictation 以对象字面量内联构造，无具名 import）。@lintignore */
export interface AsrEngineChoiceInputs {
  /** 设置页 voiceAsrEngine（缺省 webSpeech）。 */
  engine: "webSpeech" | "remote";
  /**
   * 厂商档完整谓词（§9.6.2-5）：baseUrl.trim() && asrVendorModel.trim() && apiKey.trim()
   * 三者同时非空。apiKey 由调用方经凭据服务读取后传入。
   */
  vendorConfigComplete: boolean;
  /** remote 适配器能力探测（MediaRecorder/FormData 存在性）。 */
  remoteSupported: boolean;
  /** webSpeech 能力探测（SpeechRecognition 存在性）。 */
  webSpeechSupported: boolean;
}

/** 选型结果单一出处（useVoiceDictation 按字面量消费；协议形状导出）。@lintignore */
export type AsrEngineChoice = "webSpeech" | "remote";

import { validateVoiceVendorBaseUrl } from "./voiceVendorBaseUrl.js";

export function resolveAsrEngineChoice(inputs: AsrEngineChoiceInputs): AsrEngineChoice {
  if (inputs.engine !== "remote") {
    return "webSpeech";
  }
  // §9.6.6：remote 且档完整且能力可用 → remote；任一不满足 → webSpeech
  //（调用方对「档不完整」记 voice.asr info、「start 失败」记 warn，§7.1 既有槽位）。
  if (!inputs.vendorConfigComplete || !inputs.remoteSupported) {
    return "webSpeech";
  }
  return "remote";
}

/** 厂商档完整谓词（§9.6.2-5 的规范实现，设置面选型共用）。baseUrl 校验 S1：明文非本机地址判档不完整 → 运行时回退。 */
export function isVoiceVendorConfigComplete(values: {
  baseUrl: string | null | undefined;
  model: string | null | undefined;
  apiKey: string | null | undefined;
}): boolean {
  if (!validateVoiceVendorBaseUrl(values.baseUrl).ok) {
    return false;
  }
  return (
    Boolean(values.baseUrl?.trim()) &&
    Boolean(values.model?.trim()) &&
    Boolean(values.apiKey?.trim())
  );
}
