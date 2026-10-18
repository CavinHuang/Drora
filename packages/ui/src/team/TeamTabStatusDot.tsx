import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import type { TeamSidePaneTab } from "@/lib/workspaceSidePane.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamUiStatus } from "./contract.js";
import {
  TEAM_STATUS_DOT_TONE,
  TEAM_STATUS_I18N_KEYS,
  TONE_DOT_CLASS,
} from "./team-status-presentation.js";
import { V4PaneConversationProvider, useV4Conversation } from "@/v4/V4ConversationContext.js";

/**
 * team tab 标题上的状态点（PR-2.4c「面板开态徽标」；设计 01 §3.5 的会话正文团队
 * 摘要行在 v1 简化为它——正文行流改造登记 PR-2.5b，见 specs/agents-team.md 实现登记）。
 *
 * 数据通道与面板同一条：父会话实时投影的 team 键（spec §10「不走第二条真相通道」）。
 * 复用 `V4PaneConversationProvider`（scope 直接取 tab 上的 workspace 三键——tab 与
 * pane 内容同键，连接 refCount 共享，不另建数据层）。订阅用 status 单值 selector，
 * 投影行流刷新不惊动 tab 条。
 *
 * 投影缺席（灰度关 / 旧 CLI / 归档出投影）→ 渲染 null：没有团队就没有状态点。
 * DESIGN 纪律：色点 `aria-hidden`，状态文字以 sr-only 并行（不以色独行）。
 */

/** status 单值订阅（getSnapshot 返回原始字符串，store 不变则值稳定，不会无限重渲）。 */
function useTeamStatus(lease: SessionLease | null): TeamUiStatus | undefined {
  const store = lease?.store ?? null;
  return useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.getState().snapshot?.team?.status,
    () => undefined,
  );
}

const TeamTabStatusDotInner = memo(function TeamTabStatusDotInner({
  parentSessionId,
}: {
  parentSessionId: string;
}): JSX.Element | null {
  const { intl } = useDroraIntl();
  const { layer } = useV4Conversation();

  // 渲染期同步建连 + 卸载释放（同 TeamSidePane 的租约纪律；tab 条上的点与面板内容
  // 抢同一份 keep-warm，不额外增加连接生命周期）。
  const lease = useMemo(() => layer.acquire(parentSessionId), [layer, parentSessionId]);
  useEffect(() => () => lease.release(), [lease]);

  const status = useTeamStatus(lease);
  if (status === undefined) {
    return null;
  }
  const statusLabel = intl.formatMessage({ id: TEAM_STATUS_I18N_KEYS[status] });
  return (
    <span
      className="flex shrink-0 items-center"
      data-testid="team-tab-status-dot"
      data-team-status={status}
    >
      <span
        aria-hidden
        className={`inline-block size-1.5 rounded-full ${TONE_DOT_CLASS[TEAM_STATUS_DOT_TONE[status]]}`}
      />
      <span className="sr-only">
        {intl.formatMessage({ id: "team.tab.statusDot" }, { status: statusLabel })}
      </span>
    </span>
  );
});

/**
 * team tab 的状态点。`SidePaneTabItemContent` 在 `tab.type === "team"` 分支渲染；
 * 非 team tab 零开销（不进 provider，不建订阅）。
 */
export const TeamTabStatusDot = memo(function TeamTabStatusDot({
  tab,
}: {
  tab: TeamSidePaneTab;
}): JSX.Element {
  const scope = useMemo(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );
  return (
    <V4PaneConversationProvider scope={scope}>
      <TeamTabStatusDotInner parentSessionId={tab.parentSessionId} />
    </V4PaneConversationProvider>
  );
});
