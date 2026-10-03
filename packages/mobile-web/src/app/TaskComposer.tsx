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
import { lazy, Suspense, useState } from "react";
import {
  AlignEndHorizontal,
  ArrowUp,
  ChevronDown,
  Plus,
  Square,
} from "lucide-react";
import { useIntl } from "../ui/intl.js";
import { cn } from "../ui/cn.js";
import { resolveMobileComposerPlaceholderId } from "./composerPlaceholder.js";
// §33.18.18 ComposerRichInput 懒引入：其依赖链（git-pane/lexical）不进主包，node
// 测试环境也不解析 ui 别名链——Suspense fallback 兜 testid/占位形状。
const ComposerRichInput = lazy(() =>
  import("./ComposerRichInput.js").then((module) => ({
    default: module.ComposerRichInput,
  })),
);
import { ModelMenu } from "../ui/ModelMenu.js";
import type {
  ConversationControlState,
  ConversationQueueState,
  ModelSelectionState,
} from "./conversationStore.js";
import type { CollaborationMode } from "./taskSession.js";
import type { ModelSelectionView } from "@drora/services";

/** 官方 switchCollaborationMode 值域闭集（顺序照官方 schema Si([build,edit,plan,yolo])）。 */
export { MODE_SELECT_ITEMS } from "./TaskModeMenu.js";
import { TaskModeTrigger, TaskModePlanMarker } from "./TaskModeMenu.js";

export interface TaskComposerProps {
  draft: string;
  sending: boolean;
  stopping: boolean;
  controlState: ConversationControlState | null;
  queueState: ConversationQueueState | null;
  /** §32.39 官方 plt：无历史消息 → newTaskMobile 占位（草稿语义）。 */
  hasHistoryMessages?: boolean;
  /** §33.18 宽壳占位分支：running 语义键官方宽壳=followUpAsk（窄壳=followUpQueue）。 */
  desktopComposer?: boolean;
  modelState: ModelSelectionState | null;
  modelView: ModelSelectionView | null;
  modelLoading: boolean;
  modelMenuOpen: boolean;
  /** 官方 mode.label.glm.{mode} 的 mode 值（snapshot.config.mode；缺省 build）。 */
  configMode?: string | null;
  onDraftChange: (draft: string) => void;
  /** text 覆写：富文本编辑器提交以参数传递（Lexical 自持状态，state 可能滞后）。 */
  onSend: (text?: string) => void;
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
  /** §33.18.18 富文本编辑器数据面（workspacePath/身份/会话，mention/历史键用）。 */
  workspacePath?: string;
  workspaceIdentity?: string;
  taskId?: string | null;
}

/** 官方 mode.label.glm.* 闭集与模式域 UI（触发钮/菜单/plan 标记）收口在 TaskModeMenu.tsx。 */

/** §32.68 官方用量环几何：r=10 圆周 2πr（官方 dasharray 62.83185307179586 同值）。 */
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * 10;
/** §32.68 官方 aria 数字格式：Intl 千分位（活体 aria「上下文已用 123,456 / 总量 1,000,000」）。 */
const usageNumberFormat = new Intl.NumberFormat();

export function TaskComposer(props: TaskComposerProps) {
  const {
    draft,
    sending,
    stopping,
    controlState,
    queueState,
    hasHistoryMessages = true,
    desktopComposer = false,
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
    workspacePath,
    workspaceIdentity,
    taskId,
  } = props;
  const { formatMessage } = useIntl();
  // P6 深面本地交互态：思考档位弹层（选择走 switchModelConfig CAS 既有链路）。
  const [thoughtMenuOpen, setThoughtMenuOpen] = useState(false);
  // §32.3 模式弹层（选择走 switchCollaborationMode CAS；开合为本地 UI 态）。
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  // §32.68 思考档位门改成 provider-settings 语义：档位集合只认 modelView 模型的
  // optionSpecs（活体实证：snapshot.config.thoughtLevels=["low","high"] 已到而官方页
  // 不渲染 chat-thought-level-select-trigger——档位事实归 provider-settings 模型配置，
  // 不归快照；harness 无 provider-settings → 双方一致不渲染）。
  const thoughtLevels =
    modelView?.providers
      .flatMap((provider) => provider.models)
      .map((model) => model.config?.optionSpecs?.reasoningLevel?.values ?? [])
      .find((values) => values.length > 0) ?? [];
  const currentThought =
    modelState?.fallback?.thought || "";
  const currentProvider =
    modelState?.current?.providerId ?? modelState?.fallback?.provider ?? "";
  const currentModel = modelState?.current?.modelId ?? modelState?.fallback?.model ?? "";

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
        {/* §33.18.18 输入面换装：textarea → ui LexicalChatInput 官方富文本编辑器
            （窄入口经 ComposerRichInput 懒装配）。工具条已对齐面不动；提交语义=
            乐观清空（onSubmit 同步 App draft 后 onSend(text)，失败经错误面呈现）；
            @ 文件上下文/附件协议面（P7）未通，mention 关、slash 空表。 */}
        <Suspense
          fallback={
            <textarea
              data-testid="v4-composer-input"
              className="max-h-40 min-h-10 w-full resize-none bg-transparent text-mobile-input-safe leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
              rows={1}
              placeholder={formatMessage({
                id: resolveMobileComposerPlaceholderId(
                  controlState?.phase ?? null,
                  controlState?.queuePending ?? false,
                  hasHistoryMessages,
                  desktopComposer,
                ),
              })}
              readOnly
            />
          }
        >
          <ComposerRichInput
            workspacePath={workspacePath ?? ""}
            workspaceIdentity={workspaceIdentity}
            taskId={taskId ?? null}
            placeholder={formatMessage({
              id: resolveMobileComposerPlaceholderId(
                controlState?.phase ?? null,
                controlState?.queuePending ?? false,
                hasHistoryMessages,
                desktopComposer,
              ),
            })}
            disabled={sending}
            initialText={draft}
            inputTestId="v4-composer-input"
            onChange={onDraftChange}
            onSubmit={(text) => {
              onDraftChange(text);
              onSend(text);
              return true;
            }}
          />
        </Suspense>
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
              {/* §32.3 模式触发器（§33.18.13 抽 TaskModeMenu.tsx 域内）：响应式双形态
                  触发钮 + 弹层；无 onModeSelect（旧装配/测试）时退回只读展示。 */}
              <TaskModeTrigger
                configMode={configMode}
                desktopComposer={desktopComposer}
                modeMenuOpen={modeMenuOpen}
                onToggle={() => setModeMenuOpen((open) => !open)}
                onCloseMenu={() => setModeMenuOpen(false)}
                onModeSelect={onModeSelect}
              />
              {onModeSelect && configMode === "plan" ? (
                <TaskModePlanMarker onRemove={() => onModeSelect("build")} />
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5" data-composer-trailing-actions>
            {/* §32.68 官方 chat-context-usage-trigger：环形用量表（track opacity .25 /
                progress opacity .7、strokeWidth 4、-90° 起角），aria=chat.contextUsage
                Intl 千分位（活体「上下文已用 123,456 / 总量 1,000,000」）。数据源 =
                snapshot.usage.contextWindow（官方同源），无数据不渲染（官方 null 门）。 */}
            {modelState?.usage ? (
              <button
                type="button"
                data-testid="chat-context-usage-trigger"
                aria-label={formatMessage(
                  { id: "chat.contextUsage" },
                  {
                    used: usageNumberFormat.format(modelState.usage.usedTokens),
                    total: usageNumberFormat.format(modelState.usage.maxTokens),
                  },
                )}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-hover"
              >
                <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24">
                  <circle
                    cx="12"
                    cy="12"
                    fill="none"
                    opacity="0.25"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    fill="none"
                    opacity="0.7"
                    r="10"
                    stroke="currentColor"
                    strokeDasharray={`${CONTEXT_RING_CIRCUMFERENCE} ${CONTEXT_RING_CIRCUMFERENCE}`}
                    strokeDashoffset={
                      CONTEXT_RING_CIRCUMFERENCE *
                      (1 -
                        Math.min(
                          Math.max(
                            modelState.usage.usedTokens / modelState.usage.maxTokens,
                            0,
                          ),
                          1,
                        ))
                    }
                    strokeLinecap="round"
                    strokeWidth="4"
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center center" }}
                  />
                </svg>
              </button>
            ) : null}
            <div
              data-testid="v4-model-config"
              className="flex min-w-0 items-center"
            >
              <button
                type="button"
                data-testid="chat-model-select-trigger"
                title={formatMessage({ id: "chat.toolbar.model.manageModels" })}
                data-model-current-value={currentModel}
                className="inline-flex h-7 shrink-0 items-center justify-between gap-1 rounded-lg pl-2 pr-1.5 text-ui-base text-foreground transition-colors hover:bg-hover"
                onClick={onToggleModelMenu}
              >
                {/* §33.18.12 真数据活体：可见文案与 a11y 名 = 当前模型名（GLM-5.3），
                    未选择回落管理模型（官方无 aria-label，名字随内容）；title 保持
                    管理模型。§32.68「恒管理模型」为空数据态取证。 */}
                <span className="block min-w-0 truncate">
                  {currentModel || formatMessage({ id: "chat.toolbar.model.manageModels" })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-foreground-subtle"
                />
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
            {/* §33.18.12 翻案（官方 bundle 常量表 WD="v4-stop" + 流式态活体）：canStop
                （snapshot.control 同源）时同槽互换为 v4-stop 停止钮（chat.stop 官方逐字，
                stopping 期间 disabled），走既有 sendStop 链（§14 第 3 条）；空闲态才是
                v4-composer-send（空草稿 disabled 但保持官方实心形态）。§33.18.2 探针
                只踩到无流式回合状态，其"无停止钮"结论作废。 */}
            {controlState?.canStop ? (
              <button
                type="button"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
                disabled={stopping}
                aria-label={formatMessage({ id: "chat.stop" })}
                data-testid="v4-stop"
                onClick={onStop}
              >
                <Square aria-hidden="true" className="size-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
                disabled={!draft.trim() || sending}
                aria-label={formatMessage({ id: "mobileShell.composer.send" })}
                data-testid="v4-composer-send"
                onClick={() => onSend()}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
