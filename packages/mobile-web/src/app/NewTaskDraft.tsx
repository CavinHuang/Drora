// §32.9 新建任务草稿页（specs/mobile-relay-r3-frontend.md）：官方 chat.empty 族还原——
// 时段问候（边界照官方 MCt：[5,9)morningEarly [9,12)morning [12,14)noon [14,18)afternoon
// [18,23)evening 其余 lateNight）+ 项目标识 + composer（占位 chat.placeholder.newTaskMobile）
// + 静态建议词 chips（chat.draft.suggestedPrompt.{recentCommits,createPdf}，官方 locale 既有；
// 周报总结等动态 chips 无数据源，不臆造）。发送语义：首输 createSession → sendText（App 装配）；
// 返回 = 丢弃草稿（不建会话，与官方一致）。
import { useState } from "react";
import { ArrowUp, ChevronDown, Folder, Paperclip } from "lucide-react";
import { useIntl } from "../ui/intl.js";
import { cn } from "../ui/cn.js";

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

/** 官方静态建议词（chat.draft.suggestedPrompt.*；locale 既有键，zh/en 双语逐字入库）。 */
const SUGGESTED_PROMPTS: readonly { labelId: string; promptId: string }[] = [
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
  /** 草稿目标工作区显示名（路径 basename；官方项目标识行）。 */
  workspaceName: string;
  /** §32.16 多工作区项目选择（官方草稿页 选择项目 下拉；单工作区时下拉退化为标识行）。 */
  workspaces?: readonly { workspaceKey: string; path: string; name: string }[];
  /** 项目切换回调（App 更新 draftTarget）。 */
  onWorkspaceChange?: (workspace: { workspaceKey: string; path: string; name: string }) => void;
  /** 返回 = 丢弃草稿（App 清 draftTarget，不建会话）。 */
  onBack: () => void;
  onThemePress?: () => void;
  /** 首输发送（App：createSession → openTask → sendText；ws = 选中的项目）。 */
  onSend: (text: string, ws?: { workspaceKey: string; path: string }) => void;
  sending?: boolean;
  /** 测试注入时钟；缺省当前时间。 */
  now?: Date;
}

export function NewTaskDraft(props: NewTaskDraftProps) {
  const { formatMessage } = useIntl();
  const [draft, setDraft] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectIdx, setProjectIdx] = useState(0);
  const hour = (props.now ?? new Date()).getHours();
  const greetingKey = resolveChatEmptyGreetingKey(hour);
  const canSend = Boolean(draft.trim()) && !props.sending;
  const workspaces = props.workspaces;

  const send = () => {
    const text = draft.trim();
    if (!text || props.sending) return;
    const ws = workspaces?.[projectIdx];
    props.onSend(text, ws ? { workspaceKey: ws.workspaceKey, path: ws.path } : undefined);
    setDraft("");
  };

  return (
    <div className="flex h-dvh w-full flex-col bg-background text-foreground">
      {/* 官方草稿页顶栏：返回任务首页 / 任务会话 / 主题（选择主题按钮与任务面同款）。 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <button
          type="button"
          aria-label={formatMessage({ id: "mobileShell.task.backHome" })}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-surface-hover"
          onClick={props.onBack}
        >
          <ArrowUp aria-hidden="true" className="size-4 rotate-[180deg]" />
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
              <Paperclip aria-hidden="true" className="hidden size-4" />
              <span aria-hidden="true" className="text-ui-base">
                ◐
              </span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
        <div className="min-h-[18vh]" />
        {/* 官方时段问候（chat.empty.greeting.*，大字号居中）。 */}
        <h1 className="text-center text-ui-xl font-semibold leading-7 text-foreground">
          {formatMessage({ id: greetingKey })}
        </h1>
        <div className="min-h-[6vh]" />
        {/* 项目选择行（folder + 工作区名；§32.16 多工作区=下拉切换，单工作区=标识行）。
            官方另有分支/CLI 选择，数据源归后续轮。 */}
        {workspaces && workspaces.length > 1 ? (
          <div className="relative flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
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
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
            <Folder aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
            <span className="truncate text-ui-base font-medium text-foreground">
              {props.workspaceName}
            </span>
          </div>
        )}
        {/* composer 卡（占位 = chat.placeholder.newTaskMobile；附件保持官方禁用态语义）。 */}
        <div className="mt-3 rounded-2xl border border-input-border bg-input p-3 focus-within:border-input-border-focused">
          <textarea
            data-testid="new-task-draft-input"
            className="max-h-40 min-h-10 w-full resize-none bg-transparent text-mobile-input-safe leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
            rows={2}
            value={draft}
            placeholder={formatMessage({ id: "chat.placeholder.newTaskMobile" })}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground-subtlest"
              aria-hidden="true"
            >
              <Paperclip className="size-4" />
            </span>
            <button
              type="button"
              data-testid="new-task-draft-send"
              aria-label={formatMessage({ id: "mobileShell.composer.send" })}
              disabled={!canSend}
              className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
              onClick={send}
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        {/* 官方静态建议词 chips（点击预填草稿；动态 chips 无数据源不渲染）。 */}
        <div className="mt-3 flex flex-wrap gap-2 pb-4">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt.promptId}
              type="button"
              data-testid={`new-task-draft-chip-${prompt.promptId.split(".").at(-1)}`}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-ui-sm text-foreground transition-colors hover:bg-surface-hover",
              )}
              onClick={() => setDraft(formatMessage({ id: prompt.promptId }))}
            >
              {formatMessage({ id: prompt.labelId })}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
