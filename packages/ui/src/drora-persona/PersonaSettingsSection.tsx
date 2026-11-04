import { useEffect, useRef, useState } from "react";
import {
  PERSONA_CORE_LIMITS,
  type PersonaDirectness,
  type PersonaEditableCore,
  type PersonaHumor,
  type PersonaWarmth,
} from "@drora/shared";
import { RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { PersonaAdvancedArea } from "./PersonaAdvancedArea.js";
import { PersonaExpressionSection } from "./PersonaExpressionSection.js";
import { PersonaPolicyTogglesSection } from "./PersonaPolicyTogglesSection.js";
import { PersonaPresetSection, type PersonaPresetApplyNotice } from "./PersonaPresetSection.js";
import type { PersonaApplicationWorkspaceTarget } from "./contract.js";
import { usePersonaCoreEditor } from "./usePersonaCoreEditor.js";
import { usePersonaPresets } from "./usePersonaPresets.js";
import { usePersonaPreferences } from "./usePersonaPreferences.js";

/**
 * Drora Persona 设置分区（specs/drora-persona-system.md §10 第十六批、合同 §1/§2/§3）。
 *
 * 单页分区（自上而下）：开关与许可（E/U/L 三开关）→ 人设预设 → 它是谁（身份五字段）→
 * 它怎么说话（四键交流默认）→ 高级（默认折叠：预览/应用情况/导出/恢复默认）。
 *
 * 状态边界（诚实呈现，不互相冒充）：
 * - 「已保存」＝ Persona 服务的 coreRevision（唯一权威；跨窗口/跨进程以服务 revision 为准）；
 * - 「已应用/已省略」＝ getPersonaApplication 对指定会话/轮的运行时事实，重启后
 *   not_available，不伪造冷历史；保存成功只说明资料落库，不得表述成当前轮已应用；
 * - 「不可用」＝ CLI 不支持或存储故障，按原样降级展示，不吞原错误。
 *
 * 即时保存（spec §10 第十六批）：本分区没有整块保存按钮。身份区离散选择变更即提交、
 * 文本字段失焦/停顿约 1 秒提交（状态机见 usePersonaCoreEditor）；表达区四键同模型
 * （状态机见 usePersonaPreferences）。CAS revision 冲突保留草稿并提供重新加载比较，
 * 不静默 last-write-wins；分歧未解决时自动提交暂停，由分歧面板引导。
 * hello.capabilities 能力门在 SettingsPage 侧，进入本分区后仍以 overview 确认服务状态。
 * U/L 当前值以 getPersonaLearningOverview 读路径为权威，读取失败按「当前生效值未知」降级。
 */

const WARMTH_OPTIONS: readonly PersonaWarmth[] = ["restrained", "balanced", "warm"];
const DIRECTNESS_OPTIONS: readonly PersonaDirectness[] = ["gentle", "balanced", "direct"];
const HUMOR_OPTIONS: readonly PersonaHumor[] = ["off", "light"];

function codePointLength(value: string): number {
  // 限制按 Unicode code point 计（合同 §1），与服务的校验口径一致。
  return [...value].length;
}

export function PersonaSettingsSection({
  personaService,
  personaEnabled,
  onPersonaEnabledChange,
  applicationWorkspace,
}: {
  personaService: Parameters<typeof usePersonaCoreEditor>[0];
  personaEnabled: boolean;
  onPersonaEnabledChange: (enabled: boolean) => Promise<void>;
  /** 应用情况查询的本地 workspace 路由目标；null（无本地 workspace）时禁用查询。 */
  applicationWorkspace: PersonaApplicationWorkspaceTarget | null;
}) {
  const { intl, locale } = useDroraIntl();
  const platform = useOptionalPlatform();
  const editor = usePersonaCoreEditor(personaService);
  const preferences = usePersonaPreferences(personaService, platform?.saveFile);
  const {
    loadPhase,
    loadErrorCode,
    saved,
    draftState,
    notice,
    initializePending,
    resetPending,
    resetConfirmOpen,
    setResetConfirmOpen,
    showDivergence,
    reload,
    flushDraftSave,
    revertField,
    handleInitialize,
    handleDiscardDraftAndReload,
    handleKeepDraft,
    handleRefresh,
    updateDraftField,
  } = editor;
  const {
    forgetCandidate,
    cancelForget,
    handleForgetPreference,
    handleSetPolicy,
    reload: reloadPreferences,
  } = preferences;

  // 人设预设（spec §13 第十五批）：应用后刷新 core 编辑器与偏好区（偏好被显式覆盖）。
  const presets = usePersonaPresets(personaService);
  const [presetNotice, setPresetNotice] = useState<PersonaPresetApplyNotice | null>(null);
  const [prefsRefreshKey, setPrefsRefreshKey] = useState(0);
  const handleApplyPreset = async (preset: Parameters<typeof presets.applyPreset>[0]) => {
    const result = await presets.applyPreset(preset);
    if (!result) return;
    const name = locale.startsWith("zh") ? preset.nameZh : preset.nameEn;
    if (result.status === "applied") {
      setPresetNotice({
        tone: "success",
        message: intl.formatMessage({ id: "settings.drora.presets.result.applied" }, { name }),
      });
    } else if (result.status === "partial") {
      setPresetNotice({
        tone: "error",
        message: intl.formatMessage(
          { id: "settings.drora.presets.result.partial" },
          {
            name,
            keys: result.failedKeys.map((entry) => entry.key).join(", "),
          },
        ),
      });
    } else {
      // failed＝core 步骤未落库；携带失败码诚实呈现（不吞错误码，方便定位）。
      setPresetNotice({
        tone: "error",
        message:
          result.failedCoreCode !== undefined
            ? intl.formatMessage(
                { id: "settings.drora.presets.result.failedWithCode" },
                { code: result.failedCoreCode },
              )
            : intl.formatMessage({ id: "settings.drora.presets.result.failed" }),
      });
    }
    // 应用后同步两块本地状态：core 编辑器重读（含 reseed，丢弃与预设无关的旧草稿），
    // 偏好区经 refreshKey 重载（四键已被显式值覆盖）。
    await reload({ reseed: true });
    setPrefsRefreshKey((key) => key + 1);
  };

  // 预设应用会从外部覆盖偏好槽；偏好区不拥有该写路径，经 refreshKey 感知并重读
  // （spec §13 第十五批「预设全量覆盖」的呈现侧配合，不新增第二条写入路径）。
  const preferencesMountedRef = useRef(false);
  useEffect(() => {
    if (!preferencesMountedRef.current) {
      preferencesMountedRef.current = true;
      return;
    }
    void reloadPreferences();
  }, [prefsRefreshKey, reloadPreferences]);

  // 关闭 U 的级联确认（合同 §4.2 同事务关 L）：确认文案写明级联与不可恢复范围。
  const [cascadeConfirmOpen, setCascadeConfirmOpen] = useState(false);

  const divergenceRows = (() => {
    if (!showDivergence || !saved || !draftState) return [];
    const rows: Array<{ key: string; label: string; savedValue: string; draftValue: string }> = [
      {
        key: "displayName",
        label: intl.formatMessage({ id: "settings.drora.identity.displayName" }),
        savedValue: saved.core.displayName,
        draftValue: draftState.core.displayName,
      },
      {
        key: "selfDescription",
        label: intl.formatMessage({ id: "settings.drora.identity.selfDescription" }),
        savedValue: saved.core.selfDescription,
        draftValue: draftState.core.selfDescription,
      },
      {
        key: "warmth",
        label: intl.formatMessage({ id: "settings.drora.identity.warmth" }),
        savedValue: optionLabel(intl, "warmth", saved.core.warmth),
        draftValue: optionLabel(intl, "warmth", draftState.core.warmth),
      },
      {
        key: "directness",
        label: intl.formatMessage({ id: "settings.drora.identity.directness" }),
        savedValue: optionLabel(intl, "directness", saved.core.directness),
        draftValue: optionLabel(intl, "directness", draftState.core.directness),
      },
      {
        key: "humor",
        label: intl.formatMessage({ id: "settings.drora.identity.humor" }),
        savedValue: optionLabel(intl, "humor", saved.core.humor),
        draftValue: optionLabel(intl, "humor", draftState.core.humor),
      },
    ];
    return rows.filter((row) => row.savedValue !== row.draftValue);
  })();

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------

  if (loadPhase === "loading" && !saved) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-ui-base text-foreground-subtle">
        <Spinner className="size-4" />
        {intl.formatMessage({ id: "settings.drora.loading" })}
      </div>
    );
  }

  if (loadPhase === "error") {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-border px-4 py-8">
        <p className="text-ui-base text-foreground">
          {intl.formatMessage({ id: "settings.drora.unavailable" })}
        </p>
        {loadErrorCode ? (
          <p className="font-mono text-ui-sm text-foreground-subtlest">{loadErrorCode}</p>
        ) : null}
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() => {
            void reload({ reseed: true });
          }}
        >
          {intl.formatMessage({ id: "settings.drora.retry" })}
        </Button>
      </div>
    );
  }

  if (!saved || !draftState) return null;

  const noticeClassName_ =
    notice?.tone === "success"
      ? "px-4 pb-2 text-ui-sm text-success"
      : notice?.tone === "error"
        ? "px-4 pb-2 text-ui-sm text-destructive"
        : "px-4 pb-2 text-ui-sm text-foreground-subtle";

  /** 身份单字段脏检查（↺ 回退只对脏字段可见，spec §10 第十六批）。 */
  const isCoreFieldDirty = (field: keyof PersonaEditableCore): boolean =>
    draftState.core[field] !== draftState.seed[field];

  /** 单字段 ↺ 回退按钮：点击回到已保存值；离散选择变更即存，无需手动保存。 */
  const renderCoreRevertButton = (field: keyof PersonaEditableCore) =>
    isCoreFieldDirty(field) ? (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={intl.formatMessage({ id: "settings.drora.revert" })}
        data-testid={`settings-persona-revert-${field}`}
        disabled={editor.savePending || initializePending || resetPending}
        onClick={() => revertField(field)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    ) : null;

  return (
    <div className="space-y-6" data-testid="settings-persona-section">
      {/* 开关与许可（spec §10 第十六批）：E 执行开关＋U 偏好注入＋L 自动学习归一区；
          U/L 开关语义与降级见 PersonaPolicyTogglesSection；关闭 U 的级联确认对话框在根部。 */}
      <PersonaPolicyTogglesSection
        personaEnabled={personaEnabled}
        onPersonaEnabledChange={onPersonaEnabledChange}
        preferences={preferences}
        onDisableUsePreferences={() => setCascadeConfirmOpen(true)}
      />

      {/* 人设预设（spec §13 第十五批）：六张内置起点，应用＝core 全量替换＋四键显式覆盖。 */}
      <PersonaPresetSection
        currentCore={saved?.core ?? null}
        applyingPresetId={presets.applyingPresetId}
        applyNotice={presetNotice}
        onApply={handleApplyPreset}
      />

      {/* 它是谁（P0 身份）：五个受控字段即时保存；初始化与刷新保持显式动作。 */}
      <SettingsGroupCard data-testid="settings-persona-identity-section">
        <div className="px-4 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "settings.drora.identity.title" })}
              </div>
              <div className="mt-1 text-ui-base leading-6 text-foreground-subtle">
                {intl.formatMessage({ id: "settings.drora.identity.description" })}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {saved.initialized ? (
                <span
                  className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle"
                  data-testid="settings-persona-saved-revision"
                >
                  {intl.formatMessage(
                    { id: "settings.drora.identity.savedRevision" },
                    { revision: String(saved.revision) },
                  )}
                </span>
              ) : (
                <span className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.drora.identity.uninitialized" })}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={intl.formatMessage({ id: "settings.drora.refresh" })}
                data-testid="settings-persona-refresh"
                onClick={handleRefresh}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>
          {!saved.initialized ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                data-testid="settings-persona-initialize"
                disabled={initializePending}
                onClick={() => {
                  void handleInitialize();
                }}
              >
                {initializePending
                  ? intl.formatMessage({ id: "settings.drora.identity.initializing" })
                  : intl.formatMessage({ id: "settings.drora.identity.initialize" })}
              </Button>
              <span className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "settings.drora.identity.initializeHint" })}
              </span>
            </div>
          ) : null}
        </div>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.identity.displayName" })}
          description={intl.formatMessage({ id: "settings.drora.identity.displayNameDescription" })}
          control={
            <div className="flex items-center gap-1">
              <Input
                size="lg"
                className="w-full min-w-0 sm:w-52"
                data-testid="settings-persona-display-name"
                value={draftState.core.displayName}
                maxLength={PERSONA_CORE_LIMITS.displayNameMax}
                onChange={(event) => updateDraftField({ displayName: event.currentTarget.value })}
                onBlur={() => {
                  void flushDraftSave("keyboard");
                }}
              />
              {renderCoreRevertButton("displayName")}
            </div>
          }
          detail={
            <span className="block text-right text-ui-xs tabular-nums text-foreground-subtlest">
              {intl.formatMessage(
                { id: "settings.drora.identity.counter" },
                {
                  count: String(codePointLength(draftState.core.displayName)),
                  max: String(PERSONA_CORE_LIMITS.displayNameMax),
                },
              )}
            </span>
          }
        />
        {/* 自我描述：上下结构（标题/说明在上，输入框整行在下）——长文本不适合窄右列。 */}
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-ui-base font-medium text-foreground">
                {intl.formatMessage({ id: "settings.drora.identity.selfDescription" })}
              </div>
              <div className="mt-1 text-ui-base leading-6 text-foreground-subtle">
                {intl.formatMessage({
                  id: "settings.drora.identity.selfDescriptionDescription",
                })}
              </div>
            </div>
            {renderCoreRevertButton("selfDescription")}
          </div>
          <div className="mt-3 w-full space-y-1">
            <Textarea
              className="w-full"
              data-testid="settings-persona-self-description"
              aria-label={intl.formatMessage({ id: "settings.drora.identity.selfDescription" })}
              value={draftState.core.selfDescription}
              onChange={(event) => updateDraftField({ selfDescription: event.currentTarget.value })}
              onBlur={() => {
                void flushDraftSave("keyboard");
              }}
            />
            <span className="block text-right text-ui-xs tabular-nums text-foreground-subtlest">
              {intl.formatMessage(
                { id: "settings.drora.identity.counter" },
                {
                  count: String(codePointLength(draftState.core.selfDescription)),
                  max: String(PERSONA_CORE_LIMITS.selfDescriptionMax),
                },
              )}
            </span>
          </div>
        </div>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.identity.warmth" })}
          description={intl.formatMessage({ id: "settings.drora.identity.warmthDescription" })}
          control={
            <div className="flex items-center gap-1">
              <Select
                value={draftState.core.warmth}
                onValueChange={(value) => updateDraftField({ warmth: value as PersonaWarmth })}
              >
                <SelectTrigger
                  size="lg"
                  className="w-full min-w-0 justify-between sm:w-52"
                  data-testid="settings-persona-warmth"
                  aria-label={intl.formatMessage({ id: "settings.drora.identity.warmth" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WARMTH_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {optionLabel(intl, "warmth", option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderCoreRevertButton("warmth")}
            </div>
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.identity.directness" })}
          description={intl.formatMessage({ id: "settings.drora.identity.directnessDescription" })}
          control={
            <div className="flex items-center gap-1">
              <Select
                value={draftState.core.directness}
                onValueChange={(value) =>
                  updateDraftField({ directness: value as PersonaDirectness })
                }
              >
                <SelectTrigger
                  size="lg"
                  className="w-full min-w-0 justify-between sm:w-52"
                  data-testid="settings-persona-directness"
                  aria-label={intl.formatMessage({ id: "settings.drora.identity.directness" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIRECTNESS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {optionLabel(intl, "directness", option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderCoreRevertButton("directness")}
            </div>
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.identity.humor" })}
          description={intl.formatMessage({ id: "settings.drora.identity.humorDescription" })}
          control={
            <div className="flex items-center gap-1">
              <Select
                value={draftState.core.humor}
                onValueChange={(value) => updateDraftField({ humor: value as PersonaHumor })}
              >
                <SelectTrigger
                  size="lg"
                  className="w-full min-w-0 justify-between sm:w-52"
                  data-testid="settings-persona-humor"
                  aria-label={intl.formatMessage({ id: "settings.drora.identity.humor" })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HUMOR_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {optionLabel(intl, "humor", option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderCoreRevertButton("humor")}
            </div>
          }
        />
        {/* 分歧/冲突面板：保留草稿 + 比较已保存版本，绝不静默 last-write-wins；
            分歧未解决时自动提交暂停（flush 守卫），面板是唯一解决面。 */}
        {showDivergence ? (
          <div
            className="mx-4 mb-4 space-y-2 rounded-lg bg-warning-surface px-3 py-3 text-warning-surface-foreground"
            data-testid="settings-persona-divergence"
          >
            <p className="text-ui-sm font-medium">
              {intl.formatMessage({ id: "settings.drora.divergence.title" })}
            </p>
            <p className="text-ui-sm">
              {intl.formatMessage(
                { id: "settings.drora.divergence.description" },
                { latest: String(saved.revision), base: String(draftState.seedRevision) },
              )}
            </p>
            {divergenceRows.length > 0 ? (
              <div className="space-y-1">
                {divergenceRows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-2 text-ui-sm"
                  >
                    <span className="shrink-0 opacity-80">{row.label}</span>
                    <span className="min-w-0 break-words opacity-80">
                      <span className="me-1 opacity-70">
                        {intl.formatMessage({ id: "settings.drora.divergence.savedValue" })}
                      </span>
                      {row.savedValue}
                    </span>
                    <span className="min-w-0 break-words">
                      <span className="me-1 opacity-70">
                        {intl.formatMessage({ id: "settings.drora.divergence.draftValue" })}
                      </span>
                      {row.draftValue}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="settings-persona-keep-draft"
                onClick={handleKeepDraft}
              >
                {intl.formatMessage({ id: "settings.drora.divergence.keepDraft" })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="settings-persona-discard-draft"
                disabled={editor.savePending || resetPending}
                onClick={() => {
                  void handleDiscardDraftAndReload();
                }}
              >
                {intl.formatMessage({ id: "settings.drora.divergence.discardDraft" })}
              </Button>
            </div>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className={noticeClassName_} data-testid="settings-persona-notice">
            {notice.kind === "saved"
              ? intl.formatMessage({ id: "settings.drora.notice.saved" })
              : notice.kind === "unchanged"
                ? intl.formatMessage({ id: "settings.drora.notice.unchanged" })
                : notice.kind === "initialized"
                  ? intl.formatMessage({ id: "settings.drora.notice.initialized" })
                  : notice.kind === "outcomeUnknown"
                    ? intl.formatMessage({ id: "settings.drora.notice.outcomeUnknown" })
                    : notice.kind === "conflict"
                      ? intl.formatMessage({ id: "settings.drora.notice.conflict" })
                      : notice.kind === "uninitialized"
                        ? intl.formatMessage({ id: "settings.drora.notice.uninitialized" })
                        : notice.kind === "code"
                          ? intl.formatMessage(
                              { id: "settings.drora.notice.code" },
                              { code: notice.code },
                            )
                          : intl.formatMessage(
                              { id: "settings.drora.notice.rpc" },
                              { message: notice.message },
                            )}
          </p>
        ) : null}
      </SettingsGroupCard>

      {/* 它怎么说话（P1a 交流默认）：四键即时保存/忘记；状态机见 usePersonaPreferences。 */}
      <PersonaExpressionSection preferences={preferences} />

      {/* 高级（默认折叠）：预览、应用情况查询、只读导出、恢复产品默认。 */}
      <PersonaAdvancedArea
        personaService={personaService}
        editor={editor}
        preferences={preferences}
        applicationWorkspace={applicationWorkspace}
        exportSupported={Boolean(platform?.saveFile)}
      />

      <AlertDialog
        open={resetConfirmOpen}
        onOpenChange={(open) => {
          if (!resetPending) setResetConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: "settings.drora.reset.confirmTitle" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: "settings.drora.reset.confirmDescription" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPending}>
              {intl.formatMessage({ id: "common.cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={resetPending}
              onClick={(event) => {
                event.preventDefault();
                void editor.handleResetDefaults();
              }}
            >
              {intl.formatMessage({ id: "settings.drora.reset.confirmAction" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 关闭 U 的级联确认（合同 §4.2）：同事务关 L、撤租约、清未提交候选/负载；重开 U 不恢复 L。 */}
      <AlertDialog
        open={cascadeConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setCascadeConfirmOpen(false);
        }}
      >
        <AlertDialogContent data-testid="settings-persona-cascade-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: "settings.drora.policy.cascade.title" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: "settings.drora.policy.cascade.description" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCascadeConfirmOpen(false)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="settings-persona-cascade-confirm-action"
              onClick={(event) => {
                event.preventDefault();
                setCascadeConfirmOpen(false);
                void handleSetPolicy(false);
              }}
            >
              {intl.formatMessage({ id: "settings.drora.policy.cascade.action" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 忘记确认（spec §9）：准确范围说明——逻辑撤销，不叫「彻底忘记/所有地方删除」。 */}
      <AlertDialog
        open={forgetCandidate !== null}
        onOpenChange={(open) => {
          if (!open) cancelForget();
        }}
      >
        <AlertDialogContent data-testid="settings-persona-forget-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage(
                { id: "settings.drora.forget.confirmTitle" },
                forgetCandidate
                  ? {
                      key: intl.formatMessage({
                        id: `settings.drora.preferences.${forgetCandidate}`,
                      }),
                    }
                  : undefined,
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage({ id: "settings.drora.forget.confirmDescription" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelForget}>
              {intl.formatMessage({ id: "common.cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="settings-persona-forget-confirm-action"
              disabled={forgetCandidate === null}
              onClick={(event) => {
                event.preventDefault();
                if (forgetCandidate) {
                  void handleForgetPreference(forgetCandidate);
                }
              }}
            >
              {intl.formatMessage({ id: "settings.drora.preferences.forget" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 选项标签的小工具：值 → i18n key（settings.drora.identity.<字段>.<值>）。
function optionLabel(
  intl: { formatMessage: (descriptor: { id: string }) => string },
  field: "warmth" | "directness" | "humor",
  value: string,
): string {
  return intl.formatMessage({ id: `settings.drora.identity.${field}.${value}` });
}
