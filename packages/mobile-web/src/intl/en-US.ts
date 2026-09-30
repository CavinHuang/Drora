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
  "mobileShell.home.workspaceEmpty": "No open workspaces on this device",
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
  "mobileShell.task.status.completed": "Completed",
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
  "chat.reasoning.thinking": "Thinking", // 官方 en-US.ts:4820
  "chat.reasoning.thought": "Thought", // 官方 en-US.ts:4821
  "chat.stop.short": "Stop", // 官方 en-US.ts:4779
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
  "mobileShell.organize.title": "Organize", // P3c 自建键（官方 webRemoteControl.mobileHome.* 为手机页自有 i18n，后续可从冻结 bundle 逐字提取）
  "mobileShell.organize.organizeBy": "Group by", // P3c 自建键（官方 webRemoteControl.mobileHome.* 为手机页自有 i18n，后续可从冻结 bundle 逐字提取）
  "mobileShell.organize.byWorkspace": "By workspace", // P3c 自建键（官方 webRemoteControl.mobileHome.* 为手机页自有 i18n，后续可从冻结 bundle 逐字提取）
  "mobileShell.organize.byTimeline": "By timeline", // P3c 自建键（官方 webRemoteControl.mobileHome.* 为手机页自有 i18n，后续可从冻结 bundle 逐字提取）
  "mobileShell.organize.sortBy": "Sort by", // P3c 自建键（官方 webRemoteControl.mobileHome.* 为手机页自有 i18n，后续可从冻结 bundle 逐字提取）
  "mobileShell.organize.byCreated": "By created", // P3c 自建键（官方 webRemoteControl.mobileHome.* 为手机页自有 i18n，后续可从冻结 bundle 逐字提取）
  "mobileShell.organize.byUpdated": "By updated", // P3c 自建键（官方 webRemoteControl.mobileHome.* 为手机页自有 i18n，后续可从冻结 bundle 逐字提取）
  // —— P3c 模型选择器第一档 + 上下文用量：官方键，值逐字取自 packages/ui/src/i18n/locales/en-US.ts ——
  "chat.toolbar.model.label": "Choose model", // 官方 en-US.ts:4950
  "chat.toolbar.model.loadFailedRetry": "Models failed to load. Retry", // 官方 en-US.ts:1045
  "chat.toolbar.model.remoteWaiting": "Waiting for remote models", // 官方 en-US.ts:1046
  "chat.toolbar.model.targetMissing": "No model target", // 官方 en-US.ts:1047
  "chat.contextUsage": "Context usage {used} of {total}", // 官方 en-US.ts:4824
  "mobileShell.model.thoughtLevel": "Reasoning level", // P3c 自建键（官方 ui locales 无现成菜单内档位分组标题）
  "notification.permissionRequired": "Needs your confirmation", // P4b 官方键（值取自 ui locales en-US.ts）
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
  "mobileShell.wide.newTask": "New task", // P5b 自建键（值 = 官方 taskList.newTask）
  "mobileShell.wide.search": "Search tasks", // P5b 自建键（值 = 官方 workspaceSidebar.searchTasks en:1731）
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
};
