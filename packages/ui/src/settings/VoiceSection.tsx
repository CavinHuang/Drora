/**
 * 设置页 voice 分节（specs/voice-agent-integration.md §6.1 / §6.2 / §9.2）。
 *
 * 八开关（键名 = VOICE_SETTINGS_KEYS，appSettings 持久化）+ 三条隐私披露 + FD-5 确认门：
 * 任一语音开关的开启动作在 acknowledged=false 时先弹披露，确认后本次开启生效；
 * 取消则开关回落。参数类设置（语言/引擎/音色/语速）不走确认门。
 * 消费读取一律经 voiceComposerEntryState 的 reader 函数收口，本组件只写不读判定。
 */
import { useCallback, useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { Input } from "@/components/ui/input.js";
import { useServices } from "@/hooks/useServices.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { VOICE_VENDOR_CREDENTIAL_KEY } from "@drora/shared";
import { isVoiceVendorConfigComplete } from "@/voice/resolveAsrAdapter.js";
import { validateVoiceVendorBaseUrl } from "@/voice/voiceVendorBaseUrl.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { isVoicePrivacyAcknowledged } from "@/voice/voiceComposerEntryState.js";
import { VoicePrivacyDisclosureDialog } from "@/voice/VoicePrivacyDisclosureDialog.js";

type VoiceCapabilityPatch = Partial<{
  voiceComposerEntryHidden: boolean;
  voiceAnnouncementEnabled: boolean;
  voiceToolBriefEnabled: boolean;
}>;

export function VoiceSection() {
  const { intl } = useDroraIntl();
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
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.announcement.voice.label" })}
          control={
            <Input
              className="w-56"
              value={announcementVoice}
              placeholder={intl.formatMessage({ id: "voice.settings.announcement.voice.default" })}
              aria-label={intl.formatMessage({ id: "voice.settings.announcement.voice.label" })}
              onChange={(event) => {
                void updateSettings({ voiceAnnouncementVoice: event.target.value });
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "voice.settings.announcement.rate.label" })}
          control={
            <Input
              className="w-28"
              type="number"
              min={0.5}
              max={2}
              step={0.1}
              value={announcementRate}
              aria-label={intl.formatMessage({ id: "voice.settings.announcement.rate.label" })}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2) {
                  void updateSettings({ voiceAnnouncementRate: parsed });
                }
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
