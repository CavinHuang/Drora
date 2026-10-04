// §32.9/§32.72 新建任务草稿页（specs/mobile-relay-r3-frontend.md）：官方 chat.empty 族
// 还原。§32.72 活体重构（nt-official 双页取证）：
//   顶栏 [← 返回][任务会话][🎨 主题]；时段问候（边界照官方 MCt）；
//   composer 单卡 = 工作区行（📁 名；多工作区下拉 §32.16 + ⑂ 分支占位图标——分支
//   数据源归 P-next，仅图标态）→ 输入（chat.placeholder.newTask 全句，活体逐字）
//   → 工具条 [＋ 添加上下文][Hand 模式名 ▾（TaskModeMenu，本地 draftMode 缺省 build=
//   官方活体；createSession 协议无初始 mode 字段，wire 归协议扩展轮）][管理模型 ▾
//   （ModelMenu；草稿页无模型管线 → 空态单条面，§32.70）][↑ 发送]；
//   建议词 chips 官方由 suggestions 服务门控（桩缺位不渲染，活体一致）→
//   props.suggestions 装配缝，App 现不传=隐藏。
// 记录：品牌水印（官方 ZCode「Z」底纹）= 品牌政策面（specs/zcode-rename.md 规则 4）；
// 套餐 banner = coding-plan 服务 harness 面（P7 家族）。
// 发送语义：首输 createSession → sendText（App 装配）；返回 = 丢弃草稿。
import { useState } from "react";
import { ArrowLeft, ArrowUp, ChevronDown, Folder, GitBranch, Hand, Plus } from "lucide-react";
import { useIntl } from "../ui/intl.js";
import { ModelMenu } from "../ui/ModelMenu.js";
import { EMPTY_MODEL_SELECTION_STATE } from "./conversationStore.js";
import { MODE_LABEL_IDS, TaskModeMenu } from "./TaskModeMenu.js";
import type { CollaborationMode } from "./taskSession.js";

/** 官方时段→问候键映射（纯函数；边界 [5,9,12,14,18,23) 与官方 MCt 逐值一致）。
 * 五段复用 P5b 既有键 mobileShell.wide.greeting.*（值 = 官方逐字），仅 early morning 新键。 */
export function resolveChatEmptyGreetingKey(hour: number): string {
  if (hour >= 5 && hour < 9) return "chat.empty.greeting.morningEarly";
  if (hour >= 9 && hour < 12) return "mobileShell.wide.greeting.morning";
  if (hour >= 12 && hour < 14) return "mobileShell.wide.greeting.noon";
  if (hour >= 14 && hour < 18) return "mobileShell.wide.greeting.afternoon";
  if (hour >= 18 && hour < 23) return "mobileShell.wide.greeting.evening";
  return "mobileShell.wide.greeting.lateNight";
}

/** 官方静态建议词（chat.draft.suggestedPrompt.*；经 suggestions 装配缝下发才渲染）。 */
export const SUGGESTED_PROMPTS: readonly { labelId: string; promptId: string }[] = [
  {
    labelId: "chat.draft.suggestedPrompt.recentCommits",
    promptId: "chat.draft.suggestedPrompt.recentCommits.prompt",
  },
  {
    labelId: "chat.draft.suggestedPrompt.createPdf",
    promptId: "chat.draft.suggestedPrompt.createPdf.prompt",
  },
];

export interface NewTaskDraftProps {
  /** 草稿目标工作区显示名（路径 basename；composer 内嵌工作区行）。 */
  workspaceName: string;
  /** §32.16 多工作区项目选择（官方草稿页 选择项目 下拉；单工作区时退化为标识行）。 */
  workspaces?: readonly { workspaceKey: string; path: string; name: string }[];
  /** 项目切换回调（App 更新 draftTarget）。 */
  onWorkspaceChange?: (workspace: { workspaceKey: string; path: string; name: string }) => void;
  /** 返回 = 丢弃草稿（App 清 draftTarget，不建会话）。 */
  onBack: () => void;
  onThemePress?: () => void;
  /** 首输发送（App：createSession → openTask → sendText；ws = 选中的项目）。
   * §32.72 mode = 草稿页模式选择（createSession 协议暂无初始 mode 字段，App 暂收不转）。 */
  onSend: (
    text: string,
    ws?: { workspaceKey: string; path: string },
    mode?: CollaborationMode,
  ) => void;
  sending?: boolean;
  /** §32.72 建议词装配缝（官方 suggestions 服务门控；缺省不渲染，活体一致）。 */
  suggestions?: readonly { labelId: string; promptId: string }[];
  /** 测试注入时钟；缺省当前时间。 */
  now?: Date;
}

export function NewTaskDraft(props: NewTaskDraftProps) {
  const { formatMessage } = useIntl();
  const [draft, setDraft] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectIdx, setProjectIdx] = useState(0);
  // §32.72 草稿模式（官方活体缺省 build=变更前确认；本地 UI 态，随 TaskModeMenu 切换）。
  const [draftMode, setDraftMode] = useState<CollaborationMode>("build");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const hour = (props.now ?? new Date()).getHours();
  const greetingKey = resolveChatEmptyGreetingKey(hour);
  const canSend = Boolean(draft.trim()) && !props.sending;
  const workspaces = props.workspaces;
  const modeLabelId = MODE_LABEL_IDS[draftMode] ?? MODE_LABEL_IDS.build!;

  const send = () => {
    const text = draft.trim();
    if (!text || props.sending) return;
    const ws = workspaces?.[projectIdx];
    props.onSend(
      text,
      ws ? { workspaceKey: ws.workspaceKey, path: ws.path } : undefined,
      draftMode,
    );
    setDraft("");
  };

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground">
      {/* 官方草稿页顶栏：返回（← ArrowLeft，活体 nt-official）/ 任务会话 / 主题。 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <button
          type="button"
          aria-label={formatMessage({ id: "mobileShell.task.backHome" })}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-surface-hover"
          onClick={props.onBack}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </button>
        <span className="text-ui-base font-medium text-foreground">
          {formatMessage({ id: "mobileShell.task.chatTitle" })}
        </span>
        <div className="ml-auto">
          {props.onThemePress ? (
            <button
              type="button"
              aria-label={formatMessage({ id: "mobileShell.home.theme" })}
              className="inline-flex size-9 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface-hover"
              onClick={props.onThemePress}
            >
              <span aria-hidden="true" className="text-ui-base">
                ◐
              </span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
        <div className="min-h-[24vh]" />
        {/* 官方时段问候（chat.empty.greeting.*，大字号居中）；品牌水印=品牌政策面记录。 */}
        <h1 className="text-center text-ui-xl font-semibold leading-7 text-foreground">
          {formatMessage({ id: greetingKey })}
        </h1>
        <div className="min-h-[10vh]" />
        {/* §32.72 composer 单卡：工作区行 + 输入 + 工具条（官方活体同卡三段）。 */}
        <div className="overflow-hidden rounded-2xl border border-input-border bg-card focus-within:border-input-border-focused">
          {workspaces && workspaces.length > 1 ? (
            <div className="relative flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
              <Folder aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
              <select
                data-testid="new-task-draft-project"
                className="min-w-0 flex-1 truncate bg-transparent text-ui-base font-medium text-foreground outline-none"
                value={projectIdx}
                onChange={(event) => setProjectIdx(Number(event.target.value))}
              >
                {workspaces.map((ws, idx) => (
                  <option key={ws.workspaceKey} value={idx}>
                    {ws.name}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
              <GitBranch aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
            </div>
          ) : (
            <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
              <Folder aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1 truncate text-ui-base font-medium text-foreground">
                {props.workspaceName}
              </span>
              {/* 分支占位图标（官方 ⑂；分支选择数据源归 P-next，仅图标态）。 */}
              <GitBranch aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
            </div>
          )}
          <textarea
            data-testid="new-task-draft-input"
            className="max-h-40 min-h-16 w-full resize-none bg-transparent px-3 pt-3 text-mobile-input-safe leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
            rows={2}
            value={draft}
            // §32.72 官方活体全句占位（chat.placeholder.newTask，非 newTaskMobile 短句）。
            placeholder={formatMessage({ id: "chat.placeholder.newTask" })}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
            {/* 官方工具条 [＋ 添加上下文][模式 ▾][管理模型 ▾][↑]（P7 上传面不接线）。 */}
            <button
              type="button"
              data-testid="new-task-draft-attach"
              aria-label={formatMessage({ id: "chat.composer.contextShortcut" })}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground-subtlest"
            >
              <Plus aria-hidden="true" className="size-4" />
            </button>
            <div className="relative shrink-0">
              <TaskModeMenu
                open={modeMenuOpen}
                configMode={draftMode}
                onSelect={(mode) => setDraftMode(mode)}
                onClose={() => setModeMenuOpen(false)}
              />
              <button
                type="button"
                data-testid="new-task-draft-mode-trigger"
                aria-haspopup="menu"
                aria-expanded={modeMenuOpen}
                aria-label={formatMessage({ id: "chat.toolbar.mode.label" })}
                className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-ui-base text-foreground transition-colors hover:bg-hover"
                onClick={() => setModeMenuOpen((open) => !open)}
              >
                <Hand aria-hidden="true" className="size-4" />
                <span className="inline">{formatMessage({ id: modeLabelId })}</span>
                <ChevronDown aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            <div className="relative ml-auto shrink-0">
              {modelMenuOpen ? (
                <div className="absolute bottom-full right-0 z-30 mb-2">
                  <ModelMenu
                    view={null}
                    state={EMPTY_MODEL_SELECTION_STATE}
                    onSelect={() => {}}
                    onClose={() => setModelMenuOpen(false)}
                  />
                </div>
              ) : null}
              <button
                type="button"
                data-testid="new-task-draft-model-trigger"
                aria-label={formatMessage({ id: "chat.toolbar.model.manageModels" })}
                title={formatMessage({ id: "chat.toolbar.model.manageModels" })}
                className="inline-flex h-7 shrink-0 items-center justify-between gap-1 rounded-lg pl-2 pr-1.5 text-ui-base text-foreground transition-colors hover:bg-hover"
                onClick={() => setModelMenuOpen((open) => !open)}
              >
                <span className="block min-w-0 truncate">
                  {formatMessage({ id: "chat.toolbar.model.manageModels" })}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-foreground-subtle"
                />
              </button>
            </div>
            <button
              type="button"
              data-testid="new-task-draft-send"
              aria-label={formatMessage({ id: "mobileShell.composer.send" })}
              disabled={!canSend}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
              onClick={send}
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        {/* §32.72 建议词 chips：官方 suggestions 服务门控（缺位不渲染，活体一致）；
            App 现不传装配缝 → 隐藏，生产接线归 P-next。 */}
        {props.suggestions && props.suggestions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2 pb-4">
            {props.suggestions.map((prompt) => (
              <button
                key={prompt.promptId}
                type="button"
                data-testid={`new-task-draft-chip-${prompt.promptId.split(".").at(-1)}`}
                className="inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-ui-sm text-foreground transition-colors hover:bg-surface-hover"
                onClick={() => setDraft(formatMessage({ id: prompt.promptId }))}
              >
                {formatMessage({ id: prompt.labelId })}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
