/**
 * 语音听写 composer 入口 hook（照 useCuaComposerEntry 三段式先例）。
 *
 * 只做数据汇聚：settings（appSettings 八键）× 平台形态 × locale × Web Speech 能力探测
 * → voiceComposerEntryState 纯函数；录音运行时全部在 useVoiceDictation，本 hook 不复制
 * 任何状态机分支。FD-5 的两入口共用 reader 守卫也在这里消费（isVoicePrivacyAcknowledged）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { VOICE_VENDOR_CREDENTIAL_KEY } from "@drora/shared";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import {
  isVoiceComposerEntryVisibleInSettings,
  isVoicePrivacyAcknowledged,
  resolveVoiceComposerEntryView,
  resolveVoiceDictationLang,
  type VoiceComposerEntryView,
} from "./voiceComposerEntryState.js";
import { createWebSpeechAsrAdapter } from "./webSpeechAsrAdapter.js";
import { isRemoteAsrSupported } from "./remoteAsrAdapter.js";
import { isVoiceVendorConfigComplete, resolveAsrEngineChoice } from "./resolveAsrAdapter.js";
import { useVoiceDictation } from "./useVoiceDictation.js";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";

export interface UseVoiceComposerEntryParams {
  /** mic 入口所在会话（按下即捕获为绑定目标；草稿 composer 为 null）。 */
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 手机 Web 远控壳：远控约束下不渲染本机 mic 入口（§8.3）。 */
  isWebRemoteControl?: boolean;
}

export interface VoiceComposerEntryController {
  view: VoiceComposerEntryView;
  /** FD-5：未确认披露时点按 mic 返回 false（入口侧弹披露并中止本次动作）。 */
  requestStart: () => boolean;
  /** FD-5 弹层确认：置 acknowledged 后中止本次动作，再次显式点按才开始。 */
  acknowledgePrivacy: () => void;
  cancelPrivacyAcknowledgement: () => void;
  privacyDialogOpen: boolean;
  dictation: ReturnType<typeof useVoiceDictation>;
  dictationLang: string;
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
  const services = useServices();
  const { settings, update: updateSettings } = useSettings();
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  // 能力探测一次即可：window.SpeechRecognition 的存在性在会话生命周期内不会翻转；
  // 缺席（Firefox/iOS Safari）即不出入口（§6.1 能力探测，不写 UA 分支）。
  const webSpeechSupported = useMemo(() => createWebSpeechAsrAdapter().isSupported(), []);
  const [vendorCredentialReady, setVendorCredentialReady] = useState(false);
  useEffect(() => {
    let active = true;
    setVendorCredentialReady(false);
    if (settings?.voiceAsrEngine !== "remote") return;
    void services.credentialService
      ?.load(VOICE_VENDOR_CREDENTIAL_KEY)
      .then((key) => {
        if (active) setVendorCredentialReady(Boolean(key?.trim()));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    services.credentialService,
    settings?.voiceAsrEngine,
    settings?.voiceVendorBaseUrl,
    settings?.voiceAsrVendorModel,
  ]);
  // F6：只在完整 remote 档+独立媒体能力均成立时选 remote，入口与起录同一解析规则。
  const asrSupported =
    resolveAsrEngineChoice({
      engine: settings?.voiceAsrEngine ?? "webSpeech",
      vendorConfigComplete: isVoiceVendorConfigComplete({
        baseUrl: settings?.voiceVendorBaseUrl,
        model: settings?.voiceAsrVendorModel,
        apiKey: vendorCredentialReady ? "available" : "",
      }),
      remoteSupported: isRemoteAsrSupported(),
      webSpeechSupported,
    }) !== null;

  const view = useMemo(
    () =>
      resolveVoiceComposerEntryView({
        isWebRemoteControl,
        asrSupported,
        hiddenBySettings: !isVoiceComposerEntryVisibleInSettings(settings),
      }),
    [asrSupported, isWebRemoteControl, settings],
  );
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

  // §9.6.6 引擎选型输入：settings 引擎/厂商档 + 凭据服务 apiKey（异步）。
  const getVendorApiKey = useCallback(
    () =>
      services.credentialService?.load(VOICE_VENDOR_CREDENTIAL_KEY).catch(() => null) ??
      Promise.resolve(null),
    [services.credentialService],
  );
  const dictation = useVoiceDictation({
    sessionId,
    workspacePath,
    workspaceIdentity,
    lang: dictationLang,
    requestStart,
    asrEngine: settings?.voiceAsrEngine ?? "webSpeech",
    vendor: {
      baseUrl: settings?.voiceVendorBaseUrl ?? "",
      model: settings?.voiceAsrVendorModel ?? "",
    },
    getVendorApiKey,
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
