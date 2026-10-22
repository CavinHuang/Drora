/**
 * 设置页 voice 分节（specs/voice-agent-integration.md §6.1 / §6.2 / §9.2）。
 *
 * 八开关（键名 = VOICE_SETTINGS_KEYS，appSettings 持久化）+ 三条隐私披露 + FD-5 确认门：
 * 任一语音开关的开启动作在 acknowledged=false 时先弹披露，确认后本次开启生效；
 * 取消则开关回落。参数类设置（语言/引擎/音色/语速）不走确认门。
 * 消费读取一律经 voiceComposerEntryState 的 reader 函数收口，本组件只写不读判定。
 */
import { useCallback, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { Input } from "@/components/ui/input.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
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
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
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

  const entryVisible = settings?.voiceComposerEntryHidden !== false;
  const announcementEnabled = settings?.voiceAnnouncementEnabled === true;
  const toolBriefEnabled = settings?.voiceToolBriefEnabled === true;
  const dictationLang = settings?.voiceDictationLang ?? "";
  const asrEngine = settings?.voiceAsrEngine ?? "webSpeech";
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
                {/* Phase 2 引擎（remoteAsrAdapter）未实现：保留选项占位但不可选，
                    消除无实现的可选态。 */}
                <SelectItem value="remote" disabled>
                  {intl.formatMessage({ id: "voice.settings.asr.engine.remote" })}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
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
