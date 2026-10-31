/**
 * shared-contracts 对外契约：调用方要想正确调用就必须知道的一切都写在这里；其余对外不可见。
 *
 * 本目录是跨进程/跨包契约字面量的单一出处（AGENTS.md 契约键单一出处规则）：
 * - desktopPet.ts：桌面宠物文件/wire 键（存量）；
 * - voice.ts：语音接入契约键（specs/voice-agent-integration.md §2.1）——
 *   VOICE_INPUT_SOURCE_KIND（input-intent schema 的 kind literal 单一出处）、
 *   VOICE_SETTINGS_KEYS（appSettings 八键，与 validationAppSettings 字段名一一对应由
 *   parity 单测钉住）、VOICE_BROADCAST_CLAIM_KEY（BroadcastHub claim 键，mic 为 EG-7 预留）。
 * - persona.ts：Persona P0 契约（specs/drora-persona-system.md §4；数据合同 §1/§2/§3）——
 *   管理错误码封闭枚举、receipt scope/resultCode 词汇、库位置键（personas/persona.sqlite）、
 *   schema/template/compiler 版本常量与 P0 逻辑管理 API 输入输出严格类型；
 *   personaControlV1/personaEnabled 能力位与 wire 方法名在切片 C 随协议注册补齐。
 *
 * 行为阈值与打断词表不进本目录（renderer 行为参数，放 packages/ui/src/voice/voiceTuning.ts
 * 与 interruptionWords.ts，spec §2.1 冻结边界）。
 */
export interface SharedContractsContract {
  // 契约以 as const 常量对象分散在上述文件中；改名任何一侧前先全链 grep 生产与消费。
}
