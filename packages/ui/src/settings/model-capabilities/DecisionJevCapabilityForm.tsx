/**
 * 「知识评分」（decision-jev）条目表单（specs/model-capabilities.md §5.1 字段表）。
 *
 * 自 KnowledgeSettingsSection 迁入的配置面（Jev 开关/提供商/端点/模型/Key/连接测试），
 * 数据源从 AppSettings knowledgeJev* 旧键切到模型能力档案（spec §3.3 迁移后旧键删除）：
 * - 开关/提供商/baseUrl/modelId 走档案 update 的 capabilities 面；
 * - API Key 按提供商分键（modelCapabilityCredentialKey.decisionJev(kind)），走
 *   credentials 面（留空保存即删除，明文不回显）；
 * - 生效语义如实标注：即时（下一次检索决策 stage；写后调 refreshDecisionConfig
 *   置空签名，确定性热路径与旧表单一致）；
 * - 连接测试沿用 testJevConnection RPC 与结果分类文案（Host 经档案动态源取当前装配）。
 */
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  KNOWLEDGE_JEV_PROVIDERS,
  modelCapabilityCredentialKey,
  type KnowledgeJevProvider,
} from "@drora/shared";
import {
  TID_MODEL_CAPABILITY_TEST_CONNECTION_BUTTON,
  TID_MODEL_CAPABILITY_TOGGLE,
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
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
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

const PROVIDER_LABEL_IDS: Record<KnowledgeJevProvider, string> = {
  typesafe: "settings.modelCapability.decisionJev.provider.typesafe",
  openrouter: "settings.modelCapability.decisionJev.provider.openrouter",
  "ai-gateway": "settings.modelCapability.decisionJev.provider.aiGateway",
};

export function DecisionJevCapabilityForm() {
  const { intl } = useDroraIntl();
  const { capabilities, update } = useModelCapabilities();
  const services = useServices();
  const indexService = services.knowledgeIndexService ?? null;
  const entry = capabilities?.["decision-jev"] ?? null;
  const provider: KnowledgeJevProvider = entry?.providerKind ?? "typesafe";
  const credentialKey = modelCapabilityCredentialKey.decisionJev(provider);
  const loadCredential = useCallback(
    () => services.credentialService.load(credentialKey),
    [services.credentialService, credentialKey],
  );
  const [credentialPresent, setCredentialPresent] = useCredentialPresence(loadCredential);
  const [savingCredential, setSavingCredential] = useState(false);

  /** 写档案 + 确定性热路径（refreshDecisionConfig 置空 Jev 签名清缓存）。 */
  const persistWithHotRefresh = useCallback(
    async (patch: {
      enabled?: boolean;
      providerKind?: KnowledgeJevProvider;
      baseUrl?: string;
      modelId?: string;
    }) => {
      await update({ capabilities: { "decision-jev": patch } });
      await indexService?.refreshDecisionConfig();
      toast(intl.formatMessage({ id: "settings.modelCapability.saved" }));
    },
    [indexService, intl, update],
  );

  const handleEnabledChange = useCallback(
    async (enabled: boolean) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "toggle_decision_jev",
        trigger: "switch",
      });
      try {
        await persistWithHotRefresh({ enabled });
        trace.complete({
          resultSource: "setting_service",
          stateAfter: enabled ? "enabled" : "disabled",
        });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      }
    },
    [persistWithHotRefresh],
  );

  const handleProviderChange = useCallback(
    async (next: KnowledgeJevProvider) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "change_decision_jev_provider",
        trigger: "select",
      });
      try {
        // 三供应商共用一对 baseUrl/modelId 档案字段（spec §3.2）；切换只改
        // providerKind，端点/模型保持现值由用户按需调整——与迁移映射语义一致。
        await persistWithHotRefresh({ providerKind: next });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      }
    },
    [persistWithHotRefresh],
  );

  const handleBaseUrlSave = useCallback(
    (baseUrl: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_decision_jev_base_url",
        trigger: "button", // 输入落盘动作照 save_http_proxy 先例记 button
      });
      // 清空保存 = 回落该提供商内置默认端点（照旧表单语义）。
      void persistWithHotRefresh({ baseUrl })
        .then(() => {
          trace.complete({ resultSource: "setting_service", configured: baseUrl.length > 0 });
        })
        .catch((error: unknown) => {
          trace.fail({ failureStage: "setting_update" });
          void error;
        });
    },
    [persistWithHotRefresh],
  );

  const handleModelSave = useCallback(
    (modelId: string) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "save_decision_jev_model",
        trigger: "button",
      });
      void persistWithHotRefresh({ modelId: modelId.trim() })
        .then(() => {
          trace.complete({ resultSource: "setting_service" });
        })
        .catch((error: unknown) => {
          trace.fail({ failureStage: "setting_update" });
          void error;
        });
    },
    [persistWithHotRefresh],
  );

  const handleCredentialSave = useCallback(
    async (value: string) => {
      setSavingCredential(true);
      try {
        // 留空保存即删除（ApiKeyRow 语义）；按当前 providerKind 分键。
        await update({
          credentials: {
            decisionJev: { providerKind: provider, value: value.length > 0 ? value : null },
          },
        });
        setCredentialPresent(value.trim().length > 0);
        await indexService?.refreshDecisionConfig(); // Key 变更热生效（照旧表单）
      } finally {
        setSavingCredential(false);
      }
    },
    [indexService, provider, setCredentialPresent, update],
  );

  // --- 连接测试（沿用 testJevConnection RPC 与结果分类文案）---
  const [connectionTesting, setConnectionTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    ok: boolean;
    latencyMs: number;
    error: string | null;
  } | null>(null);
  const handleTestConnection = useCallback(async () => {
    if (!indexService) return;
    const trace = startUserAction({
      featureId: "settings.model_capabilities",
      action: "test_decision_jev_connection",
      trigger: "button",
    });
    setConnectionTesting(true);
    setConnectionResult(null);
    try {
      const result = await indexService.testJevConnection();
      setConnectionResult(result);
      if (result.ok) {
        trace.complete({ resultSource: "authority_ack" });
      } else {
        trace.fail({ failureStage: "connection_test" });
      }
    } catch (error) {
      trace.fail({ failureStage: "connection_test" });
      setConnectionResult({
        ok: false,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setConnectionTesting(false);
    }
  }, [indexService]);

  // 切提供商后凭据存在性按新分键重读（useCredentialPresence 依赖 credentialKey）；
  // 连接测试结果属旧装配，同时清空。
  useEffect(() => {
    setConnectionResult(null);
  }, [provider]);

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.modelCapability.decisionJev.enabled.label" })}
        description={intl.formatMessage({
          id: "settings.modelCapability.decisionJev.enabled.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({
              id: "settings.modelCapability.decisionJev.enabled.label",
            })}
            data-testid={testId(TID_MODEL_CAPABILITY_TOGGLE, "decision-jev")}
            checked={entry?.enabled === true}
            onCheckedChange={(checked) => void handleEnabledChange(checked)}
          />
        }
        detail={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={connectionTesting || entry?.enabled !== true}
              onClick={() => void handleTestConnection()}
              data-testid={TID_MODEL_CAPABILITY_TEST_CONNECTION_BUTTON}
            >
              {connectionTesting ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {intl.formatMessage({
                id: "settings.modelCapability.decisionJev.testConnection.action",
              })}
            </Button>
            {connectionResult !== null ? (
              <span
                className={
                  connectionResult.ok
                    ? "text-ui-xs text-foreground-subtle"
                    : "text-ui-xs text-destructive"
                }
              >
                {connectionResult.ok
                  ? `${intl.formatMessage({ id: "settings.modelCapability.decisionJev.testConnection.ok" })} · ${connectionResult.latencyMs}ms`
                  : `${intl.formatMessage({ id: "settings.modelCapability.decisionJev.testConnection.failed" })}：${connectionResult.error ?? ""}`}
              </span>
            ) : null}
          </div>
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.modelCapability.decisionJev.provider.label" })}
        description={intl.formatMessage({
          id: "settings.modelCapability.decisionJev.provider.description",
        })}
        control={
          <Select
            value={provider}
            onValueChange={(value) => {
              if ((KNOWLEDGE_JEV_PROVIDERS as readonly string[]).includes(value)) {
                void handleProviderChange(value as KnowledgeJevProvider);
              }
            }}
          >
            <SelectTrigger
              className="w-56"
              aria-label={intl.formatMessage({
                id: "settings.modelCapability.decisionJev.provider.label",
              })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" side="bottom" sideOffset={4}>
              {KNOWLEDGE_JEV_PROVIDERS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {intl.formatMessage({ id: PROVIDER_LABEL_IDS[kind] })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <CapabilityBaseUrlRow
        labelId="settings.modelCapability.decisionJev.baseUrl.title"
        placeholderId={
          provider === "typesafe"
            ? "settings.modelCapability.decisionJev.baseUrl.placeholder"
            : "settings.modelCapability.decisionJev.remoteBaseUrl.placeholder"
        }
        value={entry?.baseUrl ?? ""}
        onSave={handleBaseUrlSave}
        testIdValue="decision-jev"
      />
      {provider !== "typesafe" ? (
        <CapabilityTextValueRow
          labelId="settings.modelCapability.decisionJev.model.title"
          placeholderId="settings.modelCapability.decisionJev.model.placeholder"
          value={entry?.modelId ?? ""}
          onSave={handleModelSave}
          testIdValue="decision-jev"
        />
      ) : null}
      <CapabilityApiKeyRow
        credentialLabel={`${intl.formatMessage({ id: PROVIDER_LABEL_IDS[provider] })}${intl.formatMessage({ id: "settings.modelCapability.apiKey.titleSuffix" })}`}
        descriptionId="settings.modelCapability.decisionJev.apiKey.description"
        present={credentialPresent}
        saving={savingCredential}
        onSave={handleCredentialSave}
        actionName="save_decision_jev_api_key"
      />
    </SettingsGroupCard>
  );
}
