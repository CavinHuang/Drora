/**
 * §15 语音供应商模板行 + 内联 API Key 行（asr/tts 共用；image-generation 不适用）。
 *
 * 社区成熟 UX（specs/model-capabilities.md §15.3）：下拉 = 内置语音供应商模板（host
 * 反查现有卡标注连接态；缺卡自动建，照 LoginApiKeyForm 程序化建卡先例）+ 自定义端点
 * 卡区（§13 行为保留）。Key 录入面内联回本表单，但存储经 persistProviderApiKey 单点
 * 落所选供应商卡（§13 key 双录禁令不破）。本组件不含音色/模型行——厂商变形行由
 * 条目表单按 vendorState.vendor 自组（火山 Select / 其余 datalist）。
 */
import { useCallback, useMemo, useState } from "react";
import { TID_MODEL_CAPABILITY_PROVIDER_SELECT, testId } from "@drora/shared/test-ids";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useServices } from "@/hooks/useServices.js";
import { useProviderSettingsServiceView } from "@/hooks/useProviderSettingsView.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { persistProviderApiKey } from "@/lib/providerApiKeyPersistence.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { CapabilityApiKeyRow } from "./CapabilityFormParts.js";
import {
  resolveVendorLocaleName,
  resolveVoiceVendorForCard,
  VOICE_VENDOR_REGISTRY,
  type VoiceVendorApiKind,
  type VoiceVendorTemplate,
} from "./voiceVendorRegistry.js";

/** 下拉内置模板项的取值前缀（与自定义卡 providerId 值空间隔离）。 */
const VENDOR_KEY_PREFIX = "vendor:";

interface ProviderLike {
  providerId: string;
  providerName?: string | null;
  enabled: boolean;
  effectiveConfig?: {
    api?: { baseUrl?: string | null };
    access?: { type: string; apiKey?: string | null };
  };
}

function hostOf(provider: ProviderLike): string {
  try {
    return new URL(provider.effectiveConfig?.api?.baseUrl ?? "").host;
  } catch {
    return "";
  }
}

function apiKeyOf(provider: ProviderLike): string {
  const access = provider.effectiveConfig?.access;
  return access?.type === "api-key" ? (access.apiKey?.trim() ?? "") : "";
}

export interface VoiceVendorOption {
  key: string;
  vendorId?: string;
  label: string;
  cardExists: boolean;
  keyPresent: boolean;
}

export interface VoiceVendorCardSnapshot {
  providerId: string;
  label: string;
  baseUrl: string;
  /** 出站/试听用（明文）；本组件只透传给适配器，零日志零回显。 */
  apiKey: string;
}

export interface VoiceVendorState {
  ready: boolean;
  vendorOptions: ReadonlyArray<VoiceVendorOption>;
  customOptions: ReadonlyArray<VoiceVendorOption>;
  /** 当前 Select 取值（vendor:<id> 或自定义卡 id；未选 = undefined）。 */
  selectValue: string | undefined;
  /** providerRef 卡 host 命中的厂商模板（null = 自定义端点卡或未选）。 */
  vendor: VoiceVendorTemplate | null;
  card: VoiceVendorCardSnapshot | null;
  apiKeyPresent: boolean | null;
  savingKey: boolean;
  selectVendor(vendorId: string): Promise<void>;
  selectCustom(providerId: string): void;
  saveApiKey(value: string): Promise<void>;
}

export function useVoiceVendorState(params: {
  kind: VoiceVendorApiKind;
  providerRef: string;
  onSaveProviderRef(providerRef: string): void;
}): VoiceVendorState {
  const { kind, providerRef, onSaveProviderRef } = params;
  const { intl, locale } = useDroraIntl();
  const { providerSettingsService } = useServices();
  const read = useProviderSettingsServiceView(providerSettingsService);
  const [savingKey, setSavingKey] = useState(false);

  const view = read.state.status === "ready" ? read.state.view : null;
  const providers = useMemo(
    () => (view?.providers ?? []).filter((provider) => provider.enabled) as ProviderLike[],
    [view],
  );

  const templates = useMemo(
    () => VOICE_VENDOR_REGISTRY.filter((template) => template.apiKinds.includes(kind)),
    [kind],
  );

  const currentCard = useMemo(
    () => providers.find((provider) => provider.providerId === providerRef) ?? null,
    [providers, providerRef],
  );
  const vendor = useMemo(
    () =>
      currentCard ? resolveVoiceVendorForCard(currentCard.effectiveConfig?.api?.baseUrl) : null,
    [currentCard],
  );

  const vendorOptions = useMemo<VoiceVendorOption[]>(
    () =>
      templates.map((template) => {
        const matched = providers.find((provider) => hostOf(provider) === template.matchHost);
        return {
          key: `${VENDOR_KEY_PREFIX}${template.vendorId}`,
          vendorId: template.vendorId,
          label: resolveVendorLocaleName(template, locale),
          cardExists: matched != null,
          keyPresent: matched ? apiKeyOf(matched).length > 0 : false,
        };
      }),
    [templates, providers, locale],
  );

  const customOptions = useMemo<VoiceVendorOption[]>(
    () =>
      providers
        .filter(
          (provider) => resolveVoiceVendorForCard(provider.effectiveConfig?.api?.baseUrl) == null,
        )
        .map((provider) => ({
          key: provider.providerId,
          label: provider.providerName ?? provider.providerId,
          cardExists: true,
          keyPresent: apiKeyOf(provider).length > 0,
        })),
    [providers],
  );

  const card = useMemo<VoiceVendorCardSnapshot | null>(() => {
    if (!currentCard) return null;
    return {
      providerId: currentCard.providerId,
      label: currentCard.providerName ?? currentCard.providerId,
      baseUrl: currentCard.effectiveConfig?.api?.baseUrl?.trim() ?? "",
      apiKey: apiKeyOf(currentCard),
    };
  }, [currentCard]);

  const selectVendor = useCallback(
    async (vendorId: string) => {
      const template = templates.find((candidate) => candidate.vendorId === vendorId);
      if (!template) return;
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: `select_${kind}_vendor`,
        trigger: "select",
      });
      try {
        // 优先当前 providerRef 卡（host 命中即复用），否则任一命中卡；都无 → 程序化建卡。
        const matched =
          providers.find(
            (provider) =>
              provider.providerId === providerRef && hostOf(provider) === template.matchHost,
          ) ?? providers.find((provider) => hostOf(provider) === template.matchHost);
        let targetId = matched?.providerId;
        if (!targetId) {
          const created = await providerSettingsService.createPersonalProvider({
            providerName: resolveVendorLocaleName(template, locale),
            initialConfig: {
              access: { type: "api-key" },
              api: { type: "openai-chat-completions", baseUrl: template.canonicalBaseUrl },
            },
          });
          targetId = created.providerId;
          // mutation 返回权威 View 直接提交，不依赖异步 onDidChange 才收敛下拉。
          if (created.view) {
            read.commit(created.view);
          }
        }
        if (targetId) {
          onSaveProviderRef(targetId);
        }
        trace.complete({ resultSource: "setting_service" });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        logger.warn("[model-capabilities] 语音供应商模板建卡失败", {
          vendorId,
          error: error instanceof Error ? error.message : String(error),
        });
        toast(intl.formatMessage({ id: "settings.modelCapability.vendor.createFailed" }));
      }
    },
    [
      templates,
      providers,
      providerRef,
      providerSettingsService,
      intl,
      locale,
      onSaveProviderRef,
      read,
    ],
  );

  const selectCustom = useCallback(
    (customProviderId: string) => {
      onSaveProviderRef(customProviderId);
    },
    [onSaveProviderRef],
  );

  const saveApiKey = useCallback(
    async (value: string) => {
      if (!card) {
        throw new Error("voice vendor card not selected");
      }
      setSavingKey(true);
      try {
        await persistProviderApiKey({
          providerId: card.providerId,
          apiKey: value,
          providerSettingsService,
        });
        // persistProviderApiKey 不回传 View；显式 reload 刷新存在性标注。
        read.reload();
      } finally {
        setSavingKey(false);
      }
    },
    [card, providerSettingsService, read],
  );

  return {
    ready: read.state.status === "ready",
    vendorOptions,
    customOptions,
    selectValue: vendor ? `${VENDOR_KEY_PREFIX}${vendor.vendorId}` : currentCard?.providerId,
    vendor,
    card,
    apiKeyPresent: read.state.status === "ready" ? (card ? card.apiKey.length > 0 : false) : null,
    savingKey,
    selectVendor,
    selectCustom,
    saveApiKey,
  };
}

const OPTION_STATE_KEYS = {
  connected: "settings.modelCapability.vendor.connected",
  needsKey: "settings.modelCapability.vendor.needsKey",
} as const;

export function VoiceVendorProviderRow(params: {
  state: VoiceVendorState;
  /** API Key 行遥测动作名（条目表单注入）。 */
  apiKeyActionName: string;
  testIdValue: string;
}) {
  const { intl } = useDroraIntl();
  const { state } = params;
  const formatOption = (option: VoiceVendorOption): string =>
    intl.formatMessage(
      { id: "settings.modelCapability.vendor.optionState" },
      {
        name: option.label,
        state: intl.formatMessage({
          id:
            option.cardExists && option.keyPresent
              ? OPTION_STATE_KEYS.connected
              : OPTION_STATE_KEYS.needsKey,
        }),
      },
    );

  return (
    <>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.modelCapability.vendor.title" })}
        description={intl.formatMessage({ id: "settings.modelCapability.vendor.description" })}
        control={
          <Select
            value={state.selectValue}
            onValueChange={(next) => {
              if (next.startsWith(VENDOR_KEY_PREFIX)) {
                void state.selectVendor(next.slice(VENDOR_KEY_PREFIX.length));
              } else {
                state.selectCustom(next);
              }
            }}
          >
            <SelectTrigger
              className="w-72"
              data-testid={testId(TID_MODEL_CAPABILITY_PROVIDER_SELECT, params.testIdValue)}
              aria-label={intl.formatMessage({ id: "settings.modelCapability.vendor.title" })}
            >
              <SelectValue
                placeholder={intl.formatMessage({
                  id: "settings.modelCapability.provider.unselected",
                })}
              />
            </SelectTrigger>
            <SelectContent>
              {state.vendorOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {formatOption(option)}
                </SelectItem>
              ))}
              {state.customOptions.length > 0 ? (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>
                      {intl.formatMessage({ id: "settings.modelCapability.vendor.customGroup" })}
                    </SelectLabel>
                    {state.customOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {formatOption(option)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              ) : null}
            </SelectContent>
          </Select>
        }
      />
      <CapabilityApiKeyRow
        credentialLabel={intl.formatMessage({ id: "settings.modelCapability.vendor.apiKey.label" })}
        descriptionId={
          state.vendor?.credentialHintKey ?? "settings.modelCapability.vendor.credentialHint.custom"
        }
        present={state.apiKeyPresent}
        saving={state.savingKey}
        onSave={(value) => state.saveApiKey(value)}
        actionName={params.apiKeyActionName}
      />
    </>
  );
}
