/**
 * 语音听写 composer 入口 hook（照 useCuaComposerEntry 三段式先例）。
 *
 * 只做数据汇聚：settings（appSettings 行为偏好键）× 模型能力档案（asr 引擎/厂商档，
 * useModelCapabilities）× 平台形态 × locale × Web Speech 能力探测 →
 * voiceComposerEntryState 纯函数；录音运行时全部在 useVoiceDictation，本 hook 不复制
 * 任何状态机分支。FD-5 的两入口共用 reader 守卫也在这里消费（isVoicePrivacyAcknowledged）。
 */
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ProviderSettingsView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
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
  // ASR 引擎数据源（specs/model-capabilities.md §4/§13）：引擎选择读档案 asr 条目；
  // §13 起连接信息（baseUrl+apiKey）单点在官方供应商卡，经 providerSettingsService
  // 按 providerRef 实时解析（卡删/key 变即时生效，回退树语义不变 MC-10）。
  const { capabilities } = useModelCapabilities();
  const asrCapability = capabilities?.asr ?? null;
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  // 能力探测一次即可：window.SpeechRecognition 的存在性在会话生命周期内不会翻转；
  // 缺席（Firefox/iOS Safari）即不出入口（§6.1 能力探测，不写 UA 分支）。
  const webSpeechSupported = useMemo(() => createWebSpeechAsrAdapter().isSupported(), []);
  const [vendorConnectionReady, setVendorConnectionReady] = useState(false);
  const [vendorConnection, setVendorConnection] = useState<{
    baseUrl: string;
    apiKey: string;
  } | null>(null);
  // §13：连接信息（baseUrl+apiKey）单点在官方供应商卡，按 providerRef 从视图解析
  //（override 优先）。解析只依赖条目连接面，不消费 modelId。
  const resolveFromView = useCallback(
    (view: ProviderSettingsView | null | undefined) => {
      if (asrCapability?.engine !== "remote" || !asrCapability.providerRef.trim()) return null;
      const provider = view?.providers.find(
        (candidate) => candidate.providerId === asrCapability.providerRef,
      );
      // 项2（enabled 语义两口径对齐 fail-closed）：表单侧（VoiceVendorProviderRow）只列
      // enabled 卡，运行时解析原先不过滤 enabled → 「UI 说不可用、功能照常跑」。裁定：
      // 与 §13 卡不可用 fail-closed 精神一致——enabled === false 与缺 Key 同路径返回
      // null（ProviderSettingsProviderView.enabled 为必填 boolean，facades.ts:153），
      // 出站侧自然回落 webSpeech。
      if (provider?.enabled === false) return null;
      const access = provider?.effectiveConfig?.access;
      const baseUrl = provider?.effectiveConfig?.api?.baseUrl?.trim() ?? "";
      const apiKey = access?.type === "api-key" ? (access.apiKey?.trim() ?? "") : "";
      const override = asrCapability.baseUrlOverride.trim();
      return baseUrl && apiKey ? { baseUrl: override || baseUrl, apiKey } : null;
    },
    [asrCapability?.engine, asrCapability?.providerRef, asrCapability?.baseUrlOverride],
  );
  const applyVendorConnection = useCallback(
    (connection: { baseUrl: string; apiKey: string } | null) => {
      // 值等价保持旧引用（onDidChange 在任意供应商卡变更都会 fire，防无谓重渲染）。
      setVendorConnection((prev) =>
        prev?.baseUrl === connection?.baseUrl &&
        prev?.apiKey === connection?.apiKey &&
        (prev === null) === (connection === null)
          ? prev
          : connection,
      );
      setVendorConnectionReady(connection !== null);
    },
    [],
  );
  // 项5（getView 与 onDidChange 竞态）：连接解析 effect 里初始 getView 与 onDidChange
  // 事件并行到达，晚到的旧 getView 响应可能把已更新状态写回（窄窗口自愈）。参照同类
  // hook useProviderSettingsView 的 commitView：ref 记录已应用的最大 revision，仅
  // revision >= 已应用值的视图才提交（同 revision 重复提交幂等——applyVendorConnection
  // 值等价保旧引用；revision 缺席的载荷无法排序，放行，与 commitView 对 undefined
  // revision 的比较行为一致）。
  const latestAppliedRevisionRef = useRef(-1);
  useEffect(() => {
    let active = true;
    // 新解析代际重置防护值（条目/服务依赖变化即换代，与 commitView 在 service 换代时
    // 重置 latestRevisionRef 同法；跨代旧回调由下方 active 标记拦截）。
    latestAppliedRevisionRef.current = -1;
    setVendorConnectionReady(false);
    setVendorConnection(null);
    const commitView = (view: ProviderSettingsView): void => {
      if (!active) return;
      const revision = view.revision;
      if (typeof revision === "number") {
        if (revision < latestAppliedRevisionRef.current) return;
        latestAppliedRevisionRef.current = revision;
      }
      applyVendorConnection(resolveFromView(view));
    };
    void services.providerSettingsService
      ?.getView()
      .then(commitView)
      .catch(() => undefined);
    // §15 修复（对齐 TTS 的懒解析语义）：卡上 Key 变化（§15 内联 Key 行粘贴/他窗口
    // 修改/卡删除）即时重解析——原实现只挂能力条目依赖，Key 变化不触发重解析，听写
    // 入口以旧态出站（401）或误判档不完整回落 webSpeech。事件源与
    // useProviderSettingsServiceView 同一（providerSettingsService.onDidChange）。
    const subscription = services.providerSettingsService?.onDidChange(commitView);
    return () => {
      active = false;
      subscription?.dispose();
    };
  }, [applyVendorConnection, resolveFromView, services.providerSettingsService]);
  // F6：只在完整 remote 档+独立媒体能力均成立时选 remote，入口与起录同一解析规则。
  const asrSupported =
    resolveAsrEngineChoice({
      engine: asrCapability?.engine ?? "webSpeech",
      vendorConfigComplete: isVoiceVendorConfigComplete({
        baseUrl: vendorConnection?.baseUrl ?? "",
        model: asrCapability?.modelId,
        apiKey: vendorConnectionReady ? "available" : "",
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

  // §13：apiKey 来自供应商卡（vendorConnection 已含，闭包实时取 ref 值不重建）。
  const vendorConnectionRef = useRef(vendorConnection);
  vendorConnectionRef.current = vendorConnection;
  const getVendorApiKey = useCallback(
    () => Promise.resolve(vendorConnectionRef.current?.apiKey ?? null),
    [],
  );
  const dictation = useVoiceDictation({
    sessionId,
    workspacePath,
    workspaceIdentity,
    lang: dictationLang,
    requestStart,
    asrEngine: asrCapability?.engine ?? "webSpeech",
    vendor: {
      baseUrl: vendorConnection?.baseUrl ?? "",
      model: asrCapability?.modelId ?? "",
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
