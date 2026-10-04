// 任务更多菜单（specs/mobile-relay-r3-frontend.md §32.3/§32.15/§32.69）：官方
// workspace-more-button 弹层（index-NjWRUABD.js pin()@186832 逐结构）。
// §32.69 全项 9 条 4 组（活体 mv-more-official 截图 + pin() 装配序取证）：
//   [置顶/重命名/归档/标记未读] ‖ [复制路径/复制任务路径/复制日志路径/复制会话 ID]
//   ‖ [查看调用轨迹] ‖ [反馈问题]。
// 官方门语义（O=disableTaskActions||disableTaskTargetActions，harness 态=真）：
//   数据/命令源缺位 → disabled 渲染（不隐藏）；我方对应=§32.15 三态查询能力源
//   （loadMembership）与文件路径 prop，缺位即 disabled。仅 重命名/复制路径
//   harness 常绿（官方灰为其 O 微态，功能真接线记录为准）。
// 重命名对话框照官方 TaskRenameDialog（index-NjWRUABD.js:187230-187302）：标题
// taskList.rename + placeholder taskList.renamePlaceholder + common.cancel/confirm，
// IME composition 期 Enter 不提交（官方 To() 守卫同语义）；失败内联 taskList.renameFailed。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "../ui/intl.js";

/** §32.15 三态状态源查询（App 装配：accessor.zcodeTaskService 只读面）。 */
export interface TaskMembershipState {
  pinned: boolean;
  archived: boolean;
}

export interface TaskMoreMenuProps {
  /** 官方 ⋯ 触发（App 持开合态；菜单渲染归本组件）。 */
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  sessionId: string;
  /** 任务标题（重命名对话框初值 = 当前服务端事实标题）。 */
  title: string;
  /** v4 renameSession 提交（装配归 App→TaskSession）；返回 ACK 收敛结果。 */
  onRename: (title: string) => Promise<boolean>;
  /** §32.15 打开菜单时拉三态（App 装配：listPinnedTaskIds/listArchivedTasks 查询）。 */
  loadMembership?: () => Promise<TaskMembershipState>;
  /** 置顶切换（zcodeTaskService.setTaskPinned；App 装配）。 */
  onTogglePinned?: (pinned: boolean) => Promise<boolean>;
  /** 归档（zcodeTaskService.archiveTask；成功后 App 关任务面）。 */
  onArchive?: () => Promise<boolean>;
  /** 标记未读（zcodeTaskService.setTaskUnread）。 */
  onMarkUnread?: () => Promise<boolean>;
  /** §32.69 官方 appHeader.copyTaskPath 数据源（taskNativeSessionLogFile.path；缺位 disabled）。 */
  taskPath?: string | null;
  /** §32.69 官方 appHeader.copyLogPath 数据源（taskSessionFile.path；缺位 disabled）。 */
  logPath?: string | null;
  /** §32.69 官方 taskList.viewModelTrajectory（调用轨迹面归专项；缺 handler=disabled 渲染）。 */
  onViewModelTrajectory?: () => void;
  /** §32.69 官方 taskList.feedback（反馈面；缺 handler=disabled 渲染）。 */
  onTaskFeedback?: () => void;
}

export function TaskMoreMenu({
  open,
  onClose,
  workspacePath,
  sessionId,
  title,
  onRename,
  loadMembership,
  onTogglePinned,
  onArchive,
  onMarkUnread,
  taskPath,
  logPath,
  onViewModelTrajectory,
  onTaskFeedback,
}: TaskMoreMenuProps) {
  const { formatMessage } = useIntl();
  // §32.15 三态状态（开菜单时拉取；无查询能力=三态项不渲染，不盲切换）。
  const [membership, setMembership] = useState<TaskMembershipState | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const [pinPending, setPinPending] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const [renameError, setRenameError] = useState(false);
  const [renamePending, setRenamePending] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchorTop, setAnchorTop] = useState(0);
  const [anchorLeft, setAnchorLeft] = useState(0);
  // §32.69 portal 仅挂载后启用（SSR/首帧 in-flow 渲染，静态测试可见）。
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  // IME composition 期 Enter 不提交（官方 TaskRenameDialog 同守卫）。
  const composingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setRenameOpen(false);
      setRenameError(false);
      setArchiveConfirm(false);
    }
    // 初值播种只在点「重命名」时做（onClick）；快照回流不覆盖输入中的草稿。
  }, [open]);

  // §32.15 开菜单时拉三态真状态（置顶/归档），失败 = 三态项不渲染（不盲切换）。
  useEffect(() => {
    if (!open || !loadMembership) return;
    let cancelled = false;
    void loadMembership()
      .then((state) => {
        if (!cancelled) setMembership(state);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, loadMembership]);

  // §32.69 面板 portal 到 body + fixed 锚定：官方 Radix 同为 portal 渲染；头部左组
  // overflow-hidden 会裁剪 in-flow absolute 面板（活体 DOM 在而不可见实证）。
  useEffect(() => {
    if (!open) return;
    const r = menuRef.current?.getBoundingClientRect();
    if (r) {
      setAnchorTop(r.bottom + 4);
      setAnchorLeft(Math.max(8, Math.min(r.left, window.innerWidth - 200)));
    }
  }, [open]);

  useEffect(() => {
    if (!open || renameOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, renameOpen, onClose]);

  if (!open) return null;

  const copyText = (text: string) => {
    // 尽力而为：剪贴板权限缺失不阻塞菜单（无 toast 面，官方移动端同静默语义）。
    void navigator.clipboard?.writeText(text).catch(() => {});
    onClose();
  };

  const submitRename = () => {
    const next = renameValue.trim();
    if (!next || renamePending) return;
    setRenamePending(true);
    void onRename(next)
      .then((ok) => {
        if (ok) {
          setRenameOpen(false);
          onClose();
        } else {
          setRenameError(true);
        }
      })
      .finally(() => setRenamePending(false));
  };

  return (
    <div ref={menuRef} className="relative inline-flex">
      {renameOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"
          role="dialog"
          aria-label={formatMessage({ id: "taskList.rename" })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setRenameOpen(false);
            }
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-ui-lg font-semibold text-foreground">
              {formatMessage({ id: "taskList.rename" })}
            </h2>
            <input
              className="mt-4 h-10 w-full rounded-lg border border-input-border bg-input px-3 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-focused"
              value={renameValue}
              placeholder={formatMessage({ id: "taskList.renamePlaceholder" })}
              // 官方同款：触发初值 = 当前标题全量（服务端事实）。
              onChange={(event) => {
                setRenameValue(event.target.value);
                setRenameError(false);
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !composingRef.current) {
                  event.preventDefault();
                  submitRename();
                }
              }}
              autoFocus
            />
            {renameError ? (
              <p className="mt-2 text-ui-sm text-destructive">
                {formatMessage({ id: "taskList.renameFailed" })}
              </p>
            ) : null}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="h-10 rounded-lg border border-border px-5 text-ui-base text-foreground hover:bg-surface-hover"
                onClick={() => setRenameOpen(false)}
              >
                {formatMessage({ id: "common.cancel" })}
              </button>
              <button
                type="button"
                disabled={renamePending || !renameValue.trim()}
                className="h-10 rounded-lg bg-primary px-5 text-ui-base text-primary-foreground disabled:opacity-50"
                onClick={submitRename}
              >
                {formatMessage({ id: "common.confirm" })}
              </button>
            </div>
          </div>
        </div>
      ) : (
        (() => {
          const panel = (
            <div
              ref={panelRef}
              role="menu"
              style={
                isMounted ? { position: "fixed", top: anchorTop, left: anchorLeft } : undefined
              }
              className={
                isMounted
                  ? "z-30 w-48 rounded-xl border border-border bg-card p-1 shadow-lg"
                  : "absolute left-0 top-8 z-30 w-48 rounded-xl border border-border bg-card p-1 shadow-lg"
              }
            >
              {/* —— 组 A：任务三态 + 重命名（官方 pin()@186860 装配序）—— */}
              {/* §32.69 三态项改「缺能力源=disabled 渲染」不隐藏（官方 O 门语义，活体全灰）。 */}
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-pin"
                disabled={pinPending || !membership || !onTogglePinned}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={() => {
                  if (!membership || !onTogglePinned) return;
                  setPinPending(true);
                  void onTogglePinned(!membership.pinned)
                    .then((ok) => {
                      if (ok) setMembership({ ...membership, pinned: !membership.pinned });
                    })
                    .finally(() => setPinPending(false));
                }}
              >
                {formatMessage({
                  id: membership?.pinned ? "taskList.unpin" : "taskList.pin",
                })}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-rename"
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover"
                onClick={() => {
                  setRenameValue(title);
                  setRenameError(false);
                  setRenameOpen(true);
                }}
              >
                {formatMessage({ id: "taskList.rename" })}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-archive"
                disabled={!membership || !onArchive}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={() => {
                  if (!membership || !onArchive) return;
                  setArchiveConfirm(true);
                }}
              >
                {formatMessage({ id: "taskList.archive" })}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-mark-unread"
                disabled={!membership || !onMarkUnread}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={() => {
                  if (!onMarkUnread) return;
                  void onMarkUnread().finally(() => onClose());
                }}
              >
                {formatMessage({ id: "taskList.markAsUnread" })}
              </button>
              {/* 归档确认二态（官方 confirmDialog.taskArchiveTitle 同语义，§32.15 保留）。 */}
              {archiveConfirm ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="task-more-archive-confirm"
                  disabled={archivePending}
                  className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:opacity-50"
                  onClick={() => {
                    setArchivePending(true);
                    void onArchive?.()
                      .then((ok) => {
                        if (ok) onClose();
                      })
                      .finally(() => setArchivePending(false));
                  }}
                >
                  {formatMessage({ id: "taskList.archive" })}?
                </button>
              ) : null}
              {/* —— 组 B：路径/ID 复制 —— */}
              <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-copy-path"
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover"
                onClick={() => copyText(workspacePath)}
              >
                {formatMessage({ id: "appHeader.copyPath" })}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-copy-task-path"
                disabled={!taskPath}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={() => taskPath && copyText(taskPath)}
              >
                {formatMessage({ id: "appHeader.copyTaskPath" })}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-copy-log-path"
                disabled={!logPath}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={() => logPath && copyText(logPath)}
              >
                {formatMessage({ id: "appHeader.copyLogPath" })}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-copy-session-id"
                disabled={!membership}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={() => copyText(sessionId)}
              >
                {formatMessage({ id: "appHeader.copySessionId" })}
              </button>
              {/* —— 组 C：调用轨迹（官方 E 条件渲染项；缺 handler=disabled）—— */}
              <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-view-trajectory"
                disabled={!onViewModelTrajectory}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={onViewModelTrajectory}
              >
                {formatMessage({ id: "taskList.viewModelTrajectory" })}
              </button>
              {/* —— 组 D：反馈（官方 b 条件渲染项；缺 handler=disabled）—— */}
              <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-feedback"
                disabled={!onTaskFeedback}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-50"
                onClick={onTaskFeedback}
              >
                {formatMessage({ id: "taskList.feedback" })}
              </button>
            </div>
          );
          return isMounted ? createPortal(panel, document.body) : panel;
        })()
      )}
    </div>
  );
}
