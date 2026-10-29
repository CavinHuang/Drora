/**
 * shared-contracts 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 生产方/消费方一律 import 常量本身，不重复写字面量。
 */
import { PERSONA_ERROR_CODES } from "./persona.js";
import { VOICE_INPUT_SOURCE_KIND } from "./voice.js";

export function exampleVoiceSourceKind(): string {
  // schema 侧：z.literal(VOICE_INPUT_SOURCE_KIND)；wire 侧投译：intent.source.kind === 常量。
  return VOICE_INPUT_SOURCE_KIND;
}

export function examplePersonaErrorCode(): string {
  // 服务/仓储侧返回封闭错误码时引用常量本身，不重复写字面量（数据合同 §3 枚举）。
  return PERSONA_ERROR_CODES.revisionConflict;
}
