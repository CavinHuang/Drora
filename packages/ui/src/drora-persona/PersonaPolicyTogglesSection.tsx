import { PERSONA_LEARNING_BUDGET } from "@drora/shared";
import { Switch } from "@/components/ui/switch.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import type { PersonaPreferences } from "./usePersonaPreferences.js";
import { noticeClassName, noticeText } from "./PersonaExpressionSection.js";

/**
 * 「开关与许可」分区（spec §10 第十六批）：E 执行开关＋U 偏好注入＋L 自动学习三个开关
 * 归一区。语义保持既有合同：
 * - E 经原 Settings 保存通道（AppSettings.personaEnabled），文案必须说明
 *   「用于新建或真正重新加载的会话」并附隐私说明；
 * - U/L 当前值来自 getPersonaLearningOverview（服务权威读路径）；读取失败按「当前生效值
 *   未知」诚实降级并整体禁用开关，不做「当前会话已关闭」类断言；关闭 U 有级联确认
 *   （同一事务关 L、撤租约、清未提交候选/负载，重开 U 不恢复 L——合同 §4.2）；
 * - 学习预算/计数在 L 行下如实展示（预算上界引用 shared PERSONA_LEARNING_BUDGET）。
 */

/** 策略开关状态行：当前值来自 overview（服务权威）；无 overview 时诚实降级为未知。 */
function policyStateText(
  intl: { formatMessage: (descriptor: { id: string }) => string },
  currentValue: boolean | null,
  lastOperation: { value: boolean; kind: "saved" | "unchanged" } | null,
): string {
  const current =
    currentValue === null
      ? intl.formatMessage({ id: "settings.drora.policy.state.unknown" })
      : intl.formatMessage({
          id: currentValue ? "settings.drora.policy.state.on" : "settings.drora.policy.state.off",
        });
  if (!lastOperation) return current;
  const submitted = intl.formatMessage({
    id:
      lastOperation.kind === "saved"
        ? lastOperation.value
          ? "settings.drora.policy.state.savedOn"
          : "settings.drora.policy.state.savedOff"
        : lastOperation.value
          ? "settings.drora.policy.state.unchangedOn"
          : "settings.drora.policy.state.unchangedOff",
  });
  return `${current}　${submitted}`;
}

export function PersonaPolicyTogglesSection({
  personaEnabled,
  onPersonaEnabledChange,
  preferences,
  onDisableUsePreferences,
}: {
  personaEnabled: boolean;
  onPersonaEnabledChange: (enabled: boolean) => Promise<void>;
  preferences: PersonaPreferences;
  /** 关闭 U 的入口（级联确认对话框由分区根部持有，确认后才真正提交 false）。 */
  onDisableUsePreferences: () => void;
}) {
  const { intl } = useDroraIntl();
  const { policy, learningOverview, loadPhase, loadErrorCode, handleSetPolicy } = preferences;

  const overviewPolicy =
    learningOverview && learningOverview.state === "initialized" ? learningOverview.policy : null;
  const overviewBudget =
    learningOverview && learningOverview.state === "initialized" ? learningOverview.budget : null;
  const overviewCounters =
    learningOverview && learningOverview.state === "initialized" ? learningOverview.counters : null;
  const policyControlsReady = loadPhase === "ready" && preferences.initialized;
  const policyPending = policy.pending;
  // U/L 当前值以概览为权威：概览缺席（读取失败/旧 wire）时开关禁用，按「当前生效值未知」
  // 降级，不猜测值发请求（合同 §4.2；spec §10 第十六批「未知时禁用」）。
  const policySwitchDisabled = !policyControlsReady || policyPending || overviewPolicy === null;

  const lastOperationFor = (switchName: "usePreferences" | "autoLearn") =>
    policy.lastOperation && policy.lastOperation.switch === switchName
      ? { value: policy.lastOperation.value, kind: policy.lastOperation.kind }
      : null;

  return (
    <SettingsGroupCard data-testid="settings-persona-toggles-section">
      {/* 执行许可 E：经原 Settings 保存通道；只影响新建/真正重新加载的会话。 */}
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

      {/* U 偏好注入（spec §5）：开关提交 setPersonalPolicy；关闭走级联确认（合同 §4.2）。 */}
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.drora.policy.title" })}
        description={intl.formatMessage({ id: "settings.drora.policy.description" })}
        control={
          <Switch
            data-testid="settings-persona-policy-switch"
            aria-label={intl.formatMessage({ id: "settings.drora.policy.title" })}
            checked={overviewPolicy ? overviewPolicy.usePreferences : false}
            disabled={policySwitchDisabled}
            onCheckedChange={(checked) => {
              if (checked) {
                void handleSetPolicy(true);
              } else {
                onDisableUsePreferences();
              }
            }}
          />
        }
        detail={
          <div className="w-full space-y-2">
            <p className="text-ui-sm text-foreground" data-testid="settings-persona-policy-state">
              {loadPhase === "error"
                ? intl.formatMessage(
                    { id: "settings.drora.preferences.loadFailed" },
                    loadErrorCode ? { code: loadErrorCode } : undefined,
                  )
                : policyStateText(
                    intl,
                    overviewPolicy ? overviewPolicy.usePreferences : null,
                    lastOperationFor("usePreferences"),
                  )}
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
                        ? intl.formatMessage({
                            id: "settings.drora.policy.notice.uninitialized",
                          })
                        : noticeText(intl, policy.notice)}
              </p>
            ) : null}
          </div>
        }
      />

      {/* L 自动学习（spec §5/§8）：独立授权、默认 off；开启＝U&&L 一次提交；无虚构经历页。 */}
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.drora.learning.title" })}
        description={intl.formatMessage({ id: "settings.drora.learning.description" })}
        control={
          <Switch
            data-testid="settings-persona-learning-switch"
            aria-label={intl.formatMessage({ id: "settings.drora.learning.title" })}
            checked={overviewPolicy ? overviewPolicy.autoLearn : false}
            disabled={policySwitchDisabled}
            onCheckedChange={(checked) => {
              if (checked) {
                // 学习前置＝U&&L：一次 CAS 完成一致状态（显式开 U 是该操作语义的一部分）。
                void handleSetPolicy(true, true);
              } else if (overviewPolicy) {
                // 关闭 L 保持当前 U 值不变（概览缺席时开关已禁用，不猜测发请求）。
                void handleSetPolicy(overviewPolicy.usePreferences, false);
              }
            }}
          />
        }
        detail={
          <div className="w-full space-y-2">
            <p className="text-ui-sm text-foreground" data-testid="settings-persona-learning-state">
              {policyStateText(
                intl,
                overviewPolicy ? overviewPolicy.autoLearn : null,
                lastOperationFor("autoLearn"),
              )}
            </p>
            {overviewBudget ? (
              <p
                className="text-ui-sm text-foreground-subtle"
                data-testid="settings-persona-learning-budget"
              >
                {intl.formatMessage(
                  { id: "settings.drora.learning.budget" },
                  {
                    attempts: String(overviewBudget.attemptsUsed),
                    attemptsMax: String(PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax),
                    input: String(overviewBudget.inputTokensUsed),
                    inputMax: String(PERSONA_LEARNING_BUDGET.dailyInputTokensMax),
                    output: String(overviewBudget.outputTokensUsed),
                    outputMax: String(PERSONA_LEARNING_BUDGET.dailyOutputTokensMax),
                  },
                )}
              </p>
            ) : null}
            {overviewCounters ? (
              <p
                className="text-ui-sm text-foreground-subtle"
                data-testid="settings-persona-learning-counters"
              >
                {intl.formatMessage(
                  { id: "settings.drora.learning.counters" },
                  {
                    received: String(overviewCounters.received),
                    dropped: String(overviewCounters.droppedQueueFull),
                    applied: String(overviewCounters.workApplied),
                    noChange: String(overviewCounters.workNoChange),
                    rejected: String(overviewCounters.workRejected),
                  },
                )}
              </p>
            ) : null}
            {policy.notice ? (
              <p
                role="status"
                className={noticeClassName(policy.notice.tone)}
                data-testid="settings-persona-learning-notice"
              >
                {noticeText(intl, policy.notice)}
              </p>
            ) : null}
          </div>
        }
      />
    </SettingsGroupCard>
  );
}
