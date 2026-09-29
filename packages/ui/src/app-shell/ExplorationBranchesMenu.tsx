import { useMemo, useState } from "react";
import { GitBranchIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { resolveExplorationSourceLabel, type OpenExplorationBranchRequest } from "@/lib/workspaceSidePane.js";
import {
  useWorkspaceSessionsIndexItems,
  type WorkspaceSessionsIndexScope,
} from "@/v4/useWorkspaceSessionsIndexItems.js";

function resolveMenuSourceLabel(
  forkSourceLabel: string | undefined,
  intl: ReturnType<typeof useDroraIntl>["intl"],
): string {
  if (!forkSourceLabel) return intl.formatMessage({ id: "chat.exploration.sourceLabel" });
  const resolved = resolveExplorationSourceLabel(forkSourceLabel);
  return resolved.i18nKey ? intl.formatMessage({ id: resolved.i18nKey }) : resolved.text;
}

/**
 * 主会话头部的探索分支入口（specs/exploration-mode.md）：列出 parentSessionId 指向
 * 当前会话的分支（forkSourceMessageId/forkSourceLabel 来自 sessions-index live 投影
 * 与冷启动种子两条链），点击重开右侧分支 Tab。分支 Tab 打开态本身是 renderer 本地
 * sidePaneState，重启后由此入口（或 Tab 概览搜索）恢复。
 */
export function ExplorationBranchesMenu({
  sessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  agentService,
  disabled,
  onOpenBranch,
}: {
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  /** resolveWorkspaceServices 产物；远端 workspace 必须显式携带。 */
  agentService?: WorkspaceSessionsIndexScope["agentService"];
  disabled?: boolean;
  onOpenBranch: (request: OpenExplorationBranchRequest) => void;
}) {
  const { intl } = useDroraIntl();
  const [open, setOpen] = useState(false);
  const scopes = useMemo<WorkspaceSessionsIndexScope[]>(
    () =>
      sessionId && !disabled
        ? [
            {
              workspacePath,
              ...(workspaceIdentity ? { workspaceIdentity } : {}),
              ...(remoteSessionId ? { endpointKey: remoteSessionId } : {}),
              ...(agentService ? { agentService } : {}),
            },
          ]
        : [],
    [agentService, disabled, remoteSessionId, sessionId, workspaceIdentity, workspacePath],
  );
  const { items } = useWorkspaceSessionsIndexItems(scopes);
  const branches = useMemo(
    () =>
      sessionId
        ? items
            // forkedFromTaskId 对所有 fork child 都有值；只有携带探索来源
            // （forkSourceMessageId）的才是探索分支，否则普通分叉会话会混进菜单
            // 并被误标为只读（specs/exploration-mode.md）。
            .filter((task) => task.forkedFromTaskId === sessionId && task.forkSourceMessageId)
            .sort((left, right) => right.updatedAt - left.updatedAt)
        : [],
    [items, sessionId],
  );
  const hasBranches = branches.length > 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={intl.formatMessage({ id: "chat.exploration.branches" })}
          disabled={disabled}
          data-testid="v4-exploration-branches-menu"
        >
          <GitBranchIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-56">
        {hasBranches ? (
          branches.map((task) => (
            <DropdownMenuItem
              key={task.taskId}
              data-testid={`v4-exploration-branch:${task.taskId}`}
              onClick={() =>
                onOpenBranch({
                  workspacePath,
                  ...(workspaceIdentity ? { workspaceIdentity } : {}),
                  ...(remoteSessionId ? { remoteSessionId } : {}),
                  parentSessionId: sessionId ?? "",
                  childSessionId: task.taskId,
                  sourceLabel: resolveMenuSourceLabel(task.forkSourceLabel, intl),
                })
              }
            >
              <GitBranchIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{task.title}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <div className="px-2 py-1.5 text-ui-sm text-foreground-subtlest">
            {intl.formatMessage({ id: "chat.exploration.noBranches" })}
            <div className="mt-0.5 text-ui-xs">
              {intl.formatMessage({ id: "chat.exploration.branchesHint" })}
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
