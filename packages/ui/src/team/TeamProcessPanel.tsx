import { useMemo } from "react";
import { HistoryIcon, RefreshCwIcon, SaveIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTeamHistory, type TeamHistoryConnection } from "@/hooks/useTeamHistory.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { teamActor } from "./presentation.js";
import type { TeamUiFocus } from "./contract.js";
import type { TeamPanelModel } from "./view-model.js";

/**
 * 过程页 refreshKey 的投影侧活性信号（§19 契约 6 活性缝 + §21 A5 补齐，
 * specs/agents-team.md，2026-10-24；照 useWorkflowRunJournalSummaries 的 refreshKey
 * 先例——那里注释记载「跑完的 run 不挪位」是实测修过的 bug）：团队跑动中打开过程面，
 * journal 新事件（任务领取/邮件/终态）必须自动出现，而不是停在打开时刻的一页。
 * team 投影没有单调 revision，用看板各列计数 + working 成员数 + 最大任务 updatedAt +
 * 尾窗末条消息 id 拼投影侧单调信号——任一活动边缘都会抬升它，抬升即重查当前页；
 * 手动「回最新」保留为兜底（history.latest 不变）。
 *
 * §21 A5 补入的两个真实活动边缘（均为投影既有字段，零 wire 词表扩展）：
 * (a) **送达翻转**：只改 `mailboxTail[].delivered` 并新增 journal message_delivered——
 *     messageId/计数/updatedAt 全不变，原信号不动（尾窗徽标可见但过程页漏刷新）；
 *     拼入末条 delivered 后翻转即抬升。
 * (b) **无板活动**：halt/resume 仅迁移 record.status + journal + notifyChange，不动板
 *     计数与任务 updatedAt——拼入 team.status（模型层即投影 status）后迁移即抬升。
 *
 * 纯函数导出：TeamProcessPanel 消费，测试直接断言两类边缘各自抬升（§21 A5 测试②）。
 */
export function teamProcessActivitySignal(model: TeamPanelModel): string {
  const lastTaskUpdatedAt = [
    ...model.board.completed,
    ...model.board.attention,
    ...model.board.inProgress,
    ...model.board.pending,
  ].reduce<string>(
    (max, task) => (task.updatedAt !== undefined && task.updatedAt > max ? task.updatedAt : max),
    "",
  );
  const lastMail = model.mailboxTail[model.mailboxTail.length - 1];
  return [
    model.board.completed.length,
    model.board.inProgress.length,
    model.board.attention.length,
    model.board.pending.length,
    model.members.filter((member) => member.state === "working").length,
    lastTaskUpdatedAt,
    lastMail?.messageId ?? "",
    // §21 A5 边缘 (a)：末条 delivered 三值（true/false/缺席）各自占位——缺席用 ""
    // 与 false 区分（String(undefined) 会与显式 false 撞成同段）。
    lastMail?.delivered === undefined ? "" : String(lastMail.delivered),
    // §21 A5 边缘 (b)：无板活动（halt/resume）只迁移投影 status。
    model.status,
  ].join("|");
}

export function TeamProcessPanel({
  model,
  connection,
  onSelect,
}: {
  model: TeamPanelModel;
  connection?: TeamHistoryConnection;
  onSelect: (focus: TeamUiFocus) => void;
}) {
  const { intl } = useDroraIntl();
  // §19 契约 6 活性缝 + §21 A5 补齐：信号构造收口到导出纯函数 teamProcessActivitySignal
  //（含送达翻转/无板活动两类边缘，依据见该函数头注）；此处仅按 model 记忆化。
  const activitySignal = useMemo(() => teamProcessActivitySignal(model), [model]);
  const history = useTeamHistory(model.teamId, connection, activitySignal);
  const lead = intl.formatMessage({ id: "team.ui.lead" });
  return (
    <section
      data-testid="team-process"
      aria-label={intl.formatMessage({ id: "team.ui.savedProcess" })}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-ui-sm">
          <HistoryIcon className="size-3.5" />
          {intl.formatMessage({ id: "team.ui.savedProcess" })}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="pointer-coarse:min-h-11"
          onClick={history.latest}
          disabled={history.loading}
        >
          <RefreshCwIcon className="size-3" />
          {intl.formatMessage({ id: "team.ui.latest" })}
        </Button>
      </div>
      {history.loading ? (
        <p role="status" className="py-5 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "team.ui.historyLoading" })}
        </p>
      ) : history.error ? (
        <div
          role="status"
          data-testid="team-history-error"
          className="rounded-lg border border-border p-3 text-ui-sm"
        >
          <p>{intl.formatMessage({ id: "team.ui.historyUnavailable" })}</p>
          {connection ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 pointer-coarse:min-h-11"
              onClick={history.retry}
            >
              {intl.formatMessage({ id: "team.ui.retry" })}
            </Button>
          ) : null}
        </div>
      ) : history.data ? (
        <>
          {history.older ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-3 pointer-coarse:min-h-11"
              onClick={history.older}
              data-testid="team-history-older"
            >
              {intl.formatMessage({ id: "team.ui.older" })}
            </Button>
          ) : null}
          {!history.data.events.length ? (
            <p className="py-6 text-ui-sm text-foreground-subtle" data-testid="team-history-empty">
              {intl.formatMessage({ id: "team.ui.historyEmpty" })}
            </p>
          ) : null}
          <ol
            className="flex flex-col gap-3"
            aria-label={intl.formatMessage({ id: "team.ui.process" })}
          >
            {history.data.events.map((entry) => (
              <li
                key={entry.seq}
                className="border-l border-workflow-trace pl-3"
                data-testid="team-history-entry"
              >
                <div className="flex flex-wrap items-center gap-x-2 text-ui-sm text-foreground-subtle">
                  <span className="font-mono">#{entry.seq}</span>
                  <time dateTime={entry.at}>{entry.at}</time>
                </div>
                <details className="mt-1 text-ui-caption">
                  <summary className="break-words rounded-md py-1 focus-visible:ring-2 focus-visible:ring-ring">
                    {intl.formatMessage({ id: `team.history.kind.${entry.kind}` })}
                    {entry.title ? ` · ${entry.title}` : ""}
                    {entry.from && entry.to
                      ? ` · ${teamActor(model, entry.from, lead)} → ${teamActor(model, entry.to, lead)}`
                      : ""}
                    {entry.memberName ? ` · ${entry.memberName}` : ""}
                  </summary>
                  {entry.message !== undefined ? (
                    <p className="mt-2 break-words whitespace-pre-wrap rounded-lg bg-surface p-2 text-ui-sm">
                      {entry.message}
                    </p>
                  ) : null}
                  {entry.delivered !== undefined ? (
                    <p className="mt-2 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({
                        id: entry.delivered ? "team.ui.delivered" : "team.ui.queued",
                      })}
                    </p>
                  ) : null}
                  {entry.reason ? (
                    <p className="mt-2 break-words text-ui-sm">{entry.reason}</p>
                  ) : null}
                  {entry.taskStatus ? (
                    <p className="mt-2 text-ui-sm text-foreground-subtle">
                      {intl.formatMessage({ id: `team.task.status.${entry.taskStatus}` })}
                      {entry.assignee ? ` · ${teamActor(model, entry.assignee, lead)}` : ""}
                    </p>
                  ) : null}
                  {entry.sourceAttemptId ? (
                    <p className="mt-2 break-all font-mono text-ui-sm text-foreground-subtle">
                      {entry.sourceAttemptId}
                    </p>
                  ) : null}
                  {entry.messageIds?.length ? (
                    <p className="mt-2 break-all font-mono text-ui-sm text-foreground-subtle">
                      {entry.messageIds.join(" · ")}
                    </p>
                  ) : null}
                </details>
                {entry.taskId || entry.sourceTaskId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-1 pointer-coarse:min-h-11"
                    onClick={() =>
                      onSelect({
                        teamId: model.teamId,
                        kind: "task",
                        id: (entry.taskId ?? entry.sourceTaskId)!,
                      })
                    }
                  >
                    {intl.formatMessage({ id: "team.ui.currentTask" })} ·{" "}
                    {entry.taskId ?? entry.sourceTaskId}
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
          <p
            className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-ui-sm text-foreground-subtle"
            data-testid="team-history-range"
          >
            <SaveIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {intl.formatMessage({ id: "team.ui.historyRange" }, { seq: history.data.throughSeq })}
              {history.data.savedAt ? (
                <time className="mt-1 block" dateTime={history.data.savedAt}>
                  {history.data.savedAt}
                </time>
              ) : null}
            </span>
          </p>
          {history.data.skippedEntries ? (
            <p className="mt-2 text-ui-sm text-warning">
              {intl.formatMessage(
                { id: "team.ui.historySkipped" },
                { count: history.data.skippedEntries },
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
