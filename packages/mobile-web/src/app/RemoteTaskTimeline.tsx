// 任务消息区唯一装配缝：惰性加载 UI 包的实时 v4 时间线。
import { lazy, Suspense, type ReactNode } from "react";
import type { GitChangeSourceId, GitRepositorySummary, Locale } from "@drora/shared";
import type {
  AttachmentRef,
  CommandAck,
  ConversationRow,
  ConversationSnapshot,
  PendingInteraction,
  SessionPhase,
  V4ConversationFileChangesResult,
  V4ConversationFileRewindPreviewResult,
} from "@drora/shared/drora-protocol-v4";
import type { ModelSelectionView } from "@drora/services";
import { InteractionCards, type InteractionAnswer } from "../ui/InteractionCards.js";
// FileChangesBar 挂载移除（§32.40）：ui ConversationTurnGroup 已内建官方
// ConversationFileSummaryPanel（@1402，unit.header.fileChanges 驱动）——App 侧独立
// 横条是重复渲染且被 taskShell 头部裁切（双页截图对照实证）。组件保留供复用。

const Timeline = lazy(() =>
  import("@drora/ui/remote-timeline").then((module) => ({
    default: module.RemoteConversationTimeline,
  })),
);

export interface RemoteTaskTimelineProps {
  rows: readonly ConversationRow[];
  totalCount: number;
  sessionKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  locale: Locale;
  theme: "light" | "dark";
  sessionPhase?: SessionPhase;
  modelSelectionView?: ModelSelectionView | null;
  statusSnapshot?: ConversationSnapshot | null;
  gitSummary?: GitRepositorySummary | null;
  gitDirtyFileCount?: number;
  gitWorktreeChangeSummary?: { added: number; removed: number } | null;
  onRefreshGit?: () => void;
  onOpenGitReview?: (sourceId?: GitChangeSourceId) => void;
  onPauseGoal?: () => void;
  onResumeGoal?: () => void;
  onCancelBackgroundWork?: (workId: string) => void;
  interactions: readonly PendingInteraction[];
  answering: boolean;
  onResolve: (interactionId: string, answer: InteractionAnswer) => void;
  fileChanges: V4ConversationFileChangesResult | null;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<void>;
  bottomDock: ReactNode;
  /** 助手消息赞/踩（v4 setAssistantFeedback；缺省不渲染 feedback 按钮）。 */
  onFeedbackChange?: (
    target: { rowId: number; entityId: string },
    feedback: "like" | "dislike" | null,
  ) => Promise<boolean | void> | boolean | void;
  /** 从 assistant 消息分叉（v4 forkAssistant；缺省不渲染 fork 按钮）。 */
  onFork?: (target: { rowId: number; entityId: string }) => void;
  /** user 行行内编辑（v4 editUserQuery；缺省不渲染编辑入口。§33.18.13）。 */
  onEdit?: (
    target: { rowId: number; entityId: string },
    newText: string,
    attachments?: readonly AttachmentRef[],
    workspaceMode?: "preserve" | "rewind",
  ) => Promise<CommandAck | boolean | void> | CommandAck | boolean | void;
  /** 撤销该轮文件更改预览（v4 conversationFileRewindPreviewV4；缺省撤销钮不渲染）。 */
  previewFileRewind?: (
    target: { rowId: number; entityId: string },
  ) => Promise<V4ConversationFileRewindPreviewResult>;
  /** 撤销该轮文件更改应用（v4 applyFileRewind；workspace-only 不截断历史）。 */
  applyFileRewind?: (target: { rowId: number; entityId: string }) => Promise<CommandAck>;
}

export function RemoteTaskTimeline(props: RemoteTaskTimelineProps) {
  const headerSlot = (
    <>
      <InteractionCards
        interactions={props.interactions}
        busy={props.answering}
        onResolve={props.onResolve}
      />
    </>
  );
  return (
    <Suspense fallback={<div className="min-h-0 flex-1" />}>
      <Timeline
        key={props.sessionKey}
        rows={props.rows}
        totalCount={props.totalCount}
        sessionKey={props.sessionKey}
        workspacePath={props.workspacePath}
        workspaceIdentity={props.workspaceIdentity}
        locale={props.locale}
        theme={props.theme}
        sessionPhase={props.sessionPhase}
        modelSelectionView={props.modelSelectionView}
        statusSnapshot={props.statusSnapshot}
        gitSummary={props.gitSummary}
        gitDirtyFileCount={props.gitDirtyFileCount}
        gitWorktreeChangeSummary={props.gitWorktreeChangeSummary}
        onRefreshGit={props.onRefreshGit}
        onOpenGitReview={props.onOpenGitReview}
        onPauseGoal={props.onPauseGoal}
        onResumeGoal={props.onResumeGoal}
        onCancelBackgroundWork={props.onCancelBackgroundWork}
        headerSlot={headerSlot}
        bottomDock={props.bottomDock}
        onFeedbackChange={props.onFeedbackChange}
        onFork={props.onFork}
        onEdit={props.onEdit}
        previewFileRewind={props.previewFileRewind}
        applyFileRewind={props.applyFileRewind}
        canLoadOlder={props.canLoadOlder}
        loadingOlder={props.loadingOlder}
        onLoadOlder={props.onLoadOlder}
      />
    </Suspense>
  );
}
