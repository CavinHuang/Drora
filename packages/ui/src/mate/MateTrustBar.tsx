import { memo, useCallback, useState } from "react";
import type { AssistantTrustView } from "@drora/services";
import type { IAssistantTicketService } from "@drora/services";
import { ASSISTANT_ERROR_CODES, type AssistantMode } from "@drora/shared";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { Button } from "@/components/ui/button.js";
import { useMateStore } from "@/store/mateStore.js";
import { isMateAutoSwitchAvailable, resolveMateTrustGateProgress } from "./view-model.js";

/**
 * 信任条（01 §5 MateTrustBar）：would-accept 数 · 人工放行数 · 进度条。
 * 进度条填充率 = 放行 /（放行 + would-accept），分母为 0 时恒空。
 *
 * P4 auto 信任门（04 详设 §2）：达标（trust.gateOpen，服务侧实时判定的投影）且尚未
 * 处于 auto 模式时出现「切换 auto」唯一入口 → 仓库全局确认框（不可逆提示：列出当前
 * 名单与软预算）→ mateStore.setMode("auto")（服务侧信任门复核，未达标仍 mate.auto.locked）。
 * 信任门字段缺席（旧 Host 快照）只显示既有计数，不渲染入口——诚实降级，UI 不做第二判定。
 */
export const MateTrustBar = memo(function MateTrustBar({
  trust,
  mode,
  service,
  workspaceKey,
  allowlist,
  budgetMax,
}: {
  trust: AssistantTrustView;
  /** 当前模式（快照投影；auto 下不渲染切换入口）。 */
  mode: AssistantMode;
  /** 服务动作入口（hooks 注入；切换动作经 mateStore single-flight）。 */
  service: IAssistantTicketService;
  /** workspace 分域键（mateStore 动作隔离）。 */
  workspaceKey: string;
  /** 确认框列出的当前名单（快照投影）。 */
  allowlist: readonly string[];
  /** 确认框列出的软预算上限（快照投影）。 */
  budgetMax: number;
}) {
  const { intl } = useDroraIntl();
  const requestConfirmation = useConfirmDialogStore((state) => state.requestConfirmation);
  const setMode = useMateStore((state) => state.setMode);
  // 切换失败提示（role=alert；成功由快照推送收敛——模式徽标变化即成功反馈，无本地态）。
  const [failure, setFailure] = useState<string | null>(null);
  const denominator = trust.releaseCount + trust.wouldAcceptCount;
  const ratio = denominator > 0 ? trust.releaseCount / denominator : 0;
  const gateProgress = resolveMateTrustGateProgress(trust);
  const autoAvailable = isMateAutoSwitchAvailable(trust, mode);

  const handleSwitchToAuto = useCallback(() => {
    setFailure(null);
    void (async () => {
      const confirmed = await requestConfirmation({
        title: intl.formatMessage({ id: "mate.trust.autoSwitch.title" }),
        description: intl.formatMessage({ id: "mate.trust.autoSwitch.irreversible" }),
        // 04 详设 §2：确认框列出当前名单与预算（快照投影只读，弹窗内不可编辑）。
        codeBlock: {
          code: intl.formatMessage({ id: "mate.trust.autoSwitch.list" }, {
            allowlist: allowlist.join(", "),
            budget: budgetMax,
          }),
          language: "text",
        },
        confirmLabel: intl.formatMessage({ id: "mate.trust.autoSwitch.confirm" }),
        testId: "mate-auto-switch-confirm",
      });
      if (!confirmed) return;
      const result = await setMode(service, workspaceKey, "auto");
      if (!result.ok) {
        // mate.auto.locked=服务侧复核未达标（快照窗口内信任回落），专属文案；其余落通用。
        setFailure(
          result.error.code === ASSISTANT_ERROR_CODES.autoLocked
            ? intl.formatMessage({ id: "mate.error.auto" })
            : intl.formatMessage({ id: "mate.trust.autoSwitch.failed" }),
        );
      }
    })();
  }, [allowlist, budgetMax, intl, requestConfirmation, service, setMode, workspaceKey]);

  return (
    <div className="shrink-0 border-b border-border/50 px-3 py-2.5" data-testid="mate-trust-bar">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-sm font-medium text-foreground">
          {intl.formatMessage({ id: "mate.trust.title" })}
        </span>
        <span className="font-mono text-ui-xs text-foreground-subtle">
          {Math.round(ratio * 100)}%
        </span>
      </div>
      <div className="mt-1 flex items-center gap-4">
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "mate.trust.wouldAccept" }, { count: trust.wouldAcceptCount })}
        </span>
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "mate.trust.released" }, { count: trust.releaseCount })}
        </span>
        {autoAvailable ? (
          <Button
            size="xs"
            onClick={handleSwitchToAuto}
            data-testid="mate-auto-switch"
            className="ml-auto"
          >
            {intl.formatMessage({ id: "mate.trust.autoSwitch" })}
          </Button>
        ) : null}
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${ratio * 100}%` }} />
      </div>
      {gateProgress !== null ? (
        <p className="mt-1.5 text-ui-xs text-foreground-subtlest" data-testid="mate-trust-gate-progress">
          {intl.formatMessage({ id: "mate.trust.gate.progress" }, gateProgress)}
        </p>
      ) : null}
      <p className="mt-1.5 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.trust.hint" })}
      </p>
      {failure !== null ? (
        <p role="alert" className="text-ui-sm text-destructive" data-testid="mate-auto-switch-error">
          {failure}
        </p>
      ) : null}
    </div>
  );
});
