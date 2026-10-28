import { useMemo, useState } from "react";
import { ArrowUpRightIcon, UsersIcon } from "lucide-react";
import {
  deriveSessionTeamActivity,
  type TeamProjectionState,
} from "@drora/shared/drora-protocol-v4";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamHistoryConnection } from "@/hooks/useTeamHistory.js";
import type { TeamUiFocus } from "./contract.js";
import type { TeamOpenTarget } from "./TeamNavigation.js";
import { useTeamNavigation } from "./TeamNavigation.js";
import { TeamStatusBadge } from "./TeamStatusBadge.js";
import { TeamAvatar } from "./TeamAvatar.js";
import { TeamStagedEditorConnected } from "./TeamStagedEditorConnected.js";
import { TeamWorkspaceViews } from "./TeamWorkspaceViews.js";
import { TeamStageRail } from "./TeamStageRail.js";
import { TeamRecentMessages } from "./TeamRecentMessages.js";
import { mapTeamProjectionToViewModel } from "./view-model.js";

export function TeamConversationSummary(props: {
  team: TeamProjectionState;
  target: TeamOpenTarget;
  connection?: TeamHistoryConnection;
  /** 桌面端 dock 接管审批时置 true：staged 分支退化为只读摘要，不重复渲染编辑器。 */
  stagedEditorSuppressed?: boolean;
  /**
   * 「回对话修改」的会话输入框预填回调（spec §15 第4条 2026-10-23 三发起面扩圈；
   * 挂载点注入，走 requestComposerTextInsert 缺口9 通道定向 lead 会话）。缺席 =
   * 无法触达 composer 的面（如远端 timeline）：note 输入隐藏并出「请在对话说明」
   * 提示，禁止 note 静默丢弃（TeamStagedEditorConnected 裁决）。
   */
  onPrefillComposer?: (prefill: string, targetSessionId?: string | null) => void;
}) {
  return <TeamConversationSummaryContent key={props.team.teamId} {...props} />;
}

function TeamConversationSummaryContent({
  team,
  target,
  connection,
  stagedEditorSuppressed = false,
  onPrefillComposer,
}: {
  team: TeamProjectionState;
  target: TeamOpenTarget;
  connection?: TeamHistoryConnection;
  stagedEditorSuppressed?: boolean;
  /** 「回对话修改」预填回调（缺席 = note 输入抑制形态，见外层 doc）。 */
  onPrefillComposer?: (prefill: string, targetSessionId?: string | null) => void;
}) {
  const { intl } = useDroraIntl(),
    open = useTeamNavigation();
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<TeamUiFocus>();
  const model = useMemo(() => mapTeamProjectionToViewModel(team), [team]);
  const summary = deriveSessionTeamActivity(team)!;
  // staged 审批（2026-10-22 用户裁定：审批对齐 workflow 模式——会话流内、用户驱动；
  // 废除 PR-2.4c 的「自动打开 TeamPanel」桥，78b72ba8 的桥曾因 h-full 包装在无布局
  // 上下文裸挂载把壳层顶出一屏）。2026-10-23 §10 呈现规则修订：桌面端升级为 timeline
  // bottom dock（TeamApprovalDock，与 workflow 确认窗同位同 chrome，本组件传
  // stagedEditorSuppressed 退化只读）；移动/远端无 dock 机制，保留摘要卡内联编辑器。
  // 命令经 connection.sendCommand 走 team/commands.ts 单一通道，与面板/ dock 同一路径；
  // 失败出显接线收拢在 TeamStagedEditorConnected（两表面共用，单一实现）。
  const sendCommand = connection?.sendCommand;
  const select = (next: TeamUiFocus) => {
    if (open) open({ ...target, focus: next });
    else {
      setFocus(next);
      setExpanded(true);
    }
  };
  const onOpen = () => (open ? open(target) : setExpanded((value) => !value));
  return (
    <section
      className="my-4 rounded-xl border border-card-border bg-card p-3"
      data-testid="team-conversation-summary"
      aria-label={intl.formatMessage({ id: "team.ui.current" })}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <UsersIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 break-words text-ui-base font-medium">
          {team.name ?? intl.formatMessage({ id: "team.ui.title" })}
        </span>
        <TeamStatusBadge status={team.status} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          onClick={onOpen}
          aria-label={intl.formatMessage({ id: "team.ui.open" })}
        >
          <ArrowUpRightIcon className="size-4" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-ui-sm text-foreground-subtle">
        {team.status === "staged" ? (
          sendCommand && model.stagedDraft ? (
            stagedEditorSuppressed ? (
              // 桌面端：审批由 timeline bottom dock（TeamApprovalDock）承载，摘要卡退化为只读
              // 摘要（specs/agents-team.md §10 呈现规则修订，2026-10-23）。
              intl.formatMessage(
                { id: "team.ui.planned" },
                { members: summary.memberCount, tasks: summary.total },
              )
            ) : (
              <div className="mt-1 w-full">
                <TeamStagedEditorConnected
                  draft={model.stagedDraft}
                  sessionId={target.parentSessionId}
                  sendCommand={sendCommand}
                  {...(onPrefillComposer === undefined ? {} : { onPrefillComposer })}
                />
              </div>
            )
          ) : (
            intl.formatMessage(
              { id: "team.ui.planned" },
              { members: summary.memberCount, tasks: summary.total },
            )
          )
        ) : (
          <>
            <span className="flex gap-1">
              {team.members.slice(0, 3).map((member) => (
                <button
                  type="button"
                  key={member.agentId}
                  className="rounded-md pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  aria-label={intl.formatMessage(
                    { id: "team.panel.memberOpen" },
                    { name: member.memberName },
                  )}
                  onClick={() =>
                    select({ teamId: team.teamId, kind: "member", id: member.agentId })
                  }
                >
                  <TeamAvatar name={member.memberName} color={member.profileColor} />
                </button>
              ))}
            </span>
            {summary.blocked ? (
              <span>
                {intl.formatMessage({ id: "team.ui.blockedCount" }, { count: summary.blocked })}
              </span>
            ) : null}
            <span>
              {intl.formatMessage({ id: "team.ui.members" }, { count: summary.memberCount })}
            </span>
            <span>
              {intl.formatMessage(
                { id: "team.ui.progress" },
                { completed: summary.completed, total: summary.total },
              )}
            </span>
          </>
        )}
      </div>
      <TeamStageRail model={model} onSelect={select} />
      <TeamRecentMessages model={model} onSelect={select} />
      {open === null ? (
        <Button
          variant="ghost"
          className="mt-2 pointer-coarse:min-h-11"
          onClick={onOpen}
          aria-expanded={expanded}
        >
          {intl.formatMessage({ id: "team.ui.details" })}
        </Button>
      ) : null}
      {open === null && expanded ? (
        <div className="mt-3 border-t border-border pt-3">
          <TeamWorkspaceViews
            key={team.teamId}
            model={model}
            focus={focus}
            connection={connection}
          />
        </div>
      ) : null}
    </section>
  );
}
