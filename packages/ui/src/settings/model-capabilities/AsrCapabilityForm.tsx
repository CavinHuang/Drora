/**
 * 「语音识别」（asr）条目表单（specs/model-capabilities.md §5.1 / §15）。
 *
 * 引擎 Select（系统听写/厂商端点）；engine=remote 时显 §15 语音供应商模板行 + 内联
 * API Key 行（存储单点落所选供应商卡，§13）+ 模型 id（厂商预设 datalist）+ Base URL
 * 覆盖。无试听（需麦克风录制，backlog）。生效语义：即时（下一次听写）。
 * 引擎档完整性谓词复用 isVoiceVendorConfigComplete（remote 档不完整时运行时回退
 * webSpeech，§9.6.6 回退树不变）；此处仅提示，不阻断选择。
 */
import { useCallback } from "react";
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
import { CapabilityBaseUrlRow, CapabilityTextValueRow } from "./CapabilityFormParts.js";
import { useVoiceVendorState, VoiceVendorProviderRow } from "./VoiceVendorProviderRow.js";

const ASR_MODEL_PRESETS = ["FunAudioLLM/SenseVoiceSmall", "TeleAI/TeleSpeechASR"];

export function AsrCapabilityForm() {
  const { intl } = useDroraIntl();
  const { capabilities, update } = useModelCapabilities();
  const entry = capabilities?.asr ?? null;
  const engine = entry?.engine ?? "webSpeech";

  const handleEngineChange = useCallback(
    async (next: "webSpeech" | "remote") => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "change_asr_engine",
        trigger: "select",
      });
      try {
        await update({ capabilities: { asr: { engine: next } } });
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
        action: "save_asr_provider",
        trigger: "select",
      });
      void update({ capabilities: { asr: { providerRef } } })
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
        action: "save_asr_base_url",
        trigger: "button",
      });
      void update({ capabilities: { asr: { baseUrlOverride } } })
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
        action: "save_asr_model",
        trigger: "button",
      });
      void update({ capabilities: { asr: { modelId: modelId.trim() } } })
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

  const vendorState = useVoiceVendorState({
    kind: "asr",
    providerRef: entry?.providerRef ?? "",
    onSaveProviderRef: handleProviderRefSave,
  });

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.modelCapability.asr.engine.label" })}
        description={intl.formatMessage({ id: "settings.modelCapability.asr.engine.description" })}
        control={
          <Select
            value={engine}
            onValueChange={(value) => {
              if (value === "webSpeech" || value === "remote") {
                void handleEngineChange(value);
              }
            }}
          >
            <SelectTrigger
              className="w-56"
              data-testid={testId(TID_MODEL_CAPABILITY_ENGINE_SELECT, "asr")}
              aria-label={intl.formatMessage({ id: "settings.modelCapability.asr.engine.label" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="webSpeech">
                {intl.formatMessage({ id: "settings.modelCapability.asr.engine.webSpeech" })}
              </SelectItem>
              <SelectItem value="remote">
                {intl.formatMessage({ id: "settings.modelCapability.asr.engine.remote" })}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
      {engine === "remote" ? (
        <>
          <VoiceVendorProviderRow
            state={vendorState}
            apiKeyActionName="save_asr_vendor_key"
            testIdValue="asr"
          />
          <CapabilityTextValueRow
            labelId="settings.modelCapability.asr.model.title"
            placeholderId="settings.modelCapability.asr.model.placeholder"
            value={entry?.modelId ?? ""}
            onSave={handleModelSave}
            testIdValue="asr"
            datalist={{ id: "model-capability-asr-model-presets", values: ASR_MODEL_PRESETS }}
          />
          <CapabilityBaseUrlRow
            labelId="settings.modelCapability.asr.baseUrlOverride.title"
            placeholderId="settings.modelCapability.asr.baseUrl.placeholder"
            value={entry?.baseUrlOverride ?? ""}
            onSave={handleBaseUrlOverrideSave}
            testIdValue="asr"
          />
        </>
      ) : null}
    </SettingsGroupCard>
  );
}
