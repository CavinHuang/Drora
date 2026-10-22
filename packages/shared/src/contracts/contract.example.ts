/**
 * shared-contracts 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 生产方/消费方一律 import 常量本身，不重复写字面量。
 */
import { VOICE_INPUT_SOURCE_KIND } from "./voice.js";

export function exampleVoiceSourceKind(): string {
  // schema 侧：z.literal(VOICE_INPUT_SOURCE_KIND)；wire 侧投译：intent.source.kind === 常量。
  return VOICE_INPUT_SOURCE_KIND;
}
