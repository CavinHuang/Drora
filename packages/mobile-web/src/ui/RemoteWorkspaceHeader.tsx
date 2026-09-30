// 原版任务页第二顶栏的纯展示投影；任务标题与工作区路径由 App 提供。
import { Folder } from "lucide-react";

export function RemoteWorkspaceHeader({
  title,
  workspacePath,
}: {
  title: string;
  workspacePath: string;
}) {
  const workspaceName =
    workspacePath
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? workspacePath;
  return (
    <header
      data-testid="workspace-header"
      data-workspace-header-variant="task"
      className="relative flex h-12 w-full shrink-0 items-center border-b border-border/50 px-2"
    >
      <div className="flex min-w-0 items-center gap-2 overflow-hidden max-md:gap-1">
        <span
          data-testid="workspace-path"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle"
          title={workspacePath}
          aria-label={workspaceName}
        >
          <Folder aria-hidden="true" className="size-4" />
        </span>
        <h1
          data-testid="workspace-title"
          className="min-w-12 max-w-[42vw] truncate text-ui-base font-semibold text-foreground"
          title={title}
        >
          {title}
        </h1>
      </div>
    </header>
  );
}
