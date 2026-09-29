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
  onModelSelect: (selection: { providerId: string; modelId: string; thoughtLevel?: string }) => void;
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
    <div className="px-3 py-2">
      {(queueState?.itemCount ?? 0) > 0 ? (
        <div className="mb-2 rounded-lg border border-border bg-surface px-3 py-2 text-ui-xs text-foreground-subtle">
          <div className="font-medium text-foreground">
            {formatMessage(
              { id: "chat.queue.title" },
              { count: String(queueState?.itemCount ?? 0) },
            )}
          </div>
          {queueState?.autoDrain === false ? (
            <div className="mt-0.5">
              {formatMessage({
                id:
                  queueState.pauseReason === "stopped"
                    ? "chat.queue.paused.stopped"
                    : queueState.pauseReason === "error"
                      ? "chat.queue.paused.error"
                      : "chat.queue.paused.generic",
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mb-1 flex items-center gap-2">
        <button
          type="button"
          className="min-h-9 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-ui-xs text-foreground transition-colors hover:bg-surface-hover"
          onClick={onToggleModelMenu}
        >
          {modelState?.current?.modelId ??
            modelState?.fallback?.model ??
            formatMessage({ id: "chat.toolbar.model.label" })}
        </button>
        {modelState?.usage ? (
          <UsageBadge
            usedTokens={modelState.usage.usedTokens}
            maxTokens={modelState.usage.maxTokens}
          />
        ) : null}
      </div>
      {modelMenuOpen ? (
        <div className="relative z-20 mb-2">
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
      <MobileComposerStateBar
        phase={controlState?.phase ?? null}
        canStop={controlState?.canStop ?? false}
        stopState={controlState?.stopState ?? "idle"}
        queuePending={controlState?.queuePending ?? false}
        onStop={onStop}
      />
      <div className="mt-1 flex items-end gap-2">
        <textarea
          className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-input-border bg-input px-3 py-2.5 text-mobile-input-safe text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-focused"
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
        <button
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          disabled={!draft.trim() || sending}
          aria-label={formatMessage({ id: "mobileShell.composer.send" })}
          onClick={onSend}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

