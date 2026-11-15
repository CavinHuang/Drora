/**
 * 语音听写 composer 入口 hook（照 useCuaComposerEntry 三段式先例）。
 *
 * 只做数据汇聚：settings（appSettings 行为偏好键）× 引擎支持/可见性（useVoiceEntrySupport
 * ——§11 收编后与 ConversationComposer 官方按钮互斥门共用的单一派生）× locale ×
 * 平台 ASR 流通道 → voiceComposerEntryState 纯函数；录音运行时全部在 useVoiceDictation，
 * 本 hook 不复制任何状态机分支。FD-5 的两入口共用 reader 守卫也在这里消费
 * （isVoicePrivacyAcknowledged）。
 */
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";
import {
  isVoicePrivacyAcknowledged,
  resolveVoiceDictationLang,
} from "./voiceComposerEntryState.js";
import { useVoiceEntrySupport } from "./useVoiceEntrySupport.js";
import { useVoiceDictation } from "./useVoiceDictation.js";

export interface UseVoiceComposerEntryParams {
  /** mic 入口所在会话（按下即捕获为绑定目标；草稿 composer 为 null）。 */
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 手机 Web 远控壳：远控约束下不渲染本机 mic 入口（§8.3）。 */
  isWebRemoteControl?: boolean;
}

export interface VoiceComposerEntryController {
  view: ReturnType<typeof useVoiceEntrySupport>["view"];
  /** FD-5：未确认披露时点按 mic 返回 false（入口侧弹披露并中止本次动作）。 */
  requestStart: () => boolean;
  /** FD-5 弹层确认：置 acknowledged 后中止本次动作，再次显式点按才开始。 */
  acknowledgePrivacy: () => void;
  cancelPrivacyAcknowledgement: () => void;
  privacyDialogOpen: boolean;
  dictation: ReturnType<typeof useVoiceDictation>;
  dictationLang: string;
  /** §5.5：当前 ASR 走豆包流式（火山卡命中）——窗口内浮层让位悬浮指示窗。 */
  isVolcanoStreaming: boolean;
  /** §5.5.1 长按听写持键（appSettings；"off" = 组件不挂 window 监听；枚举单一出处）。 */
  dictationHoldKey: import("@drora/shared").VoiceDictationHoldKey;
  /** 可见时的 hover 提示（不可见为空串；组件按 view.visible 决定是否渲染）。 */
  tooltip: string;
}

export function useVoiceComposerEntry({
  sessionId,
  workspacePath,
  workspaceIdentity,
  isWebRemoteControl = false,
}: UseVoiceComposerEntryParams): VoiceComposerEntryController {
  const { intl, locale } = useDroraIntl();
  const { settings, update: updateSettings } = useSettings();
  const platform = useOptionalPlatform();
  // §11.2：支持性/可见性/引擎装配（含官方链路可用性与厂商连接解析）单一出处抽至
  // useVoiceEntrySupport——本 hook 与 ConversationComposer 官方按钮互斥门共用同一派生。
  const support = useVoiceEntrySupport({ isWebRemoteControl });
  const { view } = support;
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);

  const dictationLang = resolveVoiceDictationLang(settings, locale);
  const privacyAcknowledged = isVoicePrivacyAcknowledged(settings);

  const requestStart = useCallback((): boolean => {
    if (!privacyAcknowledged) {
      // FD-5 兜底门：先展示三条披露且不进入 RequestingMic；确认后中止本次动作。
      setPrivacyDialogOpen(true);
      return false;
    }
    return true;
  }, [privacyAcknowledged]);

  const acknowledgePrivacy = useCallback(() => {
    setPrivacyDialogOpen(false);
    // 确认即持久化 acknowledged（与设置页开关共写同一 appSettings 键，FD-5 两入口同一
    // reader/writer）；本次动作到此中止（不自动开录），再次显式点按才开始。
    void updateSettings({ voicePrivacyDisclosureAcknowledged: true }).catch(() => {
      // 写失败（Host 不可达等）：弹层已关，下次点按会再走披露门（reader 仍读 false）。
    });
  }, [updateSettings]);

  // §5.5：长按听写两设置键（appSettings 行为偏好；schema 默认 off/true）。
  const dictationHoldKey = settings?.voiceDictationHoldKey ?? "off";
  // §9.6.10 豆包流式 ASR 通道聚合（火山卡命中的听写走真流式；方法缺席=缺席端口）。
  const asrStream = useMemo<
    import("./doubaoStreamingAsrAdapter.js").DoubaoAsrStreamPort | null
  >(() => {
    const platformAsr = platform;
    if (
      platformAsr?.voiceAsrStreamStart == null ||
      platformAsr.voiceAsrStreamSendAudio == null ||
      platformAsr.onVoiceAsrStreamTranscript == null ||
      platformAsr.onVoiceAsrStreamState == null ||
      platformAsr.voiceAsrStreamAbort == null
    ) {
      return null;
    }
    return {
      start: (request) => platformAsr.voiceAsrStreamStart!(request),
      sendAudio: (chunk) => platformAsr.voiceAsrStreamSendAudio!(chunk),
      onTranscript: (handler) => platformAsr.onVoiceAsrStreamTranscript!(handler),
      onState: (handler) => platformAsr.onVoiceAsrStreamState!(handler),
      abort: (payload) => platformAsr.voiceAsrStreamAbort!(payload),
    };
  }, [platform]);
  const dictationHybridPreview = settings?.voiceDictationHybridPreview ?? true;
  const dictation = useVoiceDictation({
    sessionId,
    workspacePath,
    workspaceIdentity,
    lang: dictationLang,
    requestStart,
    asrEngine: support.asrCapability?.engine ?? "webSpeech",
    vendor: {
      baseUrl: support.vendorConnection?.baseUrl ?? "",
      model: support.asrCapability?.modelId ?? "",
    },
    getVendorApiKey: support.getVendorApiKey,
    // §5.5.2：混合流式预览开关。
    hybridPreview: dictationHybridPreview,
    // §9.6.10：豆包流式 ASR 通道（火山卡命中优先）。
    asrStream: asrStream ?? undefined,
    // §11 收编：engine=official 时官方服务端 ASR 桥接装配（句柄缺席由 useVoiceDictation
    // 回落 webSpeech，§11.2 回退树）。
    officialAsr: support.officialAsr ?? undefined,
    // §9.9.3-M9：入口可见性（voiceComposerEntryState 纯函数收口的唯一判定源）——
    // 录音中设置隐藏入口 = 持有者定向停止，不留下无入口的继续拾音。
    entryVisible: view.visible,
  });

  return {
    view,
    requestStart,
    acknowledgePrivacy,
    cancelPrivacyAcknowledgement: useCallback(() => setPrivacyDialogOpen(false), []),
    privacyDialogOpen,
    dictation,
    dictationLang,
    dictationHoldKey,
    /** §5.5：当前 ASR 走豆包流式（火山卡命中）——窗口内浮层让位悬浮指示窗。 */
    isVolcanoStreaming: support.isVolcanoStreaming && asrStream != null,
    tooltip: view.visible ? intl.formatMessage({ id: view.tooltipMessageId }) : "",
  };
}

/** 供入口组件读录音态（partial/绑定会话/notice 全局 store 单一事实源；shallow 防重渲染）。 */
export function useVoiceDictationSnapshot() {
  return useVoiceSessionStore(
    useShallow((state) => ({
      inputLeg: state.inputLeg,
      boundSessionId: state.boundSessionId,
      partialText: state.partialText,
      notice: state.notice,
      recordingPulseSeq: state.recordingPulseSeq,
      lastDictation: state.lastDictation,
      // §9.9.4-L6：owner 判定换轨——停止图标/预览条/脉冲/sr-only 指示按入口实例区分
      //（store :85 注释明言仅按 sessionId 无法区分同会话双 pane 双入口）。
      recordingOwnerEntryId: state.recordingOwnerEntryId,
    })),
  );
}
