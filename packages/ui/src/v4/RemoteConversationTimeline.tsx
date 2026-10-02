// 远控展示适配层：复用 v4 实时消息列表，不在 UI 包里持有 relay 或会话状态。
import { useMemo, useState, type ReactNode } from "react";
import type { GitChangeSourceId, GitRepositorySummary, Locale } from "@drora/shared";
import type {
  ConversationRow,
  ConversationSnapshot,
  SessionPhase,
} from "@drora/shared/drora-protocol-v4";
import type { ModelSelectionView } from "@drora/services";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { ConversationStatusPanel } from "@/v4/ConversationStatusPanel.js";
import { ConversationTimeline } from "@/v4/ConversationTimeline.js";
import { buildConversationStatusPanelModel } from "@/v4/conversationStatusPanelModel.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import type { ChatViewSummaryPanelVariant } from "@/v4/legacyChatViewTypes.js";
import { PluginReferenceIconProvider } from "@/v4/pluginReferenceIconContext.js";
import type { AssistantFeedbackHandler } from "@/v4/ConversationRowView.js";

export type RemoteStatusSnapshot = Pick<
  ConversationSnapshot,
  "goal" | "plan" | "backgroundWorks" | "subagents" | "availability"
>;

export interface RemoteConversationTimelineProps {
  rows: readonly ConversationRow[];
  totalCount: number;
  sessionKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  locale: Locale;
  theme: "light" | "dark";
  sessionPhase?: SessionPhase;
  modelSelectionView?: ModelSelectionView | null;
  statusSnapshot?: RemoteStatusSnapshot | null;
  gitSummary?: GitRepositorySummary | null;
  gitDirtyFileCount?: number;
  gitWorktreeChangeSummary?: { added: number; removed: number } | null;
  onRefreshGit?: () => void;
  onOpenGitReview?: (sourceId?: GitChangeSourceId) => void;
  onPauseGoal?: () => void;
  onResumeGoal?: () => void;
  onCancelBackgroundWork?: (workId: string) => void;
  headerSlot?: ReactNode;
  /** §32.51 手机远控：消息操作行常显（官方 compactForRemoteControl 同语义）。 */
  compactForRemoteControl?: boolean;
  bottomDock?: ReactNode;
  canLoadOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => Promise<void> | void;
  /** 助手消息赞/踩（v4 setAssistantFeedback；缺省不渲染 feedback 按钮——capability 降级）。 */
  onFeedbackChange?: AssistantFeedbackHandler;
  /** 从 assistant 消息分叉（v4 forkAssistant；缺省不渲染 fork 按钮）。 */
  onFork?: (target: import("@drora/shared/drora-protocol-v4").ConversationRowTarget) => void;
}

export function RemoteConversationTimeline({
  rows,
  totalCount,
  sessionKey,
  workspacePath,
  workspaceIdentity,
  locale,
  theme,
  sessionPhase,
  modelSelectionView,
  statusSnapshot,
  gitSummary,
  gitDirtyFileCount,
  gitWorktreeChangeSummary,
  onRefreshGit,
  onOpenGitReview,
  onPauseGoal,
  onResumeGoal,
  onCancelBackgroundWork,
  headerSlot,
  compactForRemoteControl,
  bottomDock,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  onFeedbackChange,
  onFork,
}: RemoteConversationTimelineProps) {
  const [statusPanelVariant, setStatusPanelVariant] = useState<ChatViewSummaryPanelVariant | null>(
    null,
  );
  const statusModel = useMemo(
    () =>
      buildConversationStatusPanelModel({
        workspacePath,
        gitSummary,
        gitDirtyFileCount,
        gitWorktreeChangeSummary,
        goal: statusSnapshot?.goal ?? null,
        plan: statusSnapshot?.plan ?? null,
        backgroundWorks: statusSnapshot?.backgroundWorks ?? [],
        runningSubagents: statusSnapshot?.subagents?.running ?? [],
      }),
    [workspacePath, gitSummary, gitDirtyFileCount, gitWorktreeChangeSummary, statusSnapshot],
  );
  const statusPanelLayout =
    !statusModel.hasContent || statusPanelVariant === "mini"
      ? "none"
      : statusPanelVariant === "panel"
        ? "inline"
        : "auto";
  const rowContext = useMemo<ConversationRowRenderContext>(
    () => ({
      workspacePath,
      workspaceIdentity,
      sessionId: sessionKey,
      theme,
      codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
      modelSelectionView,
      // §32.51 本组件即手机远控页时间线：操作行常显（官方 compactForRemoteControl）。
      compactForRemoteControl: true,
    }),
    [workspacePath, workspaceIdentity, sessionKey, theme, modelSelectionView],
  );

  return (
    <DroraIntlProvider initialLocale={locale}>
      <TooltipProvider delayDuration={0}>
        <PluginReferenceIconProvider value={null}>
          <div className="@container/conversation relative flex min-h-0 flex-1 flex-col">
            <ConversationStatusPanel
              workspacePath={workspacePath}
              workspaceIdentity={workspaceIdentity}
              gitSummary={gitSummary}
              gitDirtyFileCount={gitDirtyFileCount}
              gitWorktreeChangeSummary={gitWorktreeChangeSummary}
              onRefreshGit={onRefreshGit}
              onOpenGitReview={onOpenGitReview}
              goal={statusSnapshot?.goal ?? null}
              plan={statusSnapshot?.plan ?? null}
              backgroundWorks={statusSnapshot?.backgroundWorks ?? []}
              runningSubagents={statusSnapshot?.subagents?.running ?? []}
              layoutMode={statusPanelLayout}
              summaryPanelVariantOverride={statusPanelVariant}
              onVariantChange={setStatusPanelVariant}
              onPauseGoal={
                statusSnapshot?.availability?.pauseGoal.allowed ? onPauseGoal : undefined
              }
              onResumeGoal={
                statusSnapshot?.availability?.resumeGoal.allowed ? onResumeGoal : undefined
              }
              onCancelBackgroundWork={onCancelBackgroundWork}
            />
            <ConversationTimeline
              rows={rows}
              totalCount={totalCount}
              sessionKey={sessionKey}
              rowContext={rowContext}
              sessionPhase={sessionPhase}
              summaryPanelLayout={statusPanelLayout}
              compactForRemoteControl={compactForRemoteControl}
              headerSlot={headerSlot}
              bottomDock={bottomDock}
              onFeedbackChange={onFeedbackChange}
              onFork={onFork}
              canLoadOlder={canLoadOlder}
              loadingOlder={loadingOlder}
              onLoadOlder={onLoadOlder}
            />
          </div>
        </PluginReferenceIconProvider>
      </TooltipProvider>
    </DroraIntlProvider>
  );
}
