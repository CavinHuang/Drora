/**
 * 「图像生成」（image-generation）条目表单（specs/model-capabilities.md §5.1/§13）。
 *
 * §13 供应商引用式：开关 + 供应商下拉（providerRef，连接信息单点在官方供应商卡）
 * + 模型 id + 可选 baseUrl 覆盖（datalist 预设保留供覆盖场景）。不再有独立 ApiKey
 * 输入——key 在供应商卡管理（§13 单一连接层）。fail-closed 判定在消费方（Host 画图
 * 服务），表单不重复实现。
 */
import { useCallback } from "react";
import { TID_MODEL_CAPABILITY_TOGGLE, testId } from "@drora/shared/test-ids";
import { Switch } from "@/components/ui/switch.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  CapabilityBaseUrlRow,
  CapabilityProviderRefRow,
  CapabilityTextValueRow,
  useCapabilityProviderOptions,
} from "./CapabilityFormParts.js";

/** baseUrl 覆盖的常用预设（datalist 仅输入建议；正常路径无需覆盖——卡片已持 baseUrl）。 */
const IMAGE_GENERATION_BASE_URL_PRESETS = [
  "https://api.openai.com/v1",
  "https://open.bigmodel.cn/api/paas/v4",
] as const;
const IMAGE_GENERATION_BASE_URL_DATALIST_ID = "model-capability-image-base-url-presets";

export function ImageGenerationCapabilityForm() {
  const { intl } = useDroraIntl();
  const { capabilities, update } = useModelCapabilities();
  const entry = capabilities?.["image-generation"] ?? null;
  const providerOptions = useCapabilityProviderOptions();

  const handleEnabledChange = useCallback(
    async (enabled: boolean) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "toggle_image_generation",
        trigger: "switch",
      });
      try {
        await update({ capabilities: { "image-generation": { enabled } } });
        trace.complete({
          resultSource: "setting_service",
          stateAfter: enabled ? "enabled" : "disabled",
        });
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
        action: "save_image_generation_provider",
        trigger: "select",
      });
      void update({ capabilities: { "image-generation": { providerRef } } })
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
        action: "save_image_generation_base_url",
        trigger: "button",
      });
      void update({ capabilities: { "image-generation": { baseUrlOverride } } })
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
        action: "save_image_generation_model",
        trigger: "button",
      });
      void update({ capabilities: { "image-generation": { modelId: modelId.trim() } } })
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
        label={intl.formatMessage({
          id: "settings.modelCapability.imageGeneration.enabled.label",
        })}
        description={intl.formatMessage({
          id: "settings.modelCapability.imageGeneration.enabled.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({
              id: "settings.modelCapability.imageGeneration.enabled.label",
            })}
            data-testid={testId(TID_MODEL_CAPABILITY_TOGGLE, "image-generation")}
            checked={entry?.enabled === true}
            onCheckedChange={(checked) => void handleEnabledChange(checked)}
          />
        }
      />
      {/* 配置行不门控开关（与 v1 行为一致）：覆盖行与 datalist 预设常驻可填，
          开关只控制消费方出站（fail-closed 在 Host 画图服务）。 */}
      <CapabilityProviderRefRow
        labelId="settings.modelCapability.imageGeneration.provider.title"
        descriptionId="settings.modelCapability.imageGeneration.provider.description"
        value={entry?.providerRef ?? ""}
        options={providerOptions}
        onSave={handleProviderRefSave}
        testIdValue="image-generation"
      />
      <CapabilityTextValueRow
        labelId="settings.modelCapability.imageGeneration.model.title"
        placeholderId="settings.modelCapability.imageGeneration.model.placeholder"
        value={entry?.modelId ?? ""}
        onSave={handleModelSave}
        testIdValue="image-generation"
      />
      <CapabilityBaseUrlRow
        labelId="settings.modelCapability.imageGeneration.baseUrlOverride.title"
        placeholderId="settings.modelCapability.imageGeneration.baseUrl.placeholder"
        value={entry?.baseUrlOverride ?? ""}
        onSave={handleBaseUrlOverrideSave}
        testIdValue="image-generation"
        datalist={{
          id: IMAGE_GENERATION_BASE_URL_DATALIST_ID,
          values: IMAGE_GENERATION_BASE_URL_PRESETS,
        }}
      />
    </SettingsGroupCard>
  );
}
