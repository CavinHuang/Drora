/**
 * 设置页 voice 分节（specs/voice-agent-integration.md §6.1 / §6.2 / §9.2 / §9.7.2-9.7.6）。
 *
 * 八开关（键名 = VOICE_SETTINGS_KEYS，appSettings 持久化）+ 三条隐私披露 + FD-5 确认门：
 * 任一语音开关的开启动作在 acknowledged=false 时先弹披露，确认后本次开启生效；
 * 取消则开关回落。参数类设置（语言/引擎/音色/语速）不走确认门。
 * 消费读取一律经 voiceComposerEntryState 的 reader 函数收口，本组件只写不读判定。
 *
 * §9.7 增补：system 音色枚举 Select（voiceschanged 异步刷新）+ 试听（仅 system 引擎，
 * §9.7.4 边界）+ 云音色独立输入（§9.7.3）+ 播报语言键（§9.7.5）+ 语速草稿态（§9.7.6）
 * + persona 选择（§9.7.8：物化写底层键，voicePersonaId 仅显示派生）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { useServices } from "@/hooks/useServices.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { VOICE_VENDOR_CREDENTIAL_KEY } from "@drora/shared";
import { isVoiceVendorConfigComplete } from "@/voice/resolveAsrAdapter.js";
import { validateVoiceVendorBaseUrl } from "@/voice/voiceVendorBaseUrl.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { isVoicePrivacyAcknowledged, resolveVoiceAnnouncementLang } from "@/voice/voiceComposerEntryState.js";
import { VoicePrivacyDisclosureDialog } from "@/voice/VoicePrivacyDisclosureDialog.js";
import {
  VOICE_PERSONA_PRESETS,
  buildVoicePersonaPatch,
  findVoicePersonaPreset,
  resolveVoicePersonaSelection,
} from "@/voice/voicePersonas.js";
import {
  filterVoicesForAnnouncement,
  getSpeechSynthesisForCatalog,
  listSystemVoices,
  subscribeSystemVoices,
} from "@/voice/systemVoiceCatalog.js";
import { createSpeechSynthesisTtsAdapter } from "@/voice/speechSynthesisTtsAdapter.js";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";
import type { VoiceTtsPort } from "@/voice/voiceTtsPort.js";

type VoiceCapabilityPatch = Partial<{
  voiceComposerEntryHidden: boolean;
  voiceAnnouncementEnabled: boolean;
  voiceToolBriefEnabled: boolean;
}>;

export function VoiceSection() {
  const { intl, locale } = useDroraIntl();
  const { settings, update: updateSettings } = useSettings();
  const { credentialService } = useServices();
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  // §9.6.2：apiKey 走凭据服务（不进 appSettings/wire）；本地 state 支撑 remote 选项
  // 启用条件与 password 输入，onBlur 落盘（避免每键 RPC）。
  const [vendorApiKey, setVendorApiKey] = useState("");
  const [vendorApiKeyLoaded, setVendorApiKeyLoaded] = useState(false);
  useEffect(() => {
    if (vendorApiKeyLoaded || !credentialService) {
      return;
    }
    let cancelled = false;
    void credentialService
      .load(VOICE_VENDOR_CREDENTIAL_KEY)
      .then((value) => {
        if (!cancelled) {
          setVendorApiKey(value ?? "");
          setVendorApiKeyLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVendorApiKeyLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [credentialService, vendorApiKeyLoaded]);
  const persistVendorApiKey = useCallback(
    (value: string) => {
      if (!credentialService) {
        return;
      }
      if (value.trim().length === 0) {
        void credentialService.delete(VOICE_VENDOR_CREDENTIAL_KEY).catch(() => undefined);
        return;
      }
      void credentialService.save(VOICE_VENDOR_CREDENTIAL_KEY, value).catch(() => undefined);
    },
    [credentialService],
  );
  // 待生效的开关补丁：确认后才写入（FD-5「确认后本次开启生效」，取消则回落）。
  const [pendingPatch, setPendingPatch] = useState<VoiceCapabilityPatch | null>(null);

  const acknowledged = isVoicePrivacyAcknowledged(settings);

  const handleCapabilityToggle = useCallback(
    (patch: VoiceCapabilityPatch) => {
      if (!acknowledged) {
        setPendingPatch(patch);
        setPrivacyDialogOpen(true);
        return;
      }
      void updateSettings(patch);
    },
    [acknowledged, updateSettings],
  );

  const handleAcknowledge = useCallback(() => {
    setPrivacyDialogOpen(false);
    // FD-5：确认后本次开启生效（开关补丁随 acknowledged 一起写入），不做「确认即
    // 连续开录」——composer 入口的下一次点按仍需显式动作。
    const patch = pendingPatch;
    setPendingPatch(null);
    void updateSettings({ ...(patch), voicePrivacyDisclosureAcknowledged: true });
  }, [pendingPatch, updateSettings]);

  const handleCancel = useCallback(() => {
    // 取消：开关回落（补丁丢弃，设置未写）。
    setPendingPatch(null);
    setPrivacyDialogOpen(false);
  }, []);

  // 修复轮 F2：读侧语义 = 存储值直接决定入口可用性（hidden === false ⇔ 显示）。
  // 修复前误写 `!== false`（hidden 语义被当作可见性，默认/显式隐藏全显示），
  // 与写路径组合成死控件（开关显示态恒等存储值，点击后读回不变）。
  const entryVisible = settings?.voiceComposerEntryHidden === false;
  const vendorBaseUrl = settings?.voiceVendorBaseUrl ?? "";
  // S1：baseUrl 草稿 + 明文非法标记（onBlur 校验，阻止写入持久层）。
  const [vendorBaseUrlDraft, setVendorBaseUrlDraft] = useState(vendorBaseUrl);
  // 终审 S3：警告按校验 reason 分型——unparseable 不应显示「明文 HTTP」文案。
  const [baseUrlWarning, setBaseUrlWarning] = useState<
    "insecure-remote" | "unparseable" | null
  >(null);
  useEffect(() => {
    // 外部变更（如清除设置）同步草稿。
    setVendorBaseUrlDraft(settings?.voiceVendorBaseUrl ?? "");
  }, [settings?.voiceVendorBaseUrl]);
  const asrVendorModel = settings?.voiceAsrVendorModel ?? "";
  const vendorRecordComplete = isVoiceVendorConfigComplete({
    baseUrl: vendorBaseUrl,
    model: asrVendorModel,
    apiKey: vendorApiKey,
  });
  const asrEngine = settings?.voiceAsrEngine ?? "webSpeech";
  const ttsEngine = settings?.voiceTtsEngine ?? "system";
  const ttsVendorModel = settings?.voiceTtsVendorModel ?? "";
  // §9.6.2-5：TTS 厂商档完整判定（ttsVendorModel + baseUrl + apiKey）。
  const ttsVendorComplete =
    isVoiceVendorConfigComplete({
      baseUrl: vendorBaseUrl,
      model: ttsVendorModel,
      apiKey: vendorApiKey,
    }) && vendorBaseUrl.trim().length > 0;
  const announcementEnabled = settings?.voiceAnnouncementEnabled === true;
  const toolBriefEnabled = settings?.voiceToolBriefEnabled === true;
  const dictationLang = settings?.voiceDictationLang ?? "";
  const announcementVoice = settings?.voiceAnnouncementVoice ?? "";
  const announcementRate = settings?.voiceAnnouncementRate ?? 1;
  // §9.7.5：播报语言键（"" = 自动 = UI locale）；v1 仅 system 引擎生效（cloud 语种
  // 由厂商模型自判，不承诺跟随——行内 description 如实披露）。
  const announcementLang = settings?.voiceAnnouncementLang ?? "";
  // §9.7.3：云音色独立键（厂商音色 id 命名空间；空 = 厂商默认音色）。
  const ttsVendorVoice = settings?.voiceTtsVendorVoice ?? "";
  // §9.7.8 persona 显示派生：命中 builtin 且四底层键与物化值逐项相等 → 显示该 preset；
  // 任一键发散/未选/未知 id → 「自定义」（只读不写，不回写 voicePersonaId）。
  const personaSelection = resolveVoicePersonaSelection(settings);

  // §9.7.2 system 音色枚举目录：getVoices 快照 + voiceschanged 异步刷新（Windows/Chrome
  // 首帧常为空表——设置面列表不阻塞等待，空表仅渲染「自动」+ 禁用加载占位）。
  const [systemVoices, setSystemVoices] = useState<
    ReturnType<typeof filterVoicesForAnnouncement>
  >([]);
  useEffect(() => {
    const synth = getSpeechSynthesisForCatalog();
    const refresh = () => {
      setSystemVoices(filterVoicesForAnnouncement(listSystemVoices(synth)));
    };
    refresh();
    return subscribeSystemVoices(synth, refresh);
  }, []);

  // §9.7.4 试听：preview 专用 speechSynthesis 适配器实例（不进播报腿状态机、不持播报
  // claim；不与 planner 共用实例——但底层引擎级 cancel 互斥由下方禁用门构造性保障）。
  const previewTtsRef = useRef<VoiceTtsPort | null>(null);
  if (previewTtsRef.current === null) {
    previewTtsRef.current = createSpeechSynthesisTtsAdapter();
  }
  const [previewPlaying, setPreviewPlaying] = useState(false);
  useEffect(() => {
    const tts = previewTtsRef.current;
    if (!tts) {
      return;
    }
    return tts.onDone(() => {
      // 播放态是设置面本地 useState（§9.7.4）；任何结算（end/cancelled/error）复位。
      setPreviewPlaying(false);
    });
  }, []);
  useEffect(() => {
    // 卸载停播：preview 实例归本组件所有，离开设置页不留余音。
    return () => {
      previewTtsRef.current?.cancel();
    };
  }, []);
  // 禁用门（§9.7.4 构造性保障）：输入腿 Recording（§3.3 Recording 优先——TTS 出声会被
  // ASR 拾入）或播报腿非 AnnIdle（speechSynthesis.cancel 是引擎级全停，两侧不可并存）。
  const inputLeg = useVoiceSessionStore((state) => state.inputLeg);
  const announcementPhase = useVoiceSessionStore((state) => state.announcement.phase);
  const previewDisabled = inputLeg === "recording" || announcementPhase !== "annIdle";
  const handlePreview = useCallback(() => {
    const tts = previewTtsRef.current;
    if (!tts || previewDisabled) {
      return;
    }
    // 点按 = 重播（先 cancel 后 speak）；试听短句文案按当前 UI locale 取键值（发音样本，
    // 不承担播报语言链路验证）；lang/voice/rate = 当前设置解析值（voice 空 = 系统默认）。
    tts.cancel();
    tts.speak({
      text: intl.formatMessage({ id: "voice.settings.announcement.voice.previewText" }),
      lang: resolveVoiceAnnouncementLang(settings, locale),
      ...(announcementVoice.length > 0 ? { voice: announcementVoice } : {}),
      rate: announcementRate,
    });
    setPreviewPlaying(true);
  }, [announcementRate, announcementVoice, intl, locale, previewDisabled, settings]);

  // §9.7.6 语速草稿态：onChange 只写本地草稿；onBlur 解析——合法（有限数且 ∈ [0.5, 2]）
  // → updateSettings 恰一次；非法/越界 → 草稿回退持久值 + 行内警告（照 baseUrl 先例）。
  const [rateDraft, setRateDraft] = useState(String(announcementRate));
  const [rateWarningVisible, setRateWarningVisible] = useState(false);
  useEffect(() => {
    // 草稿随外部变更重同步（如后续 persona 物化写入是控件外路径）。
    setRateDraft(String(settings?.voiceAnnouncementRate ?? 1));
    setRateWarningVisible(false);
  }, [settings?.voiceAnnouncementRate]);

  return (
    <div className="space-y-3">
      <div className="text-ui-base font-medium text-foreground-subtle">
        {intl.formatMessage({ id: "voice.settings.description" })}
      </div>
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.dictation.entry.label" })}
          description={intl.formatMessage({ id: "voice.settings.dictation.entry.description" })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "voice.settings.dictation.entry.label" })}
              data-testid="voice-entry-toggle"
              checked={entryVisible}
              onCheckedChange={(checked) =>
                handleCapabilityToggle({ voiceComposerEntryHidden: !checked })
              }
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.dictation.lang.label" })}
          control={
            <Select
              value={dictationLang.length > 0 ? dictationLang : "auto"}
              onValueChange={(value) => {
                void updateSettings({ voiceDictationLang: value === "auto" ? "" : value });
              }}
            >
              <SelectTrigger className="w-40" aria-label={intl.formatMessage({ id: "voice.settings.dictation.lang.label" })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  {intl.formatMessage({ id: "voice.settings.dictation.lang.auto" })}
                </SelectItem>
                {/* 语言选项按 endonym 展示（语言选择器惯例：以该语言自称呈现，
                    不随界面语言翻译）；文案仍经 i18n 键双语管理。 */}
                <SelectItem value="zh-CN">
                  {intl.formatMessage({ id: "voice.settings.dictation.lang.zh" })}
                </SelectItem>
                <SelectItem value="en-US">
                  {intl.formatMessage({ id: "voice.settings.dictation.lang.en" })}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.asr.engine.label" })}
          control={
            <Select
              value={asrEngine}
              onValueChange={(value) => {
                void updateSettings({
                  voiceAsrEngine: value === "remote" ? "remote" : "webSpeech",
                });
              }}
            >
              <SelectTrigger className="w-40" aria-label={intl.formatMessage({ id: "voice.settings.asr.engine.label" })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webSpeech">
                  {intl.formatMessage({ id: "voice.settings.asr.engine.webSpeech" })}
                </SelectItem>
                {/* §9.6.2-5：厂商档完整才可选，消除无实现/无配置的可选态；
                    已选中后档变不完整 → 运行时回退树（§9.6.6）兜底，选项不回收。 */}
                <SelectItem value="remote" disabled={!vendorRecordComplete}>
                  {intl.formatMessage({ id: "voice.settings.asr.engine.remote" })}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        {/* §9.6.2 厂商档分组：baseUrl/model（appSettings 非秘密键）+ apiKey（凭据服务，
            password 形态照 model-provider-section 先例）；§6.2 披露 1 落地——任一云引擎
            开启且 baseUrl 非空时渲染为数据处理方（§9.6.2-6 收口，终审 S3）。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.vendor.baseUrl.label" })}
          detail={
            baseUrlWarning ? (
              <div
                className="border-t border-border px-4 py-2 text-ui-base text-warning"
                data-testid="voice-vendor-base-url-warning"
              >
                {intl.formatMessage({
                  id:
                    baseUrlWarning === "unparseable"
                      ? "voice.settings.vendor.baseUrl.unparseableWarning"
                      : "voice.settings.vendor.baseUrl.insecureWarning",
                })}
              </div>
            ) : null
          }
          control={
            <Input
              className="w-72"
              value={vendorBaseUrlDraft}
              placeholder={intl.formatMessage({ id: "voice.settings.vendor.baseUrl.placeholder" })}
              aria-label={intl.formatMessage({ id: "voice.settings.vendor.baseUrl.label" })}
              data-testid="voice-vendor-base-url"
              onChange={(event) => setVendorBaseUrlDraft(event.target.value)}
              onBlur={(event) => {
                // S1 UI 层：明文非本机地址阻止写入（持久化保持上一次合法值）+ 行内警告；
                // 用户可改输 https 或本机明文地址。
                const value = event.target.value;
                const verdict = validateVoiceVendorBaseUrl(value);
                if (verdict.ok) {
                  setBaseUrlWarning(null);
                  void updateSettings({ voiceVendorBaseUrl: value });
                } else {
                  setBaseUrlWarning(verdict.reason ?? "insecure-remote");
                }
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.vendor.asrModel.label" })}
          control={
            <Input
              className="w-72"
              value={asrVendorModel}
              placeholder={intl.formatMessage({ id: "voice.settings.vendor.asrModel.placeholder" })}
              aria-label={intl.formatMessage({ id: "voice.settings.vendor.asrModel.label" })}
              data-testid="voice-vendor-asr-model"
              onChange={(event) => {
                void updateSettings({ voiceAsrVendorModel: event.target.value });
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.vendor.apiKey.label" })}
          control={
            <Input
              className="w-72"
              type="password"
              value={vendorApiKey}
              placeholder={intl.formatMessage({ id: "voice.settings.vendor.apiKey.placeholder" })}
              aria-label={intl.formatMessage({ id: "voice.settings.vendor.apiKey.label" })}
              data-testid="voice-vendor-api-key"
              onChange={(event) => setVendorApiKey(event.target.value)}
              onBlur={(event) => persistVendorApiKey(event.target.value)}
            />
          }
        />
        {(asrEngine === "remote" || ttsEngine === "cloud") && vendorBaseUrl.trim().length > 0 ? (
          <div className="border-t border-border px-4 py-3 text-ui-base leading-6 text-foreground-subtle">
            {intl.formatMessage(
              { id: "voice.settings.vendor.dataHandler" },
              { baseUrl: vendorBaseUrl.trim() },
            )}
          </div>
        ) : null}
      </SettingsGroupCard>
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.announcement.enable.label" })}
          description={intl.formatMessage({ id: "voice.settings.announcement.enable.description" })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "voice.settings.announcement.enable.label" })}
              checked={announcementEnabled}
              onCheckedChange={(checked) =>
                handleCapabilityToggle({ voiceAnnouncementEnabled: checked })
              }
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.tts.engine.label" })}
          control={
            <Select
              value={ttsEngine}
              onValueChange={(value) => {
                void updateSettings({
                  voiceTtsEngine: value === "cloud" ? "cloud" : "system",
                });
              }}
            >
              <SelectTrigger className="w-40" aria-label={intl.formatMessage({ id: "voice.settings.tts.engine.label" })}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">
                  {intl.formatMessage({ id: "voice.settings.tts.engine.system" })}
                </SelectItem>
                {/* §9.6.2-5：TTS 厂商档完整才可选 cloud（消除无配置的可选态）。 */}
                <SelectItem value="cloud" disabled={!ttsVendorComplete}>
                  {intl.formatMessage({ id: "voice.settings.tts.engine.cloud" })}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.vendor.ttsModel.label" })}
          control={
            <Input
              className="w-72"
              value={ttsVendorModel}
              placeholder={intl.formatMessage({ id: "voice.settings.vendor.ttsModel.placeholder" })}
              aria-label={intl.formatMessage({ id: "voice.settings.vendor.ttsModel.label" })}
              data-testid="voice-vendor-tts-model"
              onChange={(event) => {
                void updateSettings({ voiceTtsVendorModel: event.target.value });
              }}
            />
          }
        />
        {/* §9.7.3 云音色独立输入：厂商音色 id 命名空间（与 system 音色键永不互读）；
            v1 自由文本不校验（厂商音色枚举未抓取——OQ-9，照 ttsVendorModel 同形态）。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.vendor.ttsVoice.label" })}
          control={
            <Input
              className="w-72"
              value={ttsVendorVoice}
              placeholder={intl.formatMessage({ id: "voice.settings.vendor.ttsVoice.placeholder" })}
              aria-label={intl.formatMessage({ id: "voice.settings.vendor.ttsVoice.label" })}
              data-testid="voice-vendor-tts-voice"
              onChange={(event) => {
                void updateSettings({ voiceTtsVendorVoice: event.target.value });
              }}
            />
          }
        />
        {/* §9.7.8 persona 选择：点选 builtin = 单次 patch 物化写四个底层键（音色/云音色/
            语速/播报语言 + voicePersonaId）；voicePersonaId 的唯一消费方 = 本 Select 显示
            派生（运行时零读路径）。「自定义」= 派生档不可点选（不出现在 SelectItem 列表，
            经 SelectValue 条件 children 显示——radix value 非空时 children 优先渲染）。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.persona.label" })}
          description={intl.formatMessage({ id: "voice.settings.persona.description" })}
          control={
            <Select
              value={personaSelection.id}
              onValueChange={(value) => {
                // 哨兵/未知 id 无对应 item 不可点选；仅 builtin 触发物化 patch。
                const preset = findVoicePersonaPreset(value);
                if (!preset) {
                  return;
                }
                void updateSettings(buildVoicePersonaPatch(preset));
              }}
            >
              <SelectTrigger
                className="w-40"
                aria-label={intl.formatMessage({ id: "voice.settings.persona.label" })}
                data-testid="voice-persona"
              >
                <SelectValue>
                  {personaSelection.preset
                    ? undefined
                    : intl.formatMessage({ id: "voice.settings.persona.custom" })}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VOICE_PERSONA_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {intl.formatMessage({ id: preset.labelKey })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {/* §9.7.2 system 音色枚举 Select：「自动」+ zh/en 过滤的系统音色（空表回落
            全量列表）；voiceschanged 异步刷新；首帧空表 = 「自动」+ 禁用加载占位。
            选中项写值 = 音色 name 原串（与适配器精确匹配键一致）。§9.7.4 试听仅
            system 引擎（cloud keptOpen——TV-8 同期）。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.announcement.voice.label" })}
          control={
            <div className="flex items-center gap-2">
              <Select
                value={announcementVoice.length > 0 ? announcementVoice : "auto"}
                onValueChange={(value) => {
                  // auto 哨兵 → 写 ""（系统默认；照听写语言 auto→"" 先例）。
                  void updateSettings({ voiceAnnouncementVoice: value === "auto" ? "" : value });
                }}
              >
                <SelectTrigger
                  className="w-56"
                  aria-label={intl.formatMessage({ id: "voice.settings.announcement.voice.label" })}
                  data-testid="voice-announcement-voice"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {intl.formatMessage({ id: "voice.settings.announcement.voice.default" })}
                  </SelectItem>
                  {systemVoices.length === 0 ? (
                    <SelectItem value="system-voices-loading" disabled>
                      {intl.formatMessage({ id: "voice.settings.announcement.voice.loading" })}
                    </SelectItem>
                  ) : (
                    systemVoices.map((voice) => (
                      <SelectItem key={`${voice.name}\0${voice.lang}`} value={voice.name}>
                        {`${voice.name}（${voice.lang}）`}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                aria-label={intl.formatMessage({ id: "voice.settings.announcement.voice.preview" })}
                aria-pressed={previewPlaying}
                data-testid="voice-announcement-voice-preview"
                disabled={previewDisabled}
                onClick={handlePreview}
              >
                {intl.formatMessage({ id: "voice.settings.announcement.voice.preview" })}
              </Button>
            </div>
          }
        />
        {/* §9.7.5 播报语言："" = 自动 = UI locale（缺省语义零迁移）；不联动所选音色
            lang（语言来源单一，状态所有者红线）；cloud 引擎 v1 不映射（如实披露）。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.announcement.lang.label" })}
          description={intl.formatMessage({ id: "voice.settings.announcement.lang.description" })}
          control={
            <Select
              value={announcementLang.length > 0 ? announcementLang : "auto"}
              onValueChange={(value) => {
                void updateSettings({ voiceAnnouncementLang: value === "auto" ? "" : value });
              }}
            >
              <SelectTrigger
                className="w-40"
                aria-label={intl.formatMessage({ id: "voice.settings.announcement.lang.label" })}
                data-testid="voice-announcement-lang"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  {intl.formatMessage({ id: "voice.settings.announcement.lang.auto" })}
                </SelectItem>
                <SelectItem value="zh-CN">
                  {intl.formatMessage({ id: "voice.settings.announcement.lang.zh" })}
                </SelectItem>
                <SelectItem value="en-US">
                  {intl.formatMessage({ id: "voice.settings.announcement.lang.en" })}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.announcement.rate.label" })}
          detail={
            rateWarningVisible ? (
              <div
                className="border-t border-border px-4 py-2 text-ui-base text-warning"
                data-testid="voice-announcement-rate-warning"
              >
                {intl.formatMessage({ id: "voice.settings.announcement.rate.invalidWarning" })}
              </div>
            ) : null
          }
          control={
            <Input
              className="w-28"
              type="number"
              min={0.5}
              max={2}
              step={0.1}
              value={rateDraft}
              aria-label={intl.formatMessage({ id: "voice.settings.announcement.rate.label" })}
              data-testid="voice-announcement-rate"
              onChange={(event) => {
                // 草稿态（§9.7.6）：中间态不写持久层。
                setRateDraft(event.target.value);
              }}
              onBlur={() => {
                const parsed = Number(rateDraft);
                if (Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2) {
                  setRateWarningVisible(false);
                  void updateSettings({ voiceAnnouncementRate: parsed });
                  return;
                }
                // 非法/越界：草稿回退持久值 + 行内警告（持久层保持上一次合法值）。
                setRateDraft(String(announcementRate));
                setRateWarningVisible(true);
              }}
            />
          }
        />
        <div className="border-t border-border px-4 py-3 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "voice.settings.announcement.outputDisclosure" })}
        </div>
      </SettingsGroupCard>
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.toolBrief.enable.label" })}
          description={intl.formatMessage({ id: "voice.settings.toolBrief.enable.description" })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "voice.settings.toolBrief.enable.label" })}
              checked={toolBriefEnabled}
              onCheckedChange={(checked) =>
                handleCapabilityToggle({ voiceToolBriefEnabled: checked })
              }
            />
          }
        />
      </SettingsGroupCard>
      <SettingsGroupCard>
        <div className="space-y-3 px-4 py-3">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "voice.settings.privacy.title" })}
          </div>
          <ul className="list-disc space-y-2 pl-5 text-ui-base leading-6 text-foreground-subtle">
            <li>{intl.formatMessage({ id: "voice.settings.privacy.asr" })}</li>
            <li>{intl.formatMessage({ id: "voice.settings.privacy.persistence" })}</li>
            <li>{intl.formatMessage({ id: "voice.settings.privacy.mic" })}</li>
          </ul>
        </div>
      </SettingsGroupCard>
      <VoicePrivacyDisclosureDialog
        open={privacyDialogOpen}
        onAcknowledge={handleAcknowledge}
        onCancel={handleCancel}
      />
    </div>
  );
}
