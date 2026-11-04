/**
 * 「语音合成」（tts）条目表单（specs/model-capabilities.md §5.1 字段表）。
 *
 * 引擎 Select（系统语音/云端）；engine=cloud 时显 baseUrl + 模型 id + 音色 + ApiKeyInput。
 * 自 VoiceSection 厂商档迁入：数据源从 AppSettings voiceTtsEngine/voiceTtsVendorModel/
 * voiceTtsVendorVoice 旧键切到档案 tts 条目；凭据迁至 model-capabilities:tts:api-key
 * （留空保存即删除）。生效语义：即时（下一次播报；渲染进程经 hook 订阅）。
 * 音色为厂商音色 id 命名空间（与系统音色 voiceAnnouncementVoice 永不互读，§9.7.3）。
 */
import { useCallback, useState } from "react";
import { TID_MODEL_CAPABILITY_ENGINE_SELECT, testId } from "@drora/shared/test-ids";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  CapabilityApiKeyRow,
  CapabilityBaseUrlRow,
  CapabilityTextValueRow,
  CapabilityProviderRefRow,
  useCapabilityProviderOptions,
} from "./CapabilityFormParts.js";

export function TtsCapabilityForm() {
  const { intl } = useDroraIntl();
  const { capabilities, update } = useModelCapabilities();
  const entry = capabilities?.tts ?? null;
  const providerOptions = useCapabilityProviderOptions();
  const engine = entry?.engine ?? "system";

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
        throw error;
      }
    },
    [update],
  );

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
          void error;
        });
    },
    [update],
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
          void error;
        });
    },
    [update],
  );

  const handleModelSave = useCallback(
    (modelId: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_tts_model",
        trigger: "button",
      });
      void update({ capabilities: { tts: { modelId: modelId.trim() } } })
        .then(() => {
          trace.complete({ resultSource: "setting_service" });
        })
        .catch((error: unknown) => {
          trace.fail({ failureStage: "setting_update" });
          void error;
        });
    },
    [update],
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
          void error;
        });
    },
    [update],
  );

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
          <CapabilityProviderRefRow
            labelId="settings.modelCapability.tts.provider.title"
            descriptionId="settings.modelCapability.tts.provider.description"
            value={entry?.providerRef ?? ""}
            options={providerOptions}
            onSave={handleProviderRefSave}
            testIdValue="tts"
          />
          <CapabilityTextValueRow
            labelId="settings.modelCapability.tts.model.title"
            placeholderId="settings.modelCapability.tts.model.placeholder"
            value={entry?.modelId ?? ""}
            onSave={handleModelSave}
            testIdValue="tts"
          />
          <CapabilityTextValueRow
            labelId="settings.modelCapability.tts.voice.title"
            placeholderId="settings.modelCapability.tts.voice.placeholder"
            value={entry?.voice ?? ""}
            onSave={handleVoiceSave}
            testIdValue="tts-voice"
          />
          <CapabilityBaseUrlRow
            labelId="settings.modelCapability.tts.baseUrlOverride.title"
            placeholderId="settings.modelCapability.tts.baseUrl.placeholder"
            value={entry?.baseUrlOverride ?? ""}
            onSave={handleBaseUrlOverrideSave}
            testIdValue="tts"
          />
        </>
      ) : null}
    </SettingsGroupCard>
  );
}
