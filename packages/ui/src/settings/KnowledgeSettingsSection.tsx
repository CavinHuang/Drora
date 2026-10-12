/**
 * 知识问答设置区块（specs/obsidian-knowledge.md §5d.10）。
 *
 * Jev 出站决策的配置面：决策模型提供商（TypeSafe / OpenRouter / AI Gateway）可选，
 * 每个具名提供商有各自的协议适配——不做「用户自填通用兼容端点」的泛化模式。
 * 开关与端点等走 settingService，API Key 走 credentialService（加密存储，本表单
 * 只写不回显，各提供商独立凭据键）。装配期快照语义——变更重启 Host 后生效；
 * 实际出站仍需 VaultView 内逐 run 用户授权（grant RPC，W05 既有链路）。
 */
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { KNOWLEDGE_JEV_CREDENTIAL_KEY, type KnowledgeJevProvider } from "@drora/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useCredentials } from "@/hooks/useCredentials.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import type { KnowledgeSemanticPortStatus } from "@drora/services";
import { useSettings } from "@/hooks/useSettingService.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import {
  ApiKeyRow,
  REMOTE_PROVIDER_CONFIGS,
  RemoteProviderModelRows,
} from "@/settings/knowledgeSettingsFields.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function KnowledgeSettingsSection() {
  const { intl } = useDroraIntl();
  const { settings, loading: settingsLoading, update } = useSettings();
  const { load, save, delete: deleteCredential } = useCredentials();

  const jevEnabled = settings?.knowledgeJevEnabled === true;
  const provider: KnowledgeJevProvider = settings?.knowledgeJevProvider ?? "typesafe";

  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [savingBaseUrl, setSavingBaseUrl] = useState(false);

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
        trace.complete({ resultSource: "setting_service", stateAfter: enabled ? "enabled" : "disabled" });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      }
    },
    [intl, update],
  );

  const semanticEnabled = settings?.knowledgeSemanticEnabled === true;
  const indexService = useOptionalServices()?.knowledgeIndexService ?? null;
  const [semanticStatus, setSemanticStatus] = useState<KnowledgeSemanticPortStatus | null>(null);
  const [modelDownloading, setModelDownloading] = useState(false);

  // 状态面轮询（spec §5b.9）：开启时取一次；下载中每 1.5s 跟进直到落定。
  useEffect(() => {
    if (!semanticEnabled || !indexService) return;
    let cancelled = false;
    const refresh = async (): Promise<boolean> => {
      try {
        const status = await indexService.getSemanticStatus();
        if (!cancelled) setSemanticStatus(status);
        return status.state === "downloading";
      } catch {
        return false;
      }
    };
    void refresh().then((downloading) => {
      if (!downloading) return;
      const timer = setInterval(() => {
        void refresh().then((still) => {
          if (!still) {
            clearInterval(timer);
            setModelDownloading(false);
          }
        });
      }, 1500);
      return () => clearInterval(timer);
    });
    return () => {
      cancelled = true;
    };
  }, [semanticEnabled, indexService, modelDownloading]);

  const handleDownloadModel = useCallback(async () => {
    if (!indexService) return;
    const trace = startUserAction({
      featureId: "settings.knowledge",
      action: "download_semantic_model",
      trigger: "button",
    });
    setModelDownloading(true);
    try {
      const result = await indexService.downloadSemanticModel();
      if (result.error) {
        setSemanticStatus((previous) =>
          previous ? { ...previous, state: "failed", lastError: result.error } : previous,
        );
        toast(intl.formatMessage({ id: "settings.knowledge.semantic.download.failed" }));
        trace.fail({ failureStage: "model_download" });
        return;
      }
      trace.complete({ resultSource: "authority_ack" });
    } catch (error) {
      trace.fail({ failureStage: "model_download" });
      throw error;
    }
  }, [indexService, intl]);

  const handleSemanticChange = useCallback(
    async (enabled: boolean) => {
      const trace = startUserAction({
        featureId: "settings.knowledge",
        action: "toggle_knowledge_semantic",
        trigger: "switch",
      });
      try {
        await update({ knowledgeSemanticEnabled: enabled });
        toast(intl.formatMessage({ id: "settings.knowledge.toggle.saved" }));
        trace.complete({
          resultSource: "setting_service",
          stateAfter: enabled ? "enabled" : "disabled",
          requiresRestart: true,
        });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      }
    },
    [intl, update],
  );

  const handleProviderChange = useCallback(
    async (next: KnowledgeJevProvider) => {
      const trace = startUserAction({
        featureId: "settings.knowledge",
        action: "change_knowledge_jev_provider",
        trigger: "select",
      });
      try {
        await update({ knowledgeJevProvider: next });
        toast(intl.formatMessage({ id: "settings.knowledge.toggle.saved" }));
        trace.complete({ resultSource: "setting_service" });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      }
    },
    [intl, update],
  );

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
            label={intl.formatMessage({ id: "settings.knowledge.semantic.title" })}
            description={intl.formatMessage({ id: "settings.knowledge.semantic.description" })}
            control={
              <Switch
                aria-label={intl.formatMessage({ id: "settings.knowledge.semantic.title" })}
                checked={semanticEnabled}
                disabled={settingsLoading}
                onCheckedChange={(checked) => void handleSemanticChange(checked)}
              />
            }
            detail={
              semanticEnabled ? (
                <div className="flex items-center gap-2">
                  {(() => {
                    const state = semanticStatus?.state ?? "model_missing";
                    const failed = state === "failed";
                    const stateId = failed
                      ? "settings.knowledge.semantic.status.failed"
                      : state === "downloading"
                        ? "settings.knowledge.semantic.status.downloading"
                        : state === "ready"
                          ? "settings.knowledge.semantic.status.ready"
                          : "settings.knowledge.semantic.status.modelMissing";
                    return (
                      <>
                        <span className={failed ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                          {intl.formatMessage({ id: stateId })}
                        </span>
                        {(state === "model_missing" || failed) && !modelDownloading ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDownloadModel()}
                          >
                            {intl.formatMessage({
                              id: failed
                                ? "settings.knowledge.semantic.download.retry"
                                : "settings.knowledge.semantic.download.action",
                            })}
                          </Button>
                        ) : null}
                        {state === "downloading" || modelDownloading ? (
                          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : undefined
            }
          />
          <SettingsRow
            label={intl.formatMessage({ id: "settings.knowledge.provider.title" })}
            description={intl.formatMessage({ id: "settings.knowledge.provider.description" })}
            control={
              <Select
                value={provider}
                onValueChange={(value) => {
                  if (value === "typesafe" || value === "openrouter" || value === "ai-gateway") {
                    void handleProviderChange(value);
                  }
                }}
              >
                <SelectTrigger
                  className="w-56"
                  aria-label={intl.formatMessage({ id: "settings.knowledge.provider.title" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start" side="bottom" sideOffset={4}>
                  <SelectItem value="typesafe">
                    {intl.formatMessage({ id: "settings.knowledge.provider.typesafe" })}
                  </SelectItem>
                  <SelectItem value="openrouter">
                    {intl.formatMessage({ id: "settings.knowledge.provider.openrouter" })}
                  </SelectItem>
                  <SelectItem value="ai-gateway">
                    {intl.formatMessage({ id: "settings.knowledge.provider.aiGateway" })}
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />
          {provider === "typesafe" ? (
            <>
              <ApiKeyRow
                credentialKey={KNOWLEDGE_JEV_CREDENTIAL_KEY}
                titleId="settings.knowledge.apiKey.title"
                descriptionId="settings.knowledge.apiKey.description"
                load={load}
                save={save}
                deleteCredential={deleteCredential}
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
            </>
          ) : (
            <>
              <ApiKeyRow
                credentialKey={REMOTE_PROVIDER_CONFIGS[provider].credentialKey}
                titleId={REMOTE_PROVIDER_CONFIGS[provider].apiKeyTitleId}
                descriptionId="settings.knowledge.apiKey.description"
                load={load}
                save={save}
                deleteCredential={deleteCredential}
              />
              <RemoteProviderModelRows
                config={REMOTE_PROVIDER_CONFIGS[provider]}
                update={update as (patch: Record<string, string>) => Promise<void>}
              />
            </>
          )}
        </SettingsGroupCard>
        <p className="text-muted-foreground text-xs">
          {intl.formatMessage({ id: "settings.knowledge.restartHint" })}
        </p>
      </section>
    </div>
  );
}
