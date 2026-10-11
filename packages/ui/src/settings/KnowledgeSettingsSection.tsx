/**
 * 知识问答设置区块（specs/obsidian-knowledge.md §5d.10）。
 *
 * Jev 出站决策的配置面：开关与端点走 settingService，API Key 走 credentialService
 * （加密存储，本表单只写不回显）。装配期快照语义——变更重启 Host 后生效；
 * 实际出站仍需 VaultView 内逐 run 用户授权（grant RPC，W05 既有链路）。
 */
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { KNOWLEDGE_JEV_CREDENTIAL_KEY } from "@drora/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useCredentials } from "@/hooks/useCredentials.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function KnowledgeSettingsSection() {
  const { intl } = useDroraIntl();
  const { settings, loading: settingsLoading, update } = useSettings();
  const { load, save, delete: deleteCredential } = useCredentials();

  const jevEnabled = settings?.knowledgeJevEnabled === true;
  // API Key 只暴露「是否已配置」；明文永不回流 renderer 状态。
  const [apiKeyPresent, setApiKeyPresent] = useState<boolean | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savingBaseUrl, setSavingBaseUrl] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void load(KNOWLEDGE_JEV_CREDENTIAL_KEY)
      .then((value) => {
        if (!cancelled) setApiKeyPresent(Boolean(value?.trim()));
      })
      .catch((error) => {
        logger.warn("[knowledge-settings] 读取 Jev 凭据存在性失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setApiKeyPresent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    setBaseUrlDraft(settings?.knowledgeJevBaseUrl ?? "");
  }, [settings?.knowledgeJevBaseUrl]);

  const handleEnabledChange = useCallback(
    async (enabled: boolean) => {
      const trace = startUserAction({
        featureId: "settings.knowledge",
        action: "toggle_knowledge_jev",
        trigger: "switch",
      });
      try {
        await update({ knowledgeJevEnabled: enabled });
        toast(intl.formatMessage({ id: "settings.knowledge.toggle.saved" }));
        trace.complete({
          resultSource: "setting_service",
          stateAfter: enabled ? "enabled" : "disabled",
        });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      }
    },
    [intl, update],
  );

  const handleSaveApiKey = useCallback(async () => {
    const trace = startUserAction({
      featureId: "settings.knowledge",
      action: "save_knowledge_jev_api_key",
      trigger: "button",
    });
    setSavingKey(true);
    try {
      const normalized = apiKeyDraft.trim();
      if (normalized) {
        await save(KNOWLEDGE_JEV_CREDENTIAL_KEY, normalized);
        setApiKeyPresent(true);
      } else {
        await deleteCredential(KNOWLEDGE_JEV_CREDENTIAL_KEY);
        setApiKeyPresent(false);
      }
      setApiKeyDraft("");
      toast(intl.formatMessage({ id: "settings.knowledge.apiKey.saved" }));
      trace.complete({ resultSource: "authority_ack", configured: normalized.length > 0 });
    } catch (error) {
      trace.fail({ failureStage: "credential_write" });
      logger.warn("[knowledge-settings] 保存 Jev API Key 失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "settings.knowledge.apiKey.saveFailed" }));
    } finally {
      setSavingKey(false);
    }
  }, [apiKeyDraft, deleteCredential, intl, save]);

  const handleSaveBaseUrl = useCallback(async () => {
    const trace = startUserAction({
      featureId: "settings.knowledge",
      action: "save_knowledge_jev_base_url",
      trigger: "button",
    });
    setSavingBaseUrl(true);
    try {
      // 清空必须传空串（RPC 丢 undefined），由装配层回落官方默认端点。
      const normalized = baseUrlDraft.trim();
      await update({ knowledgeJevBaseUrl: normalized });
      setBaseUrlDraft(normalized);
      toast(intl.formatMessage({ id: "settings.knowledge.baseUrl.saved" }));
      trace.complete({
        resultSource: "setting_service",
        configured: normalized.length > 0,
        requiresRestart: true,
      });
    } catch (error) {
      trace.fail({ failureStage: "setting_update" });
      throw error;
    } finally {
      setSavingBaseUrl(false);
    }
  }, [baseUrlDraft, intl, update]);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SettingsGroupCard>
          <SettingsRow
            label={intl.formatMessage({ id: "settings.knowledge.jev.title" })}
            description={intl.formatMessage({ id: "settings.knowledge.jev.description" })}
            control={
              <Switch
                aria-label={intl.formatMessage({ id: "settings.knowledge.jev.title" })}
                checked={jevEnabled}
                disabled={settingsLoading}
                onCheckedChange={(checked) => void handleEnabledChange(checked)}
              />
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.knowledge.apiKey.title" })}
            description={intl.formatMessage({ id: "settings.knowledge.apiKey.description" })}
            control={
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  className="w-56"
                  placeholder={intl.formatMessage({ id: "settings.knowledge.apiKey.placeholder" })}
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingKey}
                  onClick={() => void handleSaveApiKey()}
                >
                  {savingKey ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {intl.formatMessage({ id: "settings.knowledge.apiKey.save" })}
                </Button>
              </div>
            }
            detail={
              apiKeyPresent === null ? undefined : (
                <div className="text-muted-foreground text-xs">
                  {intl.formatMessage({
                    id: apiKeyPresent
                      ? "settings.knowledge.apiKey.configured"
                      : "settings.knowledge.apiKey.notConfigured",
                  })}
                </div>
              )
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.knowledge.baseUrl.title" })}
            description={intl.formatMessage({ id: "settings.knowledge.baseUrl.description" })}
            control={
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  className="w-56"
                  placeholder={intl.formatMessage({ id: "settings.knowledge.baseUrl.placeholder" })}
                  value={baseUrlDraft}
                  onChange={(event) => setBaseUrlDraft(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingBaseUrl}
                  onClick={() => void handleSaveBaseUrl()}
                >
                  {savingBaseUrl ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {intl.formatMessage({ id: "settings.knowledge.baseUrl.save" })}
                </Button>
              </div>
            }
          />
        </SettingsGroupCard>
        <p className="text-muted-foreground text-xs">
          {intl.formatMessage({ id: "settings.knowledge.restartHint" })}
        </p>
      </section>
    </div>
  );
}
