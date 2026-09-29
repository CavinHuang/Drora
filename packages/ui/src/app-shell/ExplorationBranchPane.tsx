import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { GitMergeIcon, ShieldIcon } from "lucide-react";
import type { MessageFileLinkTarget } from "@/components/ai-elements/message.js";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import type { CodeViewerSource } from "@/lib/codeViewer.js";
import {
  dispatchConversationSelectionAdd,
  type SessionMentionReference,
} from "@/lib/conversationSelectionReference.js";
import { resolveExplorationSourceLabel, type ExplorationBranchPaneTab } from "@/lib/workspaceSidePane.js";
import { useConversationProjection } from "@/v4/useConversationProjection.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";
import type { SessionLease } from "@/v4/sessionDataLayer.js";
import type { PaneWorkspaceScope } from "@/v4/paneLayoutStore.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { V4PaneConversationProvider } from "@/v4/V4ConversationContext.js";

/**
 * 锚点后是否已有新增 assistant 回复（带回按钮的空态判据，对齐 Proma
 * getLatestExplorationConclusion）：child 时间线首部有 forkNotice boundary marker，
 * 其后出现 complete assistantText 行即为新增回复；快照未就绪时 hasNewReplies 为 null
 * （按钮保持可用，点击时兜底 toast）。branchTitle 取 child 投影的当前标题，
 * 带回引用用它标注来源（对齐 Proma「探索后新增内容 · {分支标题}」的可辨识性）。
 */
function useBranchBringBackState(childSessionId: string): {
  hasNewReplies: boolean | null;
  branchTitle: string | null;
} {
  const { layer } = useV4Conversation();
  const [lease, setLease] = useState<SessionLease | null>(null);
  const projection = useConversationProjection(lease);
  useEffect(() => {
    const nextLease = layer.acquire(childSessionId);
    setLease(nextLease);
    return () => nextLease.release();
  }, [childSessionId, layer]);
  return useMemo(() => {
    const rows = projection.snapshot?.rows.window;
    let hasNewReplies: boolean | null = null;
    if (rows) {
      hasNewReplies = false;
      let afterBoundary = false;
      for (const row of rows) {
        if (row.kind === "timelineMarker" && row.marker.type === "forkNotice") {
          afterBoundary = true;
          continue;
        }
        if (afterBoundary && row.kind === "assistantText" && row.state === "complete") {
          hasNewReplies = true;
          break;
        }
      }
    }
    const branchTitle = projection.snapshot?.meta.title.trim() || null;
    return { hasNewReplies, branchTitle };
  }, [projection.snapshot]);
}

/**
 * 探索分支面板（specs/exploration-mode.md）：
 * 完整能力 SessionPane（taskType "fork"、只读执行态由 core 权限服务裁决）+
 * 分支头部（分叉来源 / 只读徽标 / 带回主线）。
 * 带回 = 往主线 composer 的 selection 引用 scope 加一条会话引用（不自动发送）；
 * 主线发送后由 CLI #sess_* 引用链注入 reminder，agent 用 ReadSessionContext 渐进读取分支增量。
 */
export const ExplorationBranchPane = memo(function ExplorationBranchPane({
  tab,
  focused,
  onOpenBrowserUrl,
  onOpenCodeViewer,
  onOpenFileLink,
  onUnavailable,
}: {
  tab: ExplorationBranchPaneTab;
  focused: boolean;
  onOpenBrowserUrl?: (url: string) => void;
  onOpenCodeViewer?: (source: CodeViewerSource) => void;
  onOpenFileLink?: (target: MessageFileLinkTarget) => void;
  onUnavailable: (tabId: string) => void;
}) {
  const { intl } = useDroraIntl();
  const scope = useMemo<PaneWorkspaceScope>(
    () => ({
      workspacePath: tab.workspacePath,
      ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
      ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
    }),
    [tab.remoteSessionId, tab.workspaceIdentity, tab.workspacePath],
  );
  // 父级 tabs.map 为每个 memo pane 创建内联闭包会让任意父级渲染破坏回调稳定性；
  // 由叶子按稳定 tab id 收口回调（对齐 SelectionSideChatPane 的做法）。
  const handleUnavailable = useCallback(() => onUnavailable(tab.id), [onUnavailable, tab.id]);

  const { hasNewReplies, branchTitle } = useBranchBringBackState(tab.childSessionId);
  const resolvedSourceLabel = useMemo(
    () => resolveExplorationSourceLabel(tab.sourceLabel),
    [tab.sourceLabel],
  );
  const sourceLabelText = resolvedSourceLabel.i18nKey
    ? intl.formatMessage({ id: resolvedSourceLabel.i18nKey })
    : resolvedSourceLabel.text;
  const handleBringBack = useCallback(() => {
    // 与 Proma 一致的空态：分支还没有新增回复时带回只会让主线读到零增量。
    if (hasNewReplies === false) {
      toast(intl.formatMessage({ id: "sidePane.exploration.bringBack.empty" }));
      return;
    }
    const reference: SessionMentionReference = {
      id: `exploration:${tab.childSessionId}`,
      contentType: "session",
      sessionId: tab.childSessionId,
      // 对齐 Proma：引用 label 带分支标题（多分支在主线里可区分）；
      // 分支标题未生成时退回分叉来源标签。
      label: `${intl.formatMessage({ id: "sidePane.exploration" })} · ${branchTitle ?? sourceLabelText}`,
      path: undefined,
    };
    const result = dispatchConversationSelectionAdd({
      targetSessionId: tab.parentSessionId,
      workspaceKey: tab.workspaceKey,
      reference,
    });
    if (!result.ok) {
      toast(intl.formatMessage({ id: "sidePane.exploration.bringBack.limit" }));
      return;
    }
    if (result.duplicate) {
      toast(intl.formatMessage({ id: "sidePane.exploration.bringBack.duplicate" }));
      return;
    }
    toast(intl.formatMessage({ id: "sidePane.exploration.bringBack.added" }));
  }, [branchTitle, hasNewReplies, intl, sourceLabelText, tab.childSessionId, tab.parentSessionId, tab.workspaceKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtle">
          {sourceLabelText}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
              <ShieldIcon className="size-3" />
              {intl.formatMessage({ id: "sidePane.exploration.readOnly" })}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {intl.formatMessage({ id: "sidePane.exploration.readOnlyHint" })}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={intl.formatMessage({ id: "sidePane.exploration.bringBack" })}
              onClick={handleBringBack}
            >
              <GitMergeIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {intl.formatMessage({ id: "sidePane.exploration.bringBackHint" })}
          </TooltipContent>
        </Tooltip>
      </div>
      <V4PaneConversationProvider scope={scope}>
        <SessionPane
          paneId={tab.id}
          sessionId={tab.childSessionId}
          openTrigger="exploration"
          focused={focused}
          telemetryVisible={focused}
          workspacePath={tab.workspacePath}
          workspaceIdentity={tab.workspaceIdentity}
          remoteSessionId={tab.remoteSessionId}
          onOpenBrowserUrl={onOpenBrowserUrl}
          onOpenCodeViewer={onOpenCodeViewer}
          onOpenFileLink={onOpenFileLink}
          onSelectionSideChatUnavailable={handleUnavailable}
        />
      </V4PaneConversationProvider>
    </div>
  );
});
