/**
 * 底部转写浮层（spec §5.2 增补 2026-11-07，照 Proma 形态）：
 * 窗口级 fixed 底部居中——流式听写 partial 逐字滚动 + 尾部光标 + 录音声波指示；
 * notice 与停止按钮并入；原 DictationPreviewOverlay 退役。
 *
 * 样式（v2 精致版）：表面 = toast 同源（bg-toast/60 + blur + rounded-2xl，DESIGN.md
 * Toast 豁免条目）；字级用 text-ui-* 强制刻度（partial=lg 主视觉、状态行=caption）；
 * 两层布局——转写主行（含"正在聆听"空态）+ 底部元信息行（声波/等待点 · 状态 · 停止）；
 * 动画遵守 DESIGN.md Motion（fast/low-drama）：淡入上滑 150ms、光标 1s 步进、声波
 * 1.2s 错相微脉动（禁弹簧）。写入规则不变（§5.1）：partial 永不进正文。
 */
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useVoiceDictationSnapshot } from "./useVoiceComposerEntry.js";

const NOTICE_MESSAGE_ID: Record<string, string> = {
  permission: "voice.dictation.error.permission",
  network: "voice.dictation.error.network",
  device: "voice.dictation.error.device",
  aborted: "voice.dictation.error.aborted",
  requestingMicTimeout: "voice.dictation.requestingMicTimeout",
  sessionGone: "voice.dictation.sessionGone",
};

/** 声波指示（4 根错相微脉动竖条；DESIGN.md Motion low-drama 约束）。 */
function WaveBars() {
  return (
    <span aria-hidden className="flex h-4 items-end gap-[3px]" data-testid="voice-transcript-wave">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-primary/70 animate-[voice-wave_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.15}s`, height: "5px" }}
        />
      ))}
    </span>
  );
}

/** 等待指示（requestingMic：三粒呼吸点）。 */
function WaitingDots() {
  return (
    <span aria-hidden className="flex items-center gap-1" data-testid="voice-transcript-waiting">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-[5px] w-[5px] rounded-full bg-muted-foreground/60 animate-[voice-wait_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

export function VoiceTranscriptOverlay({
  onStopPressed,
  suppressForStreaming = false,
}: {
  onStopPressed: () => void;
  /** §5.5：流式引擎 recording 期由独立悬浮窗展示——窗口内浮层隐藏（等态/notice 仍显示）。 */
  suppressForStreaming?: boolean;
}) {
  const { intl } = useDroraIntl();
  const snapshot = useVoiceDictationSnapshot();
  const recording = snapshot.inputLeg === "recording" && !suppressForStreaming;
  const requestingMic = snapshot.inputLeg === "requestingMic";
  const noticeCode = snapshot.notice?.code;
  const active = recording || requestingMic;
  if (!active && !noticeCode) {
    return null;
  }
  return (
    <div
      data-testid="voice-transcript-overlay"
      className="pointer-events-none fixed bottom-8 left-1/2 z-40 w-[min(560px,calc(100vw-4rem))] -translate-x-1/2 animate-[voice-rise_150ms_ease-out]"
    >
      <div className="pointer-events-auto rounded-2xl border border-border/40 bg-toast/60 shadow-xl backdrop-blur-xl">
        {/* 主行：转写文本（partial 大字视觉）/ 等待 / 错误 */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-2">
          {recording ? (
            <span className="text-primary/80 shrink-0">
              <WaveBars />
            </span>
          ) : null}
          {requestingMic && !noticeCode ? (
            <span className="flex items-center gap-2">
              <WaitingDots />
              <span className="text-ui-sm text-muted-foreground" data-testid="voice-transcript-requesting">
                {intl.formatMessage({ id: "voice.dictation.requestingMic" })}
              </span>
            </span>
          ) : null}
          {noticeCode ? (
            <p className="text-ui-sm text-foreground" role="alert">
              {intl.formatMessage({
                id: NOTICE_MESSAGE_ID[noticeCode] ?? "voice.dictation.error.network",
              })}
            </p>
          ) : recording ? (
            <p
              className="min-w-0 flex-1 truncate text-ui-lg leading-relaxed text-foreground"
              data-testid="voice-transcript-partial"
            >
              {snapshot.partialText || (
                <span className="text-muted-foreground/70">
                  {intl.formatMessage({ id: "voice.dictation.preview.hint" })}
                </span>
              )}
              <span
                aria-hidden
                className="ml-1 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-[voice-caret_1s_step-end_infinite] bg-primary/80 align-baseline"
              />
            </p>
          ) : null}
        </div>
        {/* 元信息行：左侧状态 · 右侧停止 */}
        <div className="flex items-center justify-between border-t border-border/30 px-5 py-2">
          <span className="text-ui-xs text-muted-foreground">
            {recording
              ? intl.formatMessage({ id: "voice.dictation.preview.hint" })
              : intl.formatMessage({ id: "voice.dictation.requestingMic" })}
          </span>
          {recording ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-ui-xs text-muted-foreground hover:text-foreground"
              aria-label={intl.formatMessage({ id: "voice.dictation.stop" })}
              onClick={onStopPressed}
              data-testid="voice-transcript-stop"
            >
              <XIcon className="h-3.5 w-3.5" />
              {intl.formatMessage({ id: "voice.dictation.stop" })}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
