import { memo, useEffect, useMemo, useState } from "react";
import { HourglassIcon, SendHorizontalIcon, UserXIcon, UsersIcon } from "lucide-react";
import type { TeamProjectionState } from "@drora/shared/drora-protocol-v4";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";
import type { TeamCommandOutcome } from "./commands.js";
import { teamRejectionReasonI18nKeyOrUndefined } from "./TeamStagedEditor.js";

/**
 * 团队成员下钻面板（specs/agents-team.md §10、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3.2「成员下钻」）。
 *
 * 逐点复制 `WorkflowActorSessionSidePane`（app-shell/WorkflowActorSessionSidePane.tsx:56-108）
 * 的「父投影门 + 渲染期同步建连 + 嵌套只读 SessionPane」模式，三处刻意保持一致：
 *
 * - **父投影是唯一数据通道**：门读 lead 会话（parentSessionId）实时投影的 team 键，
 *   不缓存、不建第二真相（spec §10）。
 * - **租约必须渲染期同步建连**（`useMemo`，同先例 WorkflowActorSessionSidePane.tsx:71-72）：
 *   effect 版首帧没有投影，门判 unknown，SessionPane 会对着不存在的会话订阅一次并失败，
 *   失败 store 会在 keep-warm 里活 30 秒并被门放行后的 acquire 复用——先例注释里那块死面板。
 * - **门未就绪时整棵 SessionPane 不挂载**（不是渲染一个隐藏的它）：订阅只发生在
 *   SessionPane 内部，不挂载才真的没有失败订阅。
 *
 * 与 actor 面板的差异只有两处，都有依据：
 * - 联接键是 **memberName → 实时 childSessionId**（shared team.ts 成员卡注释：
 *   「持有该成员转录的 child 会话（下钻 TeamMemberSidePane 的联接键）」）。打开时刻已知的
 *   `childSessionId` 只是兜底：成员尚未 spawn 出会话时先占位，会话在实时投影里出现即自愈
 *   （同 actor 槽位语义）；成员被移除/团队归档出投影后，已知会话 id 仍可直接订阅——
 *   transcript 本就以 childSessionId 落 session store，回看是持久能力（spec §10 恢复语义）。
 * - 底部一条发消息输入框占位：发送**必须**走 lead 侧 v4 命令 `sendTeamMessage`
 *   （团队命令不落 conversation 行，走邮箱投递；成员会话本体只读）。接线属 PR-2.4b，
 *   本组件只留 `onSendMessage` 回调 props——回调缺席时输入框是诚实占位，不假装可用。
 */

/** 门的判定结果（纯数据，便于脱离 React 单测）。 */
export type TeamMemberDrillState =
  | { state: "ready"; sessionId: string }
  | { state: "not-started" }
  | { state: "member-absent" }
  | { state: "team-absent" };

/**
 * 门：从 team 投影解析成员 transcript 会话。
 *
 * - 投影缺席 + 已知会话 id → ready（团队归档出投影/旧 CLI 的常态，直接订阅是回看唯一路径）；
 * - 成员在册 → 实时 childSessionId 优先（自愈），已知 id 兜底；两者都无 → not-started 占位；
 * - 成员不在册 + 无已知会话 id → member-absent（如实说，不猜）；
 * - 投影缺席 + 无已知会话 id → team-absent。
 */
export function resolveTeamMemberDrillSession(
  team: TeamProjectionState | undefined,
  memberName: string,
  knownChildSessionId?: string,
): TeamMemberDrillState {
  if (team === undefined) {
    return knownChildSessionId === undefined
      ? { state: "team-absent" }
      : { state: "ready", sessionId: knownChildSessionId };
  }
  const member = team.members.find((candidate) => candidate.memberName === memberName);
  if (member === undefined) {
    return knownChildSessionId === undefined
      ? { state: "member-absent" }
      : { state: "ready", sessionId: knownChildSessionId };
  }
  const sessionId = member.childSessionId ?? knownChildSessionId;
  return sessionId === undefined ? { state: "not-started" } : { state: "ready", sessionId };
}

/** 门未就绪的占位（照 WorkflowActorNotStarted：图标 + 标题 + 正文说同一件事，不以色独行）。 */
function TeamMemberPending({
  icon,
  title,
  body,
}: {
  icon: "hourglass" | "member-absent" | "team-absent";
  title: string;
  body: string;
}) {
  const Icon =
    icon === "hourglass" ? HourglassIcon : icon === "member-absent" ? UserXIcon : UsersIcon;
  return (
    <div
      className="flex h-full flex-col items-center justify-center px-6 text-center"
      data-testid="team-member-not-ready"
    >
      <Icon className="size-8 text-foreground-subtlest" />
      <p className="mt-3 text-ui-base font-medium text-foreground">{title}</p>
      <p className="mt-1 text-ui-base text-foreground-subtle">{body}</p>
    </div>
  );
}

/**
 * 底部发消息占位。`onSendMessage` 缺席（PR-2.4b 未接线）时禁用 + 说明文案；
 * 接线后 Enter 发送，走宿主注入的 `commands.sendTeamMessage`（邮箱投递，不入 conversation 行）。
 *
 * §19 契约 5（2026-10-23）：onSendMessage 返回 TeamCommandOutcome——发送即 in-flight
 * （按钮禁用），outcome.ok 才清空草稿；被拒（ack 非 accepted|duplicate|noop）或传输
 * 异常时草稿保留原文 + 输入框上方 role=alert 出显拒绝原因（reasonCode 查表，未知走
 * 兜底）。草稿永不丢（specs/agents-team.md §19 契约 5 不变量）：halt 团队后发消息被
 * hub 以 team_halted 拒，此前静默拒绝 + 草稿已清，消息文本直接丢失。
 */
function TeamMemberMessageComposer({
  memberName,
  onSendMessage,
}: {
  memberName: string;
  onSendMessage?: (message: string) => Promise<TeamCommandOutcome> | TeamCommandOutcome | void;
}) {
  const { intl } = useDroraIntl();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ reasonCode?: string } | null>(null);
  const wired = onSendMessage !== undefined;
  const send = () => {
    const text = draft.trim();
    if (!wired || text.length === 0 || sending) return;
    setSending(true);
    setFailure(null);
    const pending = onSendMessage(text);
    void Promise.resolve(pending)
      .then((outcome) => {
        if (outcome === undefined || outcome.ok) {
          setDraft("");
          return;
        }
        // 被拒/传输异常：草稿保留原文（契约 5 草稿永不丢），reasonCode 供文案查表。
        setFailure(
          outcome.ack?.reasonCode === undefined ? {} : { reasonCode: outcome.ack.reasonCode },
        );
      })
      .finally(() => {
        setSending(false);
      });
  };
  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border/50 p-2">
      {failure === null ? null : (
        <p
          role="alert"
          className="text-ui-sm text-destructive"
          data-testid="team-member-message-error"
        >
          {intl.formatMessage(
            { id: "team.memberPane.sendFailed.line" },
            {
              reason: intl.formatMessage({
                id:
                  failure.reasonCode === undefined
                    ? "team.memberPane.sendFailed.transport"
                    : (teamRejectionReasonI18nKeyOrUndefined(failure.reasonCode) ??
                      "team.memberPane.sendFailed.fallback"),
              }),
            },
          )}
        </p>
      )}
      <div className="flex items-center gap-2">
        {/* pointer-coarse ≥44px（DESIGN.md:661-662）：输入与发送钮同纪律。 */}
        <input
          type="text"
          value={draft}
          disabled={!wired}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={intl.formatMessage(
            { id: "team.memberPane.inputPlaceholder" },
            { name: memberName },
          )}
          aria-label={intl.formatMessage(
            { id: "team.memberPane.inputPlaceholder" },
            { name: memberName },
          )}
          data-testid="team-member-message-input"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-ui-base text-foreground placeholder:text-foreground-subtlest focus-visible:border-ring focus-visible:outline-none disabled:cursor-not-allowed pointer-coarse:min-h-11"
        />
        <button
          type="button"
          onClick={send}
          disabled={!wired || sending}
          aria-label={intl.formatMessage({ id: "team.memberPane.send" })}
          data-testid="team-member-message-send"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <SendHorizontalIcon className="size-4" />
        </button>
        <span className="sr-only" aria-live="polite">
          {intl.formatMessage({
            id: wired ? "team.memberPane.inputReady" : "team.memberPane.inputPending",
          })}
        </span>
      </div>
    </div>
  );
}

export interface TeamMemberSidePaneProps {
  /** lead 会话 id：父投影门读它的实时投影，租约按它建。 */
  parentSessionId: string;
  /** 成员显示名；同时是 team 投影花名册的联接键与发消息的 `to`（sendTeamMessage）。 */
  memberName: string;
  /** 打开时刻已知的成员会话 id；缺席时门从实时投影自愈（照 actorSessionId 语义）。 */
  childSessionId?: string;
  /** 宿主 pane scope 的 workspace 身份三键（SessionPane 必需 workspacePath），由 tab 补齐。 */
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  focused?: boolean;
  /**
   * 发送通道（PR-2.4b 接线 `commands.sendTeamMessage` 后由宿主注入）。缺席 = 输入框占位态。
   * 团队消息**永不**进 conversation 行（spec §1 硬边界），本组件不自行构造命令信封。
   * §19 契约 5：返回 TeamCommandOutcome（Promise 或值）——composer 据 ok 决定清空或
   * 保留草稿并出显；宿主返回 void（未接线 outcome 的宿主）按成功处理，行为同前。
   */
  onSendMessage?: (message: string) => Promise<TeamCommandOutcome> | TeamCommandOutcome | void;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
}

/**
 * 成员 transcript 的门 + 只读 SessionPane。宿主（TeamSidePane）负责把它放进 lead 会话
 * scope 的 `V4PaneConversationProvider` 下——这里的 `useV4Conversation()` 复用同一份
 * pane scope（照 SessionPane 自身的消费方式），不再嵌套 Provider。
 */
const TeamMemberSessionContent = memo(function TeamMemberSessionContent({
  parentSessionId,
  memberName,
  childSessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  focused,
  onSendMessage,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
}: TeamMemberSidePaneProps) {
  const { intl } = useDroraIntl();
  const { layer } = useV4Conversation();

  // 父会话租约走渲染期同步建连（`useMemo`）——理由见文件头与先例
  // WorkflowActorSessionSidePane.tsx:66-72，这里不再重复那 30 秒死面板的账。
  const lease = useMemo(() => layer.acquire(parentSessionId), [layer, parentSessionId]);
  useEffect(() => () => lease.release(), [lease]);

  const snapshot = useConversationProjection(lease).snapshot;
  const gate = useMemo(
    () => resolveTeamMemberDrillSession(snapshot?.team, memberName, childSessionId),
    [childSessionId, memberName, snapshot?.team],
  );

  if (gate.state !== "ready") {
    const copy: Record<
      Exclude<TeamMemberDrillState["state"], "ready">,
      { icon: "hourglass" | "member-absent" | "team-absent"; id: string }
    > = {
      "not-started": { icon: "hourglass", id: "team.memberPane.notStarted" },
      "member-absent": { icon: "member-absent", id: "team.memberPane.memberAbsent" },
      "team-absent": { icon: "team-absent", id: "team.memberPane.teamAbsent" },
    };
    const view = copy[gate.state];
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="min-h-0 flex-1">
          <TeamMemberPending
            icon={view.icon}
            title={intl.formatMessage({ id: `${view.id}.title` }, { name: memberName })}
            body={intl.formatMessage({ id: `${view.id}.body` }, { name: memberName })}
          />
        </div>
        <TeamMemberMessageComposer
          memberName={memberName}
          {...(onSendMessage === undefined ? {} : { onSendMessage })}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        <SessionPane
          paneId={`team-member:${parentSessionId}:${memberName}`}
          sessionId={gate.sessionId}
          readOnly
          allowWorkspaceFileRewind
          focused={focused}
          telemetryVisible={focused}
          workspacePath={workspacePath}
          {...(workspaceIdentity === undefined ? {} : { workspaceIdentity })}
          {...(remoteSessionId === undefined ? {} : { remoteSessionId })}
          onOpenBrowserUrl={onOpenBrowserUrl}
          onOpenCodeViewer={onOpenCodeViewer}
          onOpenFileLink={onOpenFileLink}
        />
      </div>
      <TeamMemberMessageComposer
        memberName={memberName}
        {...(onSendMessage === undefined ? {} : { onSendMessage })}
      />
    </div>
  );
});

/**
 * 团队成员下钻面板。宿主（TeamSidePane）负责放在 lead 会话 scope 的
 * `V4PaneConversationProvider` 下并传入 tab 上的 workspace 三键；本组件只承载
 * 「父投影门 + 只读 SessionPane + 发消息占位」。
 */
export const TeamMemberSidePane = TeamMemberSessionContent;
