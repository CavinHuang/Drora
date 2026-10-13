// §32.11 任务信息弹层（specs/mobile-relay-r3-frontend.md）：官方 folder 按钮弹层还原
// （活页截图取证：[📁 工作区名 / 路径] / [🕐 最近活动 X 前] / [⑂ 分支]）。
// 数据源：taskTarget（工作区名/路径）+ gitStatus.summary.branchName（attachmentGitSummary）；
// 最近活动无任务面数据源（sessions-index 摘要在首页桥），缺省不渲染该行——不臆造。
import { useEffect, useRef } from "react";
import { Clock, Folder, GitBranch } from "lucide-react";

export interface TaskInfoPopoverProps {
  open: boolean;
  onClose: () => void;
  /** 工作区显示名（路径 basename）。 */
  name: string;
  workspacePath: string;
  /** 当前分支（git 摘要可用时渲染分支行；缺省隐藏）。 */
  branchName?: string | null;
  /** 最近活动文案（官方「最近活动 X 前」；首页摘要可用时由装配方传，缺省隐藏）。 */
  lastActivityText?: string;
}

export function TaskInfoPopover(props: TaskInfoPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) props.onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={props.name}
      className="absolute left-0 top-9 z-30 w-72 rounded-xl border border-border bg-card p-3 shadow-lg"
    >
      <div className="flex items-start gap-2.5">
        <Folder aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
        <div className="min-w-0">
          <div className="truncate text-ui-base font-medium text-foreground">{props.name}</div>
          <div className="mt-0.5 truncate font-mono text-ui-xs text-foreground-subtlest">
            {props.workspacePath}
          </div>
        </div>
      </div>
      {/* §32.71 官方活体（ifo-official）：行序 = 工作区块 → 最近活动（同组无分隔）→
          分隔线 → 分支行（此前分支在前/时间末位为旧证）。文案=「最近活动 {time}」
          （workspace.context.lastActivity，装配方传全句）。 */}
      {props.lastActivityText ? (
        <div className="mt-2.5 flex items-center gap-2.5">
          <Clock aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
          <span className="truncate text-ui-sm text-foreground">{props.lastActivityText}</span>
        </div>
      ) : null}
      {props.branchName ? (
        <div className="mt-2.5 flex items-center gap-2.5 border-t border-border pt-2.5">
          <GitBranch aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
          <span className="truncate text-ui-sm text-foreground">{props.branchName}</span>
        </div>
      ) : null}
    </div>
  );
}
