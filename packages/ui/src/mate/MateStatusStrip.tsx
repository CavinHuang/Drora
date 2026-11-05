import { memo } from "react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";

import type { MateStatusLine } from "./view-model.js";

const MATE_STATUS_MODE_MESSAGE_ID: Record<MateStatusLine["mode"], string> = {
  observe: "mate.status.mode.observe",
  off: "mate.status.mode.off",
  auto: "mate.status.mode.auto",
};

/**
 * 大副会话状态条（02 详设 §1.4 Surface A：mode/活动工单数摘要行）。
 *
 * 单行只读投影：mode 徽标 + `deriveMateStatusLine` 一次折叠（活动数=软预算口径
 * dispatched+running+awaiting；queued 单列；pending=待决策卡数）。数据与 MatePaneHeader 的
 * 过滤计数同源（同一快照、同一 view-model 口径函数），不构成第二状态。
 *
 * **P4 第二棒（04 详设 §4）**：补配额行——`resolveMateQuotaLine`（当日三类累计/生效
 * 配额/余量）；snapshot.quota 缺席（旧 Host）不渲染（诚实降级，P2 形态原样）。
 */
export const MateStatusStrip = memo(function MateStatusStrip({
  status,
  quota,
}: {
  status: MateStatusLine;
  /** 配额行投影（resolveMateQuotaLine；缺席=旧 Host 快照，不渲染）。 */
  quota?: { used: number; quota: number; remaining: number } | null;
}) {
  const { intl } = useDroraIntl();
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-1.5"
      data-testid="mate-status-strip"
    >
      <span
        className={cn(
          // 最近圆角容器是 side pane 壳（rounded-xl），按 DESIGN.md 控件表用 rounded-lg。
          "shrink-0 rounded-lg px-2 py-0.5 text-ui-xs font-medium",
          status.mode === "observe"
            ? "bg-selected text-foreground"
            : "bg-surface text-foreground-subtle",
        )}
        data-testid="mate-status-mode"
      >
        {intl.formatMessage({ id: MATE_STATUS_MODE_MESSAGE_ID[status.mode] })}
      </span>
      <span className="text-ui-xs text-foreground-subtlest" data-testid="mate-status-line">
        {intl.formatMessage(
          { id: "mate.status.line" },
          {
            active: status.active,
            max: status.max,
            queued: status.queued,
            pending: status.pending,
          },
        )}
      </span>
      {quota ? (
        <span
          className="shrink-0 text-ui-xs text-foreground-subtlest"
          data-testid="mate-status-quota"
        >
          {intl.formatMessage({ id: "mate.status.quota" }, quota)}
        </span>
      ) : null}
    </div>
  );
});
