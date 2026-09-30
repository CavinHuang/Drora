// 远控展示适配层：复用 v4 实时消息列表，不在 UI 包里持有 relay 或会话状态。
import { useMemo, type ReactNode } from "react";
import type { Locale } from "@drora/shared";
import type { ConversationRow, SessionPhase } from "@drora/shared/drora-protocol-v4";
import type { ModelSelectionView } from "@drora/services";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { ConversationTimeline } from "@/v4/ConversationTimeline.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import { PluginReferenceIconProvider } from "@/v4/pluginReferenceIconContext.js";

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
  headerSlot?: ReactNode;
  bottomDock?: ReactNode;
  canLoadOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => Promise<void> | void;
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
  headerSlot,
  bottomDock,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
}: RemoteConversationTimelineProps) {
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
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ConversationTimeline
              rows={rows}
              totalCount={totalCount}
              sessionKey={sessionKey}
              rowContext={rowContext}
              sessionPhase={sessionPhase}
              headerSlot={headerSlot}
              bottomDock={bottomDock}
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
