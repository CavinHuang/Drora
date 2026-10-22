/**
 * 语音模块 renderer 行为阈值（specs/voice-agent-integration.md §2.1 冻结边界）。
 *
 * 这些是 renderer 行为参数而非跨进程契约键——明确不进 packages/shared/src/contracts/voice.ts，
 * 调参不牵动 shared 包。数值初值来自 spec 冻结裁决；Phase 1a/1b 真机实测后只改这里。
 */

/** 权限对话框被忽略/折叠后的 RequestingMic 超时（§5.3：10s 自动回 Idle + 轻提示）。 */
export const VOICE_REQUESTING_MIC_TIMEOUT_MS = 10_000;

/** lastDictation 暂存 TTL（§5.4：注入后乐观暂存 300s，过期恢复菜单项不渲染）。 */
export const VOICE_LAST_DICTATION_TTL_MS = 300_000;

/**
 * 播报 claim 续约间隔（§3.5-1 / EG-10：Speaking 与 AnnPaused 全程持 claim，每 2s renew；
 * 约束：续约间隔 < TTL/2。TTL 5s 由 Main 侧既有
 * packages/desktop/src/main/broadcastHub.ts:24 BROADCAST_CLAIM_RESERVATION_TTL_MS 决定，
 * 本侧只保证间隔约束，AnnPaused 是持约态不释放（FD-2）。
 */
export const VOICE_CLAIM_RENEW_INTERVAL_MS = 2_000;

/** Cancelling 兜底超时（§3.3：5s 内无 TurnComplete 即回 AnnIdle + voice.tts warn）。 */
export const VOICE_CANCELLING_FALLBACK_TIMEOUT_MS = 5_000;

/**
 * 播报分句的硬切上限（字符）。句边界优先按终止标点切分；单句超长（无标点长段）时
 * 按该上限硬切，避免单条 utterance 无界。调参面，非契约。
 */
export const VOICE_MAX_SENTENCE_CHARS = 120;

/**
 * ASR stop() 的兜底结算窗口（ms）：正常路径以引擎 onend 为同步点；引擎卡死（onend
 * 不回调）时按当前已得 buffer 结算，防止 stop() 永不 resolve。不是用超时掩盖同步——
 * onend 仍是主同步点，超时仅为 wedged engine 兜底。
 */
export const VOICE_ASR_STOP_SETTLE_TIMEOUT_MS = 2_000;
