import { memo } from "react";
import type { AssistantTrustView } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

/**
 * 信任条（01 §5 MateTrustBar）：would-accept 数 · 人工放行数 · 进度条。
 * P1 双按钮积累（显式路径的放行与未指名判定都进信任记录，01 §1.2）；进度条填充率 =
 * 放行 /（放行 + would-accept），分母为 0 时恒空——P1 没有阈值语义（auto 信任门的
 * 达标线属 P4，00 master plan §5），这里只可视化「放行占比」，不声称达标进度。
 */
export const MateTrustBar = memo(function MateTrustBar({ trust }: { trust: AssistantTrustView }) {
  const { intl } = useDroraIntl();
  const denominator = trust.releaseCount + trust.wouldAcceptCount;
  const ratio = denominator > 0 ? trust.releaseCount / denominator : 0;
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
      <p className="mt-1.5 text-ui-xs text-foreground-subtlest">
        {intl.formatMessage({ id: "mate.trust.hint" })}
      </p>
    </div>
  );
});
