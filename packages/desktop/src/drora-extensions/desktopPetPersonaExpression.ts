import type { Locale } from "@drora/shared";

/**
 * P2 桌宠当前态表达映射（specs/drora-persona-system.md §11、PM18/58）：
 * 把有界投影的 mode 映射为人格当前态语义——working 为专注、attention 为等待回应、
 * error 为遇到问题、completed 为中性结束（completed 包含中断，因此永不庆祝成功）。
 *
 * 硬边界（PM58，结构化保证）：
 * - 纯函数，只消费 mode 与 locale——重复 error、attention 持续时长、多任务数量在类型上
 *   就无法影响表达（无连续失败计数、无等待时长/权限超时推断、无持久化）。
 * - completed 恒为中性结束（neutralEnding 且 celebrates 恒 false）：中断结束不庆祝。
 * - 不新增 task 字段、不建立独立人格身份、不影响工具/决策；原动画轨道与导航不变
 *   （本映射只产出表达语义，sprite 轨道选择仍由 preload 播放器按原逻辑执行）。
 * - 语音兼容：不接触录音/播报/取消与来源身份（模块零 voice 依赖）。
 */

export interface DesktopPetPersonaExpression {
  /** 投影 mode 原样透出；表达不引入新状态。 */
  readonly mode: "idle" | "working" | "attention" | "completed" | "error";
  /** 当前态文案：人格语义（专注/等待回应/遇到问题/中性结束），不含庆祝/超时/失败计数语义。 */
  readonly label: string;
  /** completed 恒 true：completed 包含中断，表达为中性结束态。 */
  readonly neutralEnding: boolean;
  /** 类型级恒 false：P2 表达层不庆祝任何终态（PM58「不庆祝中断」）。 */
  readonly celebrates: false;
}

const LABELS: Record<
  Locale,
  Record<DesktopPetPersonaExpression["mode"], string>
> = {
  "zh-CN": {
    idle: "待命",
    working: "专注处理中",
    attention: "等待回应",
    error: "遇到问题",
    completed: "已结束",
  },
  "en-US": {
    idle: "Idle",
    working: "Focused",
    attention: "Waiting for you",
    error: "Hit a problem",
    completed: "Finished",
  },
};

const OTHER_LOCALE: Locale = "en-US";

export function desktopPetPersonaExpression(input: {
  mode: DesktopPetPersonaExpression["mode"];
  locale: Locale;
}): DesktopPetPersonaExpression {
  const locale = LABELS[input.locale] ? input.locale : OTHER_LOCALE;
  return {
    mode: input.mode,
    label: LABELS[locale][input.mode],
    neutralEnding: input.mode === "completed",
    celebrates: false,
  };
}
