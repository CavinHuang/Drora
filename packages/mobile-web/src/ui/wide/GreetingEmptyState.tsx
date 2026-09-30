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
  /** 主区工作区名（P5b 取首个工作区投影；多工作区归属细化归 P5c）。缺省不渲染该行。 */
  workspaceName?: string | null;
  /** 新建任务（P5c 接 draft 链路；缺省按钮禁用，不做假动作）。 */
  onNewTask?: () => void;
  className?: string;
}

export function GreetingEmptyState({
  workspaceName,
  onNewTask,
  className,
}: GreetingEmptyStateProps) {
  const { formatMessage } = useIntl();
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
      <Button
        variant="outline"
        className="min-h-9 gap-1.5 border-transparent bg-primary px-4 text-primary-foreground hover:opacity-90 disabled:opacity-50"
        disabled={!onNewTask}
        title={onNewTask ? undefined : formatMessage({ id: "mobileShell.wide.actionPending" })}
        onClick={onNewTask}
      >
        <Plus aria-hidden="true" className="size-4" />
        {formatMessage({ id: "mobileShell.wide.newTask" })}
      </Button>
    </div>
  );
}
