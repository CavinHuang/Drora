/**
 * 「语音合成」（tts）条目表单（specs/model-capabilities.md §5.1 / §15）。
 *
 * 引擎 Select（系统语音/云端）；engine=cloud 时显：§15 语音供应商模板行 + 内联 API
 * Key 行（存储单点落所选供应商卡，§13）+ 按厂商变形的音色/模型行 + Base URL 覆盖 +
 * 试听按钮（synthesizeOnce 固定句合成直播，fail-visible toast）。
 * 火山路径：音色即播报模型（speaker=modelId，单行 Select 写 modelId，voice 行隐藏）；
 * SiliconFlow/OpenAI 兼容：播报模型 + 音色双行自由文本 + 厂商预设 datalist。
 * 生效语义：即时（下一次播报；渲染进程经 hook 订阅）。
 */
import { useCallback, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  TID_MODEL_CAPABILITY_PREVIEW_BUTTON,
  TID_MODEL_CAPABILITY_VOICE_SELECT,
  TID_MODEL_CAPABILITY_MODEL_SELECT,
  TID_MODEL_CAPABILITY_ENGINE_SELECT,
  testId,
} from "@drora/shared/test-ids";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { playTtsBlob, synthesizeOnce } from "@/voice/ttsPreview.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { CapabilityBaseUrlRow, CapabilityTextValueRow } from "./CapabilityFormParts.js";
import { useVoiceVendorState, VoiceVendorProviderRow } from "./VoiceVendorProviderRow.js";

/** 试听固定句（§15.3：中文固定文案，面向中文音色预设；不随 UI locale 变化）。 */
const PREVIEW_SENTENCE = "你好，这是 Drora 的语音播报试听。";

/** 自定义端点（OpenAI 兼容）的模型/音色建议。 */
const GENERIC_MODEL_PRESETS = [
  "tts-1",
  "tts-1-hd",
  "gpt-4o-mini-tts",
  "FunAudioLLM/CosyVoice2-0.5B",
  "fnlp/MOSS-TTSD-v0.5",
];
const GENERIC_VOICE_PRESETS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

export function TtsCapabilityForm() {
  const { intl } = useDroraIntl();
  const { capabilities, update } = useModelCapabilities();
  const entry = capabilities?.tts ?? null;
  const engine = entry?.engine ?? "system";
  const modelId = entry?.modelId?.trim() ?? "";

  const handleEngineChange = useCallback(
    async (next: "system" | "cloud") => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "change_tts_engine",
        trigger: "select",
      });
      try {
        await update({ capabilities: { tts: { engine: next } } });
        trace.complete({ resultSource: "setting_service" });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        // §15 审查修复：写失败静默回弹（Select 弹回旧值）改 fail-visible。
        toast(intl.formatMessage({ id: "settings.modelCapability.saveFailed" }));
        void error;
      }
    },
    [update, intl],
  );

  // §15 审查修复：档案写失败不再静默（UI 回弹零反馈）——统一 toast + trace.fail。
  const handleProviderRefSave = useCallback(
    (providerRef: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_tts_provider",
        trigger: "select",
      });
      void update({ capabilities: { tts: { providerRef } } })
        .then(() => {
          trace.complete({ resultSource: "setting_service", configured: providerRef.length > 0 });
        })
        .catch((error: unknown) => {
          trace.fail({ failureStage: "setting_update" });
          toast(intl.formatMessage({ id: "settings.modelCapability.saveFailed" }));
          void error;
        });
    },
    [update, intl],
  );

  const handleBaseUrlOverrideSave = useCallback(
    (baseUrlOverride: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_tts_base_url",
        trigger: "button",
      });
      void update({ capabilities: { tts: { baseUrlOverride } } })
        .then(() => {
          trace.complete({
            resultSource: "setting_service",
            configured: baseUrlOverride.length > 0,
          });
        })
        .catch((error: unknown) => {
          trace.fail({ failureStage: "setting_update" });
          toast(intl.formatMessage({ id: "settings.modelCapability.saveFailed" }));
          void error;
        });
    },
    [update, intl],
  );

  const handleModelSave = useCallback(
    (nextModelId: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_tts_model",
        trigger: "button",
      });
      void update({ capabilities: { tts: { modelId: nextModelId.trim() } } })
        .then(() => {
          trace.complete({ resultSource: "setting_service" });
        })
        .catch((error: unknown) => {
          trace.fail({ failureStage: "setting_update" });
          toast(intl.formatMessage({ id: "settings.modelCapability.saveFailed" }));
          void error;
        });
    },
    [update, intl],
  );

  const handleVoiceSave = useCallback(
    (voice: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_tts_voice",
        trigger: "button",
      });
      void update({ capabilities: { tts: { voice: voice.trim() } } })
        .then(() => {
          trace.complete({ resultSource: "setting_service" });
        })
        .catch((error: unknown) => {
          trace.fail({ failureStage: "setting_update" });
          toast(intl.formatMessage({ id: "settings.modelCapability.saveFailed" }));
          void error;
        });
    },
    [update, intl],
  );

  const vendorState = useVoiceVendorState({
    kind: "tts",
    providerRef: entry?.providerRef ?? "",
    onSaveProviderRef: handleProviderRefSave,
  });

  const isVolcano = vendorState.vendor?.vendorId === "volcano";
  // §15.3（LobeChat 同构扩展）：内置厂商的模型/音色走 Select（含「保留当前」项）；
  // 自定义端点卡退自由文本 + 通用 datalist；命中厂商但无音色预设（ElevenLabs）退
  // 自由文本且不给 datalist（OpenAI 音色名对其全是无效建议，§15 审查修复）。
  const builtinModels = isVolcano ? [] : (vendorState.vendor?.models ?? []);
  const builtinVoices = isVolcano ? [] : (vendorState.vendor?.voices ?? []);
  const modelPresets = builtinModels.length > 0 ? builtinModels : GENERIC_MODEL_PRESETS;
  const voiceDatalistValues = builtinVoices.map((preset) => preset.id);
  const voice = entry?.voice?.trim() ?? "";

  // §15 试听：走当前表单态（providerRef 卡连接 + modelId + 音色）单次合成并直接播放。
  const [previewing, setPreviewing] = useState(false);
  const previewReady = Boolean(
    engine === "cloud" && modelId && vendorState.card?.baseUrl && vendorState.card?.apiKey,
  );
  const handlePreview = useCallback(async () => {
    const card = vendorState.card;
    if (!card?.baseUrl || !card.apiKey || previewing) {
      return;
    }
    const trace = startUserAction({
      featureId: "settings.model_capabilities",
      action: "preview_tts",
      trigger: "button",
    });
    setPreviewing(true);
    try {
      const override = entry?.baseUrlOverride?.trim() ?? "";
      const blob = await synthesizeOnce(
        { baseUrl: override || card.baseUrl, model: modelId, apiKey: card.apiKey },
        PREVIEW_SENTENCE,
        // 火山路径音色即 speaker（modelId），voice 字段不透传；其余路径透传云音色。
        {
          voice: isVolcano ? undefined : entry?.voice?.trim() || undefined,
          // §15 审查修复：试听无超时则网络黑洞时「合成中…」永久卡死——30s 上限。
          signal: AbortSignal.timeout(30_000),
        },
      );
      trace.complete({ resultSource: "platform_result" });
      toast(intl.formatMessage({ id: "settings.modelCapability.tts.preview.ok" }));
      playTtsBlob(blob);
    } catch (error) {
      trace.fail({ failureStage: "outbound_request" });
      const message = error instanceof Error ? error.message : String(error);
      toast(
        intl.formatMessage({ id: "settings.modelCapability.tts.preview.failed" }, { message }),
        { variant: "warning" },
      );
    } finally {
      setPreviewing(false);
    }
  }, [vendorState.card, entry, modelId, isVolcano, previewing, intl]);

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.modelCapability.tts.engine.label" })}
        description={intl.formatMessage({ id: "settings.modelCapability.tts.engine.description" })}
        control={
          <Select
            value={engine}
            onValueChange={(value) => {
              if (value === "system" || value === "cloud") {
                void handleEngineChange(value);
              }
            }}
          >
            <SelectTrigger
              className="w-56"
              data-testid={testId(TID_MODEL_CAPABILITY_ENGINE_SELECT, "tts")}
              aria-label={intl.formatMessage({ id: "settings.modelCapability.tts.engine.label" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">
                {intl.formatMessage({ id: "settings.modelCapability.tts.engine.system" })}
              </SelectItem>
              <SelectItem value="cloud">
                {intl.formatMessage({ id: "settings.modelCapability.tts.engine.cloud" })}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {engine === "cloud" ? (
        <>
          <VoiceVendorProviderRow
            state={vendorState}
            apiKeyActionName="save_tts_vendor_key"
            testIdValue="tts"
          />
          {isVolcano ? (
            <SettingsRow
              label={intl.formatMessage({ id: "settings.modelCapability.tts.voice.volcano.title" })}
              description={intl.formatMessage({
                id: "settings.modelCapability.tts.voice.volcano.description",
              })}
              control={
                <Select
                  value={modelId || undefined}
                  onValueChange={(next) => {
                    handleModelSave(next);
                  }}
                >
                  <SelectTrigger
                    className="w-72"
                    data-testid={testId(TID_MODEL_CAPABILITY_VOICE_SELECT, "tts")}
                    aria-label={intl.formatMessage({
                      id: "settings.modelCapability.tts.voice.volcano.title",
                    })}
                  >
                    <SelectValue
                      placeholder={intl.formatMessage({
                        // §15 审查修复：火山 speaker 必填（留空=功能不生效），不复用
                        // 「留空 = 厂商默认」占位（那是 OpenAI 兼容分支的语义）。
                        id: "settings.modelCapability.tts.voice.volcano.placeholder",
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(vendorState.vendor?.voices ?? []).map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.label}
                      </SelectItem>
                    ))}
                    {modelId &&
                    !(vendorState.vendor?.voices ?? []).some((p) => p.id === modelId) ? (
                      <SelectItem value={modelId}>
                        {intl.formatMessage(
                          { id: "settings.modelCapability.vendor.keepCurrent" },
                          { id: modelId },
                        )}
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              }
            />
          ) : (
            <>
              {builtinModels.length > 0 ? (
                <SettingsRow
                  label={intl.formatMessage({ id: "settings.modelCapability.tts.model.title" })}
                  control={
                    <Select
                      value={modelId || undefined}
                      onValueChange={(next) => {
                        handleModelSave(next);
                      }}
                    >
                      <SelectTrigger
                        className="w-72"
                        data-testid={testId(TID_MODEL_CAPABILITY_MODEL_SELECT, "tts")}
                        aria-label={intl.formatMessage({
                          id: "settings.modelCapability.tts.model.title",
                        })}
                      >
                        <SelectValue
                          placeholder={intl.formatMessage({
                            id: "settings.modelCapability.tts.model.placeholder",
                          })}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {builtinModels.map((preset) => (
                          <SelectItem key={preset} value={preset}>
                            {preset}
                          </SelectItem>
                        ))}
                        {modelId && !builtinModels.includes(modelId) ? (
                          <SelectItem value={modelId}>
                            {intl.formatMessage(
                              { id: "settings.modelCapability.vendor.keepCurrent" },
                              { id: modelId },
                            )}
                          </SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  }
                />
              ) : (
                <CapabilityTextValueRow
                  labelId="settings.modelCapability.tts.model.title"
                  placeholderId="settings.modelCapability.tts.model.placeholder"
                  value={entry?.modelId ?? ""}
                  onSave={handleModelSave}
                  testIdValue="tts"
                  datalist={{ id: "model-capability-tts-model-presets", values: modelPresets }}
                />
              )}
              {builtinVoices.length > 0 ? (
                <SettingsRow
                  label={intl.formatMessage({ id: "settings.modelCapability.tts.voice.title" })}
                  control={
                    <Select
                      value={voice || undefined}
                      onValueChange={(next) => {
                        handleVoiceSave(next);
                      }}
                    >
                      <SelectTrigger
                        className="w-72"
                        data-testid={testId(TID_MODEL_CAPABILITY_VOICE_SELECT, "tts")}
                        aria-label={intl.formatMessage({
                          id: "settings.modelCapability.tts.voice.title",
                        })}
                      >
                        <SelectValue
                          placeholder={intl.formatMessage({
                            id: "settings.modelCapability.tts.voice.placeholder",
                          })}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {builtinVoices.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {preset.label}
                          </SelectItem>
                        ))}
                        {voice && !builtinVoices.some((preset) => preset.id === voice) ? (
                          <SelectItem value={voice}>
                            {intl.formatMessage(
                              { id: "settings.modelCapability.vendor.keepCurrent" },
                              { id: voice },
                            )}
                          </SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  }
                />
              ) : (
                <CapabilityTextValueRow
                  labelId="settings.modelCapability.tts.voice.title"
                  placeholderId="settings.modelCapability.tts.voice.placeholder"
                  value={entry?.voice ?? ""}
                  onSave={handleVoiceSave}
                  testIdValue="tts-voice"
                  // §15 审查修复：命中厂商但无音色预设（ElevenLabs）不给 datalist——
                  // OpenAI 音色名对其全是无效建议；仅自定义端点给通用预设。
                  datalist={
                    vendorState.vendor && builtinVoices.length === 0
                      ? undefined
                      : { id: "model-capability-tts-voice-presets", values: GENERIC_VOICE_PRESETS }
                  }
                />
              )}
            </>
          )}
          <CapabilityBaseUrlRow
            labelId="settings.modelCapability.tts.baseUrlOverride.title"
            placeholderId="settings.modelCapability.tts.baseUrl.placeholder"
            value={entry?.baseUrlOverride ?? ""}
            onSave={handleBaseUrlOverrideSave}
            testIdValue="tts"
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.modelCapability.tts.preview.action" })}
            description={intl.formatMessage({
              id: "settings.modelCapability.tts.preview.description",
            })}
            control={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!previewReady || previewing}
                data-testid={testId(TID_MODEL_CAPABILITY_PREVIEW_BUTTON, "tts")}
                onClick={() => void handlePreview()}
              >
                {previewing ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {previewing
                  ? intl.formatMessage({ id: "settings.modelCapability.tts.preview.loading" })
                  : intl.formatMessage({ id: "settings.modelCapability.tts.preview.action" })}
              </Button>
            }
          />
        </>
      ) : null}
    </SettingsGroupCard>
  );
}
