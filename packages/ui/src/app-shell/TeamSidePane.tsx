import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, UsersIcon } from "lucide-react";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import type { TeamSidePaneTab } from "@/lib/workspaceSidePane.js";
import {
  abandonTeamPlan,
  approveTeamPlan,
  buildTeamReviseComposerPrefill,
  haltTeam,
  mapTeamProjectionToViewModel,
  resumeTeam,
  reviseTeamPlan,
  sendTeamMessage,
  TeamMemberSidePane,
  TeamPanel,
  useTeamFocus,
  type TeamPanelCommand,
  type TeamPanelMemberView,
  TEAM_REVISE_PREFILL_PROMPT_KEY,
} from "@/team/index.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation, V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";

/**
 * team 面板的 tab 容器（挂载点；任务卡 C）。
 *
 * 数据选择器**只有一条**：父会话（tab.parentSessionId）实时投影的 team 键
 * （conversation snapshot.team，specs/agents-team.md §10「数据全部来自
 * conversationProjectionStore 的 team 投影，不走第二条真相通道」）。租约照
 * `WorkflowActorSessionSidePane` 渲染期同步建连——effect 版首帧没有投影，空态会闪一帧。
 *
 * 组成（设计 01 §3.1-§3.3/§4）：
 * - 有投影 → `TeamPanel`。staged 态的 `TeamStagedEditor` 由 TeamPanel 内部按
 *   `onCommand` 在场与否挂载（staged 无 onCommand 时退化为只读摘要行）；本容器把
 *   TeamPanel 上抛的命令意图分发给 team/commands.ts 的同名 helper（八命令的
 *   信封构造/ACK 判定单一出处），sendCommand 来自本 pane 的 v4 会话上下文；
 * - 无投影 → 诚实空态（灰度关 / 旧 CLI / 归档出投影），不自动关 tab（同 workflow-run 的 GC 纪律）；
 * - 成员下钻 → `TeamMemberSidePane`（父投影门 + 只读 SessionPane）。选中哪个成员是本容器的
 *   **本地视图状态**（不入 store、不入 tab 身份）。PR-2.4c 起全通：TeamPanel 的
 *   onMemberClick / onMessageMember（成员卡点击与「发消息」入口，同一下钻语义）接
 *   `setActiveMember`；下钻 composer 的 onSendMessage 接 `commands.sendTeamMessage`
 *   （成员消息必须经 lead 邮箱投递，spec §1 硬边界）。
 * - 「回对话修改」预填（design 01 §3.1）：revise 命令发出后把追问文案（note 在场时
 *   随行）经 `onPrefillComposer` 回调交给挂载点注入会话 composer；文案构造纯函数在
 *   team/revise-prefill.ts，注入通道调研结论与 v1 边界见该文件头注。
 */

/** 下钻目标：memberName 是花名册联接键，childSessionId 是打开时刻已知值（可缺席，门会自愈）。 */
interface TeamMemberDrillTarget {
  memberName: string;
  childSessionId?: string;
}

const TeamEmptyState = memo(function TeamEmptyState() {
  const { intl } = useDroraIntl();
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-6 text-center"
      data-testid="team-pane-empty"
    >
      <UsersIcon className="size-8 text-foreground-subtlest" />
      <p className="mt-3 text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "team.panel.empty.title" })}
      </p>
      <p className="mt-1 text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "team.panel.empty.body" })}
      </p>
    </div>
  );
});

const TeamSidePaneContent = memo(function TeamSidePaneContent({
  tab,
  focused,
  onPrefillComposer,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: {
  tab: TeamSidePaneTab;
  focused: boolean;
  /** 「回对话修改」的会话输入框预填回调（实现由挂载点提供；缺席 = 只发命令不预填）。 */
  onPrefillComposer?: (prefill: string) => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
}) {
  const { intl } = useDroraIntl();
  const { layer, sendCommand } = useV4Conversation();
  const focus = useTeamFocus({ ...tab, parentSessionId: tab.parentSessionId });
  const historyConnection = useMemo(
    () => ({ sessionId: tab.parentSessionId, sendCommand }),
    [tab.parentSessionId, sendCommand],
  );

  // 渲染期同步建连（`useMemo`）+ 卸载释放——先例 WorkflowActorSessionSidePane.tsx:71-72。
  const lease = useMemo(() => layer.acquire(tab.parentSessionId), [layer, tab.parentSessionId]);
  useEffect(() => () => lease.release(), [lease]);

  const snapshot = useConversationProjection(lease).snapshot;
  const team = snapshot?.team;
  const model = useMemo(
    () => (team === undefined ? undefined : mapTeamProjectionToViewModel(team)),
    [team],
  );

  // 预填追问文案在渲染期解析（语言切换随渲染更新）；拼接与 note 携带规则见
  // team/revise-prefill.ts（纯函数单一出处）。
  const revisePrefillQuestion = intl.formatMessage({ id: TEAM_REVISE_PREFILL_PROMPT_KEY });

  // 面板动作意图 → team/commands.ts（信封构造与 ACK 语义单一出处；拒绝/失败由 helper
  // 内部 logger 出账）。团队命令非行级、不入 pendingCommand 对账账本（commands.ts 头注），
  // 这里的 fire-and-forget 与 WorkflowRunSidePane 的 cancel/resume 同一先例。
  const handlePanelCommand = useCallback(
    (command: TeamPanelCommand) => {
      const input = { sessionId: tab.parentSessionId, sendCommand };
      switch (command.type) {
        case "approveTeamPlan":
          void approveTeamPlan(input);
          break;
        case "reviseTeamPlan":
          void reviseTeamPlan({ ...input, ...command.payload });
          // design 01 §3.1「会话输入框预填『要调整什么？』」：发命令的同时把追问文案
          // 预填进会话 composer（v1 边界：hub 不消费 wire note，note 随预填进对话，
          // 见 revise-prefill.ts 头注）。回调缺席（挂载点未接线）= 只发命令，行为同前。
          if (onPrefillComposer !== undefined) {
            onPrefillComposer(
              buildTeamReviseComposerPrefill({
                question: revisePrefillQuestion,
                ...(command.payload.note === undefined ? {} : { note: command.payload.note }),
              }),
            );
          }
          break;
        case "abandonTeamPlan":
          void abandonTeamPlan(input);
          break;
        case "haltTeam":
          void haltTeam({ ...input, ...command.payload });
          break;
        case "resumeTeam":
          void resumeTeam({ ...input, ...command.payload });
          break;
      }
    },
    [onPrefillComposer, revisePrefillQuestion, sendCommand, tab.parentSessionId],
  );

  // 成员下钻是本地视图状态。teamId 变化（同一对话换队）时回落到团队视图，
  // 避免把上一个团队的下钻目标带到新队里。
  const [activeMember, setActiveMember] = useState<TeamMemberDrillTarget | null>(null);
  useEffect(() => {
    setActiveMember(null);
  }, [model?.teamId, focus]);

  // 成员卡点击与「发消息」入口同一下钻语义（design 01 §3.2）：发消息的输入面在下钻
  // composer，不在面板内另造第二条输入路径。
  const handleMemberDrill = useCallback((member: TeamPanelMemberView) => {
    setActiveMember({
      memberName: member.memberName,
      ...(member.childSessionId === undefined ? {} : { childSessionId: member.childSessionId }),
    });
  }, []);

  if (model === undefined) {
    return <TeamEmptyState />;
  }

  const memberPane =
    activeMember !== null ? (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center gap-1 border-b border-border/50 p-1.5">
          <button
            type="button"
            onClick={() => setActiveMember(null)}
            aria-label={intl.formatMessage({ id: "team.memberPane.back" })}
            data-testid="team-member-back"
            className="flex size-7 items-center justify-center rounded-md text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeftIcon className="size-4" />
          </button>
          <span className="min-w-0 truncate text-ui-base font-medium text-foreground">
            {activeMember.memberName}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <TeamMemberSidePane
            parentSessionId={tab.parentSessionId}
            memberName={activeMember.memberName}
            {...(activeMember.childSessionId === undefined
              ? {}
              : { childSessionId: activeMember.childSessionId })}
            workspacePath={tab.workspacePath}
            {...(tab.workspaceIdentity === undefined
              ? {}
              : { workspaceIdentity: tab.workspaceIdentity })}
            {...(tab.remoteSessionId === undefined ? {} : { remoteSessionId: tab.remoteSessionId })}
            focused={focused}
            onSendMessage={(message) => {
              // PR-2.4c：成员消息唯一通道 = lead 侧 sendTeamMessage（邮箱投递，不入
              // conversation 行）。fire-and-forget 与面板动作区同一先例；拒绝/失败由
              // commands helper 内部 logger 出账。
              void sendTeamMessage({
                sessionId: tab.parentSessionId,
                sendCommand,
                to: activeMember.memberName,
                message,
              });
            }}
            onOpenBrowserUrl={onOpenBrowserUrl}
            onOpenCodeViewer={onOpenCodeViewer}
            onOpenFileLink={onOpenFileLink}
          />
        </div>
      </div>
    ) : null;

  return (
    // PR-2.4c 收口：成员卡点击 / 发消息入口 → setActiveMember（下钻），composer 消息 →
    // sendTeamMessage（上文 onSendMessage）。下钻 + 发消息全通。
    <div className="h-full min-h-0">
      {/* 中文依据：下钻不能卸载关系视图，否则返回会丢失图层与选中关系；只隐藏本地视图。 */}
      <div hidden={activeMember !== null} className="h-full min-h-0">
        <TeamPanel
          model={model}
          onCommand={handlePanelCommand}
          onMemberClick={handleMemberDrill}
          onMessageMember={handleMemberDrill}
          focus={focus}
          connection={historyConnection}
          onQuoteTask={
            onPrefillComposer
              ? (task) =>
                  onPrefillComposer(
                    intl.formatMessage(
                      { id: "team.ui.quoteTaskPrompt" },
                      { id: task.taskId, title: task.title },
                    ),
                  )
              : undefined
          }
        />
      </div>
      {memberPane}
    </div>
  );
});

/**
 * 「团队」tab 的内容根（`tab.type === "team"`，与 WorkflowRun 同级的独立 tab）。
 * pane scope 由 tab 上的 workspace 身份构造（同 WorkflowActorSessionSidePane 的组合方式）。
 */
export const TeamSidePane = memo(function TeamSidePane({
  tab,
  focused,
  onPrefillComposer,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: {
  tab: TeamSidePaneTab;
  focused: boolean;
  /** 「回对话修改」的会话输入框预填回调（实现由挂载点提供；缺席 = 只发命令不预填）。 */
  onPrefillComposer?: (prefill: string) => void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
}) {
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );

  return (
    <V4PaneConversationProvider scope={scope}>
      <TeamSidePaneContent
        tab={tab}
        focused={focused}
        {...(onPrefillComposer === undefined ? {} : { onPrefillComposer })}
        onOpenBrowserUrl={onOpenBrowserUrl}
        onOpenCodeViewer={onOpenCodeViewer}
        onOpenFileLink={onOpenFileLink}
      />
    </V4PaneConversationProvider>
  );
});
