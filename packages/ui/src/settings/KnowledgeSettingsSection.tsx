/**
 * 知识问答设置区块（specs/obsidian-knowledge.md §5d.10）。
 *
 * Jev 出站决策的配置面：决策模型提供商（TypeSafe / OpenAI 兼容端点）可选，
 * 开关与端点等走 settingService，API Key 走 credentialService（加密存储，本表单
 * 只写不回显，两个提供商各自独立凭据键）。装配期快照语义——变更重启 Host 后生效；
 * 实际出站仍需 VaultView 内逐 run 用户授权（grant RPC，W05 既有链路）。
 */
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  KNOWLEDGE_JEV_CREDENTIAL_KEY,
  KNOWLEDGE_JEV_OPENAI_CREDENTIAL_KEY,
  type KnowledgeJevProvider,
} from "@drora/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useCredentials } from "@/hooks/useCredentials.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

/** 单个提供商 API Key 的「存在性」状态（明文永不回流 renderer 状态）。 */
function useApiKeyPresence(key: string, load: (key: string) => Promise<string | null>) {
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

export function KnowledgeSettingsSection() {
  const { intl } = useDroraIntl();
  const { settings, loading: settingsLoading, update } = useSettings();
  const { load, save, delete: deleteCredential } = useCredentials();

  const jevEnabled = settings?.knowledgeJevEnabled === true;
  const provider: KnowledgeJevProvider = settings?.knowledgeJevProvider ?? "typesafe";
  const apiKeyRow = useApiKeyPresence(KNOWLEDGE_JEV_CREDENTIAL_KEY, load);
  const openaiApiKeyRow = useApiKeyPresence(KNOWLEDGE_JEV_OPENAI_CREDENTIAL_KEY, load);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [openaiApiKeyDraft, setOpenaiApiKeyDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("");
  const [openaiBaseUrlDraft, setOpenaiBaseUrlDraft] = useState("");
  const [openaiModelDraft, setOpenaiModelDraft] = useState("");
  const [savingKey, setSavingKey] = useState<"typesafe" | "openai" | null>(null);
  const [savingBaseUrl, setSavingBaseUrl] = useState(false);
  const [savingOpenaiField, setSavingOpenaiField] = useState(false);

  useEffect(() => {
    setBaseUrlDraft(settings?.knowledgeJevBaseUrl ?? "");
  }, [settings?.knowledgeJevBaseUrl]);
  useEffect(() => {
    setOpenaiBaseUrlDraft(settings?.knowledgeJevOpenaiBaseUrl ?? "");
  }, [settings?.knowledgeJevOpenaiBaseUrl]);
  useEffect(() => {
    setOpenaiModelDraft(settings?.knowledgeJevOpenaiModel ?? "");
  }, [settings?.knowledgeJevOpenaiModel]);

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

  const saveApiKey = useCallback(
    async (which: "typesafe" | "openai") => {
      const credentialKey = which === "openai" ? KNOWLEDGE_JEV_OPENAI_CREDENTIAL_KEY : KNOWLEDGE_JEV_CREDENTIAL_KEY;
      const draft = which === "openai" ? openaiApiKeyDraft : apiKeyDraft;
      const setDraft = which === "openai" ? setOpenaiApiKeyDraft : setApiKeyDraft;
      const setPresent = which === "openai" ? openaiApiKeyRow[1] : apiKeyRow[1];
      const trace = startUserAction({
        featureId: "settings.knowledge",
        action: "save_knowledge_jev_api_key",
        trigger: "button",
      });
      setSavingKey(which);
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
        toast(intl.formatMessage({ id: "settings.knowledge.apiKey.saved" }));
        trace.complete({ resultSource: "authority_ack", configured: normalized.length > 0 });
      } catch (error) {
        trace.fail({ failureStage: "credential_write" });
        logger.warn("[knowledge-settings] 保存 Jev API Key 失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        toast(intl.formatMessage({ id: "settings.knowledge.apiKey.saveFailed" }));
      } finally {
        setSavingKey(null);
      }
    },
    [apiKeyDraft, apiKeyRow, deleteCredential, intl, openaiApiKeyDraft, openaiApiKeyRow, save],
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

  const saveOpenaiField = useCallback(
    async (field: "baseUrl" | "model") => {
      const trace = startUserAction({
        featureId: "settings.knowledge",
        action: "save_knowledge_jev_base_url",
        trigger: "button",
      });
      setSavingOpenaiField(true);
      try {
        if (field === "baseUrl") {
          // 清空必须传空串（RPC 丢 undefined）——openai 兼容端点必填，空=该提供商禁用。
          const normalized = openaiBaseUrlDraft.trim();
          await update({ knowledgeJevOpenaiBaseUrl: normalized });
          setOpenaiBaseUrlDraft(normalized);
          toast(intl.formatMessage({ id: "settings.knowledge.baseUrl.saved" }));
        } else {
          const normalized = openaiModelDraft.trim();
          await update({ knowledgeJevOpenaiModel: normalized });
          setOpenaiModelDraft(normalized);
          toast(intl.formatMessage({ id: "settings.knowledge.openaiModel.saved" }));
        }
        trace.complete({ resultSource: "setting_service", requiresRestart: true });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      } finally {
        setSavingOpenaiField(false);
      }
    },
    [intl, openaiBaseUrlDraft, openaiModelDraft, update],
  );

  const apiKeySaveButton = (which: "typesafe" | "openai") => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={savingKey !== null}
      onClick={() => void saveApiKey(which)}
    >
      {savingKey === which ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : null}
      {intl.formatMessage({ id: "settings.knowledge.apiKey.save" })}
    </Button>
  );

  const presenceText = (present: boolean | null) =>
    present === null ? undefined : (
      <div className="text-muted-foreground text-xs">
        {intl.formatMessage({
          id: present
            ? "settings.knowledge.apiKey.configured"
            : "settings.knowledge.apiKey.notConfigured",
        })}
      </div>
    );

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
            label={intl.formatMessage({ id: "settings.knowledge.provider.title" })}
            description={intl.formatMessage({ id: "settings.knowledge.provider.description" })}
            control={
              <Select
                value={provider}
                onValueChange={(value) => {
                  if (value === "typesafe" || value === "openai-compatible") {
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
                  <SelectItem value="openai-compatible">
                    {intl.formatMessage({ id: "settings.knowledge.provider.openaiCompatible" })}
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />
          {provider === "typesafe" ? (
            <>
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
                    {apiKeySaveButton("typesafe")}
                  </div>
                }
                detail={presenceText(apiKeyRow[0])}
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
              <SettingsRow
                label={intl.formatMessage({ id: "settings.knowledge.openaiApiKey.title" })}
                description={intl.formatMessage({ id: "settings.knowledge.openaiApiKey.description" })}
                control={
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      className="w-56"
                      placeholder={intl.formatMessage({ id: "settings.knowledge.apiKey.placeholder" })}
                      value={openaiApiKeyDraft}
                      onChange={(event) => setOpenaiApiKeyDraft(event.target.value)}
                    />
                    {apiKeySaveButton("openai")}
                  </div>
                }
                detail={presenceText(openaiApiKeyRow[0])}
              />
              <SettingsRow
                label={intl.formatMessage({ id: "settings.knowledge.openaiBaseUrl.title" })}
                description={intl.formatMessage({ id: "settings.knowledge.openaiBaseUrl.description" })}
                control={
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      className="w-56"
                      placeholder={intl.formatMessage({ id: "settings.knowledge.openaiBaseUrl.placeholder" })}
                      value={openaiBaseUrlDraft}
                      onChange={(event) => setOpenaiBaseUrlDraft(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={savingOpenaiField}
                      onClick={() => void saveOpenaiField("baseUrl")}
                    >
                      {savingOpenaiField ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {intl.formatMessage({ id: "settings.knowledge.baseUrl.save" })}
                    </Button>
                  </div>
                }
              />
              <SettingsRow
                label={intl.formatMessage({ id: "settings.knowledge.openaiModel.title" })}
                description={intl.formatMessage({ id: "settings.knowledge.openaiModel.description" })}
                control={
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      className="w-56"
                      placeholder={intl.formatMessage({ id: "settings.knowledge.openaiModel.placeholder" })}
                      value={openaiModelDraft}
                      onChange={(event) => setOpenaiModelDraft(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={savingOpenaiField}
                      onClick={() => void saveOpenaiField("model")}
                    >
                      {savingOpenaiField ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {intl.formatMessage({ id: "settings.knowledge.openaiModel.save" })}
                    </Button>
                  </div>
                }
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
