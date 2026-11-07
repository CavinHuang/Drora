/**
 * 底部转写浮层（spec §5.2 增补 2026-11-07，照 Proma 形态；v3 精修）：
 * 窗口级 fixed 底部居中——流式听写 partial 逐字滚动 + 尾部光标 + 录音声波指示；
 * notice 与停止按钮并入。
 *
 * v3（2026-11-07 用户「再次优化样式」轮）：
 * - 流式文本两行自适应区 + 自动滚到最新（v2 单行 truncate 把正在说的字截成省略号
 *   ——「说了什么看不见」是最大体验缺陷；两行窗口兼顾紧凑与最新可见）；
 * - 元信息行状态文案对齐 §5.5.1 auto 模式（再按一下结束/按住松开结束）；
 * - 表面按 DESIGN.md Toast 规范收紧（bg-toast/60 + blur + rounded-2xl + 强化投影）。
 * 写入规则不变（§5.1）：partial 永不进正文。
 */
import { useEffect, useRef } from "react";
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
    <span
      aria-hidden
      className="flex h-4 shrink-0 items-end gap-[3px]"
      data-testid="voice-transcript-wave"
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full bg-primary/80 animate-[voice-wave_1.2s_ease-in-out_infinite]"
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
  // v3：两行滚动窗口常显最新——partial 每帧滚到底（说了什么永远在视野内）。
  const partialRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    const el = partialRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot.partialText]);
  if (!active && !noticeCode) {
    return null;
  }
  return (
    <div
      data-testid="voice-transcript-overlay"
      className="pointer-events-none fixed bottom-4 left-1/2 z-40 w-[min(560px,calc(100vw-4rem))] -translate-x-1/2 animate-[voice-rise_150ms_ease-out]"
    >
      <div className="pointer-events-auto rounded-2xl border border-border/40 bg-toast/60 shadow-2xl backdrop-blur-xl">
        {/* 主行：转写文本（两行滚动窗，最新常显）/ 等待 / 错误 */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-2">
          {recording ? (
            <span className="mt-[7px] text-primary/80">
              <WaveBars />
            </span>
          ) : null}
          {requestingMic && !noticeCode ? (
            <span className="flex items-center gap-2 py-1">
              <WaitingDots />
              <span
                className="text-ui-sm text-muted-foreground"
                data-testid="voice-transcript-requesting"
              >
                {intl.formatMessage({ id: "voice.dictation.requestingMic" })}
              </span>
            </span>
          ) : null}
          {noticeCode ? (
            <p className="py-1 text-ui-sm text-foreground" role="alert">
              {intl.formatMessage({
                id: NOTICE_MESSAGE_ID[noticeCode] ?? "voice.dictation.error.network",
              })}
            </p>
          ) : recording ? (
            <p
              ref={partialRef}
              className="max-h-14 min-w-0 flex-1 overflow-y-auto break-words text-ui-lg leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
        {/* 元信息行：左侧状态（auto 模式操作提示）· 右侧停止 */}
        <div className="flex items-center justify-between border-t border-border/30 px-5 py-2">
          <span className="text-ui-xs text-muted-foreground">
            {recording
              ? intl.formatMessage({ id: "voice.dictation.status.recording" })
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
