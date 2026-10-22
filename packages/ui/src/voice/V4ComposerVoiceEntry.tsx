/**
 * 语音听写 composer 入口按钮（specs/voice-agent-integration.md §9.2 / §5.2 / §5.4）。
 *
 * 纯展示件（照 V4ComposerCuaEntry 先例）：可见性判定在 voiceComposerEntryState 纯函数，
 * 录音运行时在 useVoiceDictation，录音态事实在 voiceSessionStore。本组件负责：
 * mic 按钮（push-to-talk 点按开始/停止）、录音指示（常驻显示绑定会话名 §3.2）、
 * lastDictation「恢复上次转写」右键菜单（FD-4，TTL 过期不渲染）、隐私披露兜底门（FD-5）、
 * 绑定 pane 的听写预览条（§5.2）。
 */
import { memo, useEffect, useRef, useState } from "react";
import { MicIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
import {
  isVoiceLastDictationFresh,
  useVoiceSessionStore,
} from "@/store/voiceSessionStore.js";
import { VOICE_LAST_DICTATION_TTL_MS } from "./voiceTuning.js";
import { DictationPreviewOverlay } from "./DictationPreviewOverlay.js";
import { VoicePrivacyDisclosureDialog } from "./VoicePrivacyDisclosureDialog.js";
import { useVoiceComposerEntry, useVoiceDictationSnapshot } from "./useVoiceComposerEntry.js";

export interface V4ComposerVoiceEntryProps {
  /** mic 入口所在会话（按下即捕获为绑定目标；草稿 composer 为 null）。 */
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 手机 Web 远控壳：远控约束下不渲染本机 mic 入口（§8.3）。 */
  isWebRemoteControl?: boolean;
}

/**
 * 平台门前置层（照 V4ComposerCuaEntry 先例）：composer 会在没有 Platform/Service
 * provider 的宿主（组件级测试）里渲染，缺 context 即静默降级为不渲染。
 */
export const V4ComposerVoiceEntry = memo(function V4ComposerVoiceEntry(
  props: V4ComposerVoiceEntryProps,
) {
  const platform = useOptionalPlatform();
  const services = useOptionalServices();
  if (platform === null || services === null) {
    return null;
  }
  return <V4ComposerVoiceEntryMounted {...props} />;
});

/** FD-6 录音指示高亮脉冲时长（ms）。短暂高亮是 UI 信号，非契约常量。 */
const RECORDING_PULSE_HIGHLIGHT_MS = 1200;

function V4ComposerVoiceEntryMounted({
  sessionId,
  workspacePath,
  workspaceIdentity,
  isWebRemoteControl = false,
}: V4ComposerVoiceEntryProps) {
  const { intl } = useDroraIntl();
  const { view, acknowledgePrivacy, cancelPrivacyAcknowledgement, privacyDialogOpen, dictation, tooltip } =
    useVoiceComposerEntry({ sessionId, workspacePath, workspaceIdentity, isWebRemoteControl });
  const snapshot = useVoiceDictationSnapshot();
  const [pulseHighlighted, setPulseHighlighted] = useState(false);
  const [lastDictationExpired, setLastDictationExpired] = useState(false);
  const lastPulseSeqRef = useRef(snapshot.recordingPulseSeq);

  // FD-6：第二入口点按被拒时 store 递增 recordingPulseSeq；持有录音指示的入口（本组件
  // 在录音中即持有者）短暂高亮。
  useEffect(() => {
    if (snapshot.recordingPulseSeq === lastPulseSeqRef.current) {
      return;
    }
    lastPulseSeqRef.current = snapshot.recordingPulseSeq;
    if (snapshot.inputLeg !== "recording") {
      return;
    }
    setPulseHighlighted(true);
    const timer = setTimeout(() => setPulseHighlighted(false), RECORDING_PULSE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [snapshot.inputLeg, snapshot.recordingPulseSeq]);

  // FD-4：TTL 过期后恢复菜单项「直接消失，不置灰」——到期时刻安排一次重渲染翻转。
  useEffect(() => {
    setLastDictationExpired(false);
    const last = snapshot.lastDictation;
    if (!last) {
      return;
    }
    const remaining = VOICE_LAST_DICTATION_TTL_MS - (Date.now() - last.capturedAt);
    if (remaining <= 0) {
      setLastDictationExpired(true);
      return;
    }
    const timer = setTimeout(() => setLastDictationExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [snapshot.lastDictation]);

  if (!view.visible) return null;

  // §3.3/FD-6：停止态只属于绑定入口——他人 pane 录音时本入口仍显示普通 mic
  //（点按走 store 拒绝 + 脉冲高亮持有者，不停别人的录音）。
  const recording = snapshot.inputLeg === "recording" && snapshot.boundSessionId === sessionId;
  const bound = recording;
  const isBoundEntry = snapshot.boundSessionId === sessionId;
  const micAriaId = recording ? "voice.entry.mic.stop.aria" : "voice.entry.mic.start.aria";

  const lastDictationFresh =
    !lastDictationExpired &&
    isVoiceLastDictationFresh(useVoiceSessionStore.getState(), Date.now());
  const restoreLastDictation = () => {
    // §5.4 FD-4：恢复目标 = 触发恢复的 mic 入口所在会话（原绑定会话已消失或消费门
    // 不匹配时不指向旧目标）；恢复以新 requestId 走 mode="append"；成功即清暂存由
    // 菜单点击语义直接执行（乐观模型无法区分注入成败，§5.4 记档风险不变）。
    const state = useVoiceSessionStore.getState();
    const last = state.lastDictation;
    if (!last || !isVoiceLastDictationFresh(state, Date.now())) {
      return;
    }
    useDroraSessionStore
      .getState()
      .requestComposerTextInsert(
        workspacePath,
        last.text,
        workspaceIdentity,
        undefined,
        "append",
        sessionId,
      );
    state.clearLastDictation();
  };

  const micButton = (
    <Button
      type="button"
      variant="ghost"
      size="default"
      aria-label={intl.formatMessage({ id: micAriaId })}
      aria-pressed={recording}
      data-testid="v4-composer-voice-entry"
      data-voice-leg={snapshot.inputLeg}
      data-voice-bound={bound ? "true" : "false"}
      onClick={dictation.toggleMic}
      className={
        "h-7 w-fit justify-center gap-1 rounded-lg px-1.5 py-1.5 text-ui-base data-[composer-compact=true]:size-7 data-[composer-compact=true]:gap-0 data-[composer-compact=true]:p-0 " +
        (pulseHighlighted ? "ring-2 ring-ring" : "")
      }
    >
      {recording ? (
        <SquareIcon className="size-4 shrink-0 text-destructive" aria-hidden />
      ) : (
        <MicIcon className="size-4 shrink-0" aria-hidden />
      )}
    </Button>
  );

  return (
    <div className="relative inline-flex items-center">
      {/* 录音指示（绑定 pane，§3.2 note：常驻显示绑定会话名）+ 预览条（§5.2）。 */}
      {recording && isBoundEntry ? (
        <DictationPreviewOverlay
          bound
          inputLeg={snapshot.inputLeg}
          partialText={snapshot.partialText}
          notice={snapshot.notice}
          onClearPartial={() => useVoiceSessionStore.getState().setPartial("")}
          onDismissNotice={() => useVoiceSessionStore.getState().clearNotice()}
        />
      ) : null}
      <ControlHintTooltip title={tooltip}>
        {lastDictationFresh ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{micButton}</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={restoreLastDictation}>
                {intl.formatMessage({ id: "voice.dictation.restoreLast" })}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          micButton
        )}
      </ControlHintTooltip>
      {/* 录音中绑定会话名（§3.2 note，读给辅助技术的常驻指示；切 focused 不改绑定）。 */}
      {recording && isBoundEntry ? (
        <span className="sr-only">
          {intl.formatMessage({ id: "voice.dictation.recordingIndicatorAria" }, {
            session: sessionId ?? intl.formatMessage({ id: "voice.dictation.draftSessionName" }),
          })}
        </span>
      ) : null}
      <VoicePrivacyDisclosureDialog
        open={privacyDialogOpen}
        onAcknowledge={acknowledgePrivacy}
        onCancel={cancelPrivacyAcknowledgement}
      />
    </div>
  );
}
