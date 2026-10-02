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
// §32.3 模式切换解封：官方 chat-mode-select-trigger → chat-mode-select-item 四项闭集
// （switchCollaborationMode 命令官方 schema 逐字一致，spec §32.2#2）；标签读
// snapshot.config.mode 回流，本组件不持有模式事实。
import { useState } from "react";
import { AlignEndHorizontal, ArrowUp, ChevronDown, Plus, Shield, X } from "lucide-react";
import { useIntl } from "../ui/intl.js";
import { cn } from "../ui/cn.js";
import { MobileComposerStateBar, resolveMobileComposerPlaceholderId } from "../ui/TaskTimeline.js";
import { ModelMenu, UsageBadge } from "../ui/ModelMenu.js";
import type {
  ConversationControlState,
  ConversationQueueState,
  ModelSelectionState,
} from "./conversationStore.js";
import type { CollaborationMode } from "./taskSession.js";
import type { ModelSelectionView } from "@drora/services";

/** 官方 switchCollaborationMode 值域闭集（顺序照官方 schema Si([build,edit,plan,yolo])）。 */
export const MODE_SELECT_ITEMS: readonly CollaborationMode[] = ["build", "edit", "plan", "yolo"];

export interface TaskComposerProps {
  draft: string;
  sending: boolean;
  stopping: boolean;
  controlState: ConversationControlState | null;
  queueState: ConversationQueueState | null;
  /** §32.39 官方 plt：无历史消息 → newTaskMobile 占位（草稿语义）。 */
  hasHistoryMessages?: boolean;
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
  /** 协作模式切换（§32.3；v4 switchCollaborationMode CAS，装配归 App）。 */
  onModeSelect?: (mode: CollaborationMode) => void;
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
    hasHistoryMessages = true,
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
    onModeSelect,
  } = props;
  const { formatMessage } = useIntl();
  // P6 深面本地交互态：思考档位弹层（选择走 switchModelConfig CAS 既有链路）。
  const [thoughtMenuOpen, setThoughtMenuOpen] = useState(false);
  // §32.3 模式弹层（选择走 switchCollaborationMode CAS；开合为本地 UI 态）。
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
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
              hasHistoryMessages,
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
              {/* §32.64 官方活体（CDP 探针）：chat-attachment-button aria=添加上下文（非
                  添加附件），Plus 图标非回形针；P7 上传协议面仍归后续，按钮不 disabled。 */}
              <input type="file" hidden multiple aria-hidden="true" tabIndex={-1} />
              <button
                type="button"
                data-testid="chat-attachment-button"
                aria-label={formatMessage({ id: "chat.composer.contextShortcut" })}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground-subtlest"
              >
                <Plus aria-hidden="true" className="size-4" />
              </button>
              {/* §32.3 模式触发器：官方 chat-mode-select-trigger 弹层形态；无 onModeSelect
                  （旧装配/测试）时退回只读展示。 */}
              {onModeSelect ? (
                <div className="relative shrink-0">
                  {modeMenuOpen ? (
                    <div
                      role="menu"
                      aria-label={formatMessage({ id: modeLabelId })}
                      className="absolute bottom-full left-0 z-30 mb-2 w-44 rounded-lg border border-border bg-card p-1 shadow-lg"
                    >
                      {MODE_SELECT_ITEMS.map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="menuitem"
                          data-testid={`chat-mode-select-item-${mode}`}
                          className={cn(
                            "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-ui-sm hover:bg-surface-hover",
                            mode === configMode
                              ? "text-foreground"
                              : "text-foreground-subtle",
                          )}
                          onClick={() => {
                            setModeMenuOpen(false);
                            if (mode !== configMode) onModeSelect(mode);
                          }}
                        >
                          {formatMessage({ id: MODE_LABEL_IDS[mode] ?? MODE_LABEL_IDS.build! })}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    data-testid="chat-mode-select-trigger"
                    aria-haspopup="menu"
                    aria-expanded={modeMenuOpen}
                    aria-label={formatMessage({ id: "chat.toolbar.mode.label" })}
                    title={formatMessage({ id: "chat.toolbar.mode.label" })}
                    className={cn(
                      "inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover",
                      configMode === "yolo"
                        ? "text-warning"
                        : "text-foreground-subtle",
                    )}
                    onClick={() => setModeMenuOpen((open) => !open)}
                  >
                    {/* 官方窄壳模式触发器 = 盾形图标（§32.10）；aria/title = 官方通用
                        「切换模式」（§32.24 官方还原页活体取证，非当前模式名）。 */}
                    <Shield aria-hidden="true" className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="chat-mode-select-trigger"
                  aria-disabled="true"
                  aria-label={formatMessage({ id: "chat.toolbar.mode.label" })}
                  title={formatMessage({ id: "chat.toolbar.mode.label" })}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground-subtle"
                >
                  <Shield aria-hidden="true" className="size-4" />
                </button>
              )}
              {/* §32.22 官方 v4-composer-plan-marker（bundle @2029871）：plan 生效时工具栏
                  出现可移除标记（竖分隔 + ghost 钮，悬停换 X，chat.plan.removeMarker 文案，
                  官方动作为正交的 plan/plan-off 命令——本协议把 plan 折进 mode 闭集（§32.3），
                  移除等价映射为切回 build）。仅在有切换能力（onModeSelect）时渲染。 */}
              {onModeSelect && configMode === "plan" ? (
                <span data-testid="v4-composer-plan-marker" className="flex items-center gap-1">
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    className="h-3 w-px shrink-0 bg-border"
                  />
                  <button
                    type="button"
                    aria-label={formatMessage({ id: "chat.plan.removeMarker" })}
                    title={formatMessage({ id: "chat.plan.removeMarker" })}
                    className="group/plan inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface-hover hover:text-foreground-subtle"
                    onClick={() => onModeSelect("build")}
                  >
                    <Shield
                      aria-hidden="true"
                      className="size-4 group-hover/plan:hidden group-focus-visible/plan:hidden"
                    />
                    <X
                      aria-hidden="true"
                      className="hidden size-4 group-hover/plan:block group-focus-visible/plan:block"
                    />
                  </button>
                </span>
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5" data-composer-trailing-actions>
            <span className="inline-flex shrink-0" data-testid="chat-context-usage-trigger">
              {modelState?.usage ? (
                <UsageBadge
                  usedTokens={modelState.usage.usedTokens}
                  maxTokens={modelState.usage.maxTokens}
                  compact
                />
              ) : null}
            </span>
            <div
              data-testid="v4-model-config"
              className="flex min-w-0 items-center"
            >
              <button
                type="button"
                data-testid="chat-model-select-trigger"
                className="flex min-h-9 max-w-36 flex-col items-start justify-center rounded-lg px-2 leading-tight transition-colors hover:bg-surface-hover"
                onClick={onToggleModelMenu}
              >
                {/* 官方双行触发器：上行 管理模型（小字），下行 模型名+下拉箭头（§32.10 截图取证）。 */}
                <span className="text-[10px] leading-3 text-foreground-subtle">
                  {formatMessage({ id: "chat.toolbar.model.manageModels" })}
                </span>
                <span className="flex max-w-full items-center gap-0.5 text-ui-sm text-foreground">
                  <span className="truncate">
                    {modelState?.current?.modelId ??
                      modelState?.fallback?.model ??
                      formatMessage({ id: "chat.toolbar.model.label" })}
                  </span>
                  <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
                </span>
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
                  <AlignEndHorizontal aria-hidden="true" className="size-3.5 shrink-0 text-foreground-subtle" />
                  {currentThought
                    ? formatMessage({
                        id: `chat.toolbar.thoughtLevel.value.${currentThought}`,
                      })
                    : formatMessage({ id: "chat.toolbar.thoughtLevel.placeholder" })}
                </button>
              ) : null}
            </div>
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
