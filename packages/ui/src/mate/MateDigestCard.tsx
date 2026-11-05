import { memo, useState } from "react";
import { BellRingIcon, MailCheckIcon } from "lucide-react";
import type { AssistantSnapshot, IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { formatTaskRelativeTime } from "@/lib/taskListItemPresentation.js";
import { Button } from "@/components/ui/button.js";

import { resolveMateErrorMessageId } from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";

/**
 * 配额中心摘要卡（04 详设 §4 UI 侧，P4 第二棒）：同一快照源分两节——
 * ①watchdog 通知区（快照 watchdogNotices ≤5：停滞/滞留/饥饿判据的配额内通知，新→旧）；
 * ②近 ≤7 日未投递摘要（quota.pendingDigest：超额 report/bubble 推送的次日聚合），
 *   「标记已投递」按钮=`markDailyDigestDelivered` 回执（只结清今日之前的积压）。
 * 两节皆空 → 整卡不渲染（快照缺席字段=旧 Host，同样不渲染——诚实降级）。
 * 全部数据来自 useAssistantTickets 推送快照，无第二计数器（P3 气泡注记兑现）。
 */
export const MateDigestCard = memo(function MateDigestCard({
  snapshot,
  service,
  workspaceKey,
}: {
  snapshot: AssistantSnapshot;
  service: IAssistantTicketService;
  /** workspace 分域键（mateStore 动作隔离；摘要卡是会话级面板件，动作用当前 tab 域）。 */
  workspaceKey: string;
}) {
  const { intl } = useDroraIntl();
  const markDelivered = useMateStore((state) => state.markDailyDigestDelivered);
  const [failure, setFailure] = useState<string | null>(null);
  const notices = snapshot.watchdogNotices ?? [];
  const pendingDigest = snapshot.quota?.pendingDigest ?? [];
  const digestItemCount = pendingDigest.reduce((total, day) => total + day.items.length, 0);
  if (notices.length === 0 && digestItemCount === 0) return null;

  const handleMarkDelivered = (): void => {
    setFailure(null);
    markDelivered(service, workspaceKey)
      .then((result) => {
        // 成功由快照推送收敛（pendingDigest 出清即成功反馈）；失败臂出 role=alert。
        if (!result.ok) setFailure(resolveMateErrorMessageId(result.error));
      })
      .catch(() => setFailure("mate.error.generic"));
  };

  return (
    <div
      className="rounded-lg border border-card-border bg-card p-3"
      data-testid="mate-digest-card"
    >
      <div className="flex items-center gap-2">
        <BellRingIcon aria-hidden className="size-4 shrink-0 text-foreground-subtle" />
        <span className="text-ui-sm font-medium text-foreground">
          {intl.formatMessage({ id: "mate.digest.title" })}
        </span>
        <span
          className="ml-auto shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
          data-testid="mate-digest-quota"
        >
          {intl.formatMessage(
            { id: "mate.digest.quotaUsed" },
            { used: snapshot.quota?.total ?? 0, quota: snapshot.quota?.quota ?? 0 },
          )}
        </span>
      </div>

      {notices.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5" data-testid="mate-digest-notices">
          {notices.map((notice, index) => (
            <li
              // 通知无稳定 id（kv 通知区按新→旧投影）；键=时刻+序号即可稳定到下一帧。
              key={`${notice.ticketId}:${notice.atMs}:${index}`}
              className="rounded-md bg-surface px-2 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0 rounded-sm bg-warning-surface px-1.5 py-0.5 text-ui-xs text-warning-surface-foreground"
                  data-testid="mate-digest-notice-kind"
                >
                  {intl.formatMessage(
                    { id: `mate.watchdog.kind.${notice.kind}` },
                    // 未知判据类别按原文值展示（封闭映射外的诚实降级）。
                  )}
                </span>
                <span className="font-mono text-ui-xs text-foreground-subtlest">
                  {notice.ticketId}
                </span>
                <span className="ml-auto shrink-0 text-ui-xs text-foreground-subtlest">
                  {formatTaskRelativeTime(notice.atMs, intl)}
                </span>
              </div>
              <p className="mt-1 break-words text-ui-xs text-foreground-subtle">{notice.summary}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {digestItemCount > 0 ? (
        <div className="mt-2 flex flex-col gap-2" data-testid="mate-digest-pending">
          {pendingDigest.map((day) => (
            <div key={day.date} className="rounded-md bg-surface px-2 py-1.5">
              <p className="font-mono text-ui-xs text-foreground-subtlest">{day.date}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {day.items.map((item, index) => (
                  <li
                    key={index}
                    className="break-words border-l-2 border-border pl-2 text-ui-xs text-foreground-subtle"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Button
            size="xs"
            variant="outline"
            className="self-start"
            onClick={handleMarkDelivered}
            data-testid="mate-digest-delivered"
          >
            <MailCheckIcon aria-hidden className="mr-1 size-3.5" />
            {intl.formatMessage({ id: "mate.digest.markDelivered" })}
          </Button>
        </div>
      ) : null}

      {failure !== null ? (
        <p role="alert" className="mt-1.5 text-ui-sm text-destructive" data-testid="mate-digest-error">
          {intl.formatMessage({ id: failure })}
        </p>
      ) : null}
    </div>
  );
});
