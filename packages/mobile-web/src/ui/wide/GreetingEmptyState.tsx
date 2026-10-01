// R3 P5b 宽壳主区问候空态（specs/mobile-relay-r3-frontend.md §19/P5b）：时段问候 +
// 工作区名 + 新建任务主按钮。问候分桶/跨档换用逻辑与官方 ConversationDraftEmptyState
// 同构（D6 冻结 ui，只读参照不 import）：桶边界为 P5b 裁定五桶（wideShellModel），文案
// 键 mobileShell.wide.greeting.* 为自建键（值 = 官方 chat.empty.greeting.* 对应档）。
// 纯展示：工作区名与动作经 props 注入；新建任务链路 P5c 接入（缺回调时按钮禁用）。
import { useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { Button } from "../Button.js";
import { cn } from "../cn.js";
import { useIntl } from "../intl.js";
import {
  nextGreetingBoundaryDelayMs,
  resolveGreetingSlot,
  type WideGreetingSlot,
} from "./wideShellModel.js";

const GREETING_SLOT_KEYS: Record<WideGreetingSlot, string> = {
  morning: "mobileShell.wide.greeting.morning",
  noon: "mobileShell.wide.greeting.noon",
  afternoon: "mobileShell.wide.greeting.afternoon",
  evening: "mobileShell.wide.greeting.evening",
  lateNight: "mobileShell.wide.greeting.lateNight",
};

export interface GreetingEmptyStateProps {
  /** 主区工作区名（P5b 取首个工作区投影；多工作区取首个）。缺省不渲染该行。 */
  workspaceName?: string | null;
  /** 新建任务（P5c 链路；缺省按钮禁用，不做假动作）。 */
  onNewTask?: () => void;
  /** §32.13 宽壳草稿卡：首输发送（createSession → sendText；官方宽壳空态同构）。 */
  onDraftSend?: (text: string) => void;
  /** 草稿发送中（禁用发送钮）。 */
  draftSending?: boolean;
  className?: string;
}

/** §32.9 官方静态建议词（chat.draft.suggestedPrompt.*，zh/en 逐字入库）。 */
const DRAFT_PROMPTS: readonly { labelId: string; promptId: string }[] = [
  {
    labelId: "chat.draft.suggestedPrompt.recentCommits",
    promptId: "chat.draft.suggestedPrompt.recentCommits.prompt",
  },
  {
    labelId: "chat.draft.suggestedPrompt.createPdf",
    promptId: "chat.draft.suggestedPrompt.createPdf.prompt",
  },
];

export function GreetingEmptyState({
  workspaceName,
  onNewTask,
  onDraftSend,
  draftSending,
  className,
}: GreetingEmptyStateProps) {
  const { formatMessage } = useIntl();
  // §32.13 宽壳草稿卡本地草稿态（窄壳 NewTaskDraft 同款链路）。
  const [draft, setDraft] = useState("");
  const canSend = Boolean(draft.trim()) && !draftSending;
  // 问候时刻自持有：跨时段边界自动换档（官方 getNextChatEmptyGreetingDelayMs 同构）。
  const [greetingDate, setGreetingDate] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setTimeout(
      () => setGreetingDate(new Date()),
      nextGreetingBoundaryDelayMs(greetingDate),
    );
    return () => window.clearTimeout(timer);
  }, [greetingDate]);
  const greeting = formatMessage({
    id: GREETING_SLOT_KEYS[resolveGreetingSlot(greetingDate.getHours())],
  });
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-8 text-foreground",
        className,
      )}
    >
      {/* 品牌水印留 P5c 深面对齐（官方 DroraEmptyStateLogo 资产未随手机包恢复）。 */}
      <p className="text-center text-2xl/[1.2] font-medium">{greeting}</p>
      {workspaceName ? (
        <p className="flex min-w-0 items-center gap-1.5 text-ui-sm text-foreground-subtle">
          <FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{workspaceName}</span>
        </p>
      ) : null}
      {/* §32.13 宽壳草稿卡（官方空态同构：composer+静态建议词 chips；有草稿链路时替换新建钮）。 */}
      {onDraftSend ? (
        <>
          <div className="w-full max-w-2xl rounded-2xl border border-input-border bg-input p-3 focus-within:border-input-border-focused">
            <textarea
              data-testid="wide-draft-input"
              className="max-h-40 min-h-16 w-full resize-none bg-transparent text-ui-base leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
              rows={2}
              value={draft}
              placeholder={formatMessage({ id: "chat.placeholder.newTaskMobile" })}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (canSend && onDraftSend) onDraftSend(draft.trim());
                }
              }}
            />
            <div className="flex items-center justify-end">
              <button
                type="button"
                data-testid="wide-draft-send"
                aria-label={formatMessage({ id: "mobileShell.composer.send" })}
                disabled={!canSend}
                className="inline-flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                onClick={() => onDraftSend && canSend && onDraftSend(draft.trim())}
              >
                <Plus aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {DRAFT_PROMPTS.map((prompt) => (
              <button
                key={prompt.promptId}
                type="button"
                data-testid={`wide-draft-chip-${prompt.promptId.split(".").at(-1)}`}
                className="inline-flex min-h-9 items-center rounded-full border border-border bg-card px-3 text-ui-sm text-foreground transition-colors hover:bg-surface-hover"
                onClick={() => setDraft(formatMessage({ id: prompt.promptId }))}
              >
                {formatMessage({ id: prompt.labelId })}
              </button>
            ))}
          </div>
        </>
      ) : (
        <Button
          variant="outline"
          className="min-h-9 gap-1.5 border-transparent bg-primary px-4 text-primary-foreground hover:opacity-50 disabled:opacity-50"
          disabled={!onNewTask}
          title={onNewTask ? undefined : formatMessage({ id: "mobileShell.wide.actionPending" })}
          onClick={onNewTask}
        >
          <Plus aria-hidden="true" className="size-4" />
          {formatMessage({ id: "mobileShell.wide.newTask" })}
        </Button>
      )}
    </div>
  );
}
