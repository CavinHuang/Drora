/**
 * 语音听写入口「支持性/可见性」装配 hook（specs/voice-agent-integration.md §11.2）。
 *
 * 从 useVoiceComposerEntry 抽出的汇聚段（§11 收编后有两个消费方，判定单一出处）：
 * - 入口本体（useVoiceComposerEntry → V4ComposerVoiceEntry）消费完整支持面
 *   （引擎选择、厂商连接、官方句柄注入）；
 * - ConversationComposer 的官方 VoiceInputButton 互斥门只消费 view.visible
 *   （「自研入口可见时隐藏官方按钮」，D6 收编裁定）。
 *
 * 可见性判定仍是 voiceComposerEntryState.resolveVoiceComposerEntryView 纯函数单一
 * 出处；本 hook 只做数据汇聚（settings × 模型能力档案 × 厂商卡连接 × 官方链路可用性
 * × Web Speech 能力探测），两处消费同一派生结果，不复制判定逻辑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelCapabilities } from "@drora/shared";
import type { ProviderSettingsView } from "@drora/services";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { useDroraStore } from "@/store/StoreProvider.js";
import { createWebSpeechAsrAdapter } from "./webSpeechAsrAdapter.js";
import { isRemoteAsrSupported } from "./remoteAsrAdapter.js";
import { isVoiceVendorConfigComplete, resolveAsrEngineChoice } from "./resolveAsrAdapter.js";
import type { OfficialServerAsrEngineHandle } from "./officialServerAsrAdapter.js";
import {
  isVoiceComposerEntryVisibleInSettings,
  resolveVoiceComposerEntryView,
  type VoiceComposerEntryView,
} from "./voiceComposerEntryState.js";

export interface UseVoiceEntrySupportParams {
  /** 手机 Web 远控壳：远控约束下不渲染本机 mic 入口（§8.3）。 */
  isWebRemoteControl: boolean;
}

export interface VoiceEntrySupport {
  /** 入口可见性（resolveVoiceComposerEntryView 纯函数派发；互斥门与入口共用）。 */
  view: VoiceComposerEntryView;
  /** 模型能力档案 asr 条目（engine 选择与厂商档数据源）。 */
  asrCapability: ModelCapabilities["asr"] | null;
  /** §13 厂商卡实时解析出的连接（engine=remote 的出站依据；null=档不完整）。 */
  vendorConnection: { baseUrl: string; apiKey: string } | null;
  /** §13：apiKey 读取闭包（引用稳定；实时取 ref 值）。 */
  getVendorApiKey: () => Promise<string | null>;
  /** §11 收编：engine=official 且官方链路可用时的桥接装配（service+权限预检）；
   *  官方链路不可用或引擎非 official 时为 null（消费方据此回落 webSpeech）。 */
  officialAsr: {
    service: OfficialServerAsrEngineHandle;
    ensureMicAccess: () => Promise<"granted" | "denied" | "unsupported">;
  } | null;
  /** §5.5：当前 ASR 走豆包流式（火山卡命中）——窗口内浮层让位悬浮指示窗。 */
  isVolcanoStreaming: boolean;
}

export function useVoiceEntrySupport({
  isWebRemoteControl,
}: UseVoiceEntrySupportParams): VoiceEntrySupport {
  const services = useServices();
  const { settings } = useSettings();
  const platform = useOptionalPlatform();
  // ASR 引擎数据源（specs/model-capabilities.md §4/§13）：引擎选择读档案 asr 条目；
  // §13 起连接信息（baseUrl+apiKey）单点在官方供应商卡，经 providerSettingsService
  // 按 providerRef 实时解析（卡删/key 变即时生效，回退树语义不变 MC-10）。
  const { capabilities } = useModelCapabilities();
  const asrCapability = capabilities?.asr ?? null;
  // 能力探测一次即可：window.SpeechRecognition 的存在性在会话生命周期内不会翻转；
  // 缺席（Firefox/iOS Safari）即不出入口（§6.1 能力探测，不写 UA 分支）。
  const webSpeechSupported = useMemo(() => createWebSpeechAsrAdapter().isSupported(), []);
  const [vendorConnectionReady, setVendorConnectionReady] = useState(false);
  const [vendorConnection, setVendorConnection] = useState<{
    baseUrl: string;
    apiKey: string;
  } | null>(null);
  // §11 收编：官方链路可用性判定与官方 useComposerVoiceInput available 同源
  //（platform.microphone × base 连接 voiceInputService × 已登录）——零改动官方
  // hook，只在桥接侧读同一组事实。
  const baseServices = useBaseWorkspaceServices();
  const officialService = baseServices.voiceInputService ?? null;
  const isLoggedIn = useDroraStore((state) => state.user !== null);
  const officialAsrAvailable = Boolean(platform?.microphone && officialService && isLoggedIn);
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
  // §11：engine=official 的可见性按官方链路可用性判定（不可用回落 webSpeech 档）。
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
      officialSupported: officialAsrAvailable,
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

  // §13：apiKey 来自供应商卡（vendorConnection 已含，闭包实时取 ref 值不重建）。
  const vendorConnectionRef = useRef(vendorConnection);
  vendorConnectionRef.current = vendorConnection;
  const getVendorApiKey = useCallback(
    () => Promise.resolve(vendorConnectionRef.current?.apiKey ?? null),
    [],
  );

  const microphone = platform?.microphone;
  const officialAsr = useMemo(() => {
    if (asrCapability?.engine !== "official" || !officialService || !microphone) return null;
    return {
      // 结构即官方 IVoiceInputService（error.code 侧官方枚举是其收窄，此处放宽 string、
      // 未知码统一兜底 network——上游加码零改动；cast 只消解该窄化方向的严格检查）。
      service: officialService as OfficialServerAsrEngineHandle,
      ensureMicAccess: () => microphone.ensureAccess(),
    };
  }, [asrCapability?.engine, officialService, microphone]);

  return {
    view,
    asrCapability: asrCapability ?? null,
    vendorConnection,
    getVendorApiKey,
    officialAsr,
    /** §5.5：当前 ASR 走豆包流式（火山卡命中）——窗口内浮层让位悬浮指示窗。 */
    isVolcanoStreaming:
      asrCapability?.engine === "remote" &&
      (vendorConnection?.baseUrl ?? "").includes("openspeech.bytedance.com"),
  };
}
