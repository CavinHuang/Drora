/**
 * 模型能力条目表单的共用部件（specs/model-capabilities.md §5.1）。
 *
 * - CapabilityApiKeyRow：ApiKeyInput 模式（password 输入 + 显隐）+ ApiKeyRow 语义
 *   （留空保存即删除、明文不回显、行内呈示「已配置/未配置」存在性态）；凭据写删走
 *   档案服务 update 的 credentials 面（apiKey 一律不进档案文件，spec §3.2）。
 * - CapabilityBaseUrlRow：连接区模式（baseUrl 输入 + 行内 https 校验警告，照
 *   ProviderCardSections/VoiceSection S1 先例：明文非本机地址阻止写入 + 警告分型）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeIcon, EyeOffIcon, LoaderCircle } from "lucide-react";
import {
  TID_MODEL_CAPABILITY_API_KEY_INPUT,
  TID_MODEL_CAPABILITY_API_KEY_SAVE_BUTTON,
  TID_MODEL_CAPABILITY_BASE_URL_INPUT,
  TID_MODEL_CAPABILITY_BASE_URL_WARNING,
  TID_MODEL_CAPABILITY_MODEL_INPUT,
  testId,
  TID_MODEL_CAPABILITY_PROVIDER_SELECT,
} from "@drora/shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useServices } from "@/hooks/useServices.js";
import { setPendingSettingsSectionIntent } from "@/lib/settingsNavigation.js";
import { useProviderSettingsServiceView } from "@/hooks/useProviderSettingsView.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { validateVoiceVendorBaseUrl } from "@/voice/voiceVendorBaseUrl.js";

/** 单个凭据键的「存在性」读取（明文永不回流 renderer 状态；照 useApiKeyPresence 先例）。 */
export function useCredentialPresence(
  load: () => Promise<string | null>,
): [boolean | null, (present: boolean) => void] {
  const [present, setPresent] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void load()
      .then((value) => {
        if (!cancelled) setPresent(Boolean(value?.trim()));
      })
      .catch((error: unknown) => {
        logger.warn("[model-capabilities] 读取凭据存在性失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setPresent(false);
      });
    return () => {
      cancelled = true;
    };
    // load 由调用方 useCallback 稳定（凭据键 + 服务实例），键变化时重建。
  }, [load]);
  return [present, setPresent];
}

/**
 * API Key 行：password 输入 + 保存（留空保存即删除）。onSave 由条目表单注入
 * （内部转档案服务 update 的 credentials 面）；不回显明文。
 */
export function CapabilityApiKeyRow({
  credentialLabel,
  descriptionId,
  present,
  saving,
  onSave,
  actionName,
}: {
  /** 行标题（含提供商名，由条目表单本地拼装，如 "OpenRouter API Key"）。 */
  credentialLabel: string;
  /** 描述文案 i18n 键。 */
  descriptionId: string;
  /** 凭据存在性（null = 读取中）。 */
  present: boolean | null;
  saving: boolean;
  /** value 为空串 = 删除该键（ApiKeyRow 语义）。 */
  onSave: (value: string) => Promise<void>;
  /** 遥测动作名（userActionTraceCatalog settings.modelCapability 组）。 */
  actionName: string;
}) {
  const { intl } = useDroraIntl();
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);

  const handleSave = useCallback(async () => {
    const trace = startUserAction({
      featureId: "settings.model_capabilities",
      action: actionName,
      trigger: "button",
    });
    try {
      await onSave(draft.trim());
      setDraft("");
      toast(intl.formatMessage({ id: "settings.modelCapability.apiKey.saved" }));
      trace.complete({ resultSource: "authority_ack", configured: draft.trim().length > 0 });
    } catch (error) {
      trace.fail({ failureStage: "credential_write" });
      logger.warn("[model-capabilities] 保存 API Key 失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "settings.modelCapability.apiKey.saveFailed" }));
    }
  }, [actionName, draft, intl, onSave]);

  return (
    // wide 布局：输入+显隐+保存三件超 default 192px 列，溢出会盖住左侧描述文字
    //（用户实机截图 bug），280px 列 + 输入自适应放得下。
    <SettingsRow
      controlLayout="wide"
      label={credentialLabel}
      description={intl.formatMessage({ id: descriptionId })}
      control={
        <div className="flex w-full items-center gap-2">
          <div className="relative">
            <Input
              type={visible ? "text" : "password"}
              autoComplete="off"
              className="min-w-0 flex-1 pr-9"
              placeholder={intl.formatMessage({
                id: "settings.modelCapability.apiKey.placeholder",
              })}
              aria-label={credentialLabel}
              data-testid={TID_MODEL_CAPABILITY_API_KEY_INPUT}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSave();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={intl.formatMessage({
                id: "settings.modelCapability.apiKey.toggleVisibility",
              })}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              onClick={() => setVisible((current) => !current)}
            >
              {visible ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            data-testid={TID_MODEL_CAPABILITY_API_KEY_SAVE_BUTTON}
            onClick={() => void handleSave()}
          >
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {intl.formatMessage({ id: "settings.modelCapability.apiKey.save" })}
          </Button>
        </div>
      }
      detail={
        present === null ? undefined : (
          <div className="text-ui-xs text-foreground-subtle">
            {intl.formatMessage({
              id: present
                ? "settings.modelCapability.apiKey.configured"
                : "settings.modelCapability.apiKey.notConfigured",
            })}
          </div>
        )
      }
    />
  );
}

/**
 * baseUrl 行（连接区模式）：草稿态 + onBlur 校验——合法（https 或本机明文）才回调
 * 保存；非法阻止写入并按 reason 渲染行内警告（择「阻止」：明文外发是静默风险，照
 * VoiceSection S1 整改口径）。空串放行（各条目「未配置/回落默认端点」语义）。
 */
export function CapabilityBaseUrlRow({
  labelId,
  placeholderId,
  value,
  onSave,
  testIdValue,
  datalist,
}: {
  labelId: string;
  placeholderId: string;
  /** 持久值（档案快照）。 */
  value: string;
  onSave: (value: string) => void;
  /** testid 后缀（条目名，如 asr / tts / decisionJev）。 */
  testIdValue: string;
  /** 可选输入建议（datalist 仅建议不参与校验，spec §5.1 图像生成预设）。 */
  datalist?: { id: string; values: readonly string[] };
}) {
  const { intl } = useDroraIntl();
  const [draft, setDraft] = useState(value);
  const [warning, setWarning] = useState<"insecure-remote" | "unparseable" | null>(null);
  useEffect(() => {
    // 外部变更（档案 onDidChange / 他窗口写入）同步草稿。
    setDraft(value);
    setWarning(null);
  }, [value]);

  return (
    <SettingsRow
      label={intl.formatMessage({ id: labelId })}
      control={
        <>
          {datalist ? (
            <datalist id={datalist.id}>
              {datalist.values.map((preset) => (
                <option key={preset} value={preset} />
              ))}
            </datalist>
          ) : null}
          <Input
            className="w-72"
            value={draft}
            placeholder={intl.formatMessage({ id: placeholderId })}
            aria-label={intl.formatMessage({ id: labelId })}
            data-testid={testId(TID_MODEL_CAPABILITY_BASE_URL_INPUT, testIdValue)}
            list={datalist?.id}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const next = draft.trim();
              const verdict = validateVoiceVendorBaseUrl(next);
              if (verdict.ok) {
                setWarning(null);
                if (next !== value) {
                  onSave(next);
                }
                return;
              }
              setWarning(verdict.reason ?? "insecure-remote");
            }}
          />
        </>
      }
      detail={
        warning ? (
          <div
            className="border-t border-border px-4 py-2 text-ui-base text-warning"
            data-testid={TID_MODEL_CAPABILITY_BASE_URL_WARNING}
          >
            {intl.formatMessage({
              id:
                warning === "unparseable"
                  ? "settings.modelCapability.baseUrl.unparseableWarning"
                  : "settings.modelCapability.baseUrl.insecureWarning",
            })}
          </div>
        ) : null
      }
    />
  );
}

/**
 * 模型 id / 音色等文本档行：本地草稿 + onBlur 提交（§12 修复，与 CapabilityBaseUrlRow
 * 同形态）。此前 onChange 直写快照：①各表单 save handler 的 trim 在每次击键后经快照
 * 回显回灌输入框，输入尾随空格会被即时吞掉（丢字符）；②每击键触发一条遥测 trace 与
 * 一次全档案原子写/广播。草稿化后 trim 只在提交时发生，遥测与写盘只随提交。
 */
export function CapabilityTextValueRow({
  labelId,
  placeholderId,
  value,
  onSave,
  testIdValue,
  datalist,
}: {
  labelId: string;
  placeholderId: string;
  value: string;
  onSave: (value: string) => void;
  testIdValue: string;
  /** 可选输入建议（datalist 仅建议不校验，照 CapabilityBaseUrlRow 先例）。 */
  datalist?: { id: string; values: readonly string[] };
}) {
  const { intl } = useDroraIntl();
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    // 外部变更（档案 onDidChange / 他窗口写入）同步草稿。
    setDraft(value);
  }, [value]);
  return (
    <SettingsRow
      label={intl.formatMessage({ id: labelId })}
      control={
        <>
          {datalist ? (
            <datalist id={datalist.id}>
              {datalist.values.map((preset) => (
                <option key={preset} value={preset} />
              ))}
            </datalist>
          ) : null}
          <Input
            className="w-72"
            value={draft}
            placeholder={intl.formatMessage({ id: placeholderId })}
            aria-label={intl.formatMessage({ id: labelId })}
            data-testid={testId(TID_MODEL_CAPABILITY_MODEL_INPUT, testIdValue)}
            list={datalist?.id}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              const next = draft.trim();
              if (next !== value) {
                onSave(next);
              }
            }}
          />
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// §13 供应商引用行（asr/tts/image-generation 共用）：providerRef 下拉 + 数据源 hook
// ---------------------------------------------------------------------------

/** 能力条目可引用的供应商摘要（providerRef 下拉数据；§13 单一连接层）。 */
export interface CapabilityProviderOption {
  providerId: string;
  label: string;
  /** baseUrl+API Key 齐全（缺 = 出站会 fail-closed，下拉文案标注）。 */
  connectionComplete: boolean;
}

/**
 * §13 供应商列表数据源：直读 providerSettingsService 视图（轻量，不带连通性测试；
 * useModelProviders 的重形态不适合设置表单）。仅列 enabled 且可执行/或显式 api-key
 * 形态的卡——能力出站只认有 baseUrl+apiKey 的连接。
 */
export function useCapabilityProviderOptions(): CapabilityProviderOption[] {
  const { providerSettingsService } = useServices();
  const read = useProviderSettingsServiceView(providerSettingsService);
  return useMemo(() => {
    const view = read.state.status === "ready" ? read.state.view : null;
    if (!view) return [];
    return view.providers
      .filter((provider) => provider.enabled)
      .map((provider) => {
        const access = provider.effectiveConfig?.access;
        const connectionComplete = Boolean(
          provider.effectiveConfig?.api?.baseUrl && access?.type === "api-key" && access.apiKey,
        );
        return {
          providerId: provider.providerId,
          label: provider.providerName ?? provider.providerId,
          connectionComplete,
        };
      });
  }, [read.state]);
}

/**
 * §13 供应商选择行：下拉（含「未选择」占位）+ 说明（连接信息来自所选供应商卡，
 * key 单点管理）。条目 baseUrlOverride 不在本行——高级折叠区（网关分域名边缘）。
 */
export function CapabilityProviderRefRow({
  labelId,
  descriptionId,
  value,
  options,
  onSave,
  testIdValue,
}: {
  labelId: string;
  descriptionId: string;
  value: string;
  options: readonly CapabilityProviderOption[];
  onSave: (providerRef: string) => void;
  testIdValue: string;
}) {
  const { intl } = useDroraIntl();
  // §13 空态：没有任何可用 API Key 卡时下拉无选项（Radix 空弹层），改渲染引导文案
  // + 跳转按钮（打开模型设置供应商分区新建卡，照 jevOff 横幅同机制）。
  if (options.length === 0) {
    return (
      // wide 布局 + 自适应宽：照 CapabilityApiKeyRow 同款（default 192px 列装不下，
      // 溢出盖住描述文字——同款实机截图 bug）。
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: labelId })}
        description={intl.formatMessage({ id: descriptionId })}
        control={
          <Button
            variant="outline"
            className="w-full"
            data-testid={testId(TID_MODEL_CAPABILITY_PROVIDER_SELECT, testIdValue)}
            onClick={() => {
              setPendingSettingsSectionIntent("modelProvider");
            }}
          >
            {intl.formatMessage({ id: "settings.modelCapability.provider.createFirst" })}
          </Button>
        }
      />
    );
  }
  return (
    <SettingsRow
      label={intl.formatMessage({ id: labelId })}
      description={intl.formatMessage({ id: descriptionId })}
      control={
        <Select
          value={value || undefined}
          onValueChange={(next) => {
            onSave(next);
          }}
        >
          <SelectTrigger
            className="w-72"
            data-testid={testId(TID_MODEL_CAPABILITY_PROVIDER_SELECT, testIdValue)}
            aria-label={intl.formatMessage({ id: labelId })}
          >
            <SelectValue
              placeholder={intl.formatMessage({
                id: "settings.modelCapability.provider.unselected",
              })}
            />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.providerId} value={option.providerId}>
                {option.connectionComplete
                  ? option.label
                  : `${option.label}（缺 API Key / Base URL，选中后无法出站）`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
