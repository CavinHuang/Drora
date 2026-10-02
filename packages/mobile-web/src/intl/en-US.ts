// R3 P2a 自包含 i18n 字典（en-US）。提取来源与规则同 zh-CN.ts 文件头注释。
export const enUS: Record<string, string> = {
  "mobileShell.connection.connected": "Connected to this desktop window",
  "mobileShell.connection.connecting": "Connecting",
  "mobileShell.connection.disconnected": "Disconnected",
  "mobileShell.connection.reconnecting": "Reconnecting",
  "mobileShell.failure.connectionRecoveryTimeout.action": "Retry",
  "mobileShell.failure.connectionRecoveryTimeout.badge": "Recovery timed out",
  "mobileShell.failure.connectionRecoveryTimeout.description":
    "This phone did not recover its remote control connection in time, so the current page cannot keep syncing yet.",
  "mobileShell.failure.connectionRecoveryTimeout.detailLabel": "Recovery detail",
  "mobileShell.failure.connectionRecoveryTimeout.step1":
    "Keep the phone network available and retry.",
  "mobileShell.failure.connectionRecoveryTimeout.step2":
    "If it still cannot recover, start Web remote control again from desktop.",
  "mobileShell.failure.connectionRecoveryTimeout.stepsTitle": "Next steps",
  "mobileShell.failure.connectionRecoveryTimeout.title": "Connection Recovery Timed Out",
  "mobileShell.failure.desktopBootstrapTimeout.action": "Retry",
  "mobileShell.failure.desktopBootstrapTimeout.badge": "Timed out",
  "mobileShell.failure.desktopBootstrapTimeout.description":
    "This phone reached the relay, but desktop did not return workspace data in time.",
  "mobileShell.failure.desktopBootstrapTimeout.detailLabel": "Timeout detail",
  "mobileShell.failure.desktopBootstrapTimeout.step1":
    "Check that desktop is not asleep or waiting for confirmation.",
  "mobileShell.failure.desktopBootstrapTimeout.step2": "Keep both devices online and retry.",
  "mobileShell.failure.desktopBootstrapTimeout.stepsTitle": "Next steps",
  "mobileShell.failure.desktopBootstrapTimeout.title": "Desktop Timed Out",
  "mobileShell.failure.desktopDisconnected.action": "Try Again",
  "mobileShell.failure.desktopDisconnected.badge": "Desktop offline",
  "mobileShell.failure.desktopDisconnected.description":
    "The desktop side disconnected. This phone can no longer control the desktop workspace.",
  "mobileShell.failure.desktopDisconnected.detailLabel": "Relay detail",
  "mobileShell.failure.desktopDisconnected.step1":
    "Make sure Drora is still running and online on desktop.",
  "mobileShell.failure.desktopDisconnected.step2": "Start Web remote control again from desktop.",
  "mobileShell.failure.desktopDisconnected.stepsTitle": "What happened",
  "mobileShell.failure.desktopDisconnected.title": "Desktop Offline",
  "mobileShell.failure.invalidMobileConnection.action": "Try Again",
  "mobileShell.failure.invalidMobileConnection.badge": "Invalid connection",
  "mobileShell.failure.invalidMobileConnection.description":
    "The QR parameters or authentication proof for this page are no longer valid.",
  "mobileShell.failure.invalidMobileConnection.detailLabel": "Failure detail",
  "mobileShell.failure.invalidMobileConnection.step1":
    "Do not reuse an old screenshot or copied link.",
  "mobileShell.failure.invalidMobileConnection.step2": "Scan the latest desktop QR code.",
  "mobileShell.failure.invalidMobileConnection.stepsTitle": "Next steps",
  "mobileShell.failure.invalidMobileConnection.title": "Mobile Connection Invalid",
  "mobileShell.failure.relayUnavailable.action": "Retry",
  "mobileShell.failure.relayUnavailable.badge": "Relay unavailable",
  "mobileShell.failure.relayUnavailable.description":
    "This phone cannot maintain a connection to the Web remote control relay.",
  "mobileShell.failure.relayUnavailable.detailLabel": "Connection detail",
  "mobileShell.failure.relayUnavailable.step1": "Check the phone network.",
  "mobileShell.failure.relayUnavailable.step2": "Refresh later if desktop is still online.",
  "mobileShell.failure.relayUnavailable.stepsTitle": "Next steps",
  "mobileShell.failure.relayUnavailable.title": "Relay Unavailable",
  "mobileShell.failure.sessionConflict.action": "Try Again",
  "mobileShell.failure.sessionConflict.badge": "Device takeover",
  "mobileShell.failure.sessionConflict.description":
    "Another remote control device connected and replaced this phone. Only one mobile controller can stay active at a time.",
  "mobileShell.failure.sessionConflict.detailLabel": "Relay detail",
  "mobileShell.failure.sessionConflict.step1": "Continue on the newer device.",
  "mobileShell.failure.sessionConflict.step2": "Scan the desktop QR code again to use this phone.",
  "mobileShell.failure.sessionConflict.stepsTitle": "Next steps",
  "mobileShell.failure.sessionConflict.title": "Taken Over By Another Device",
  "mobileShell.failure.sessionExpired.action": "Reload",
  "mobileShell.failure.sessionExpired.badge": "Session ended",
  "mobileShell.failure.sessionExpired.description":
    "This remote control session expired or was closed from desktop.",
  "mobileShell.failure.sessionExpired.detailLabel": "Close reason",
  "mobileShell.failure.sessionExpired.step1": "Start Web remote control again on desktop.",
  "mobileShell.failure.sessionExpired.step2": "Open the workspace from a new link.",
  "mobileShell.failure.sessionExpired.stepsTitle": "Next steps",
  "mobileShell.failure.sessionExpired.title": "Remote Control Ended",
  "mobileShell.failure.sessionNotFound.action": "Reload",
  "mobileShell.failure.sessionNotFound.badge": "Link unavailable",
  "mobileShell.failure.sessionNotFound.description":
    "This Web remote control link no longer exists, usually because desktop generated a new QR code.",
  "mobileShell.failure.sessionNotFound.detailLabel": "Relay detail",
  "mobileShell.failure.sessionNotFound.step1": "Open Web remote control again on desktop.",
  "mobileShell.failure.sessionNotFound.step2": "Scan the latest QR code.",
  "mobileShell.failure.sessionNotFound.stepsTitle": "Next steps",
  "mobileShell.failure.sessionNotFound.title": "Access Link Expired",
  "mobileShell.failure.unexpectedError.action": "Retry",
  "mobileShell.failure.unexpectedError.badge": "Unexpected error",
  "mobileShell.failure.unexpectedError.description":
    "An unexpected error occurred while opening Web remote control.",
  "mobileShell.failure.unexpectedError.detailLabel": "Error detail",
  "mobileShell.failure.unexpectedError.step1": "Refresh this page once.",
  "mobileShell.failure.unexpectedError.step2":
    "If it still fails, generate a new QR code on desktop.",
  "mobileShell.failure.unexpectedError.stepsTitle": "Next steps",
  "mobileShell.failure.unexpectedError.title": "Web Remote Control Failed",
  "mobileShell.failure.unsupportedAction.action": "Reload",
  "mobileShell.failure.unsupportedAction.badge": "Unsupported",
  "mobileShell.failure.unsupportedAction.description":
    "Web remote control can only access workspaces already open on desktop.",
  "mobileShell.failure.unsupportedAction.detailLabel": "Limitation",
  "mobileShell.failure.unsupportedAction.step1": "Open the target workspace on desktop first.",
  "mobileShell.failure.unsupportedAction.step2": "Select it from this phone afterward.",
  "mobileShell.failure.unsupportedAction.stepsTitle": "Next steps",
  "mobileShell.failure.unsupportedAction.title": "Action Not Supported",
  "mobileShell.failure.workspaceClosed.action": "Reload",
  "mobileShell.failure.workspaceClosed.badge": "Workspace closed",
  "mobileShell.failure.workspaceClosed.description":
    "The shared workspace was closed on desktop, so this phone can no longer access it.",
  "mobileShell.failure.workspaceClosed.detailLabel": "Desktop detail",
  "mobileShell.failure.workspaceClosed.step1": "Reopen the target workspace on desktop.",
  "mobileShell.failure.workspaceClosed.step2": "Start Web remote control again.",
  "mobileShell.failure.workspaceClosed.stepsTitle": "Next steps",
  "mobileShell.failure.workspaceClosed.title": "Workspace Closed",
  "mobileShell.home.collapseAll": "Collapse all workspaces",
  "mobileShell.home.expandAll": "Expand all workspaces",
  "mobileShell.home.notice":
    "This connection can view the projects, tasks, and sessions currently open on this device. If the QR code expires, return to desktop and connect again.",
  "mobileShell.home.organize": "Organize tasks",
  "mobileShell.home.reconnect": "Reconnect",
  "mobileShell.home.refresh": "Refresh workspaces and tasks",
  "mobileShell.home.sectionTitle": "Workspaces and tasks on this device",
  "mobileShell.home.summary": "{workspaceCount} workspaces · {taskCount} tasks",
  "mobileShell.home.theme": "Choose theme",
  "mobileShell.home.title": "Drora remote control",
  "mobileShell.home.workspaceEmpty": "No tasks in this workspace", // 官方逐字（§32.38 组内空态）
  "mobileShell.home.noTasks": "No tasks available in the current desktop window", // 官方逐字（顶层空态）
  "mobileShell.home.pinnedSection": "Pinned", // 官方逐字
  "mobileShell.home.openTask": "Open task {title}", // 官方逐字（行 aria）
  "mobileShell.loading.authenticating.title": "Authenticating device…",
  "mobileShell.loading.authenticating.description":
    "Relay connected. Verifying your remote-control identity.",
  "mobileShell.loading.connecting.title": "Connecting relay service…",
  "mobileShell.loading.connecting.description":
    "Establishing a connection between your phone and the relay.",
  "mobileShell.loading.paired.description": "Connection established. Syncing workspace and tasks.",
  "mobileShell.loading.paired.title": "Paired. Loading workspace…",
  "mobileShell.loading.preparing.description": "Initializing mobile remote-control session.",
  "mobileShell.loading.preparing.title": "Preparing remote control…",
  "mobileShell.loading.reconnecting.title": "Connection interrupted, reconnecting…",
  "mobileShell.loading.reconnecting.description":
    "Auto-reconnecting after network or wake-up changes.",
  "mobileShell.loading.step.auth": "Authenticate device",
  "mobileShell.loading.step.pairing": "Wait for desktop pairing",
  "mobileShell.loading.step.relay": "Connect to relay service",
  "mobileShell.loading.step.sync": "Sync workspace",
  "mobileShell.loading.suspended.title": "Page is in background, waiting to recover…",
  "mobileShell.loading.suspended.description":
    "Connection will recover automatically when back in foreground.",
  "mobileShell.loading.waiting.title": "Waiting for desktop pairing…",
  "mobileShell.loading.waiting.description":
    "Phone is ready. Waiting for desktop to match this connection.",
  "mobileShell.task.backHome": "Back to task home",
  "mobileShell.task.chatTitle": "Task chat",
  "mobileShell.task.more": "More",
  "mobileShell.task.reconnectingBanner": "Reconnecting automatically...",
  "mobileShell.task.sidePaneCollapse": "Collapse side panel",
  "mobileShell.task.sidePaneExpand": "Expand side panel",
  "mobileShell.task.help": "Help", // §33.18 官方活体（workspace-help-menu-trigger，宽壳）
  "mobileShell.task.terminalToggle": "Toggle terminal", // §33.18 官方活体（terminal-toggle，宽壳）
  "mobileShell.task.status.completed": "Completed",
  "mobileShell.task.status.idle": "Idle",
  "mobileShell.task.status.running": "Running",
  "mobileShell.workspace.kind.local": "Local",
  "mobileShell.workspace.kind.remote": "Remote",
  "mobileShell.workspace.newTask": "New task",
  "mobileShell.workspace.taskCount": "{count} tasks",
  "mobileShell.workspace.tasksEmpty": "No tasks in this workspace",
  "mobileShell.workspace.updatedAt": "Updated {time}",
  "taskList.archive": "Archive task",
  "taskList.archiveFailed": "Could not archive task",
  "taskList.archiveLocal": "Archive local task",
  "taskList.archiveRemote": "Archive remote task",
  "taskList.archivedActions": "Archive actions",
  "taskList.archivedTaskCount": "{count} archived tasks",
  "taskList.attentionCount": "{label} · {count}",
  "taskList.changeStats": "+{added} -{removed}",
  "taskList.cronTaskLabel": "Scheduled task",
  "taskList.daysAgo": "{days}d",
  "taskList.delete": "Delete task",
  "taskList.deleteAllArchived": "Delete all archived tasks",
  "taskList.deleteAllArchivedBusy": "Processing…",
  "taskList.deleteAllArchivedError":
    "The operation or list refresh failed. Refresh to check the remaining tasks.",
  "taskList.deleteAllArchivedMenu": "Delete all archived tasks…",
  "taskList.deleteAllArchivedResult": "Deleted {deleted}, skipped {skipped}, failed {failed}.",
  "taskList.deleteAllArchivedTitle": "Delete {count} archived tasks?",
  "taskList.feedback": "Report issue",
  "taskList.feedbackOpened": "Feedback opened with the current task context attached",
  "taskList.forkedUntitled": "New task",
  "taskList.hoursAgo": "{hours}h",
  "taskList.justNow": "now",
  "taskList.loading": "Loading tasks...",
  "taskList.markAsUnread": "Mark as unread",
  "taskList.markAsUnreadFailed": "Could not mark task as unread",
  "taskList.minutesAgo": "{minutes}m",
  "taskList.mobileActive": "Phone is using this task",
  "taskList.newTask": "New task",
  "taskList.newThread": "New task",
  "taskList.noArchivedTasks": "No archived tasks",
  "taskList.noTasks": "No tasks yet",
  "taskList.offPeakTaskLabel": "Idle-time task",
  "taskList.openInSplitPane": "Open in split view",
  "taskList.openSettings": "Settings",
  "taskList.permissionTag": "Awaiting approval",
  "taskList.pin": "Pin task",
  "taskList.pinFailed": "Could not update pinned state",
  "taskList.pinnedSection": "Pinned",
  "taskList.recentSection": "Recent",
  "taskList.rename": "Rename task",
  "taskList.renameFailed": "Could not rename task",
  "taskList.renamePlaceholder": "Task name",
  "taskList.resume": "Resume",
  "taskList.showLess": "Show less",
  "taskList.showMore": "Show more",
  "taskList.status.completed": "Done",
  "taskList.status.failed": "Failed",
  "taskList.status.notReady": "Not ready",
  "taskList.status.ready": "Ready",
  "taskList.status.restoring": "Restoring",
  "taskList.status.streaming": "Running",
  "taskList.stopCountdown": "Stop timer",
  "taskList.switchBlockedByModelRestart":
    "Model provider switch in progress. Task switching is temporarily disabled.",
  "taskList.syncingRemoteWorkspaces": "Loading remote tasks...",
  "taskList.unarchive": "Unarchive task",
  "taskList.unpin": "Unpin task",
  "taskList.untitled": "New task",
  "taskList.userInputTag": "Awaiting approval",
  "taskList.viewModelTrajectory": "View model trajectory",
  "taskList.workflowRun.ariaLabel": "Workflow run {name}: {status}",
  "taskList.workflowRun.liveCount": "{count} workflows running",
  "taskList.workflowRun.moreRuns": "+{count} more",
  "taskList.workflowRun.moreStations": "+{count}",
  "mobileShell.composer.placeholder": "Type a message", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  "mobileShell.composer.send": "Send", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  "mobileShell.task.timelineEmpty": "No messages yet", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  "mobileShell.home.language": "Switch language", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  // —— P3a 富时间线 / composer 状态驱动：官方键，值逐字取自 packages/ui/src/i18n/locales/en-US.ts ——
  "chat.permission.awaitingApproval": "Awaiting approval", // 官方 en-US.ts:5941
  "chat.placeholder.followUpQueue": "Keep typing to queue follow-up changes", // 官方 en-US.ts:4715
  "chat.placeholder.followUpAsk": "Ask for follow-up changes", // 官方逐字
  "chat.message.copy": "Copy", // 官方逐字（§32.40）
  "chat.reasoning.thinking": "Thinking", // 官方 en-US.ts:4820
  "chat.reasoning.thought": "Thought", // 官方 en-US.ts:4821
  "chat.stop.short": "Stop", // 官方 en-US.ts:4779
  "chat.stop": "Stop", // 官方逐字（§32.24 官方还原页活体：任务面停止钮用此键）
  "chat.toolbar.mode.label": "Switch mode", // 官方逐字（§32.24 活体：模式触发器 aria 通用文案）
  "chat.toolCall.collapseDetails": "Collapse tool details", // 官方 en-US.ts:5022
  "chat.toolCall.expandDetails": "Expand tool details", // 官方 en-US.ts:5021
  "chat.toolCall.result": "Result", // 官方 en-US.ts:5026
  "chat.toolCall.status.completed": "Completed", // 官方 en-US.ts:5017
  "chat.toolCall.status.failed": "Failed", // 官方 en-US.ts:5018
  "chat.toolCall.status.running": "Running", // 官方 en-US.ts:5016
  "chat.toolCall.status.stopped": "Stopped", // 官方 en-US.ts:5020
  "taskTimeline.daysAgo": "{days} days ago", // 官方 en-US.ts:2084
  "taskTimeline.lastMonth": "Last month", // 官方 en-US.ts:2088
  "taskTimeline.lastWeek": "Last week", // 官方 en-US.ts:2086
  "taskTimeline.older": "Older", // 官方 en-US.ts:2089
  "taskTimeline.thisMonth": "This month", // 官方 en-US.ts:2087
  "taskTimeline.thisWeek": "This week", // 官方 en-US.ts:2085
  "taskTimeline.today": "Today", // 官方 en-US.ts:2082
  "taskTimeline.yesterday": "Yesterday", // 官方 en-US.ts:2083
  // —— P3a 自建键（官方 ui locales 无现成轮级/折叠文案）——
  "mobileShell.task.turnState.interrupted": "Interrupted", // P3a 自建键
  "mobileShell.task.turnState.failed": "Failed", // P3a 自建键
  "mobileShell.timeline.reasoningCollapse": "Collapse reasoning", // P3a 自建键
  "mobileShell.timeline.reasoningExpand": "Expand reasoning", // P3a 自建键
  // —— P3b 文件变更统计 + 队列状态第一档：官方键，值逐字取自 packages/ui/src/i18n/locales/en-US.ts ——
  "chat.changeSummary.filesChanged.one": "{count} file changed", // 官方 en-US.ts:2090
  "chat.changeSummary.filesChanged.other": "{count} files changed", // 官方 en-US.ts:2091
  "chat.queue.paused.error": "The queue was paused because the response failed", // 官方 en-US.ts:4803
  "chat.queue.paused.generic": "The queue is paused", // 官方 en-US.ts:4804
  "chat.queue.paused.stopped": "The queue was paused because you stopped the current response", // 官方 en-US.ts:4802
  "chat.queue.title": "Queued messages ({count})", // 官方 en-US.ts:4792
  "mobileShell.interaction.questionBadge": "Question", // P3b 自建键（官方无 mobileShell.interaction 命名空间）
  "mobileShell.interaction.addFeedback": "Add feedback…", // P3b 自建键（官方无 mobileShell.interaction 命名空间）
  "mobileShell.organize.title": "Organize", // 自建键（官方 mobileHome 族无菜单标题键）
  "mobileShell.organize.organizeBy": "Group by", // 自建键（官方 mobileHome 族无对应键）
  "mobileShell.organize.byWorkspace": "By workspace", // 官方逐字（webRemoteControl.mobileHome.organizeByWorkspace en）
  "mobileShell.organize.byTimeline": "Timeline", // 官方逐字（webRemoteControl.mobileHome.organizeByTimeline en，§32.21 校准）
  "mobileShell.organize.sortBy": "Sort by", // 官方逐字（webRemoteControl.mobileHome.sortBy en）
  "mobileShell.organize.byCreated": "Created time", // 官方逐字（webRemoteControl.mobileHome.sortByCreated en，§32.21 校准）
  "mobileShell.organize.byUpdated": "Updated time", // 官方逐字（webRemoteControl.mobileHome.sortByUpdated en，§32.21 校准）
  // —— P3c 模型选择器第一档 + 上下文用量：官方键，值逐字取自 packages/ui/src/i18n/locales/en-US.ts ——
  "chat.toolbar.model.label": "Choose model", // 官方 en-US.ts:4950
  "chat.toolbar.model.manageModels": "Manage models", // official (32.10 two-line model trigger)
  "chat.statusPanel.terminals": "Terminals", // official (32.14 side pane terminal)
  "chat.toolbar.model.loadFailedRetry": "Models failed to load. Retry", // 官方 en-US.ts:1045
  "chat.toolbar.model.remoteWaiting": "Waiting for remote models", // 官方 en-US.ts:1046
  "chat.toolbar.model.targetMissing": "No model target", // 官方 en-US.ts:1047
  "chat.contextUsage": "Context usage {used} of {total}", // 官方 en-US.ts:4824
  "mobileShell.model.thoughtLevel": "Reasoning level", // P3c 自建键（官方 ui locales 无现成菜单内档位分组标题）
  "notification.permissionRequired": "Your confirmation is needed", // P4b 官方键（值取自 ui locales en-US.ts）
  // —— P3d 首页任务搜索：自建键（官方无 mobileShell.search 命名空间；值逐字对齐冻结 bundle
  // workspaceSidebar.searchTasks* 官方文案，见 src/recovered/remote/v4/3.14.3/assets/IntlProvider-BiPABK16.js）——
  "mobileShell.search.title": "Search tasks", // P3d 自建键（值 = 官方 workspaceSidebar.searchTasks）
  "mobileShell.search.placeholder": "Search tasks...", // P3d 自建键（值 = 官方 workspaceSidebar.searchTasksPlaceholder）
  "mobileShell.search.close": "Close task search", // P3d 自建键（值 = 官方 workspaceSidebar.closeTaskSearch 同义）
  "mobileShell.search.history": "Search history", // P3d 自建键
  "mobileShell.search.empty": "No matching tasks", // P3d 自建键
  // —— P5b 宽视口全壳（spec §19）：mobileShell.wide.* 自建键（官方无该命名空间；值逐字
  // 对齐官方 ui locales 同义键，出处随键注明）——
  "mobileShell.wide.brand": "Drora", // P5b 自建键（产品名，双语文案同值）
  "mobileShell.wide.sidebar": "Sidebar", // P5b 自建键（nav aria-label）
  "mobileShell.wide.navBack": "Back", // §33.18 官方活体（desktop-top-nav-back aria 同族）
  "mobileShell.wide.navForward": "Forward", // §33.18 官方活体（前进钮 aria 同族）
  "mobileShell.wide.login": "Sign in to use", // §33.18 官方活体（login-trigger 官方 en 语义）
  "mobileShell.wide.settings": "Settings", // §33.18 官方活体（task-settings-button aria）
  "workspaceSidebar.archive": "Archive", // §33.18 官方活体（项目行 archive 钮 aria）
  "mobileShell.wide.newTask": "New task", // P5b 自建键（值 = 官方 taskList.newTask）
  "mobileShell.wide.search": "Search tasks", // P5b
  "commandCenter.open": "Search", // 官方逐字（§32.42） 自建键（值 = 官方 workspaceSidebar.searchTasks en:1731）
  "mobileShell.wide.plugins": "Plugin Marketplace", // P5b 自建键（值 = 官方 workspace.openPluginsSettings en:1599；入口 disabled，P5c 接插件商店）
  "mobileShell.wide.actionPending": "This entry will be available in a later release", // P5b 自建键（禁用占位说明）
  "mobileShell.wide.collapseSidebar": "Collapse sidebar", // P5b 自建键
  "mobileShell.wide.expandSidebar": "Expand sidebar", // P5b 自建键
  "mobileShell.wide.projectsSection": "Projects", // P5b 自建键（值 = 官方 workspaceSidebar.projectsSection en:1718）
  "mobileShell.wide.userFooter": "User", // P5b 自建键（页脚占位；P5c 接用量/账户面板）
  "mobileShell.wide.greeting.morning": "Morning, how can I help?", // P5b 自建键（值 = 官方 chat.empty.greeting.morning en:4665）
  "mobileShell.wide.greeting.noon": "Noon break?", // P5b 自建键（值 = 官方 chat.empty.greeting.noon en:4666）
  "mobileShell.wide.greeting.afternoon": "Good afternoon! Leave the rest to me.", // P5b 自建键（值 = 官方 chat.empty.greeting.afternoon en:4667）
  "mobileShell.wide.greeting.evening": "Evening, nice work today", // P5b 自建键（值 = 官方 chat.empty.greeting.evening en:4668）
  "mobileShell.wide.greeting.lateNight": "It's late—remember to take care of yourself.", // P5b 自建键（值 = 官方 chat.empty.greeting.lateNight en:4669）
  // §32.9 新建任务草稿页（官方 chat.empty/chat.draft 族逐字，en）
  "chat.empty.greeting.morningEarly": "Morning, ready when you are", // 官方逐字
  "chat.placeholder.newTaskMobile": "Ask ZCode anything…", // 官方逐字
  "chat.placeholder.newTask": "Ask ZCode anything, @ to add context, / for commands or capabilities", // 官方 en:10332 逐字（§32.72）
  "workspace.context.lastActivity": "Last active {time}", // official
  "chat.draft.suggestedPrompt.recentCommits": "Review commits from the last 7 days", // 官方逐字
  "chat.draft.suggestedPrompt.recentCommits.prompt": "Review Git commits from the last 7 days in this workspace, summarize the main changes, and identify potential risks.", // 官方逐字
  "chat.draft.suggestedPrompt.createPdf": "Create a PDF", // 官方逐字
  "chat.draft.suggestedPrompt.createPdf.prompt": "Create a PDF document based on the contents of the current workspace.", // 官方逐字
  // §32.3 更多菜单一期（上轮键，随字典回退补回）
  "common.confirm": "Confirm", // 官方逐字
  "appHeader.copyPath": "Copy path", // 官方逐字
  "appHeader.copySessionId": "Copy session ID", // 官方逐字
  "appHeader.copyTaskPath": "Copy task path", // 官方 en-US.ts:7533 逐字（§32.69 菜单全项）
  "appHeader.copyLogPath": "Copy log path", // 官方 en-US.ts:7540 逐字（§32.69 菜单全项）
  // —— P6 workspaceFileTree 文件树面（spec §23）：en 值按官方语义补译（官方 en locale chunk 本轮未逐字
  // 提取，下轮校准）；zh 侧 11 键为官方逐字——
  "workspaceFileTree.title": "Workspace", // 官方 en 逐字（校准）
  "workspaceFileTree.backToTasks": "Back to tasks", // 官方逐字（en 校准一致）
  "workspaceFileTree.addToChat": "Add to chat", // 官方逐字（en 校准一致）
  "workspaceFileTree.clearSearch": "Clear file search", // 官方逐字（en 校准一致）
  "workspaceFileTree.searchLabel": "Search files", // 官方逐字（en 校准一致）
  "workspaceFileTree.searchPlaceholder": "Search files...", // 官方逐字（en 校准一致）
  "workspaceFileTree.refresh": "Refresh file tree", // 官方逐字（en 校准一致）
  "workspaceFileTree.gitStatus.ignored": "Ignored", // 官方逐字（en 校准一致）
  "workspaceFileTree.openFailed": "Could not open this item", // 官方 en 逐字（校准）
  "workspaceFileTree.readFailed": "Failed to read directory", // 官方逐字（en 校准一致）
  "workspaceFileTree.openInBrowser": "Open in built-in browser", // 官方逐字（en 校准一致）
  "workspaceFileTree.openWith": "Open with", // 官方逐字（en 校准一致）
  // —— P6 quickPick 快选框面（spec §23）：en 值按官方语义补译（官方 en chunk 本轮未逐字提取，
  // 下轮校准）；zh 侧 10 键为官方逐字（含 {error} 插值键）——
  "quickPick.title": "Command palette", // 官方 en 逐字（校准）
  "quickPick.description": "Search and run commands available in this workspace.", // 官方 en 逐字（校准）
  "quickPick.command.goBack": "Back", // 官方逐字（en 校准一致）
  "quickPick.command.goForward": "Forward", // 官方逐字（en 校准一致）
  "quickPick.commandFailed": "Command failed: {error}", // 官方逐字（en 校准一致）（{error} 插值对齐官方）
  "quickPick.find.description": "Search messages and file changes in the current task.", // 官方逐字（en 校准一致）
  "quickPick.find.next": "Next result", // 官方逐字（en 校准一致）
  "quickPick.find.previous": "Previous result", // 官方逐字（en 校准一致）
  "quickPick.find.scope.tooltip": "Switch search scope messages/file", // 官方 en 逐字（校准）
  "quickPick.find.title": "Find in task", // 官方逐字（en 校准一致）
  // —— P6 automations 定时任务面（spec §23）：en 按官方 zh 语义补译（官方 en chunk 本轮未逐字
  // 提取，下轮校准）；插值名保持官方 {interval}/{unit}/{month}/{day}/{time}/{limit}/{count}/
  // {when}/{error} 形态。分两段落键——
  "automations.breadcrumbLabel": "Automation path", // 官方 en 逐字（校准）
  "automations.chatCreated.defaultTitle": "Scheduled task", // 官方逐字（en 校准一致）
  "automations.chatCreated.open": "Go to scheduled tasks", // 官方逐字（en 校准一致）
  "automations.chatCreated.scheduleFallback": "Created", // 官方逐字（en 校准一致）
  "automations.create": "Create", // 官方 en 逐字（校准）
  "automations.createManually": "Create scheduled task", // 官方逐字（en 校准一致）
  "automations.createViaChat": "Create in chat", // 官方逐字（en 校准一致）
  "automations.createViaChat.prompt": "Every weekday at 9 AM, summarize code changes and follow-ups for this project.", // 官方 en 逐字（校准）
  "automations.createdLabel": "Task created", // 官方逐字（en 校准一致）
  "automations.customRepeat.byDate": "By date", // 官方逐字（en 校准一致）
  "automations.customRepeat.byWeekday": "By weekday", // 官方逐字（en 校准一致）
  "automations.customRepeat.compactFrequency": "Every {interval} {unit}", // 官方逐字（en 校准一致）
  "automations.customRepeat.ends": "Ends", // 官方逐字（en 校准一致）
  "automations.customRepeat.endsOption": "Ends", // 官方 en 逐字（校准）
  "automations.customRepeat.frequency": "Repetition frequency", // 官方 en 逐字（校准）
  "automations.customRepeat.minutes": "min", // 官方 en 逐字（校准）
  "automations.customRepeat.monthLabel": "{month}/{year}", // 官方 en 逐字（校准）
  "automations.customRepeat.neverEnds": "Never ends", // 官方逐字（en 校准一致）
  "automations.customRepeat.nextMonth": "Next month", // 官方逐字（en 校准一致）
  "automations.customRepeat.previousMonth": "Previous month", // 官方逐字（en 校准一致）
  "automations.customRepeat.rule": "Repeat rule", // 官方逐字（en 校准一致）
  "automations.customRepeat.title": "Custom Repeat", // 官方 en 逐字（校准）
  "automations.customRepeat.unit.day": "days", // 官方 en 逐字（校准）
  "automations.customRepeat.unit.hour": "hours", // 官方 en 逐字（校准）
  "automations.customRepeat.unit.minute": "minutes", // 官方 en 逐字（校准）
  "automations.customRepeat.unit.month": "months", // 官方 en 逐字（校准）
  "automations.customRepeat.unit.week": "weeks", // 官方 en 逐字（校准）
  "automations.customRepeat.unit.year": "years", // 官方 en 逐字（校准）
  "automations.delete": "Delete", // 官方逐字（en 校准一致）
  "automations.delete.description": "Delete “{title}”? This cannot be undone.", // 官方 en 逐字（校准）
  "automations.delete.title": "Delete scheduled task", // 官方逐字（en 校准一致）
  // —— 31-92 段（en 补译，form/field/validate/schedule/weekday/confirm 交互族）——
  "automations.edit.newTask": "New task", // 官方逐字（en 校准一致）
  "automations.edit.promptPlaceholder": "e.g. Review commits from the last 24 hours and summarize likely bugs and fixes", // 官方 en 逐字（校准）
  "automations.edit.tab.history": "History", // 官方逐字（en 校准一致）
  "automations.edit.tab.settings": "Settings", // 官方逐字（en 校准一致）
  "automations.edit.titlePlaceholder": "Untitled Automation", // 官方 en 逐字（校准）
  "automations.empty.title": "No scheduled tasks yet.", // 官方 en 逐字（校准）
  "automations.error.createLimit": "You can keep up to {limit} scheduled tasks, including paused, completed, and failed tasks. Delete one before creating another.", // 官方 en 逐字（校准）
  "automations.error.targetNotFound": "This scheduled task was not found. It may have been deleted.", // 官方 en 逐字（校准）
  "automations.form.dayOfMonth": "Day {day}", // 官方逐字（en 校准一致）
  "automations.form.editTitle": "Edit scheduled task", // 官方逐字（en 校准一致）
  "automations.form.project.localRequired": "Open a local project first", // 官方逐字（en 校准一致）
  "automations.form.prompt.label": "Instructions", // 官方 en 逐字（校准）
  "automations.form.schedule.at": "at", // 官方逐字（en 校准一致）
  "automations.form.schedule.label": "Schedule", // 官方逐字（en 校准一致）
  "automations.form.schedule.minutePrefix": "at minute", // 官方 en 逐字（校准）
  "automations.form.schedule.minuteSuffix": "", // 官方 en 逐字（校准）
  "automations.form.schedule.monthDayValue": "{month}/{day}", // 官方逐字（en 校准一致）
  "automations.form.schedule.weekdaysLabel": "Choose weekdays", // 官方 en 逐字（校准）
  "automations.form.schedule.yearDateLabel": "Select month and day", // 官方 en 逐字（校准）
  "automations.form.status.label": "Status", // 官方逐字（en 校准一致）
  "automations.form.title.label": "Task title", // 官方逐字（en 校准一致）
  "automations.frequency.custom": "Custom", // 官方逐字（en 校准一致）
  "automations.lifecycle.failed": "Failure", // 官方 en 逐字（校准）
  "automations.moreActions": "More actions", // 官方逐字（en 校准一致）
  "automations.moreIdeas": "Scheduled task template", // 官方 en 逐字（校准）
  "automations.nextRun": "Next run {when}", // 官方逐字（en 校准一致）
  "automations.noWorkspace": "Open a workspace to manage its scheduled tasks.", // 官方逐字（en 校准一致）
  "automations.pageTab.ariaLabel": "Automations page", // 官方逐字（en 校准一致）
  "automations.refresh": "Refresh", // 官方逐字（en 校准一致）
  "automations.restart": "Restart", // 官方逐字（en 校准一致）
  "automations.runCount": "Ran {count} times", // 官方逐字（en 校准一致）
  "automations.runNow": "Run now", // 官方逐字（en 校准一致）
  "automations.runs.col.duration": "Duration", // 官方逐字（en 校准一致）
  "automations.runs.col.status": "Status", // 官方逐字（en 校准一致）
  "automations.runs.col.trigger": "Source", // 官方 en 逐字（校准）
  "automations.runs.col.triggered": "Triggered", // 官方 en 逐字（校准）
  "automations.runs.delete": "Delete run", // 官方逐字（en 校准一致）
  "automations.runs.empty": "No runs yet.", // 官方逐字（en 校准一致）
  "automations.runs.errorUnavailable": "No error details available", // 官方逐字（en 校准一致）
  "automations.runs.nextPage": "Next", // 官方 en 逐字（校准）
  "automations.runs.openSession": "Go to session", // 官方 en 逐字（校准）
  "automations.runs.openSessionFailed": "The target project is not connected, so this session cannot be opened.", // 官方 en 逐字（校准）
  "automations.runs.prevPage": "Previous", // 官方 en 逐字（校准）
  "automations.schedule.custom": "Every {interval} {unit} at {time}", // 官方 en 逐字（校准）
  "automations.schedule.customHourly": "Every {interval} hours at :{time}", // 官方 en 逐字（校准）
  "automations.schedule.customMinutes": "Every {interval} minutes", // 官方逐字（en 校准一致）
  "automations.schedule.customMonthlyDates": "Every {interval} months on day {days} at {time}", // 官方 en 逐字（校准）
  "automations.schedule.customMonthlyWeekday": "Every {interval} months on the first {day} at {time}", // 官方 en 逐字（校准）
  "automations.schedule.customWeekly": "Every {interval} weeks on {days} at {time}", // 官方 en 逐字（校准）
  "automations.schedule.customYearly": "Every {interval} year(s) on {month}/{day} at {time}", // 官方 en 逐字（校准）
  "automations.schedule.daily": "Daily at {time}", // 官方逐字（en 校准一致）
  "automations.schedule.hourly": "Every hour at :{minute}", // 官方 en 逐字（校准）
  "automations.schedule.monthly": "Monthly on day {day} at {time}", // 官方逐字（en 校准一致）
  "automations.schedule.weekdays": "Every weekday at {time}", // 官方逐字（en 校准一致）
  "automations.schedule.weekly": "Weekly on {days} at {time}", // 官方逐字（en 校准一致）
  "automations.statusFilter.empty": "No tasks match this filter", // 官方 en 逐字（校准）
  "automations.templates.unavailable": "No templates available", // 官方逐字（en 校准一致）
  "automations.unsaved.description": "Your changes to this scheduled task will be lost", // 官方逐字（en 校准一致）
  "automations.unsaved.discard": "Discard", // 官方逐字（en 校准一致）
  "automations.unsaved.title": "Discard scheduled task draft?", // 官方逐字（en 校准一致）
  "automations.weekday.separator": ", ", // 官方 en 逐字（校准）
  // —— P6 补录：automations.weekday.{0-6} 七键（官方 locale chunk 逐字：Sun-Sat，与 zh 日-六
  // 同源实锤；0=周日/1-6=周一~周六，对齐 $Y=[1..6,0] 周一起始序）——
  "automations.weekday.0": "Sun", // 官方 locale chunk 逐字
  "automations.weekday.1": "Mon", // 官方逐字
  "automations.weekday.2": "Tue", // 官方逐字
  "automations.weekday.3": "Wed", // 官方逐字
  "automations.weekday.4": "Thu", // 官方逐字
  "automations.weekday.5": "Fri", // 官方逐字
  "automations.weekday.6": "Sat", // 官方逐字
  // —— P6 workspaceSidebar 宽壳侧栏深面（spec §23）：en 语义补译（官方 en chunk 未逐字提取，下轮校准）——
  "workspaceSidebar.addProject": "Add project", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.connecting": "Connecting", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.conversationsSection": "Tasks", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.newConversation": "New task", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.noConversations": "No tasks yet", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.noProjects": "No open projects", // 官方 en 逐字（校准）
  "workspaceSidebar.notConnected": "Not connected", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.organize": "View", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.organizeByProject": "Project", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.organizeChronologicalList": "Timeline", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.organizeGrouped": "Group", // 官方 en 逐字（校准）
  "workspaceSidebar.projectsSection": "Projects", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.reconnect": "Reconnect", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.remove": "Remove", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.removeRunningWorkspace.confirm": "Remove and stop", // 官方 en 逐字（校准）
  "workspaceSidebar.removeRunningWorkspace.description": "This project still has a running chat or Agent. Removing it will stop and release the related runtime state, but task history will not be deleted.", // 官方 en 逐字（校准）
  "workspaceSidebar.removeRunningWorkspace.title": "Remove a running project?", // 官方 en 逐字（校准）
  "workspaceSidebar.reorderSection": "Move {section} section", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.resizeSidebar": "Resize sidebar", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.showFileTree": "Show files", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.sortBy": "Sort by", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.sortByCreated": "Created", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.sortByUpdated": "Updated", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.sshConnectionAlias": "Alias", // 官方 en 逐字（校准）
  "workspaceSidebar.sshConnectionHost": "Host", // 官方 en 逐字（校准）
  "workspaceSidebar.sshConnectionPath": "Path", // 官方 en 逐字（校准）
  "workspaceSidebar.sshConnectionTitle": "SSH connection", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.taskViewOptions": "Filter and sort", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.toggleSidebar": "Toggle sidebar", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.unavailableLocalDirectory": "The workspace directory does not exist or cannot be accessed. You can only view history for now. Restore the directory and restart ZCode to continue.", // 官方 en 逐字（校准）
  "workspaceSidebar.viewByWorkspace": "By project", // 官方逐字（en 校准一致）（zh 官方逐字；SSH 三键官方 locale 缺值）
  "workspaceSidebar.windowsReservedNameRisk": "Project removed, but {count} Windows reserved-name file(s) were detected and may affect later folder deletion or renaming: {path}", // 官方 en 逐字（校准）
  // —— P6 sidePane 侧板面（spec §23）：en 语义补译——
  "sidePane.addTab": "Add tab", // 官方逐字（en 校准一致）
  "sidePane.closeAllTabs": "Close all tabs", // 官方逐字（en 校准一致）
  "sidePane.closeCurrentTab": "Close tab", // 官方逐字（en 校准一致）
  "sidePane.closeOtherTabs": "Close other tabs", // 官方逐字（en 校准一致）
  "sidePane.closeTab": "Close {title}", // 官方逐字（en 校准一致）
  "sidePane.collapse": "Collapse side pane", // 官方 en 逐字（校准）
  "sidePane.noTabsFound": "No tabs found.", // 官方逐字（en 校准一致）
  "sidePane.openFileLoading": "Loading files...", // 官方 en 逐字（校准）
  "sidePane.openTab": "Open tab", // 官方逐字（en 校准一致）
  "sidePane.openTabDescription": "Choose a tab to open in the side pane.", // 官方 en 逐字（校准）
  "sidePane.openTabs": "Open tabs", // 官方逐字（en 校准一致）
  "sidePane.recentlyClosedTabs": "Recently closed tabs", // 官方逐字（en 校准一致）
  "sidePane.review": "Review", // 官方逐字（en 校准一致）
  "sidePane.searchTabs": "Search tabs...", // 官方逐字（en 校准一致）
  "sidePane.selectionChat": "Side conversation", // 官方 en 逐字（校准）
  "sidePane.subagent": "Subagent", // 官方逐字（en 校准一致）
  "sidePane.subagentDirectory": "Subagents", // 官方 en 逐字（校准）
  "sidePane.tabOverview": "Search tabs", // 官方逐字（en 校准一致）
  "sidePane.time.justNow": "just now", // 官方 en 逐字（校准）
  "sidePane.togglePanel": "Toggle panel", // 官方逐字（en 校准一致）
  "sidePane.workflowActor": "Workflow subagent", // 官方逐字（en 校准一致）
  "sidePane.workflowArtifact": "Artifact", // 官方逐字（en 校准一致）
  "sidePane.workflowDirectory": "Workflow runs", // 官方 en 逐字（校准）
  "sidePane.workflowRun": "Workflow run", // 官方逐字（en 校准一致）
  "sidePane.workflowScript": "Script steps", // 官方 en 逐字（校准）
  "common.cancel": "Cancel", // 官方 locale chunk 逐字
  "mode.label.glm.default": "Default", // 官方逐字
  "mode.label.glm.plan": "Plan mode", // 官方逐字
  "mode.label.glm.edit": "Edit automatically", // 官方逐字
  "mode.label.glm.build": "Ask before changes", // 官方逐字
  "mode.label.glm.yolo": "Full access", // 官方逐字
  "mode.description.glm.default": "Use default confirmations.", // 官方 en:11565 逐字（§32.69）
  "mode.description.glm.build": "Ask before file changes.", // 官方 en:11566 逐字
  "mode.description.glm.edit": "Edit files automatically.", // 官方 en:11567 逐字
  "mode.description.glm.plan": "Plan before editing.", // 官方 en:11568 逐字
  "mode.description.glm.yolo": "Run with fewer confirmations.", // 官方 en:11569 逐字
  "chat.toolbar.thoughtLevel.label": "Reasoning effort", // 官方逐字
  "chat.toolbar.thoughtLevel.placeholder": "Select reasoning level", // 官方逐字
  "chat.toolbar.thoughtLevel.value.low": "Low", // 官方逐字
  "chat.toolbar.thoughtLevel.value.medium": "Medium", // 官方逐字
  "chat.toolbar.thoughtLevel.value.high": "High", // 官方逐字
  "chat.toolbar.thoughtLevel.value.max": "Max", // 官方逐字
  "chat.attachments.add": "Add attachment", // 官方逐字
  "chat.composer.contextShortcut": "Add context", // 官方逐字（§32.64）
  "chat.toolbar.thoughtLevel.value.off": "Off", // 官方逐字
  "chat.toolbar.thoughtLevel.value.minimal": "Minimal", // 官方逐字
  "chat.plan.removeMarker": "Turn off Plan mode", // 官方逐字（§32.22 composer plan 标记钮）
};
