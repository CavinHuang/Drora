// R3 P6 GitPane 一期姊妹件（specs/mobile-relay-r3-frontend.md §27.1）：官方 GitActionMenu
// 复原件（packages/ui/src/GitActionMenu.tsx 1404 行，git-commit-dialog 全 testid 实锤）
// 经窄公开入口装配。Provider 壳与 RemoteGitSidePane 同构（七层——层序契约同源）；
// gitSummary 由 App 的同一 attachment Git 快照提供（GitActionMenu props 传入，内部 useServices 的
// gitService 走桥 accessor 的 IGitService 通道——generateCommitMessage/commit/push
// 协议面 100% 既有，§27.1）。
// 官方装配形态取证（生产页活体）：「提交或推送」折叠组按钮，triggerLayout="header"
// 组件内建支持；本壳默认 header 布局挂 RemoteWorkspaceHeader 右区。
import * as React from "react";
import { GitActionMenu } from "@drora/ui/git-pane";
import { DroraIntlProvider } from "@drora/ui/git-pane";
import { TooltipProvider } from "@drora/ui/git-pane";
import { PluginReferenceIconProvider } from "@drora/ui/git-pane";
import { ServiceProvider } from "@drora/ui/git-pane";
import { StoreProvider } from "@drora/ui/git-pane";
import { TabStoreProvider } from "@drora/ui/git-pane";
import type { IServiceAccessor, IBroadcastService } from "@drora/services";
import type { Event } from "@drora/rpc";
import type { GitRepositorySummary } from "@drora/shared";
import { resolveLocale } from "../ui/intl.js";

/** mock 广播服务（与 RemoteGitSidePane 同构；store 构造存而不用）。 */
function createMockBroadcastService(): IBroadcastService {
  const noopEvent: Event<unknown> = Object.assign(() => ({ dispose: () => {} }), {});
  return {
    send: () => Promise.resolve(),
    acquireClaim: () => Promise.resolve({ status: "unavailable" } as never),
    commitClaim: () => Promise.resolve(),
    releaseClaim: () => Promise.resolve(),
    tryClaim: () => Promise.resolve(false),
    onMessage: noopEvent as never,
  };
}
const MOCK_BROADCAST = createMockBroadcastService();

export interface RemoteGitActionMenuProps {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  /** 桥服务 accessor（git 通道消费）。 */
  accessor: IServiceAccessor;
  gitSummary: GitRepositorySummary | null;
  onRefreshGit: () => void;
  className?: string;
}

export function RemoteGitActionMenu({
  workspacePath,
  workspaceIdentity,
  accessor,
  gitSummary,
  onRefreshGit,
  className,
}: RemoteGitActionMenuProps) {
  return (
    <div className={className}>
      <DroraIntlProvider initialLocale={resolveLocale()}>
        <TooltipProvider delayDuration={0}>
          <PluginReferenceIconProvider value={null}>
            <TabStoreProvider>
              <StoreProvider broadcastService={MOCK_BROADCAST}>
                <ServiceProvider services={accessor}>
                  <GitActionMenu
                    workspacePath={workspacePath}
                    workspaceIdentity={workspaceIdentity}
                    gitSummary={gitSummary ?? unavailableGitSummary(workspacePath)}
                    onRefreshGit={onRefreshGit}
                    triggerLayout="header"
                  />
                </ServiceProvider>
              </StoreProvider>
            </TabStoreProvider>
          </PluginReferenceIconProvider>
        </TooltipProvider>
      </DroraIntlProvider>
    </div>
  );
}

function unavailableGitSummary(workspacePath: string): GitRepositorySummary {
  return {
    workspacePath,
    repoRoot: workspacePath,
    workspaceInRepoPath: ".",
    autoRefreshWatchPaths: [],
    branchName: null,
    trackingBranchName: null,
    headRefType: "branch",
    ahead: 0,
    behind: 0,
    isDirty: false,
    isGitAvailable: false,
    isRepository: false,
  };
}
