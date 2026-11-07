/**
 * 长按听写键捕获层（specs/voice-agent-integration.md §5.5.1）。
 *
 * 纯逻辑核心（window 监听由入口组件装配注入，fake 事件可单测）：识别 Fn（🌐）键
 * 的按下/松开沿 → onPressStart / onPressStop 两段回调（useVoiceDictation.pressStart/
 * pressStop）。守卫：event.repeat 忽略（自动重复不重触发）；isComposing 忽略（输入法
 * 组合期）；仅认「Fn 是本次按下键」的 keydown（Fn+F1 组合等系统功能不受影响——组合
 * 期间照常录音，松开 Fn 即停，§5.5.1 取舍记档）。
 *
 * 平台现实：macOS Fn/🌐 受系统设置「按下 🌐 键时」抢占——非「无操作」时应用收不到
 * 事件（设置行文案注明前置条件）；失焦兜底（keyup 被吞）由装配层 window blur →
 * pressStop 兜住（§5.5.1）。
 */

import type { VoiceDictationHoldKey } from "@drora/shared";

export interface HoldTalkKeyConfig {
  /** 持键选择（VOICE_DICTATION_HOLD_KEYS 单一出处）；"off" = 捕获层静默。 */
  holdKey: VoiceDictationHoldKey;
  onPressStart: () => void;
  onPressStop: () => void;
}

/** 装配层事件形状（DOM KeyboardEvent 的最小消费面，测试注入 fake）。 */
export interface HoldTalkKeyEventLike {
  key: string;
  /** 左右侧物理键区分（"MetaRight"/"AltRight"/"Fn"…；右侧持键识别依赖此字段）。 */
  code?: string;
  repeat: boolean;
  isComposing: boolean;
  /** 命中持键时调用（Windows 右 Win：抑制 keyup 弹开始菜单的尝试；平台不支持则无效无害）。 */
  preventDefault?(): void;
}

/** 持键匹配（§5.5.1）：fn 按 key 识别；右侧修饰键按 code 精确区分左右（左侧不触发）。 */
function matchesHoldKey(holdKey: VoiceDictationHoldKey, event: HoldTalkKeyEventLike): boolean {
  switch (holdKey) {
    case "fn":
      return event.key === "Fn";
    case "right-meta":
      return event.key === "Meta" && event.code === "MetaRight";
    case "right-alt":
      return event.key === "Alt" && event.code === "AltRight";
    default:
      return false; // "off"
  }
}

/** 按住状态由调用方可见（装配层 blur 兜底判断「正在长按」用）。 */
export interface HoldTalkKeyHandler {
  handleKeyDown(event: HoldTalkKeyEventLike): void;
  handleKeyUp(event: HoldTalkKeyEventLike): void;
  /** window blur 兜底：正处于长按（按下未松）→ 触发 pressStop（§5.5.1 转写已说内容）。 */
  handleBlur(): void;
  /** 当前是否按住中（供装配层/测试观测）。 */
  readonly holding: boolean;
}

export function createHoldTalkKeyHandler(config: HoldTalkKeyConfig): HoldTalkKeyHandler {
  let holding = false;
  return {
    get holding() {
      return holding;
    },
    handleKeyDown(event) {
      if (!matchesHoldKey(config.holdKey, event) || event.repeat || event.isComposing) {
        return;
      }
      event.preventDefault?.();
      if (holding) {
        return; // 已按住（理论上 macOS 不重发非 repeat 的 Fn down，防御）。
      }
      holding = true;
      config.onPressStart();
    },
    handleKeyUp(event) {
      if (!matchesHoldKey(config.holdKey, event)) {
        return;
      }
      // Windows 右 Win：keyup 是开始菜单触发点，命中即 preventDefault（能否完全抑制
      // 因平台而异，§5.5.1 记档；未按住也抑制——同键的 keyup 都不该漏给系统）。
      event.preventDefault?.();
      if (!holding) {
        return;
      }
      holding = false;
      config.onPressStop();
    },
    handleBlur() {
      if (!holding) {
        return;
      }
      holding = false;
      config.onPressStop();
    },
  };
}

/**
 * window 监听装配（入口组件 useEffect 用；返回清理函数）。
 * capture 阶段监听：Fn 作为修饰键在部分合成路径不冒泡，capture 最稳。
 */
export function attachHoldTalkKeyListeners(
  handler: HoldTalkKeyHandler,
  target: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => handler.handleKeyDown(event);
  const onKeyUp = (event: KeyboardEvent) => handler.handleKeyUp(event);
  const onBlur = () => handler.handleBlur();
  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("keyup", onKeyUp, true);
  target.addEventListener("blur", onBlur);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("keyup", onKeyUp, true);
    target.removeEventListener("blur", onBlur);
  };
}
