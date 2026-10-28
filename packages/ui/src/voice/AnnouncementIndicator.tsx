/**
 * 播报中指示（specs/voice-agent-integration.md §9.3 / TV-6 / §3.3 FD-1）。
 *
 * 行外 overlay：挂在本 pane 容器顶部，不进 ConversationRowView（行组件 memo/props
 * 零变化，TV-6 裁决）。内含 TID_VOICE_ANN_STOP 停止按钮——层①唯一载体：任何播报态
 * （含 uninterruptible 段、AnnPaused）点按立即 tts.cancel() 回 AnnIdle，零协议、
 * 不取消任务；正文播报主场景（TurnComplete 后 canStop=false、TID_V4_STOP 不渲染）
 * 的唯一静音入口（FD-1）。
 */
import { memo } from "react";
import { Volume2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { TID_VOICE_ANN_STOP } from "@drora/shared/test-ids";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { VoiceAnnouncementPhase } from "@/store/voiceSessionStore.js";

/** 指示器 props（SessionPane 挂载传 phase/stop 回调）。@lintignore */
export interface AnnouncementIndicatorProps {
  phase: VoiceAnnouncementPhase;
  /** FD-1 层①：点按 = planner.notifyStopPressed()，静音不取消任务。 */
  onStopPressed: () => void;
}

export const AnnouncementIndicator = memo(function AnnouncementIndicator({
  phase,
  onStopPressed,
}: AnnouncementIndicatorProps) {
  const { intl } = useDroraIntl();
  // annIdle 无播报可静音；cancelling 已静音、等待任务终态，无需再提供停止按钮。
  if (phase !== "speaking" && phase !== "annPaused") {
    return null;
  }
  const paused = phase === "annPaused";
  return (
    // 行外 overlay（TV-6）：浮在 pane 顶部，不参与会话行渲染与滚动内容。
    <div
      role="status"
      aria-label={intl.formatMessage({ id: "voice.ann.indicatorAria" })}
      data-voice-ann-phase={phase}
      className="pointer-events-auto absolute left-1/2 top-2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 shadow-lg"
    >
      <Volume2Icon
        className={paused ? "size-3.5 text-foreground-subtle" : "size-3.5 animate-pulse text-brand"}
        aria-hidden
      />
      <span className="text-ui-caption text-foreground-subtle">
        {intl.formatMessage({ id: "voice.ann.indicator" })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-5 px-1.5 text-ui-caption"
        aria-label={intl.formatMessage({ id: "voice.ann.stop.aria" })}
        data-testid={TID_VOICE_ANN_STOP}
        onClick={onStopPressed}
      >
        <XIcon className="size-3" aria-hidden />
      </Button>
    </div>
  );
});
