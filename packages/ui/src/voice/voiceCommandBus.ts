/**
 * 语音命令总线（specs/voice-agent-integration.md §4.3 三层打断的 wiring 层）。
 *
 * 听写运行时（useVoiceDictation，挂在 composer 入口）与播报规划器（useVoiceAnnouncement，
 * 挂在 SessionPane）分属两棵组件树；打断词层①（stopAnnouncement）与「停掉任务」层③
 * （cancelTask）经本单例解耦：听写侧 dispatch，播报侧 register。
 *
 * 广播语义：dispatch 通知全部注册者——非播报中的 planner 对 stopAnnouncement 天然 no-op
 * （AnnIdle），cancelTask 由 planner 自行按播报腿活动态 gate（见 turnSpeechPlanner），
 * 因此多 pane 同时注册不会产生双停/双取消。
 */

/**
 * 命令协议单一出处（AGENTS 契约键精神）：听写侧 dispatch 与播报侧 register 分居两棵
 * 组件树，经字面量+推断各自消费，故无具名 import（knip @lintignore 先例）。
 * @lintignore
 */
export type VoiceCommandKind =
  /** 层①：打断词命中，停播报不续播（uninterruptible 段外由 planner 守卫）。 */
  | "stopAnnouncement"
  /** 层③：「停掉任务」命中，发既有 v4 stop（带 expectedForegroundExecutionId）。 */
  | "cancelTask";

/** 同上：register/dispatch 的处理器形状单一出处。@lintignore */
export type VoiceCommandHandler = (kind: VoiceCommandKind) => void;

const handlers = new Set<VoiceCommandHandler>();

/** 播报侧注册；返回注销函数（planner dispose / 组件卸载时调用）。 */
export function registerVoiceCommandHandler(handler: VoiceCommandHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** 听写侧分发（打断词命中的 final 消费路径）；无注册者时静默（播报未挂载）。 */
export function dispatchVoiceCommand(kind: VoiceCommandKind): void {
  for (const handler of Array.from(handlers)) {
    handler(kind);
  }
}

/** 测试辅助：清空注册表（生产代码不得调用）。 */
export function resetVoiceCommandHandlersForTest(): void {
  handlers.clear();
}
