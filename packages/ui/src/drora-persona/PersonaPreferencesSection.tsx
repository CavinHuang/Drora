import type { ReactNode } from "react";
import {
  PERSONA_PREFERENCE_ALLOWED_VALUES,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_PREFERENCE_LIMITS,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
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
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { Spinner } from "@/components/ui/spinner.js";
import type {
  PersonaPreferenceNotice,
  PersonaPreferencesService,
} from "./usePersonaPreferences.js";
import {
  isPreferenceSlotDirty,
  isPreferenceSlotDiverged,
  usePersonaPreferences,
} from "./usePersonaPreferences.js";

/**
 * Drora Persona P1a「交流默认与导出」分区（specs/drora-persona-system.md §9/§10、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1.2/§4.2/§7）。
 *
 * 诚实呈现边界：
 * - 偏好当前值来自 listPreferences（服务权威）；草稿是 UI 局部状态，CAS revision 冲突
 *   保留草稿并给出「已保存 vs 草稿」比较，不静默 last-write-wins；
 * - U 使用许可没有查询方法（shared 只暴露 setPersonalPolicy 写路径）：本区展示两态切换
 *   按钮，状态行只陈述本会话最近一次确定性操作结果，初始如实显示「当前生效值未知，
 *   以服务为准」；不做「当前会话已关闭」类断言，切换只对新轮生效；
 * - 忘记是逻辑撤销：确认文案写明清除范围，不承诺介质擦除、不声称删除聊天记录/项目记忆/诊断；
 * - 导出是只读快照：无资料显示「尚无资料」且不为导出初始化；取消/失败如实提示，
 *   只有平台 saveFile success 才显示已保存。
 */

const SELECT_PREFERENCE_KEYS = [
  PERSONA_PREFERENCE_KEYS.replyLanguage,
  PERSONA_PREFERENCE_KEYS.explanationDetail,
  PERSONA_PREFERENCE_KEYS.collaborationStyle,
] as const;

const SELECT_PREFERENCE_OPTIONS: Record<
  (typeof SELECT_PREFERENCE_KEYS)[number],
  readonly string[]
> = {
  [PERSONA_PREFERENCE_KEYS.replyLanguage]: PERSONA_PREFERENCE_ALLOWED_VALUES.replyLanguage,
  [PERSONA_PREFERENCE_KEYS.explanationDetail]: PERSONA_PREFERENCE_ALLOWED_VALUES.explanationDetail,
  [PERSONA_PREFERENCE_KEYS.collaborationStyle]:
    PERSONA_PREFERENCE_ALLOWED_VALUES.collaborationStyle,
};

function codePointLength(value: string): number {
  // 与服务一致：preferredAddress 上限按 Unicode code point 计（合同 §1.2）。
  return [...value].length;
}

/** 受控值 → 用户文案（preferredAddress 是自由文本原样展示；其余走受控词汇键）。 */
function preferenceValueText(
  intl: { formatMessage: (descriptor: { id: string }) => string },
  key: PersonaPreferenceKey,
  value: string | null,
): string {
  if (value === null) {
    return intl.formatMessage({ id: "settings.drora.preferences.notSet" });
  }
  if (key === PERSONA_PREFERENCE_KEYS.preferredAddress) return value;
  return intl.formatMessage({ id: `settings.drora.preferences.${key}.${value}` });
}

/** 偏好/策略共用的结果文案；saved/unchanged/forgotten 由调用方按区域选择键。 */
function noticeText(
  intl: { formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string },
  notice: PersonaPreferenceNotice,
): string {
  switch (notice.kind) {
    case "saved":
      return intl.formatMessage({ id: "settings.drora.notice.saved" });
    case "unchanged":
      return intl.formatMessage({ id: "settings.drora.notice.unchanged" });
    case "forgotten":
      return intl.formatMessage({ id: "settings.drora.preferences.notice.forgotten" });
    case "outcomeUnknown":
      return intl.formatMessage({ id: "settings.drora.notice.outcomeUnknown" });
    case "conflict":
      return intl.formatMessage({ id: "settings.drora.notice.conflict" });
    case "uninitialized":
      return intl.formatMessage({ id: "settings.drora.notice.uninitialized" });
    case "code":
      return intl.formatMessage({ id: "settings.drora.notice.code" }, { code: notice.code });
    case "rpc":
      return intl.formatMessage({ id: "settings.drora.notice.rpc" }, { message: notice.message });
  }
}

function noticeClassName(tone: PersonaPreferenceNotice["tone"]): string {
  return tone === "success"
    ? "text-ui-sm text-success"
    : tone === "error"
      ? "text-ui-sm text-destructive"
      : "text-ui-sm text-foreground-subtle";
}

export function PersonaPreferencesSection({
  personaService,
}: {
  personaService: PersonaPreferencesService;
}) {
  const { intl } = useDroraIntl();
  const platform = useOptionalPlatform();
  const preferences = usePersonaPreferences(personaService, platform?.saveFile);
  const {
    loadPhase,
    loadErrorCode,
    initialized,
    slots,
    policy,
    exportPending,
    exportNotice,
    forgetCandidate,
    reload,
    updatePreferenceDraft,
    cancelPreferenceDraft,
    keepPreferenceDraft,
    handleSavePreference,
    requestForget,
    cancelForget,
    handleForgetPreference,
    handleSetPolicy,
    handleExport,
  } = preferences;

  if (loadPhase === "loading") {
    return (
      <SettingsGroupCard>
        <div className="flex items-center gap-2 px-4 py-8 text-ui-base text-foreground-subtle">
          <Spinner className="size-4" />
          {intl.formatMessage({ id: "settings.drora.loading" })}
        </div>
      </SettingsGroupCard>
    );
  }

  if (loadPhase === "error") {
    return (
      <SettingsGroupCard>
        <div className="space-y-3 px-4 py-8">
          <p className="text-ui-base text-foreground">
            {intl.formatMessage(
              { id: "settings.drora.preferences.loadFailed" },
              loadErrorCode ? { code: loadErrorCode } : undefined,
            )}
          </p>
          <Button
            type="button"
            size="lg"
            variant="outline"
            data-testid="settings-persona-prefs-retry"
            onClick={() => {
              void reload();
            }}
          >
            {intl.formatMessage({ id: "settings.drora.retry" })}
          </Button>
        </div>
      </SettingsGroupCard>
    );
  }

  const policyStateText = policy.lastOperation
    ? policy.lastOperation.kind === "saved"
      ? intl.formatMessage({
          id: policy.lastOperation.value
            ? "settings.drora.policy.state.savedOn"
            : "settings.drora.policy.state.savedOff",
        })
      : intl.formatMessage({
          id: policy.lastOperation.value
            ? "settings.drora.policy.state.unchangedOn"
            : "settings.drora.policy.state.unchangedOff",
        })
    : intl.formatMessage({ id: "settings.drora.policy.state.unknown" });

  const policyPending = policy.pending;
  const policyButtonsDisabled = !initialized || policyPending;

  const renderPreferenceActions = (key: PersonaPreferenceKey): ReactNode => {
    const slot = slots[key];
    const dirty = isPreferenceSlotDirty(slot);
    const diverged = isPreferenceSlotDiverged(slot);
    const draftValue = slot.draft?.value ?? null;
    const savedText =
      slot.saved?.status === "forgotten"
        ? intl.formatMessage({ id: "settings.drora.preferences.forgottenValue" })
        : preferenceValueText(intl, key, slot.saved?.value ?? null);
    const addressInvalid =
      key === PERSONA_PREFERENCE_KEYS.preferredAddress &&
      codePointLength((draftValue ?? "").trim()) === 0;
    return (
      <div className="w-full space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle"
            data-testid={`settings-persona-pref-${key}-value`}
          >
            {intl.formatMessage(
              { id: "settings.drora.preferences.currentValue" },
              { value: savedText },
            )}
          </span>
          <Button
            type="button"
            size="sm"
            data-testid={`settings-persona-pref-${key}-save`}
            disabled={
              !initialized || !dirty || addressInvalid || slot.pending || slot.forgetPending
            }
            onClick={() => {
              void handleSavePreference(key);
            }}
          >
            {slot.pending
              ? intl.formatMessage({ id: "settings.drora.preferences.saving" })
              : intl.formatMessage({ id: "settings.drora.preferences.save" })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid={`settings-persona-pref-${key}-cancel`}
            disabled={!dirty || slot.pending || slot.forgetPending}
            onClick={() => cancelPreferenceDraft(key)}
          >
            {intl.formatMessage({ id: "settings.drora.identity.cancel" })}
          </Button>
          {slot.saved ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`settings-persona-pref-${key}-forget`}
              disabled={!initialized || slot.pending || slot.forgetPending}
              onClick={() => requestForget(key)}
            >
              {slot.forgetPending
                ? intl.formatMessage({ id: "settings.drora.preferences.forgetting" })
                : intl.formatMessage({ id: "settings.drora.preferences.forget" })}
            </Button>
          ) : null}
        </div>
        {diverged ? (
          <div
            className="space-y-2 rounded-lg bg-warning-surface px-3 py-3 text-warning-surface-foreground"
            data-testid={`settings-persona-pref-${key}-divergence`}
          >
            <p className="text-ui-sm font-medium">
              {intl.formatMessage({ id: "settings.drora.divergence.title" })}
            </p>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-2 text-ui-sm">
              <span className="shrink-0 opacity-80">
                {intl.formatMessage({ id: "settings.drora.divergence.savedValue" })}
              </span>
              <span className="min-w-0 break-words opacity-80">{savedText}</span>
              <span className="min-w-0 break-words">
                <span className="me-1 opacity-70">
                  {intl.formatMessage({ id: "settings.drora.divergence.draftValue" })}
                </span>
                {preferenceValueText(intl, key, draftValue)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid={`settings-persona-pref-${key}-keep-draft`}
                onClick={() => keepPreferenceDraft(key)}
              >
                {intl.formatMessage({ id: "settings.drora.divergence.keepDraft" })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid={`settings-persona-pref-${key}-discard-draft`}
                disabled={slot.pending || slot.forgetPending}
                onClick={() => cancelPreferenceDraft(key)}
              >
                {intl.formatMessage({ id: "settings.drora.divergence.discardDraft" })}
              </Button>
            </div>
          </div>
        ) : null}
        {slot.notice ? (
          <p
            role="status"
            className={noticeClassName(slot.notice.tone)}
            data-testid={`settings-persona-pref-${key}-notice`}
          >
            {noticeText(intl, slot.notice)}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <SettingsGroupCard>
        <div className="px-4 pt-3">
          <div className="min-w-0">
            <div className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "settings.drora.preferences.title" })}
            </div>
            <div className="mt-1 text-ui-base leading-6 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.drora.preferences.description" })}
            </div>
          </div>
          {!initialized ? (
            <div className="mt-3">
              <span className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle">
                {intl.formatMessage({ id: "settings.drora.preferences.uninitializedHint" })}
              </span>
            </div>
          ) : null}
        </div>

        {/* U 使用许可（spec §5）：两态按钮各自显式提交；无全局查询，不冒充当前值。 */}
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.drora.policy.title" })}
          description={intl.formatMessage({ id: "settings.drora.policy.description" })}
          control={
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                data-testid="settings-persona-policy-enable"
                disabled={policyButtonsDisabled || policy.pendingTarget === true}
                onClick={() => {
                  void handleSetPolicy(true);
                }}
              >
                {policy.pendingTarget === true
                  ? intl.formatMessage({ id: "settings.drora.policy.enabling" })
                  : intl.formatMessage({ id: "settings.drora.policy.enable" })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="settings-persona-policy-disable"
                disabled={policyButtonsDisabled || policy.pendingTarget === false}
                onClick={() => {
                  void handleSetPolicy(false);
                }}
              >
                {policy.pendingTarget === false
                  ? intl.formatMessage({ id: "settings.drora.policy.disabling" })
                  : intl.formatMessage({ id: "settings.drora.policy.disable" })}
              </Button>
            </div>
          }
          detail={
            <div className="w-full space-y-2">
              <p className="text-ui-sm text-foreground" data-testid="settings-persona-policy-state">
                {policyStateText}
              </p>
              {policy.notice ? (
                <p
                  role="status"
                  className={noticeClassName(policy.notice.tone)}
                  data-testid="settings-persona-policy-notice"
                >
                  {policy.notice.kind === "saved"
                    ? intl.formatMessage({ id: "settings.drora.policy.notice.saved" })
                    : policy.notice.kind === "unchanged"
                      ? intl.formatMessage({ id: "settings.drora.policy.notice.unchanged" })
                      : policy.notice.kind === "conflict"
                        ? intl.formatMessage({ id: "settings.drora.policy.notice.conflict" })
                        : policy.notice.kind === "uninitialized"
                          ? intl.formatMessage({ id: "settings.drora.policy.notice.uninitialized" })
                          : noticeText(intl, policy.notice)}
                </p>
              ) : null}
            </div>
          }
        />

        {SELECT_PREFERENCE_KEYS.map((key) => (
          <SettingsRow
            key={key}
            label={intl.formatMessage({ id: `settings.drora.preferences.${key}` })}
            description={intl.formatMessage({
              id: `settings.drora.preferences.${key}Description`,
            })}
            control={
              <Select
                value={slots[key].draft?.value ?? slots[key].saved?.value ?? undefined}
                onValueChange={(value) => updatePreferenceDraft(key, value)}
              >
                <SelectTrigger
                  size="lg"
                  className="w-full min-w-0 justify-between sm:w-52"
                  data-testid={`settings-persona-pref-${key}`}
                  aria-label={intl.formatMessage({ id: `settings.drora.preferences.${key}` })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELECT_PREFERENCE_OPTIONS[key].map((option) => (
                    <SelectItem key={option} value={option}>
                      {preferenceValueText(intl, key, option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            detail={renderPreferenceActions(key)}
          />
        ))}

        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.preferences.preferredAddress" })}
          description={intl.formatMessage({
            id: "settings.drora.preferences.preferredAddressDescription",
          })}
          control={
            <Input
              size="lg"
              className="w-full min-w-0 sm:w-64"
              placeholder={intl.formatMessage({
                id: "settings.drora.preferences.preferredAddressPlaceholder",
              })}
              data-testid={`settings-persona-pref-${PERSONA_PREFERENCE_KEYS.preferredAddress}`}
              value={
                slots[PERSONA_PREFERENCE_KEYS.preferredAddress].draft?.value ??
                slots[PERSONA_PREFERENCE_KEYS.preferredAddress].saved?.value ??
                ""
              }
              maxLength={PERSONA_PREFERENCE_LIMITS.preferredAddressMax}
              onChange={(event) =>
                updatePreferenceDraft(
                  PERSONA_PREFERENCE_KEYS.preferredAddress,
                  event.currentTarget.value,
                )
              }
            />
          }
          detail={renderPreferenceActions(PERSONA_PREFERENCE_KEYS.preferredAddress)}
        />

        {/* 只读导出（合同 §7）：无资料不为导出初始化；取消/失败不虚报已保存。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.drora.export.title" })}
          description={intl.formatMessage({ id: "settings.drora.export.description" })}
          control={
            <Button
              type="button"
              size="lg"
              data-testid="settings-persona-export"
              disabled={exportPending || !platform?.saveFile}
              onClick={() => {
                void handleExport();
              }}
            >
              {exportPending
                ? intl.formatMessage({ id: "settings.drora.export.pending" })
                : intl.formatMessage({ id: "settings.drora.export.action" })}
            </Button>
          }
          detail={
            <div className="w-full space-y-2">
              {!platform?.saveFile ? (
                <p className="text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.drora.export.unsupported" })}
                </p>
              ) : null}
              {exportNotice ? (
                <p
                  role="status"
                  className={noticeClassName(exportNotice.tone)}
                  data-testid="settings-persona-export-notice"
                >
                  {exportNotice.kind === "saved"
                    ? exportNotice.path
                      ? intl.formatMessage(
                          { id: "settings.drora.export.savedPath" },
                          { path: exportNotice.path },
                        )
                      : intl.formatMessage({ id: "settings.drora.export.saved" })
                    : exportNotice.kind === "canceled"
                      ? intl.formatMessage({ id: "settings.drora.export.canceled" })
                      : exportNotice.kind === "noData"
                        ? intl.formatMessage({ id: "settings.drora.export.noData" })
                        : exportNotice.kind === "unsupported"
                          ? intl.formatMessage({ id: "settings.drora.export.unsupported" })
                          : exportNotice.kind === "failed"
                            ? exportNotice.message
                              ? intl.formatMessage(
                                  { id: "settings.drora.export.failed" },
                                  { message: exportNotice.message },
                                )
                              : intl.formatMessage({ id: "settings.drora.export.failedPlain" })
                            : exportNotice.kind === "code"
                              ? intl.formatMessage(
                                  { id: "settings.drora.export.code" },
                                  { code: exportNotice.code },
                                )
                              : intl.formatMessage(
                                  { id: "settings.drora.notice.rpc" },
                                  { message: exportNotice.message },
                                )}
                </p>
              ) : null}
            </div>
          }
        />
      </SettingsGroupCard>

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
    </>
  );
}
