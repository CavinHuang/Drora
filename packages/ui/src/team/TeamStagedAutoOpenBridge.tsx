import { memo, useEffect, useMemo, useRef } from "react";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { V4PaneConversationProvider, useV4Conversation } from "@/v4/V4ConversationContext.js";
import { shouldAutoOpenTeamPanel } from "./auto-open.js";

/**
 * staged 草案 → 自动打开 team 面板的接线桥（PR-2.4c；设计 01 §2 入口 3 / §3.1）。
 *
 * 挂载点在 App（每 workspace 常驻，活动会话变化即跟随）——不能挂 TeamSidePane 容器：
 * 那是 tab 内容，面板没开时不存在，永远听不到「草案出现」这一帧。
 *
 * 数据通道只有一条：复用 `V4PaneConversationProvider`（远程 scope 解析、连接 refCount、
 * activateRemoteService 时序全部是既有 provider 的职责，这里不另写第二份 acquire 逻辑），
 * 内部照 TeamSidePane 同款「渲染期同步建连 + useConversationProjection」读
 * conversation snapshot.team 的 status 键（spec §10「不走第二条真相通道」）。
 *
 * 灰度：无显式开关——team 键缺席（灰度关/旧 CLI）时 status 恒 undefined，
 * shouldAutoOpenTeamPanel 恒 false，行为自然是关。
 */
export const TeamStagedAutoOpenBridge = memo(function TeamStagedAutoOpenBridge({
  scope,
  parentSessionId,
  panelOpen,
  onOpen,
}: {
  /** 活动 workspace 的 pane scope（宿主 App 用 workspaceAbsPath/identity/remoteSessionId 构造）。 */
  scope: PaneWorkspaceScope;
  /** 活动会话 id（lead 对话）；null（无活动任务/草稿期）时不监听。 */
  parentSessionId: string | null;
  /** 该会话的 team tab 是否已开（宿主从 useAppPanels 的 sidePaneState 派生）。 */
  panelOpen: boolean;
  /** 打开请求：宿主接 useAppPanels.handleOpenTeamSidePane（补齐 workspace 身份三键）。 */
  onOpen: (parentSessionId: string) => void;
}): JSX.Element | null {
  if (parentSessionId === null) {
    return null;
  }
  return (
    <V4PaneConversationProvider scope={scope}>
      {/* key=会话：换会话即重挂，prevStatus 不跨会话泄漏（A 队的上一帧不算 B 队的边沿先验）。 */}
      <TeamStagedAutoOpenEffect
        key={parentSessionId}
        parentSessionId={parentSessionId}
        panelOpen={panelOpen}
        onOpen={onOpen}
      />
    </V4PaneConversationProvider>
  );
});

const TeamStagedAutoOpenEffect = memo(function TeamStagedAutoOpenEffect({
  parentSessionId,
  panelOpen,
  onOpen,
}: {
  parentSessionId: string;
  panelOpen: boolean;
  onOpen: (parentSessionId: string) => void;
}): JSX.Element | null {
  const { layer } = useV4Conversation();

  // 渲染期同步建连 + 卸载释放（先例：TeamSidePane / WorkflowActorSessionSidePane——
  // effect 版首帧没有投影，会错过恰在订阅建立前落地的 staged 帧）。
  const lease = useMemo(() => layer.acquire(parentSessionId), [layer, parentSessionId]);
  useEffect(() => () => lease.release(), [lease]);

  const status = useConversationProjection(lease).snapshot?.team?.status;

  // prevStatus 只在 effect 里推进：render 期的重复执行（并发渲染/严格时序重放）不能
  // 消耗边沿，否则同一次 staged 出现可能因双重渲染而不触发。
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (shouldAutoOpenTeamPanel(prev, status, panelOpen)) {
      onOpen(parentSessionId);
    }
  }, [onOpen, panelOpen, parentSessionId, status]);

  return null;
});
