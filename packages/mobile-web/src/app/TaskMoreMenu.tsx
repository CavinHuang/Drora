// 任务更多菜单（specs/mobile-relay-r3-frontend.md §32.3/§32.15）：官方 workspace-more-button
// 弹层（index-NjWRUABD.js:186860-186935 装配序）。
// 一期：重命名（v4 renameSession，官方 schema 6206 逐字）/复制路径（appHeader.copyPath →
// workspacePath）/复制会话 ID（appHeader.copySessionId → sessionId）。
// §32.15 二期（状态源打通）：置顶/归档/未读三态经 droraTaskService 查询面
// （listPinnedTaskIds/listArchivedTasks）按开菜单时点拉真状态，命令
// setTaskPinned/archiveTask/setTaskUnread 既有——盲切换裁定解除。任务路径/日志路径
// 无快照数据源；调用轨迹/反馈问题归专项——仍不渲染。
// 重命名对话框照官方 TaskRenameDialog（index-NjWRUABD.js:187230-187302）：标题
// taskList.rename + placeholder taskList.renamePlaceholder + common.cancel/confirm，
// IME composition 期 Enter 不提交（官方 To() 守卫同语义）；失败内联 taskList.renameFailed。
import { useEffect, useRef, useState } from "react";
import { useIntl } from "../ui/intl.js";

/** §32.15 三态状态源查询（App 装配：accessor.droraTaskService 只读面）。 */
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
  /** 置顶切换（droraTaskService.setTaskPinned；App 装配）。 */
  onTogglePinned?: (pinned: boolean) => Promise<boolean>;
  /** 归档（droraTaskService.archiveTask；成功后 App 关任务面）。 */
  onArchive?: () => Promise<boolean>;
  /** 标记未读（droraTaskService.setTaskUnread）。 */
  onMarkUnread?: () => Promise<boolean>;
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

  useEffect(() => {
    if (!open || renameOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
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
        <div
          role="menu"
          className="absolute right-0 top-8 z-30 w-56 rounded-xl border border-border bg-card p-1 shadow-lg"
        >
          {/* §32.15 三态项（置顶/归档/未读）：有状态源查询能力才渲染；置顶文案随真状态切换。 */}
          {membership && onTogglePinned ? (
            <button
              type="button"
              role="menuitem"
              data-testid="task-more-pin"
              disabled={pinPending}
              className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:opacity-50"
              onClick={() => {
                setPinPending(true);
                void onTogglePinned(!membership.pinned)
                  .then((ok) => {
                    if (ok) setMembership({ ...membership, pinned: !membership.pinned });
                  })
                  .finally(() => setPinPending(false));
              }}
            >
              {formatMessage({
                id: membership.pinned ? "taskList.unpin" : "taskList.pin",
              })}
            </button>
          ) : null}
          {membership && onArchive ? (
            archiveConfirm ? (
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-archive-confirm"
                disabled={archivePending}
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover disabled:opacity-50"
                onClick={() => {
                  setArchivePending(true);
                  void onArchive()
                    .then((ok) => {
                      if (ok) onClose();
                    })
                    .finally(() => setArchivePending(false));
                }}
              >
                {formatMessage({ id: "taskList.archive" })}?
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                data-testid="task-more-archive"
                className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover"
                onClick={() => setArchiveConfirm(true)}
              >
                {formatMessage({ id: "taskList.archive" })}
              </button>
            )
          ) : null}
          {onMarkUnread ? (
            <button
              type="button"
              role="menuitem"
              data-testid="task-more-mark-unread"
              className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover"
              onClick={() => {
                void onMarkUnread().finally(() => onClose());
              }}
            >
              {formatMessage({ id: "taskList.markAsUnread" })}
            </button>
          ) : null}
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
            data-testid="task-more-copy-path"
            className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover"
            onClick={() => copyText(workspacePath)}
          >
            {formatMessage({ id: "appHeader.copyPath" })}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="task-more-copy-session-id"
            className="flex min-h-9 w-full items-center rounded-md px-3 text-left text-ui-sm text-foreground hover:bg-surface-hover"
            onClick={() => copyText(sessionId)}
          >
            {formatMessage({ id: "appHeader.copySessionId" })}
          </button>
        </div>
      )}
    </div>
  );
}
