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
import { VOICE_LAST_DICTATION_TTL_MS, VOICE_NOTICE_VISIBLE_TTL_MS } from "./voiceTuning.js";
import { DictationPreviewOverlay } from "./DictationPreviewOverlay.js";
import { VoicePrivacyDisclosureDialog } from "./VoicePrivacyDisclosureDialog.js";
import { useVoiceComposerEntry, useVoiceDictationSnapshot } from "./useVoiceComposerEntry.js";

/** 入口组件 props（ConversationComposer leadingActions 挂载）。@lintignore */
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
  // §9.9.4-L6：脉冲只归 owner——recordingOwnerEntryId === 本实例 entryId（旧判定
  // 「inputLeg==="recording"」会让同会话/他会话的任何挂载入口都高亮，违反 FD-6
  // 「持有录音指示的入口短暂高亮」原语义）。
  const isOwner = snapshot.recordingOwnerEntryId === dictation.entryId;
  useEffect(() => {
    if (snapshot.recordingPulseSeq === lastPulseSeqRef.current) {
      return;
    }
    lastPulseSeqRef.current = snapshot.recordingPulseSeq;
    if (snapshot.inputLeg !== "recording" || !isOwner) {
      return;
    }
    setPulseHighlighted(true);
    const timer = setTimeout(() => setPulseHighlighted(false), RECORDING_PULSE_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [isOwner, snapshot.inputLeg, snapshot.recordingPulseSeq]);

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

  // 修复轮 F1：notice 写入与「回 idle」同批（inputLeg 非 recording），渲染入口若只认
  // recording 则六种提示零可见帧——扩为「绑定入口 + 未过期 notice 也渲染预览条」；
  // TTL 到期安排重渲染并清 store（§9.2 用户可见 + voiceTuning 注释的选择理由）。
  const [noticeExpired, setNoticeExpired] = useState(false);
  useEffect(() => {
    setNoticeExpired(false);
    const notice = snapshot.notice;
    if (!notice) {
      return;
    }
    const remaining = VOICE_NOTICE_VISIBLE_TTL_MS - (Date.now() - notice.at);
    if (remaining <= 0) {
      setNoticeExpired(true);
      return;
    }
    const timer = setTimeout(() => {
      setNoticeExpired(true);
      // §9.2 自然消退后清 store，不留陈旧 notice（下次起录 startMicRequest 也会清除）。
      useVoiceSessionStore.getState().clearNotice();
    }, remaining);
    return () => clearTimeout(timer);
  }, [snapshot.notice]);

  if (!view.visible) return null;

  // §9.9.4-L6：停止态/指示/预览条统一按 owner 换轨——`recordingOwnerEntryId === 本实例
  // entryId`。旧判定 `boundSessionId === sessionId` 在同会话主/辅 pane 双入口全部命中
  //（停止图标/预览条/sr-only 双显，违反 FD-6「partial 只出现在 A 的预览条」）；
  // 跨会话入口照旧显示普通 mic（点按走 store 拒绝 + 持有者脉冲）。
  const legActive =
    snapshot.inputLeg === "requestingMic" ||
    snapshot.inputLeg === "recording" ||
    snapshot.inputLeg === "injecting";
  const recording = snapshot.inputLeg === "recording" && isOwner;
  // §9.9.4-L2：预览条 bound 扩至腿活动（requestingMic/recording/injecting）&& owner——
  // 请求麦克风期间（权限对话框被忽略/折叠，§5.3 10s 超时窗）预览条可见
  // `voice.dictation.requestingMic` 文案（既有键激活，零新 i18n 键；requestingMic 期
  // store 已设 recordingOwnerEntryId，owner 判定天然成立）。
  const bound = legActive && isOwner;
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

  // 修复轮 F1：notice 在 idle 态也可见——notice 写入与「回 idle」同批且 boundSessionId
  // 同批清空，故不能按绑定归属过滤（否则仍零可见帧）；v1 简化：任一挂载入口都显示
  // 未过期 notice（单 composer 主场景仅一个挂载点；双 pane 双显为已记录的 v1 简化）。
  const noticeVisible = snapshot.notice != null && !noticeExpired;
  return (
    <div className="relative inline-flex items-center">
      {/* 录音指示/预览条（持有者入口，§3.2/§5.2/§9.9.4-L6）+ notice 提示（不依赖绑定归属，F1）。 */}
      {bound || noticeVisible ? (
        <DictationPreviewOverlay
          bound={bound}
          inputLeg={snapshot.inputLeg}
          partialText={snapshot.partialText}
          notice={noticeVisible ? snapshot.notice : null}
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
      {/* 录音中绑定会话名（§3.2 note，读给辅助技术的常驻指示；切 focused 不改绑定）。
          §9.9.4-L6：sr-only 指示同轨 owner——同会话双 pane 不双显。 */}
      {recording ? (
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
