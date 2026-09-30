// 远控展示适配层：复用 v4 实时消息列表，不在 UI 包里持有 relay 或会话状态。
import { useMemo, useState, type ReactNode } from "react";
import type { Locale } from "@drora/shared";
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
  onPauseGoal?: () => void;
  onResumeGoal?: () => void;
  onCancelBackgroundWork?: (workId: string) => void;
  headerSlot?: ReactNode;
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
  onPauseGoal,
  onResumeGoal,
  onCancelBackgroundWork,
  headerSlot,
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
        goal: statusSnapshot?.goal ?? null,
        plan: statusSnapshot?.plan ?? null,
        backgroundWorks: statusSnapshot?.backgroundWorks ?? [],
        runningSubagents: statusSnapshot?.subagents?.running ?? [],
      }),
    [workspacePath, statusSnapshot],
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
              goal={statusSnapshot?.goal ?? null}
              plan={statusSnapshot?.plan ?? null}
              backgroundWorks={statusSnapshot?.backgroundWorks ?? []}
              runningSubagents={statusSnapshot?.subagents?.running ?? []}
              layoutMode={statusPanelLayout}
              summaryPanelVariantOverride={statusPanelVariant}
              onVariantChange={setStatusPanelVariant}
              onPauseGoal={statusSnapshot?.availability?.pauseGoal.allowed ? onPauseGoal : undefined}
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
