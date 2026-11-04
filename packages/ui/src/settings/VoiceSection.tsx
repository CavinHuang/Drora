/**
 * 设置页 voice 分节——纯行为偏好（specs/voice-agent-integration.md §6.1/§6.2/§9.2/§9.7；
 * specs/model-capabilities.md §0 澄清与 §5.2 瘦身）。
 *
 * 模型能力收敛（批次二）：引擎选择与厂商档（ASR/TTS 引擎、baseUrl、模型、云音色、
 * apiKey）迁入模型设置页「模型能力」分组（asr/tts 条目，模型能力档案唯一所有者）；
 * 本分区只留行为偏好：播报开关/语言/语速/系统音色预览、听写语言、入口显隐、
 * persona 显示、工具简报、隐私披露。参数类设置（语言/语速/音色）不走确认门；
 * 八开关中三开关（入口/播报/简报）开启动作在 acknowledged=false 时先弹披露
 * （FD-5 确认后本次开启生效，取消回落）。
 *
 * 消费读取一律经 voiceComposerEntryState 的 reader 函数收口，本组件只写不读判定；
 * persona 选择为双存储物化（appSettings 四行为键 + 模型能力档案 tts.voice，
 * buildVoicePersonaPatch/buildVoicePersonaCapabilityPatch 成对调用）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  isVoicePrivacyAcknowledged,
  resolveVoiceAnnouncementLang,
} from "@/voice/voiceComposerEntryState.js";
import { VoicePrivacyDisclosureDialog } from "@/voice/VoicePrivacyDisclosureDialog.js";
import {
  VOICE_PERSONA_PRESETS,
  buildVoicePersonaCapabilityPatch,
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
  // 云音色读模型能力档案 tts.voice（persona 显示派生与物化写的 cloud 轨；
  // 档案服务缺席时该腿按「未配置」处理，显示派生自然落「自定义」）。
  const { capabilities, update: updateCapabilities } = useModelCapabilities();
  const ttsVendorVoice = capabilities?.tts.voice ?? "";
  // 待生效的开关补丁：确认后才写入（FD-5「确认后本次开启生效」，取消则回落）。
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
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
    void updateSettings({ ...patch, voicePrivacyDisclosureAcknowledged: true });
  }, [pendingPatch, updateSettings]);

  const handleCancel = useCallback(() => {
    // 取消：开关回落（补丁丢弃，设置未写）。
    setPendingPatch(null);
    setPrivacyDialogOpen(false);
  }, []);

  // 修复轮 F2：读侧语义 = 存储值直接决定入口可用性（hidden === false ⇔ 显示）。
  const entryVisible = settings?.voiceComposerEntryHidden === false;
  const announcementEnabled = settings?.voiceAnnouncementEnabled === true;
  const toolBriefEnabled = settings?.voiceToolBriefEnabled === true;
  const dictationLang = settings?.voiceDictationLang ?? "";
  const announcementVoice = settings?.voiceAnnouncementVoice ?? "";
  const announcementRate = settings?.voiceAnnouncementRate ?? 1;
  // §9.7.5：播报语言键（"" = 自动 = UI locale）；v1 仅 system 引擎生效（cloud 语种
  // 由厂商模型自判，不承诺跟随——引擎配置面已迁模型设置页「语音合成」条目）。
  const announcementLang = settings?.voiceAnnouncementLang ?? "";
  // §9.7.8 persona 显示派生：命中 builtin 且底层键（含档案 tts.voice）与物化值逐项
  // 相等 → 显示该 preset；任一键发散/未选/未知 id → 「自定义」（只读不写）。
  const personaSelection = resolveVoicePersonaSelection(settings, ttsVendorVoice);

  // §9.7.2 system 音色枚举目录：getVoices 快照 + voiceschanged 异步刷新（Windows/Chrome
  // 首帧常为空表——设置面列表不阻塞等待，空表仅渲染「自动」+ 禁用加载占位）。
  const [systemVoices, setSystemVoices] = useState<ReturnType<typeof filterVoicesForAnnouncement>>(
    [],
  );
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
  // → updateSettings 恰一次；非法/越界 → 草稿回退持久值 + 行内警告。
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
              <SelectTrigger
                className="w-40"
                aria-label={intl.formatMessage({ id: "voice.settings.dictation.lang.label" })}
              >
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
        {/* §9.7.8 persona 选择：点选 builtin = 成对物化写——appSettings 四行为键
            （buildVoicePersonaPatch）+ 模型能力档案 tts.voice
            （buildVoicePersonaCapabilityPatch）；voicePersonaId 的唯一消费方 = 本 Select
            显示派生（运行时零读路径）。「自定义」= 派生档不可点选（不出现在
            SelectItem 列表，经 SelectValue 条件 children 显示）。 */}
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
                void updateCapabilities({
                  capabilities: buildVoicePersonaCapabilityPatch(preset),
                }).catch(() => undefined);
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
