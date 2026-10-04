// R3 P6 宽壳侧栏深面：工作区移除确认对话（specs/mobile-relay-r3-frontend.md §23）。
// 纯展示受控组件：open/confirm/cancel 归上层；本组件只渲染官方对话文案面。
// 官方形态取证（upstream index chunk）：confirm dialog API =
//   { title: removeRunningWorkspace.title「移除运行中的项目？」,
//     description: removeRunningWorkspace.description（运行中释放语义逐字）,
//     confirmLabel: removeRunningWorkspace.confirm「移除并停止运行」,
//     cancelLabel: common.cancel「取消」,
//     confirmVariant: "destructive" }；
// 取消路径官方 debug 文案「用户取消移除运行中 workspace」（仅日志，不进 UI 面）。
// windowsReservedNameRisk（{count}/{path} 插值官方逐字）为移除后警示段（可选装配）。
// SSH 工作区标识：sshConnectionTitle「SSH 连接」官方逐字；alias/host/path 三插值官方
// locale 缺值（补译已注明，spec §23.3）——以 title 属性承载详情（官方浮层形态未取证，
// 不臆造交互）。D6 自包含；role=alertdialog（destructive 确认语义）。
import { useIntl } from "../intl.js";
import { cn } from "../cn.js";

export interface SidebarRemoveWorkspaceDialogProps {
  open: boolean;
  /** 运行中工作区走官方 removeRunningWorkspace 三键（本组件唯一已取证形态）。 */
  onConfirm: () => void;
  onCancel: () => void;
  /** 移除后警示（官方 {count}/{path} 插值；缺省不渲染）。 */
  reservedNameRisk?: { count: number; path: string } | null;
  className?: string;
}

export function SidebarRemoveWorkspaceDialog({
  open,
  onConfirm,
  onCancel,
  reservedNameRisk,
  className,
}: SidebarRemoveWorkspaceDialogProps) {
  const { formatMessage } = useIntl();
  if (!open) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={formatMessage({ id: "workspaceSidebar.removeRunningWorkspace.title" })}
      className={cn("fixed inset-0 z-40 flex items-center justify-center p-6", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg">
        <p className="text-ui-base font-medium text-foreground">
          {formatMessage({ id: "workspaceSidebar.removeRunningWorkspace.title" })}
        </p>
        <p className="mt-1 text-ui-sm text-muted-foreground">
          {formatMessage({ id: "workspaceSidebar.removeRunningWorkspace.description" })}
        </p>
        {reservedNameRisk ? (
          <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-ui-xs text-muted-foreground">
            {formatMessage(
              { id: "workspaceSidebar.windowsReservedNameRisk" },
              { count: String(reservedNameRisk.count), path: reservedNameRisk.path },
            )}
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="sidebar-remove-cancel"
            className="rounded-md border border-border px-3 py-1.5 text-ui-sm text-foreground hover:bg-muted"
            onClick={onCancel}
          >
            {/* 官方 cancelLabel = common.cancel（六面对话共用取消键）。 */}
            {formatMessage({ id: "common.cancel" })}
          </button>
          <button
            type="button"
            data-testid="sidebar-remove-confirm"
            className="rounded-md bg-destructive px-3 py-1.5 text-ui-sm text-destructive-foreground hover:opacity-90"
            onClick={onConfirm}
          >
            {formatMessage({ id: "workspaceSidebar.removeRunningWorkspace.confirm" })}
          </button>
        </div>
      </div>
    </div>
  );
}

/** SSH 工作区标识（组行徽标 + title 详情；官方 alias/host/path 插值，缺值补译已注明）。 */
export function WorkspaceSshBadge({
  alias,
  host,
  path,
  className,
}: {
  alias?: string;
  host?: string;
  path?: string;
  className?: string;
}) {
  const { formatMessage } = useIntl();
  const details = [
    alias !== undefined
      ? formatMessage({ id: "workspaceSidebar.sshConnectionAlias" }, { alias })
      : null,
    host !== undefined
      ? formatMessage({ id: "workspaceSidebar.sshConnectionHost" }, { host })
      : null,
    path !== undefined
      ? formatMessage({ id: "workspaceSidebar.sshConnectionPath" }, { path })
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      title={details || formatMessage({ id: "workspaceSidebar.sshConnectionTitle" })}
      className={cn("shrink-0 rounded bg-muted px-1 text-ui-xs text-muted-foreground", className)}
    >
      {formatMessage({ id: "workspaceSidebar.sshConnectionTitle" })}
    </span>
  );
}
