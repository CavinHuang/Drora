/**
 * ASR 引擎选型纯函数（specs/voice-agent-integration.md §9.6.6 回退树，§9.6.8-S3）。
 *
 * 职责：把「设置引擎 × 厂商档完整 × 双侧能力探测」收敛为一个确定性选择；
 * 回退树运行时分支（remote start 失败→本次以 webSpeech 起录 + warn）在
 * useVoiceDictation 的编排层，不在本函数（选型先于起录）。
 */

/** 选型输入形状（useVoiceDictation 以对象字面量内联构造，无具名 import）。@lintignore */
export interface AsrEngineChoiceInputs {
  /** 模型能力档案 asr.engine（缺省 webSpeech；§11 收编后含 official）。 */
  engine: "webSpeech" | "remote" | "official";
  /**
   * 厂商档完整谓词（§9.6.2-5）：baseUrl.trim() && asrVendorModel.trim() && apiKey.trim()
   * 三者同时非空。apiKey 由调用方经凭据服务读取后传入。
   */
  vendorConfigComplete: boolean;
  /** remote 适配器能力探测（MediaRecorder/FormData 存在性）。 */
  remoteSupported: boolean;
  /** webSpeech 能力探测（SpeechRecognition 存在性）。 */
  webSpeechSupported: boolean;
  /**
   * §11 收编：official 引擎可用性（platform.microphone × base 连接 voiceInputService
   * × 已登录，与官方 useComposerVoiceInput available 判定同源）。缺省 false
   * （fail-closed：不显式传入即视为不可用，回退树兜底）。
   */
  officialSupported?: boolean;
}

/** 选型结果单一出处（useVoiceDictation 按字面量消费；协议形状导出）。@lintignore */
export type AsrEngineChoice = "webSpeech" | "remote" | "official" | null;

import { validateVoiceVendorBaseUrl } from "./voiceVendorBaseUrl.js";

export function resolveAsrEngineChoice(inputs: AsrEngineChoiceInputs): AsrEngineChoice {
  if (inputs.engine === "official") {
    // §11.2：official 且官方链路可用 → official；不可用（未登录/服务缺席/平台无 mic）
    // → webSpeech 回落（§9.6.6 回退树同型；调用方对回落记 voice.asr info）。
    // 默认解析维持 webSpeech 不变（§11.2 选择理由：official 改变音频数据去向
    //（drora-server 处理，§6.2 披露 1 要求用户显式选择）且依赖登录态，收编是
    //「能力归一」不是「默认切换」——本分支只在用户显式选择 official 时进入。
    if (inputs.officialSupported === true) return "official";
    return inputs.webSpeechSupported ? "webSpeech" : null;
  }
  if (inputs.engine !== "remote") {
    return inputs.webSpeechSupported ? "webSpeech" : null;
  }
  // §9.6.6：remote 且档完整且能力可用 → remote；任一不满足 → webSpeech
  //（调用方对「档不完整」记 voice.asr info、「start 失败」记 warn，§7.1 既有槽位）。
  if (!inputs.vendorConfigComplete || !inputs.remoteSupported) {
    return inputs.webSpeechSupported ? "webSpeech" : null;
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
