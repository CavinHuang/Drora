// 任务消息区唯一装配缝：惰性加载 UI 包的实时 v4 时间线。
import { lazy, Suspense, type ReactNode } from "react";
import type { Locale } from "@drora/shared";
import type {
  ConversationRow,
  PendingInteraction,
  SessionPhase,
  V4ConversationFileChangesResult,
} from "@drora/shared/drora-protocol-v4";
import type { ModelSelectionView } from "@drora/services";
import { InteractionCards, type InteractionAnswer } from "../ui/InteractionCards.js";
import { FileChangesBar } from "../ui/FileChangesBar.js";

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
  interactions: readonly PendingInteraction[];
  answering: boolean;
  onResolve: (interactionId: string, answer: InteractionAnswer) => void;
  fileChanges: V4ConversationFileChangesResult | null;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<void>;
  bottomDock: ReactNode;
}

export function RemoteTaskTimeline(props: RemoteTaskTimelineProps) {
  const headerSlot = (
    <>
      <InteractionCards
        interactions={props.interactions}
        busy={props.answering}
        onResolve={props.onResolve}
      />
      <FileChangesBar
        files={props.fileChanges?.files ?? null}
        additions={props.fileChanges?.additions ?? null}
        deletions={props.fileChanges?.deletions ?? null}
        className="px-3 pt-1"
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
        headerSlot={headerSlot}
        bottomDock={props.bottomDock}
        canLoadOlder={props.canLoadOlder}
        loadingOlder={props.loadingOlder}
        onLoadOlder={props.onLoadOlder}
      />
    </Suspense>
  );
}
