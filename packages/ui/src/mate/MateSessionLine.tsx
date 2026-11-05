import { memo } from "react";
import { AnchorIcon } from "lucide-react";
import type { SessionMateActivity } from "@drora/shared/drora-protocol-v4";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

/**
 * 任务行 mate 摘要行（specs §11.4 / 02 详设 §6 的 `mate/session-line.ts` 接缝，P2
 * Surface 批次交付）：任务行 activity 的 mate 字段（SESSION_MATE_ACTIVITY_KEY="mate"，
 * host TicketService 快照合成、controller tasks-index 帧透传）挂左侧行，teamActivity
 * 的 TeamSessionLine 同位。
 *
 * - 旧帧/旧 Host/远程降级面无 mate 字段 → 渲染 null（字段缺席合法，零徽标）。
 * - P2 无导航端口：纯摘要行（TeamSessionLine 的 open 跳转需要 team 导航通道；mate 的
 *   「打开大副面板」直达随 P3 桌宠 tray 批次的同一导航端口交付——specs §14 P3）。
 * - 计数已由 host 侧有界化（ASSISTANT_MATE_ACTIVITY_LIMITS），行内不再截断。
 */
export const MateSessionLine = memo(function MateSessionLine({
  activity,
}: {
  /** 任务行 activity.mate（host 合成摘要）；缺席=无徽标（旧帧/降级面合法）。 */
  activity: SessionMateActivity | undefined;
}) {
  const { intl } = useDroraIntl();
  // 旧会话/旧 Host 无 mate 摘要，不能因新增入口引入额外订阅或占位。
  if (!activity) return null;
  const pending = activity.pendingDecisions > 0;
  return (
    <div
      className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-ui-sm text-foreground-subtle"
      data-testid="mate-session-line"
      aria-label={intl.formatMessage(
        { id: "mate.sessionLine.aria" },
        { active: activity.activeCount, pending: activity.pendingDecisions },
      )}
    >
      <AnchorIcon
        aria-hidden
        className={pending ? "size-3 shrink-0 text-destructive" : "size-3 shrink-0"}
      />
      <span>
        {intl.formatMessage({ id: "mate.sessionLine.active" }, { active: activity.activeCount })}
      </span>
      {pending ? (
        <span
          className="rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
          data-testid="mate-session-line-pending"
        >
          {intl.formatMessage(
            { id: "mate.sessionLine.pending" },
            { pending: activity.pendingDecisions },
          )}
        </span>
      ) : null}
    </div>
  );
});
