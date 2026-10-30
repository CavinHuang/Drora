import {
  PERSONA_CORE_LIMITS,
  type PersonaWarmth,
  type PersonaDirectness,
  type PersonaHumor,
} from "@drora/shared";
import { RefreshCw } from "lucide-react";
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
import { Switch } from "@/components/ui/switch.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { Spinner } from "@/components/ui/spinner.js";
import { PersonaApplicationArea } from "./PersonaApplicationArea.js";
import { PersonaPreferencesSection } from "./PersonaPreferencesSection.js";
import type { PersonaApplicationWorkspaceTarget } from "./contract.js";
import { usePersonaCoreEditor } from "./usePersonaCoreEditor.js";

/**
 * Drora Persona P0 设置分区（specs/drora-persona-system.md §10、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1.1/§2/§3）。
 *
 * 状态边界（诚实呈现，不互相冒充）：
 * - 「已保存」＝ Persona 服务的 coreRevision（唯一权威；跨窗口/跨进程以服务 revision 为准）；
 * - 「已应用/已省略」＝ getPersonaApplication 对指定会话/轮的运行时事实，重启后
 *   not_available，不伪造冷历史；保存成功只说明资料落库，不得表述成当前轮已应用；
 * - 「不可用」＝ CLI 不支持或存储故障，按原样降级展示，不吞原错误。
 *
 * 草稿是 UI 局部状态（spec §4）：CAS revision 冲突保留草稿并提供重新加载比较，
 * 不静默 last-write-wins；只开放五个受控字段，不提供任意 system prompt 编辑。
 * hello.capabilities 能力门在 SettingsPage 侧，进入本分区后仍以 overview 确认服务状态。
 * 状态机见 usePersonaCoreEditor；应用情况卡见 PersonaApplicationArea。
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
  const { intl } = useDroraIntl();
  const editor = usePersonaCoreEditor(personaService);
  const {
    loadPhase,
    loadErrorCode,
    saved,
    draftState,
    notice,
    savePending,
    initializePending,
    resetPending,
    resetConfirmOpen,
    setResetConfirmOpen,
    preview,
    previewPending,
    previewErrorCode,
    draftDirty,
    showDivergence,
    reload,
    handleSave,
    handleCancelDraft,
    handleInitialize,
    handleResetDefaults,
    handleDiscardDraftAndReload,
    handleKeepDraft,
    handleRefresh,
    updateDraftField,
  } = editor;

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

  const noticeClassName =
    notice?.tone === "success"
      ? "px-4 pb-2 text-ui-sm text-success"
      : notice?.tone === "error"
        ? "px-4 pb-2 text-ui-sm text-destructive"
        : "px-4 pb-2 text-ui-sm text-foreground-subtle";

  return (
    <div className="space-y-6" data-testid="settings-persona-section">
      {/* 执行许可 E：经原 Settings 保存通道；只影响新建/真正重新加载的会话。 */}
      <SettingsGroupCard>
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.drora.execution.label" })}
          description={intl.formatMessage({ id: "settings.drora.execution.description" })}
          control={
            <Switch
              data-testid="settings-persona-enabled-switch"
              aria-label={intl.formatMessage({ id: "settings.drora.execution.label" })}
              checked={personaEnabled}
              onCheckedChange={(checked) => {
                void onPersonaEnabledChange(checked);
              }}
            />
          }
          detail={
            <p className="w-full text-ui-sm leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.drora.execution.privacy" })}
            </p>
          }
        />
      </SettingsGroupCard>

      {/* P0 身份：五个受控字段；核心说明来自产品模板（可审阅、不可编辑）。 */}
      <SettingsGroupCard>
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
            <Input
              size="lg"
              className="w-full min-w-0 sm:w-64"
              data-testid="settings-persona-display-name"
              value={draftState.core.displayName}
              maxLength={PERSONA_CORE_LIMITS.displayNameMax}
              onChange={(event) => updateDraftField({ displayName: event.currentTarget.value })}
            />
          }
          detail={
            <span className="text-ui-xs tabular-nums text-foreground-subtlest">
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
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.drora.identity.selfDescription" })}
          description={intl.formatMessage({
            id: "settings.drora.identity.selfDescriptionDescription",
          })}
          control={
            <div className="w-full space-y-1">
              <Textarea
                data-testid="settings-persona-self-description"
                aria-label={intl.formatMessage({ id: "settings.drora.identity.selfDescription" })}
                value={draftState.core.selfDescription}
                onChange={(event) =>
                  updateDraftField({ selfDescription: event.currentTarget.value })
                }
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
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.identity.warmth" })}
          description={intl.formatMessage({ id: "settings.drora.identity.warmthDescription" })}
          control={
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
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.identity.directness" })}
          description={intl.formatMessage({ id: "settings.drora.identity.directnessDescription" })}
          control={
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
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.identity.humor" })}
          description={intl.formatMessage({ id: "settings.drora.identity.humorDescription" })}
          control={
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
          }
        />
        {/* 分歧/冲突面板：保留草稿 + 比较已保存版本，绝不静默 last-write-wins。 */}
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
                disabled={savePending || resetPending}
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
          <p role="status" className={noticeClassName} data-testid="settings-persona-notice">
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
        <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
          <Button
            type="button"
            size="lg"
            data-testid="settings-persona-save"
            disabled={
              !saved.initialized || !draftDirty || savePending || initializePending || resetPending
            }
            onClick={() => {
              void handleSave();
            }}
          >
            {savePending
              ? intl.formatMessage({ id: "settings.drora.identity.saving" })
              : intl.formatMessage({ id: "settings.drora.identity.save" })}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            data-testid="settings-persona-cancel"
            disabled={!draftDirty || savePending}
            onClick={handleCancelDraft}
          >
            {intl.formatMessage({ id: "settings.drora.identity.cancel" })}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            data-testid="settings-persona-reset-defaults"
            disabled={!saved.initialized || savePending || initializePending || resetPending}
            onClick={() => setResetConfirmOpen(true)}
          >
            {resetPending
              ? intl.formatMessage({ id: "settings.drora.identity.resetting" })
              : intl.formatMessage({ id: "settings.drora.identity.resetDefaults" })}
          </Button>
        </div>
      </SettingsGroupCard>

      {/* 确定性预览：本地模板编译，不请求模型；明确不是实际输出保证。 */}
      <SettingsGroupCard>
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.drora.preview.title" })}
          description={intl.formatMessage({ id: "settings.drora.preview.disclaimer" })}
          control={previewPending ? <Spinner className="size-4" /> : null}
          detail={
            <div
              className="w-full whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-ui-sm leading-5 text-foreground"
              data-testid="settings-persona-preview"
            >
              {preview
                ? preview.text
                : previewErrorCode
                  ? intl.formatMessage(
                      { id: "settings.drora.preview.failed" },
                      { code: previewErrorCode },
                    )
                  : intl.formatMessage({ id: "settings.drora.preview.empty" })}
            </div>
          }
        />
      </SettingsGroupCard>

      {/* 应用情况：已保存版本与指定会话/轮的应用事实分开显示；不伪造冷历史。 */}
      <PersonaApplicationArea
        personaService={personaService}
        applicationWorkspace={applicationWorkspace}
        savedRevisionLabel={
          saved.initialized ? (
            <>
              {intl.formatMessage(
                { id: "settings.drora.application.savedVersion" },
                {
                  revision: String(saved.revision),
                  template: String(saved.template.templateVersion),
                },
              )}
              <span className="mt-1 block">
                {intl.formatMessage({ id: "settings.drora.application.savedVersionHint" })}
              </span>
            </>
          ) : (
            intl.formatMessage({ id: "settings.drora.application.uninitialized" })
          )
        }
      />

      {/* P1a 交流默认与导出（spec §9/§10）：四键显式保存/忘记、U 使用许可与只读 JSON 导出；
          状态机见 usePersonaPreferences，展示细节见 PersonaPreferencesSection。 */}
      <PersonaPreferencesSection personaService={personaService} />

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
                void handleResetDefaults();
              }}
            >
              {intl.formatMessage({ id: "settings.drora.reset.confirmAction" })}
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
