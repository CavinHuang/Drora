import type { ReactNode } from "react";
import {
  PERSONA_PREFERENCE_KEYS,
  type PersonaPreferenceFacts,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { Button } from "@/components/ui/button.js";

/**
 * 偏好槽的来源状态显示（P1b；spec §10「来源状态、争议、抑制」、合同 §1.2/§8）。
 * 诚实呈现边界：来源类别（settings/extraction）、认识状态（explicit/inferred）、争议
 * （disputed，独立于 status，只经保存/忘记解决——不提供「解除争议」按钮）、抑制
 * （autoSuppressed，经 allowLearningForKey 解除——generation++，只接受之后的新机会）
 * 与待确认候选是分立事实，分行/分徽标如实展示，不合并成一个综合状态。
 * 从 PersonaPreferencesSection 拆出满足 max-file-lines；展示为纯函数组件（无状态）。
 */

type IntlLike = { formatMessage: (descriptor: { id: string }) => string };
type IntlValues = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
};

/** 受控值 → 用户文案（preferredAddress 是自由文本原样展示；其余走受控词汇键）。 */
function preferenceValueText(
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

export function PersonaSourceStatus({
  intl,
  saved,
  mergedSourceCount,
  allowPending,
  initialized,
  onAllowLearning,
}: {
  intl: IntlValues;
  saved: PersonaPreferenceFacts;
  mergedSourceCount: number;
  allowPending: boolean;
  initialized: boolean;
  onAllowLearning: () => void;
}): ReactNode {
  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid={`settings-persona-pref-${saved.key}-source-status`}
      >
        <span className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle">
          {intl.formatMessage({
            id:
              saved.provenanceKind === "settings"
                ? "settings.drora.preferences.provenance.settings"
                : "settings.drora.preferences.provenance.extraction",
          })}
        </span>
        <span className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle">
          {intl.formatMessage({
            id:
              saved.epistemicStatus === "explicit"
                ? "settings.drora.preferences.epistemic.explicit"
                : "settings.drora.preferences.epistemic.inferred",
          })}
        </span>
        {mergedSourceCount > 0 ? (
          <span className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle">
            {intl.formatMessage(
              { id: "settings.drora.learning.sourcesCount" },
              { count: String(mergedSourceCount) },
            )}
          </span>
        ) : null}
        {saved.disputed ? (
          <span
            className="rounded-md bg-warning-surface px-2.5 py-1 text-ui-xs font-medium text-warning-surface-foreground"
            data-testid={`settings-persona-pref-${saved.key}-disputed`}
          >
            {intl.formatMessage({ id: "settings.drora.preferences.disputedBadge" })}
          </span>
        ) : null}
        {saved.autoSuppressed ? (
          <>
            <span
              className="rounded-md bg-surface px-2.5 py-1 text-ui-xs font-medium text-foreground-subtle"
              data-testid={`settings-persona-pref-${saved.key}-suppressed`}
            >
              {intl.formatMessage({ id: "settings.drora.preferences.suppressedBadge" })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`settings-persona-pref-${saved.key}-allow-learning`}
              disabled={!initialized || allowPending}
              onClick={onAllowLearning}
            >
              {allowPending
                ? intl.formatMessage({ id: "settings.drora.preferences.allowing" })
                : intl.formatMessage({ id: "settings.drora.preferences.allowLearning" })}
            </Button>
          </>
        ) : null}
      </div>
      {saved.pendingCandidate ? (
        <p
          className="text-ui-sm text-foreground-subtle"
          data-testid={`settings-persona-pref-${saved.key}-pending-candidate`}
        >
          {intl.formatMessage(
            { id: "settings.drora.preferences.pendingCandidate" },
            { value: preferenceValueText(intl, saved.key, saved.pendingCandidate.proposedValue) },
          )}
        </p>
      ) : null}
      {saved.disputed ? (
        <p
          className="text-ui-sm text-foreground-subtle"
          data-testid={`settings-persona-pref-${saved.key}-disputed-hint`}
        >
          {intl.formatMessage({ id: "settings.drora.preferences.disputedHint" })}
        </p>
      ) : null}
    </>
  );
}
