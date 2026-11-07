/**
 * 底部转写浮层（spec §5.2 增补 2026-11-07，照 Proma 形态）：
 * 窗口级 fixed 底部居中、毛玻璃卡片——流式听写 partial 逐字滚动 + 尾部光标 +
 * 录音声波指示；notice 与停止按钮并入；原 DictationPreviewOverlay 退役。
 *
 * 动画遵守 DESIGN.md Motion：fast/low-drama——淡入+上滑 150ms、光标 1s 步进闪烁、
 * 声波 3 根竖条 1.2s 错相脉动（幅度 4px，克制不弹跳）。写入规则不变（§5.1）：
 * partial 永不进正文，final 注入后从浮层消失。
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

/** 声波指示（3 根错相脉动竖条，4px 幅度，DESIGN.md low-drama 约束）。 */
function WaveBars() {
  return (
    <span aria-hidden className="flex h-4 items-end gap-[3px]" data-testid="voice-transcript-wave">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current animate-[voice-wave_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.18}s`, height: "6px" }}
        />
      ))}
    </span>
  );
}

export function VoiceTranscriptOverlay({ onStopPressed }: { onStopPressed: () => void }) {
  const { intl } = useDroraIntl();
  const snapshot = useVoiceDictationSnapshot();
  const recording = snapshot.inputLeg === "recording";
  const requestingMic = snapshot.inputLeg === "requestingMic";
  const noticeCode = snapshot.notice?.code;
  if (!recording && !requestingMic && !noticeCode) {
    return null;
  }
  return (
    <div
      data-testid="voice-transcript-overlay"
      className="pointer-events-none fixed bottom-6 left-1/2 z-40 w-[min(640px,calc(100vw-3rem))] -translate-x-1/2 animate-[voice-rise_150ms_ease-out]"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-4 py-3 shadow-lg backdrop-blur-md">
        {recording ? (
          <span className="text-muted-foreground shrink-0">
            <WaveBars />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {requestingMic && !noticeCode ? (
            <p className="text-sm text-muted-foreground" data-testid="voice-transcript-requesting">
              {intl.formatMessage({ id: "voice.dictation.requestingMic" })}
            </p>
          ) : noticeCode ? (
            <p className="text-sm text-foreground" role="alert">
              {intl.formatMessage({
                id: NOTICE_MESSAGE_ID[noticeCode] ?? "voice.dictation.error.network",
              })}
            </p>
          ) : (
            <p className="truncate text-sm text-foreground" data-testid="voice-transcript-partial">
              {snapshot.partialText || intl.formatMessage({ id: "voice.dictation.preview.hint" })}
              {recording ? (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-[voice-caret_1s_step-end_infinite] bg-current"
                />
              ) : null}
            </p>
          )}
        </div>
        {recording ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={intl.formatMessage({ id: "voice.dictation.stop" })}
            onClick={onStopPressed}
            data-testid="voice-transcript-stop"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
