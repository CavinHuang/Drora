/**
 * 知识问答设置的字段级组件与配置（从 KnowledgeSettingsSection 拆出，收口 max-lines 门禁）。
 * 详见 specs/obsidian-knowledge.md §5d.10：三类提供商共用 systemOne 线协议，远程提供商
 * （OpenRouter / AI Gateway）差异在凭据键/设置字段/端点 baseURL，集中在
 * REMOTE_PROVIDER_CONFIGS 单一出处。
 */
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  KNOWLEDGE_JEV_AI_GATEWAY_CREDENTIAL_KEY,
  KNOWLEDGE_JEV_OPENROUTER_CREDENTIAL_KEY,
  type KnowledgeJevProvider,
} from "@drora/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";

export interface Credentials {
  load: (key: string) => Promise<string | null>;
  save: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

/** 单个提供商 API Key 的「存在性」状态（明文永不回流 renderer 状态）。 */
export function useApiKeyPresence(key: string, load: Credentials["load"]) {
  const [present, setPresent] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void load(key)
      .then((value) => {
        if (!cancelled) setPresent(Boolean(value?.trim()));
      })
      .catch((error) => {
        logger.warn("[knowledge-settings] 读取 Jev 凭据存在性失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setPresent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, load]);
  return [present, setPresent] as const;
}

/** 远程具名提供商（OpenRouter / AI Gateway）的表单配置（凭据键/设置字段/i18n）。 */
export interface RemoteProviderFieldConfig {
  provider: Exclude<KnowledgeJevProvider, "typesafe">;
  credentialKey: string;
  modelSetting: "knowledgeJevOpenrouterModel" | "knowledgeJevAiGatewayModel";
  baseUrlSetting: "knowledgeJevOpenrouterBaseUrl" | "knowledgeJevAiGatewayBaseUrl";
  apiKeyTitleId: string;
}

export const REMOTE_PROVIDER_CONFIGS: Record<
  "openrouter" | "ai-gateway",
  RemoteProviderFieldConfig
> = {
  openrouter: {
    provider: "openrouter",
    credentialKey: KNOWLEDGE_JEV_OPENROUTER_CREDENTIAL_KEY,
    modelSetting: "knowledgeJevOpenrouterModel",
    baseUrlSetting: "knowledgeJevOpenrouterBaseUrl",
    apiKeyTitleId: "settings.knowledge.openrouterApiKey.title",
  },
  "ai-gateway": {
    provider: "ai-gateway",
    credentialKey: KNOWLEDGE_JEV_AI_GATEWAY_CREDENTIAL_KEY,
    modelSetting: "knowledgeJevAiGatewayModel",
    baseUrlSetting: "knowledgeJevAiGatewayBaseUrl",
    apiKeyTitleId: "settings.knowledge.aiGatewayApiKey.title",
  },
};

/** API Key 行：密码输入 + 保存（留空保存即删除），不回显明文。 */
export function ApiKeyRow({
  credentialKey,
  titleId,
  descriptionId,
  load,
  save,
  deleteCredential,
  refreshConfig,
}: {
  credentialKey: string;
  titleId: string;
  descriptionId: string;
  load: Credentials["load"];
  save: Credentials["save"];
  deleteCredential: Credentials["delete"];
  /** Jev 配置热生效（§5d.10）：Key 变更后触发决策配置重解析。 */
  refreshConfig?: () => Promise<unknown>;
}) {
  const { intl } = useDroraIntl();
  const [present, setPresent] = useApiKeyPresence(credentialKey, load);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const trace = startUserAction({
      featureId: "settings.knowledge",
      action: "save_knowledge_jev_api_key",
      trigger: "button",
    });
    setSaving(true);
    try {
      const normalized = draft.trim();
      if (normalized) {
        await save(credentialKey, normalized);
        setPresent(true);
      } else {
        await deleteCredential(credentialKey);
        setPresent(false);
      }
      setDraft("");
      await refreshConfig?.(); // Key 变更热生效（§5d.10）
      toast(intl.formatMessage({ id: "settings.knowledge.apiKey.saved" }));
      trace.complete({ resultSource: "authority_ack", configured: normalized.length > 0 });
    } catch (error) {
      trace.fail({ failureStage: "credential_write" });
      logger.warn("[knowledge-settings] 保存 Jev API Key 失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "settings.knowledge.apiKey.saveFailed" }));
    } finally {
      setSaving(false);
    }
  }, [credentialKey, deleteCredential, draft, intl, save, setPresent]);

  return (
    <SettingsRow
      label={intl.formatMessage({ id: titleId })}
      description={intl.formatMessage({ id: descriptionId })}
      control={
        <div className="flex items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            className="w-56"
            placeholder={intl.formatMessage({ id: "settings.knowledge.apiKey.placeholder" })}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage({ id: "settings.knowledge.apiKey.save" })}
          </Button>
        </div>
      }
      detail={
        present === null ? undefined : (
          <div className="text-muted-foreground text-xs">
            {intl.formatMessage({
              id: present
                ? "settings.knowledge.apiKey.configured"
                : "settings.knowledge.apiKey.notConfigured",
            })}
          </div>
        )
      }
    />
  );
}

/** 远程提供商（OpenRouter / AI Gateway）的模型别名与端点 baseURL 行（均必填）。 */
export function RemoteProviderModelRows({
  config,
  update,
  refreshConfig,
}: {
  config: RemoteProviderFieldConfig;
  update: (patch: Record<string, string>) => Promise<void>;
  /** Jev 配置热生效（§5d.10）：模型/端点变更后触发决策配置重解析。 */
  refreshConfig?: () => Promise<unknown>;
}) {
  const { intl } = useDroraIntl();
  const { settings } = useSettings();
  const [modelDraft, setModelDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [saving, setSaving] = useState<"model" | "baseUrl" | null>(null);

  useEffect(() => {
    setModelDraft(settings?.[config.modelSetting] ?? "");
  }, [config.modelSetting, settings]);
  useEffect(() => {
    setBaseUrlDraft(settings?.[config.baseUrlSetting] ?? "");
  }, [config.baseUrlSetting, settings]);

  const handleSave = useCallback(
    async (field: "model" | "baseUrl") => {
      const trace = startUserAction({
        featureId: "settings.knowledge",
        action: "save_knowledge_jev_base_url",
        trigger: "button",
      });
      setSaving(field);
      try {
        if (field === "model") {
          const normalized = modelDraft.trim();
          await update({ [config.modelSetting]: normalized });
          setModelDraft(normalized);
          await refreshConfig?.(); // 配置热生效（§5d.10）
          toast(intl.formatMessage({ id: "settings.knowledge.model.saved" }));
        } else {
          // 清空传空串 = 回落该提供商内置默认端点（§5d.10）。
          const normalized = baseUrlDraft.trim();
          await update({ [config.baseUrlSetting]: normalized });
          setBaseUrlDraft(normalized);
          await refreshConfig?.(); // 配置热生效（§5d.10）
          toast(intl.formatMessage({ id: "settings.knowledge.baseUrl.saved" }));
        }
        trace.complete({ resultSource: "setting_service", requiresRestart: true });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      } finally {
        setSaving(null);
      }
    },
    [baseUrlDraft, config, intl, modelDraft, update],
  );

  const saveButton = (field: "model" | "baseUrl", savingNow: boolean) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={saving !== null}
      onClick={() => void handleSave(field)}
    >
      {savingNow ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {intl.formatMessage({ id: "settings.knowledge.baseUrl.save" })}
    </Button>
  );

  return (
    <>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.knowledge.model.title" })}
        description={intl.formatMessage({ id: "settings.knowledge.model.description" })}
        control={
          <div className="flex items-center gap-2">
            <Input
              type="text"
              className="w-56"
              placeholder={intl.formatMessage({ id: "settings.knowledge.model.placeholder" })}
              value={modelDraft}
              onChange={(event) => setModelDraft(event.target.value)}
            />
            {saveButton("model", saving === "model")}
          </div>
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.knowledge.remoteBaseUrl.title" })}
        description={intl.formatMessage({ id: "settings.knowledge.remoteBaseUrl.description" })}
        control={
          <div className="flex items-center gap-2">
            <Input
              type="text"
              className="w-56"
              placeholder={intl.formatMessage({ id: "settings.knowledge.remoteBaseUrl.placeholder" })}
              value={baseUrlDraft}
              onChange={(event) => setBaseUrlDraft(event.target.value)}
            />
            {saveButton("baseUrl", saving === "baseUrl")}
          </div>
        }
      />
    </>
  );
}
