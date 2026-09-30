// R3 P3c 任务面 composer（自 App.tsx 抽出，App.tsx max-lines 治理）：
// 队列横幅 + 模型按钮/菜单 + 用量徽标 + 状态条（停止/占位）+ 输入行。
// 状态所有者不变：草稿 = 本地态；队列/停止/模型/用量 = conversation store 派生。
import { useIntl } from "../ui/intl.js";
import { MobileComposerStateBar, resolveMobileComposerPlaceholderId } from "../ui/TaskTimeline.js";
import { ModelMenu, UsageBadge } from "../ui/ModelMenu.js";
import type {
  ConversationControlState,
  ConversationQueueState,
  ModelSelectionState,
} from "./conversationStore.js";
import type { ModelSelectionView } from "@drora/services";
import { ArrowUp } from "lucide-react";

export interface TaskComposerProps {
  draft: string;
  sending: boolean;
  stopping: boolean;
  controlState: ConversationControlState | null;
  queueState: ConversationQueueState | null;
  modelState: ModelSelectionState | null;
  modelView: ModelSelectionView | null;
  modelLoading: boolean;
  modelMenuOpen: boolean;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onStop: () => void;
  onToggleModelMenu: () => void;
  onModelSelect: (selection: {
    providerId: string;
    modelId: string;
    thoughtLevel?: string;
  }) => void;
  onCloseModelMenu: () => void;
}

export function TaskComposer(props: TaskComposerProps) {
  const {
    draft,
    sending,
    stopping,
    controlState,
    queueState,
    modelState,
    modelView,
    modelLoading,
    modelMenuOpen,
    onDraftChange,
    onSend,
    onStop,
    onToggleModelMenu,
    onModelSelect,
    onCloseModelMenu,
  } = props;
  const { formatMessage } = useIntl();
  return (
    <div
      data-testid="v4-composer"
      data-queue-count={queueState?.itemCount ?? 0}
      className="relative w-full"
      aria-busy={sending || stopping}
    >
      {modelMenuOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-full">
          <ModelMenu
            view={modelView}
            state={
              modelState ?? {
                current: null,
                fallback: null,
                thoughtLevels: [],
                availability: null,
                usage: null,
              }
            }
            loading={modelLoading}
            onSelect={onModelSelect}
            onClose={onCloseModelMenu}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-1 rounded-2xl border border-input-border bg-input p-3 transition-colors focus-within:border-input-border-focused">
        <textarea
          data-testid="v4-composer-input"
          className="max-h-40 min-h-10 w-full resize-none bg-transparent text-mobile-input-safe leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
          rows={1}
          value={draft}
          placeholder={formatMessage({
            id: resolveMobileComposerPlaceholderId(
              controlState?.phase ?? null,
              controlState?.queuePending ?? false,
            ),
          })}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div
          className="flex min-w-0 items-center justify-end gap-1.5"
          data-composer-trailing-actions
        >
          {modelState?.usage ? (
            <UsageBadge
              usedTokens={modelState.usage.usedTokens}
              maxTokens={modelState.usage.maxTokens}
              compact
            />
          ) : null}
          <button
            type="button"
            data-testid="chat-model-select-trigger"
            className="min-h-9 max-w-36 truncate rounded-lg px-2 text-ui-base text-foreground transition-colors hover:bg-surface-hover"
            onClick={onToggleModelMenu}
          >
            {modelState?.current?.modelId ??
              modelState?.fallback?.model ??
              formatMessage({ id: "chat.toolbar.model.label" })}
          </button>
          <MobileComposerStateBar
            phase={controlState?.phase ?? null}
            canStop={controlState?.canStop ?? false}
            stopState={controlState?.stopState ?? "idle"}
            queuePending={controlState?.queuePending ?? false}
            onStop={onStop}
          />
          {draft.trim() || !controlState?.canStop ? (
            <button
              type="button"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
              disabled={!draft.trim() || sending}
              aria-label={formatMessage({ id: "mobileShell.composer.send" })}
              onClick={onSend}
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
