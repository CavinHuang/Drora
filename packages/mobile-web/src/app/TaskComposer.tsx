// R3 P6 composer 深度还原（specs/mobile-relay-r3-frontend.md §23.8）：对齐官方窄壳
// 远控任务面 composer 工具条两区形态（official-live-mobile-chat.html 取证）——
//   左区 flex.min-w-0.flex-1：[chat-attachment-button]（官方同形态 input.hidden 不接线）
//     + [chat-mode-select-trigger]（mode.label.glm.{configMode} 文案）；
//   右区 ml-auto：[v4-model-config] 容器（model trigger + thought trigger）→
//     [chat-context-usage-trigger]（用量徽标并入）→ [v4-stop]（StateBar）→ 发送。
// 能力边界（远控可达，不臆造命令）：mode 仅渲染当前值（切换命令 relay 面未确认，弹层
// 不做）；thought **真接线**——thoughtLevels 弹层 → onModelSelect 携 thoughtLevel 走既有
// switchModelConfig CAS 链路（P4b/P5 实证）；attachment 按钮禁用态（官方 hidden input
// 同形，上传面归 P7 能力矩阵）。发送按钮为实用偏差保留（官方窄壳回车提交，移动端
// 无实体回车；spec §23.8 记录）。
// 文案：mode.label.glm.* / chat.toolbar.thoughtLevel.* / chat.attachments.add 官方双语逐字。
import { useState } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { useIntl } from "../ui/intl.js";
import { cn } from "../ui/cn.js";
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
  /** 官方 mode.label.glm.{mode} 的 mode 值（snapshot.config.mode；缺省 build）。 */
  configMode?: string | null;
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

/** 官方 mode.label.glm.* 闭集（config.mode 未知值回落 build 文案同官方缺省语义）。 */
const MODE_LABEL_IDS: Record<string, string> = {
  default: "mode.label.glm.default",
  plan: "mode.label.glm.plan",
  edit: "mode.label.glm.edit",
  build: "mode.label.glm.build",
  yolo: "mode.label.glm.yolo",
};

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
    configMode,
    onDraftChange,
    onSend,
    onStop,
    onToggleModelMenu,
    onModelSelect,
    onCloseModelMenu,
  } = props;
  const { formatMessage } = useIntl();
  // P6 深面本地交互态：思考档位弹层（选择走 switchModelConfig CAS 既有链路）。
  const [thoughtMenuOpen, setThoughtMenuOpen] = useState(false);
  const thoughtLevels = modelState?.thoughtLevels ?? [];
  const currentThought =
    modelState?.fallback?.thought || "";
  const currentProvider =
    modelState?.current?.providerId ?? modelState?.fallback?.provider ?? "";
  const currentModel = modelState?.current?.modelId ?? modelState?.fallback?.model ?? "";
  const modeLabelId = MODE_LABEL_IDS[configMode ?? "build"] ?? MODE_LABEL_IDS.build!;

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
      {thoughtMenuOpen && thoughtLevels.length > 0 ? (
        <div
          role="menu"
          aria-label={formatMessage({ id: "chat.toolbar.thoughtLevel.label" })}
          className="absolute bottom-full right-0 z-30 mb-2 w-44 rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          {thoughtLevels.map((level) => (
            <button
              key={level}
              type="button"
              role="menuitem"
              data-testid={`chat-thought-level-value-${level}`}
              className={cn(
                "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-ui-sm hover:bg-surface-hover",
                level === currentThought ? "text-foreground" : "text-foreground-subtle",
              )}
              onClick={() => {
                setThoughtMenuOpen(false);
                if (level !== currentThought && currentProvider && currentModel) {
                  onModelSelect({
                    providerId: currentProvider,
                    modelId: currentModel,
                    thoughtLevel: level,
                  });
                }
              }}
            >
              {formatMessage({ id: `chat.toolbar.thoughtLevel.value.${level}` })}
            </button>
          ))}
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
        {/* 官方两区工具条（group/toolbar）：左 attachment+mode / 右 model-config+usage+stop+send。 */}
        <div className="group/toolbar flex min-w-0 items-end">
          <div className="flex min-w-0 flex-1">
            <div className="flex shrink-0 items-center">
              {/* 官方同形态：hidden input + 按钮；上传命令面未接 → disabled（P7 能力矩阵）。 */}
              <input type="file" hidden multiple aria-hidden="true" tabIndex={-1} />
              <button
                type="button"
                data-testid="chat-attachment-button"
                aria-label={formatMessage({ id: "chat.attachments.add" })}
                disabled
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground-subtlest"
              >
                <Paperclip aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                data-testid="chat-mode-select-trigger"
                aria-disabled="true"
                title={formatMessage({ id: modeLabelId })}
                className="max-w-36 truncate rounded-lg px-2 py-1.5 text-ui-sm text-foreground-subtle"
              >
                {formatMessage({ id: modeLabelId })}
              </button>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5" data-composer-trailing-actions>
            <div
              data-testid="v4-model-config"
              className="flex min-w-0 items-center"
            >
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
              {thoughtLevels.length > 0 ? (
                <button
                  type="button"
                  data-testid="chat-thought-level-select-trigger"
                  aria-haspopup="menu"
                  aria-expanded={thoughtMenuOpen}
                  className="max-w-20 truncate rounded-lg px-2 py-1.5 text-ui-sm text-foreground-subtle transition-colors hover:bg-surface-hover"
                  onClick={() => setThoughtMenuOpen((open) => !open)}
                >
                  {currentThought
                    ? formatMessage({
                        id: `chat.toolbar.thoughtLevel.value.${currentThought}`,
                      })
                    : formatMessage({ id: "chat.toolbar.thoughtLevel.placeholder" })}
                </button>
              ) : null}
            </div>
            <span className="inline-flex shrink-0" data-testid="chat-context-usage-trigger">
              {modelState?.usage ? (
                <UsageBadge
                  usedTokens={modelState.usage.usedTokens}
                  maxTokens={modelState.usage.maxTokens}
                  compact
                />
              ) : null}
            </span>
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
                data-testid="v4-composer-send"
                onClick={onSend}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
