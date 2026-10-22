/**
 * 听写预览条（specs/voice-agent-integration.md §5.2，EG-14）。
 *
 * 只读展示 partial 与进行中的听写状态：不做点按编辑（编辑入口就是 composer 正文）、
 * 不获焦（tabindex=-1，Esc 仲裁因此不需要处理预览条分支）。「清除」一键丢弃未定
 * partial（已落正文的 final 不受影响）；每句 final 注入发起即从预览条移除该句（store
 * 的 commitFinal 已清 partialText），录音结束时随录音腿回 Idle 一并清空。
 *
 * 归属（FD-6）：partial 只出现在绑定入口的预览条——由 props 传入 bound 布尔
 * （store.boundSessionId === 本入口会话），非绑定入口不渲染。
 */
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { VoiceDictationNotice } from "@/store/voiceSessionStore.js";
import type { VoiceInputLegState } from "@/store/voiceSessionStore.js";

const NOTICE_MESSAGE_ID: Record<VoiceDictationNotice["code"], string> = {
  permission: "voice.dictation.error.permission",
  network: "voice.dictation.error.network",
  device: "voice.dictation.error.device",
  aborted: "voice.dictation.error.aborted",
  requestingMicTimeout: "voice.dictation.requestingMicTimeout",
  sessionGone: "voice.dictation.sessionGone",
};

export interface DictationPreviewOverlayProps {
  /** 本入口是否为当前录音腿的绑定入口（FD-6：partial 只出现在绑定 pane）。 */
  bound: boolean;
  inputLeg: VoiceInputLegState;
  partialText: string;
  notice: VoiceDictationNotice | null;
  onClearPartial: () => void;
  onDismissNotice: () => void;
}

export function DictationPreviewOverlay({
  bound,
  inputLeg,
  partialText,
  notice,
  onClearPartial,
  onDismissNotice,
}: DictationPreviewOverlayProps) {
  const { intl } = useDroraIntl();
  // 只在绑定入口渲染；Idle 且无提示时整体不占位（§5.2 预览条随录音腿生命周期）。
  if (!bound) {
    return null;
  }
  const active = inputLeg === "requestingMic" || inputLeg === "recording" || inputLeg === "injecting";
  const showPartial = active && inputLeg === "recording" && partialText.trim().length > 0;
  if (!active && notice == null) {
    return null;
  }
  const noticeMessageId = notice ? NOTICE_MESSAGE_ID[notice.code] : null;
  return (
    // tabindex=-1：预览条不获焦（§5.2），录音中键盘焦点保持在 composer。
    <div
      tabIndex={-1}
      role="status"
      className="pointer-events-auto absolute bottom-full left-0 z-20 mb-2 w-max max-w-md rounded-lg border border-border bg-surface px-3 py-2 shadow-lg"
    >
      {active ? (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 shrink-0 animate-pulse rounded-full bg-destructive"
          />
          <span className="text-ui-base text-foreground">
            {inputLeg === "requestingMic"
              ? intl.formatMessage({ id: "voice.dictation.requestingMic" })
              : showPartial
                ? partialText
                : intl.formatMessage({ id: "voice.dictation.preview.hint" })}
          </span>
          {showPartial ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              tabIndex={-1}
              className="h-6 px-2 text-ui-base"
              onClick={onClearPartial}
            >
              <XIcon className="size-3.5" aria-hidden />
              {intl.formatMessage({ id: "voice.dictation.preview.clear" })}
            </Button>
          ) : null}
        </div>
      ) : notice && noticeMessageId ? (
        <div className="flex items-center gap-2">
          <span className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: noticeMessageId })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tabIndex={-1}
            className="h-6 px-2 text-ui-base"
            onClick={onDismissNotice}
            aria-label={intl.formatMessage({ id: "common.close" })}
          >
            <XIcon className="size-3.5" aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
