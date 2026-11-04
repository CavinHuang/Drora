import {
  PERSONA_PREFERENCE_ALLOWED_VALUES,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_PREFERENCE_LIMITS,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
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
import { PersonaSourceStatus } from "./PersonaSourceStatus.js";
import {
  isPreferenceSlotDirty,
  isPreferenceSlotDiverged,
  type PersonaPreferenceNotice,
} from "./personaPreferenceModel.js";
import type { PersonaPreferences } from "./usePersonaPreferences.js";

/**
 * 「它怎么说话」分区（spec §10 第十六批）：回复语言/解释详略/协作风格/称呼四个交流默认键
 * 归入一区，即时保存——三个受控下拉变更即提交（trigger=select），称呼文本失焦或停顿约
 * 1 秒提交；不再有逐键「保存/放弃修改」按钮，脏字段提供 ↺ 单键回退与「忘记」（逻辑撤销，
 * 确认对话框在 PersonaSettingsSection 根部）。来源状态/争议/抑制逐键如实展示；
 * CAS 分歧未解决时自动提交暂停，由分歧面板引导。
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

type IntlLike = { formatMessage: (descriptor: { id: string }) => string };
type IntlValues = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
};

/** 受控值 → 用户文案（preferredAddress 是自由文本原样展示；其余走受控词汇键）。 */
export function preferenceValueText(
  intl: IntlLike,
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
export function noticeText(intl: IntlValues, notice: PersonaPreferenceNotice): string {
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

export function noticeClassName(tone: PersonaPreferenceNotice["tone"]): string {
  return tone === "success"
    ? "text-ui-sm text-success"
    : tone === "error"
      ? "text-ui-sm text-destructive"
      : "text-ui-sm text-foreground-subtle";
}

export function PersonaExpressionSection({ preferences }: { preferences: PersonaPreferences }) {
  const { intl } = useDroraIntl();
  const {
    loadPhase,
    loadErrorCode,
    initialized,
    slots,
    learningOverview,
    reload,
    updatePreferenceDraft,
    cancelPreferenceDraft,
    flushPreferenceSave,
    requestForget,
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

  const overviewSources =
    learningOverview && learningOverview.state === "initialized" ? learningOverview.sources : null;

  /** 逐键附加区：回退/忘记、来源状态、分歧面板与通知（即时保存的呈现面）。 */
  const renderFieldExtras = (key: PersonaPreferenceKey) => {
    const slot = slots[key];
    const diverged = isPreferenceSlotDiverged(slot);
    const draftValue = slot.draft?.value ?? null;
    const savedText =
      slot.saved?.status === "forgotten"
        ? intl.formatMessage({ id: "settings.drora.preferences.forgottenValue" })
        : preferenceValueText(intl, key, slot.saved?.value ?? null);
    const addressInvalid =
      key === PERSONA_PREFERENCE_KEYS.preferredAddress &&
      codePointLength((draftValue ?? "").trim()) === 0;
    const mergedSourceCount = overviewSources?.filter((source) => source.key === key).length ?? 0;
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
          {slot.saved ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid={`settings-persona-pref-${key}-forget`}
              disabled={!initialized || slot.pending || slot.forgetPending || slot.allowPending}
              onClick={() => requestForget(key)}
            >
              {slot.forgetPending
                ? intl.formatMessage({ id: "settings.drora.preferences.forgetting" })
                : intl.formatMessage({ id: "settings.drora.preferences.forget" })}
            </Button>
          ) : null}
          {addressInvalid ? (
            <span className="text-ui-sm text-destructive">
              {intl.formatMessage({ id: "settings.drora.preferences.preferredAddressInvalid" })}
            </span>
          ) : null}
        </div>
        {/* 来源状态（合同 §1.2/§8）：类别/认识状态/争议/抑制分行如实展示，互不混淆。 */}
        {slot.saved ? (
          <PersonaSourceStatus
            intl={intl}
            saved={slot.saved}
            mergedSourceCount={mergedSourceCount}
            allowPending={slot.allowPending}
            initialized={initialized}
            onAllowLearning={() => {
              void preferences.handleAllowLearning(key);
            }}
          />
        ) : null}
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
                onClick={() => preferences.keepPreferenceDraft(key)}
              >
                {intl.formatMessage({ id: "settings.drora.divergence.keepDraft" })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid={`settings-persona-pref-${key}-discard-draft`}
                disabled={slot.pending || slot.forgetPending || slot.allowPending}
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

  /** 行尾 ↺ 回退（spec §10 第十六批）：仅脏字段可见，点击回到已保存值。 */
  const renderRevertButton = (key: PersonaPreferenceKey) =>
    isPreferenceSlotDirty(slots[key]) ? (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={intl.formatMessage({ id: "settings.drora.revert" })}
        data-testid={`settings-persona-pref-${key}-revert`}
        disabled={slots[key].pending || slots[key].forgetPending || slots[key].allowPending}
        onClick={() => cancelPreferenceDraft(key)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    ) : null;

  return (
    <SettingsGroupCard data-testid="settings-persona-expression-section">
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

      {SELECT_PREFERENCE_KEYS.map((key) => (
        <SettingsRow
          key={key}
          label={intl.formatMessage({ id: `settings.drora.preferences.${key}` })}
          description={intl.formatMessage({
            id: `settings.drora.preferences.${key}Description`,
          })}
          control={
            <div className="flex items-center gap-1">
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
              {renderRevertButton(key)}
            </div>
          }
          detail={renderFieldExtras(key)}
        />
      ))}

      <SettingsRow
        label={intl.formatMessage({ id: "settings.drora.preferences.preferredAddress" })}
        description={intl.formatMessage({
          id: "settings.drora.preferences.preferredAddressDescription",
        })}
        control={
          <div className="flex items-center gap-1">
            <Input
              size="lg"
              className="w-full min-w-0 sm:w-52"
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
              onBlur={() => {
                void flushPreferenceSave(PERSONA_PREFERENCE_KEYS.preferredAddress, "keyboard");
              }}
            />
            {renderRevertButton(PERSONA_PREFERENCE_KEYS.preferredAddress)}
          </div>
        }
        detail={renderFieldExtras(PERSONA_PREFERENCE_KEYS.preferredAddress)}
      />
    </SettingsGroupCard>
  );
}
