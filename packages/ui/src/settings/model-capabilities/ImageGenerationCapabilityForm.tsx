/**
 * 「图像生成」（image-generation）条目表单（specs/model-capabilities.md §5.1 字段表）。
 *
 * 开关 + baseUrl（含常用预设 datalist：OpenAI / 智谱开放平台 / 自填）+ 模型 id +
 * ApiKeyInput。本批仅落档案配置面（schema 已随批次一交付）；工具链路（generate_image
 * 工具 + Host 画图服务）属批次三。生效语义：即时（每次工具调用经反向 RPC 取快照）。
 * baseUrl 校验同连接区模式（https 强制，本机明文例外）；enabled=true 时 baseUrl/modelId
 * 必填的 fail-closed 判定在消费方（Host 画图服务），表单不重复实现。
 */
import { useCallback, useState } from "react";
import { modelCapabilityCredentialKey } from "@drora/shared";
import { TID_MODEL_CAPABILITY_TOGGLE, testId } from "@drora/shared/test-ids";
import { Switch } from "@/components/ui/switch.js";
import { useServices } from "@/hooks/useServices.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import {
  CapabilityApiKeyRow,
  CapabilityBaseUrlRow,
  CapabilityTextValueRow,
  useCredentialPresence,
} from "./CapabilityFormParts.js";

/** baseUrl 常用预设（datalist 仅输入建议；OQ-1 datalist 终审在批次三，先按 §5.1 两组落）。 */
const IMAGE_GENERATION_BASE_URL_PRESETS = [
  "https://api.openai.com/v1",
  "https://open.bigmodel.cn/api/paas/v4",
] as const;
const IMAGE_GENERATION_BASE_URL_DATALIST_ID = "model-capability-image-base-url-presets";

export function ImageGenerationCapabilityForm() {
  const { intl } = useDroraIntl();
  const { capabilities, update } = useModelCapabilities();
  const { credentialService } = useServices();
  const entry = capabilities?.["image-generation"] ?? null;

  const loadCredential = useCallback(
    () => credentialService.load(modelCapabilityCredentialKey.imageGeneration),
    [credentialService],
  );
  const [credentialPresent, setCredentialPresent] = useCredentialPresence(loadCredential);
  const [savingCredential, setSavingCredential] = useState(false);

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

  const handleBaseUrlSave = useCallback(
    (baseUrl: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_image_generation_base_url",
        trigger: "button", // 输入落盘动作照 save_http_proxy 先例记 button
      });
      void update({ capabilities: { "image-generation": { baseUrl } } })
        .then(() => {
          trace.complete({ resultSource: "setting_service", configured: baseUrl.length > 0 });
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

  const handleCredentialSave = useCallback(
    async (value: string) => {
      setSavingCredential(true);
      try {
        await update({
          credentials: { imageGeneration: value.length > 0 ? value : null },
        });
        setCredentialPresent(value.trim().length > 0);
      } finally {
        setSavingCredential(false);
      }
    },
    [setCredentialPresent, update],
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
      <CapabilityBaseUrlRow
        labelId="settings.modelCapability.imageGeneration.baseUrl.title"
        placeholderId="settings.modelCapability.imageGeneration.baseUrl.placeholder"
        value={entry?.baseUrl ?? ""}
        onSave={handleBaseUrlSave}
        testIdValue="image-generation"
        datalist={{
          id: IMAGE_GENERATION_BASE_URL_DATALIST_ID,
          values: IMAGE_GENERATION_BASE_URL_PRESETS,
        }}
      />
      <CapabilityTextValueRow
        labelId="settings.modelCapability.imageGeneration.model.title"
        placeholderId="settings.modelCapability.imageGeneration.model.placeholder"
        value={entry?.modelId ?? ""}
        onSave={handleModelSave}
        testIdValue="image-generation"
      />
      <CapabilityApiKeyRow
        credentialLabel={intl.formatMessage({
          id: "settings.modelCapability.imageGeneration.apiKey.title",
        })}
        descriptionId="settings.modelCapability.imageGeneration.apiKey.description"
        present={credentialPresent}
        saving={savingCredential}
        onSave={handleCredentialSave}
        actionName="save_image_generation_api_key"
      />
    </SettingsGroupCard>
  );
}
