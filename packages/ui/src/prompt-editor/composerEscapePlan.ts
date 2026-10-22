/**
 * composer Esc 仲裁计划（specs/voice-agent-integration.md §4.4 键位仲裁表的纯函数层）。
 *
 * 优先级：1) Radix dialog 打开（含事件已被上游消费——mention 菜单在 Lexical
 * KEY_ESCAPE_COMMAND CRITICAL 层 preventDefault+stopPropagation，本函数只见
 * defaultPrevented）→ 忽略（弹层/菜单自关，录音与编辑语义都不动）；
 * 2) 语音录音态（props 注入的 gate）→ 停录音不冒泡；3) 既有取消语义（提交中不取消）。
 * 抽纯函数的原因：mention 场景「仅关菜单、不停录音、不取消编辑」的验收断言依赖
 * 分支顺序，纯函数可以用例逐条钉住，不必为覆盖顺序拉起整个 Lexical 编辑器。
 */

export interface ComposerEscapePlanInput {
  key: string;
  /** 事件是否已被上游（mention 菜单/弹层）消费。 */
  defaultPrevented: boolean;
  /** 事件目标是否位于 role=dialog 内。 */
  insideDialog: boolean;
  submitting: boolean;
  hasCancel: boolean;
}

export interface ComposerEscapePlan {
  /** true = 事件已被更高优先消费者占用：不停录音、不取消编辑。 */
  ignore: boolean;
  /** 是否应尝试语音录音停止（录音态 gate 返回 true 时消费并阻止冒泡）。 */
  tryVoice: boolean;
  /** 是否允许走既有取消语义（§4.4 优先级 4：非录音态语义不变）。 */
  canCancel: boolean;
}

export function resolveComposerEscapePlan(input: ComposerEscapePlanInput): ComposerEscapePlan {
  const ignore =
    input.key !== "Escape" || input.defaultPrevented || input.insideDialog;
  return {
    ignore,
    tryVoice: !ignore,
    canCancel: !ignore && input.hasCancel && !input.submitting,
  };
}
