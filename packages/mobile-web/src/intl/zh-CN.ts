// R3 P2a 自包含 i18n 字典（zh-CN）。文案自 packages/ui/src/i18n/locales/zh-CN.ts 的
// mobileShell.* / taskList.* 命名空间提取（官方 3.14.3 逐字对齐文案，见 ui StatusCards
// 文件头取证注释）；D6 UI 自包含——本包不 import @drora/ui，字典改动需与 ui 侧对照。
export const zhCN: Record<string, string> = {
  "mobileShell.connection.connected": "已连接到当前桌面窗口",
  "mobileShell.connection.connecting": "正在连接",
  "mobileShell.connection.disconnected": "未连接",
  "mobileShell.connection.reconnecting": "连接中", // 官方逐字（webRemoteControl.mobileHome.reconnecting zh，§32.22 校准）
  "mobileShell.failure.connectionRecoveryTimeout.action": "重试",
  "mobileShell.failure.connectionRecoveryTimeout.badge": "恢复超时",
  "mobileShell.failure.connectionRecoveryTimeout.detailLabel": "恢复详情",
  "mobileShell.failure.connectionRecoveryTimeout.description":
    "手机端连接没有及时恢复，当前页面暂时无法继续同步远程控制。",
  "mobileShell.failure.connectionRecoveryTimeout.step1": "保持手机网络可用后重试。",
  "mobileShell.failure.connectionRecoveryTimeout.step2":
    "如果仍无法恢复，再回到桌面端重新开启 Web 远程控制。",
  "mobileShell.failure.connectionRecoveryTimeout.stepsTitle": "下一步",
  "mobileShell.failure.connectionRecoveryTimeout.title": "连接恢复超时",
  "mobileShell.failure.desktopBootstrapTimeout.action": "重试",
  "mobileShell.failure.desktopBootstrapTimeout.badge": "响应超时",
  "mobileShell.failure.desktopBootstrapTimeout.description":
    "手机端已经连上 relay，但桌面端没有及时返回工作区数据。",
  "mobileShell.failure.desktopBootstrapTimeout.detailLabel": "超时详情",
  "mobileShell.failure.desktopBootstrapTimeout.step1": "确认桌面端没有休眠或卡在确认弹窗。",
  "mobileShell.failure.desktopBootstrapTimeout.step2": "保持电脑和手机网络可用后重试。",
  "mobileShell.failure.desktopBootstrapTimeout.stepsTitle": "下一步",
  "mobileShell.failure.desktopBootstrapTimeout.title": "桌面端响应超时",
  "mobileShell.failure.desktopDisconnected.action": "重新连接",
  "mobileShell.failure.desktopDisconnected.badge": "电脑端离线",
  "mobileShell.failure.desktopDisconnected.description":
    "电脑端已经断开连接，当前手机页面不能继续控制桌面工作区。",
  "mobileShell.failure.desktopDisconnected.detailLabel": "Relay 返回",
  "mobileShell.failure.desktopDisconnected.step1": "确认电脑端 Drora 仍在运行并联网。",
  "mobileShell.failure.desktopDisconnected.step2": "在电脑端重新开启 Web 远程控制后再连接。",
  "mobileShell.failure.desktopDisconnected.stepsTitle": "下一步",
  "mobileShell.failure.desktopDisconnected.title": "桌面端已离线",
  "mobileShell.failure.invalidMobileConnection.action": "重新连接",
  "mobileShell.failure.invalidMobileConnection.badge": "校验失败",
  "mobileShell.failure.invalidMobileConnection.description":
    "当前页面的二维码参数或鉴权信息已经失效，不能再作为控制端连接。",
  "mobileShell.failure.invalidMobileConnection.detailLabel": "失败原因",
  "mobileShell.failure.invalidMobileConnection.step1": "不要复用旧截图或旧链接。",
  "mobileShell.failure.invalidMobileConnection.step2": "回到桌面端扫描最新二维码。",
  "mobileShell.failure.invalidMobileConnection.stepsTitle": "下一步",
  "mobileShell.failure.invalidMobileConnection.title": "手机连接已失效",
  "mobileShell.failure.relayUnavailable.action": "重试",
  "mobileShell.failure.relayUnavailable.badge": "中转异常",
  "mobileShell.failure.relayUnavailable.description": "手机端无法稳定连接 Web 远程控制中转服务。",
  "mobileShell.failure.relayUnavailable.detailLabel": "连接详情",
  "mobileShell.failure.relayUnavailable.step1": "检查手机网络是否可访问外网。",
  "mobileShell.failure.relayUnavailable.step2": "如果电脑端仍在线，可以稍后刷新重试。",
  "mobileShell.failure.relayUnavailable.stepsTitle": "下一步",
  "mobileShell.failure.relayUnavailable.title": "无法连接中转服务",
  "mobileShell.failure.sessionConflict.action": "重新连接",
  "mobileShell.failure.sessionConflict.badge": "设备接管",
  "mobileShell.failure.sessionConflict.description":
    "另一台远程控制设备已经接入，同一时间只能保留一个手机控制端。",
  "mobileShell.failure.sessionConflict.detailLabel": "Relay 返回",
  "mobileShell.failure.sessionConflict.step1": "继续使用新接入的设备。",
  "mobileShell.failure.sessionConflict.step2": "如果要用本设备控制，请重新扫描桌面端二维码。",
  "mobileShell.failure.sessionConflict.stepsTitle": "下一步",
  "mobileShell.failure.sessionConflict.title": "已被其他设备接管",
  "mobileShell.failure.sessionExpired.action": "重新加载",
  "mobileShell.failure.sessionExpired.badge": "会话结束",
  "mobileShell.failure.sessionExpired.description": "当前远程控制会话已经过期或被桌面端关闭。",
  "mobileShell.failure.sessionExpired.detailLabel": "结束原因",
  "mobileShell.failure.sessionExpired.step1": "在桌面端重新开启 Web 远程控制。",
  "mobileShell.failure.sessionExpired.step2": "用新的链接进入当前工作区。",
  "mobileShell.failure.sessionExpired.stepsTitle": "下一步",
  "mobileShell.failure.sessionExpired.title": "本次远程控制已结束",
  "mobileShell.failure.sessionNotFound.action": "重新加载",
  "mobileShell.failure.sessionNotFound.badge": "链接不可用",
  "mobileShell.failure.sessionNotFound.description":
    "这次 Web 远程控制链接已经不存在，通常是桌面端重新生成了二维码。",
  "mobileShell.failure.sessionNotFound.detailLabel": "Relay 返回",
  "mobileShell.failure.sessionNotFound.step1": "回到桌面端重新打开 Web 远程控制。",
  "mobileShell.failure.sessionNotFound.step2": "用手机扫描最新二维码。",
  "mobileShell.failure.sessionNotFound.stepsTitle": "下一步",
  "mobileShell.failure.sessionNotFound.title": "访问链接已失效",
  "mobileShell.failure.unexpectedError.action": "重试",
  "mobileShell.failure.unexpectedError.badge": "未知异常",
  "mobileShell.failure.unexpectedError.description": "打开远程控制页面时发生了未预期错误。",
  "mobileShell.failure.unexpectedError.detailLabel": "错误详情",
  "mobileShell.failure.unexpectedError.step1": "刷新页面再试一次。",
  "mobileShell.failure.unexpectedError.step2": "如果仍然失败，请回到桌面端重新生成二维码。",
  "mobileShell.failure.unexpectedError.stepsTitle": "下一步",
  "mobileShell.failure.unexpectedError.title": "Web 远程控制失败",
  "mobileShell.failure.unsupportedAction.action": "重新加载",
  "mobileShell.failure.unsupportedAction.badge": "暂不支持",
  "mobileShell.failure.unsupportedAction.description":
    "Web 远程控制只支持访问桌面端已经打开的工作区。",
  "mobileShell.failure.unsupportedAction.detailLabel": "限制说明",
  "mobileShell.failure.unsupportedAction.step1": "先在桌面端打开目标工作区。",
  "mobileShell.failure.unsupportedAction.step2": "再从手机端选择这个工作区。",
  "mobileShell.failure.unsupportedAction.stepsTitle": "下一步",
  "mobileShell.failure.unsupportedAction.title": "当前动作暂不支持",
  "mobileShell.failure.workspaceClosed.action": "重新加载",
  "mobileShell.failure.workspaceClosed.badge": "工作区关闭",
  "mobileShell.failure.workspaceClosed.description":
    "桌面端已经关闭了共享工作区，手机端无法继续访问这个 workspace。",
  "mobileShell.failure.workspaceClosed.detailLabel": "桌面端返回",
  "mobileShell.failure.workspaceClosed.step1": "在桌面端重新打开目标工作区。",
  "mobileShell.failure.workspaceClosed.step2": "重新发起 Web 远程控制。",
  "mobileShell.failure.workspaceClosed.stepsTitle": "下一步",
  "mobileShell.failure.workspaceClosed.title": "当前工作区已关闭",
  "mobileShell.home.collapseAll": "收起全部工作区",
  "mobileShell.home.expandAll": "展开全部工作区",
  "mobileShell.home.notice":
    "本次连接可以查看当前设备上已打开的项目、任务和会话；二维码失效后需要回到桌面端重新连接。",
  "mobileShell.home.organize": "整理任务",
  "mobileShell.home.reconnect": "重新连接",
  "mobileShell.home.refresh": "刷新工作区和任务",
  "mobileShell.home.sectionTitle": "当前设备上的工作区和任务",
  "mobileShell.home.summary": "{workspaceCount} 个工作区 · {taskCount} 个任务",
  "mobileShell.home.theme": "选择主题",
  "mobileShell.home.title": "Drora 远程控制",
  "mobileShell.home.workspaceEmpty": "这个工作区暂无任务", // 官方逐字（webRemoteControl.mobileHome.workspaceEmpty zh，§32.38 语义拆分：组内空态）
  "mobileShell.home.noTasks": "当前桌面窗口没有可展示的任务", // 官方逐字（webRemoteControl.noTasks zh，顶层空态）
  "mobileShell.home.pinnedSection": "已置顶", // 官方逐字（taskList.pinnedSection zh）
  "mobileShell.home.openTask": "打开任务 {title}", // 官方逐字（webRemoteControl.openTask zh，行 aria）
  "mobileShell.loading.authenticating.description": "已连接中转服务，正在完成远控身份校验。",
  "mobileShell.loading.authenticating.title": "正在认证设备…",
  "mobileShell.loading.connecting.description": "正在建立手机与远控中转服务的连接。",
  "mobileShell.loading.connecting.title": "正在连接中转服务…",
  "mobileShell.loading.paired.description": "连接已建立，正在同步桌面端工作区和任务。",
  "mobileShell.loading.paired.title": "已配对，正在加载工作区…",
  "mobileShell.loading.preparing.description": "正在初始化手机端远程控制会话。",
  "mobileShell.loading.preparing.title": "正在准备远程控制…",
  "mobileShell.loading.reconnecting.description": "网络或休眠恢复后会自动重连，请稍候。",
  "mobileShell.loading.reconnecting.title": "连接中断，正在重连…",
  "mobileShell.loading.step.auth": "设备鉴权",
  "mobileShell.loading.step.pairing": "等待桌面端配对",
  "mobileShell.loading.step.relay": "连接中转服务",
  "mobileShell.loading.step.sync": "同步工作区",
  "mobileShell.loading.suspended.description": "回到前台后会自动恢复连接。",
  "mobileShell.loading.suspended.title": "页面在后台，等待恢复…",
  "mobileShell.loading.waiting.description": "手机端已就绪，等待桌面端会话匹配当前连接。",
  "mobileShell.loading.waiting.title": "等待桌面端确认配对…",
  "mobileShell.task.backHome": "返回任务首页",
  "mobileShell.task.chatTitle": "任务会话",
  "mobileShell.task.more": "更多",
  "mobileShell.task.reconnectingBanner": "正在自动重连...",
  "mobileShell.task.sidePaneCollapse": "收起侧边面板",
  "mobileShell.task.sidePaneExpand": "展开侧边面板",
  "mobileShell.task.status.completed": "已完成",
  "mobileShell.task.status.idle": "空闲",
  "mobileShell.task.status.running": "运行中",
  "mobileShell.workspace.kind.local": "本地",
  "mobileShell.workspace.kind.remote": "远程",
  "mobileShell.workspace.newTask": "新建任务",
  "mobileShell.workspace.taskCount": "{count} 个任务",
  "mobileShell.workspace.tasksEmpty": "这个工作区暂无任务",
  "mobileShell.workspace.updatedAt": "更新于 {time}",
  "taskList.archive": "归档任务",
  "taskList.archiveFailed": "归档任务失败",
  "taskList.archiveLocal": "归档本地任务",
  "taskList.archiveRemote": "归档远端任务",
  "taskList.archivedActions": "归档操作",
  "taskList.archivedTaskCount": "{count} 个归档任务",
  "taskList.attentionCount": "{label} · {count}",
  "taskList.changeStats": "+{added} -{removed}",
  "taskList.cronTaskLabel": "定时任务",
  "taskList.daysAgo": "{days}天",
  "taskList.delete": "删除任务",
  "taskList.deleteAllArchived": "删除所有归档任务",
  "taskList.deleteAllArchivedBusy": "正在处理…",
  "taskList.deleteAllArchivedError": "操作或列表刷新失败，请刷新后检查剩余任务。",
  "taskList.deleteAllArchivedMenu": "删除所有归档任务…",
  "taskList.deleteAllArchivedResult": "已删除 {deleted} 个，跳过 {skipped} 个，失败 {failed} 个。",
  "taskList.deleteAllArchivedTitle": "删除 {count} 个归档任务？",
  "taskList.feedback": "反馈问题",
  "taskList.feedbackOpened": "已打开反馈，并自动带上当前任务信息",
  "taskList.forkedUntitled": "新任务",
  "taskList.hoursAgo": "{hours}小时",
  "taskList.justNow": "刚刚",
  "taskList.loading": "正在获取任务...",
  "taskList.markAsUnread": "标记为未读",
  "taskList.markAsUnreadFailed": "标记未读失败",
  "taskList.minutesAgo": "{minutes}分",
  "taskList.mobileActive": "手机正在操作此任务",
  "taskList.newTask": "新建任务",
  "taskList.newThread": "新建任务",
  "taskList.noArchivedTasks": "暂无归档任务",
  "taskList.noTasks": "暂无任务",
  "taskList.offPeakTaskLabel": "闲时任务",
  "taskList.openInSplitPane": "在分屏打开",
  "taskList.openSettings": "设置",
  "taskList.permissionTag": "等待确认",
  "taskList.pin": "置顶任务",
  "taskList.pinFailed": "更新置顶状态失败",
  "taskList.pinnedSection": "已置顶",
  "taskList.recentSection": "最近任务",
  "taskList.rename": "重命名任务",
  "taskList.renameFailed": "重命名任务失败",
  "taskList.renamePlaceholder": "任务名称",
  "taskList.resume": "恢复",
  "taskList.showLess": "显示更少",
  "taskList.showMore": "显示更多",
  "taskList.status.completed": "已完成",
  "taskList.status.failed": "失败",
  "taskList.status.notReady": "未就绪",
  "taskList.status.ready": "已就绪",
  "taskList.status.restoring": "恢复中",
  "taskList.status.streaming": "生成中",
  "taskList.stopCountdown": "停止计时",
  "taskList.switchBlockedByModelRestart": "模型供应商切换中，暂时不能切换任务。",
  "taskList.syncingRemoteWorkspaces": "正在加载远端任务...",
  "taskList.unarchive": "取消归档任务",
  "taskList.unpin": "取消置顶任务",
  "taskList.untitled": "新任务",
  "taskList.userInputTag": "等待确认",
  "taskList.viewModelTrajectory": "查看调用轨迹",
  "taskList.workflowRun.ariaLabel": "工作流实例 {name}：{status}",
  "taskList.workflowRun.liveCount": "{count} 个工作流在跑",
  "taskList.workflowRun.moreRuns": "+{count} 个实例",
  "taskList.workflowRun.moreStations": "+{count}",
  "mobileShell.composer.placeholder": "继续输入", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  "mobileShell.composer.send": "发送", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  "mobileShell.task.timelineEmpty": "暂无消息", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  "mobileShell.home.language": "切换语言", // P2a 自建键（非官方提取；官方 composer 富面归 P3）
  // —— P3a 富时间线 / composer 状态驱动：官方键，值逐字取自 packages/ui/src/i18n/locales/zh-CN.ts ——
  "chat.permission.awaitingApproval": "等待确认", // 官方 zh-CN.ts:5674
  "chat.placeholder.followUpQueue": "继续输入以排队后续修改", // 官方 zh-CN.ts:4408
  "chat.placeholder.followUpAsk": "提出后续修改要求", // 官方逐字（§32.39：官方 plt 无历史+非处理中态用此键，旧自建键淘汰）
  "chat.message.copy": "复制", // 官方逐字（§32.40 用户行复制钮）
  "chat.reasoning.thinking": "正在思考", // 官方 zh-CN.ts:4510
  "chat.reasoning.thought": "思考", // 官方 zh-CN.ts:4511
  "chat.stop.short": "停止", // 官方 zh-CN.ts:4472
  "chat.stop": "停止生成", // 官方逐字（§32.24 官方还原页活体：任务面停止钮用此键）
  "chat.toolbar.mode.label": "切换模式", // 官方逐字（§32.24 活体：模式触发器 aria 通用文案）
  "chat.toolCall.collapseDetails": "收起工具详情", // 官方 zh-CN.ts:4709
  "chat.toolCall.expandDetails": "展开工具详情", // 官方 zh-CN.ts:4708
  "chat.toolCall.result": "结果", // 官方 zh-CN.ts:4713
  "chat.toolCall.status.completed": "已执行", // 官方 zh-CN.ts:4704
  "chat.toolCall.status.failed": "执行失败", // 官方 zh-CN.ts:4705
  "chat.toolCall.status.running": "执行中", // 官方 zh-CN.ts:4703
  "chat.toolCall.status.stopped": "已停止", // 官方 zh-CN.ts:4707
  "taskTimeline.daysAgo": "{days} 天前", // 官方 zh-CN.ts:1955
  "taskTimeline.lastMonth": "上月", // 官方 zh-CN.ts:1959
  "taskTimeline.lastWeek": "上周", // 官方 zh-CN.ts:1957
  "taskTimeline.older": "更早", // 官方 zh-CN.ts:1960
  "taskTimeline.thisMonth": "本月", // 官方 zh-CN.ts:1958
  "taskTimeline.thisWeek": "本周", // 官方 zh-CN.ts:1956
  "taskTimeline.today": "今天", // 官方 zh-CN.ts:1953
  "taskTimeline.yesterday": "昨天", // 官方 zh-CN.ts:1954
  // —— P3a 自建键（官方 ui locales 无现成轮级/折叠文案）——
  "mobileShell.task.turnState.interrupted": "已中断", // P3a 自建键
  "mobileShell.task.turnState.failed": "失败", // P3a 自建键
  "mobileShell.timeline.reasoningCollapse": "收起思考过程", // P3a 自建键
  "mobileShell.timeline.reasoningExpand": "展开思考过程", // P3a 自建键
  // —— P3b 文件变更统计 + 队列状态第一档：官方键，值逐字取自 packages/ui/src/i18n/locales/zh-CN.ts ——
  "chat.changeSummary.filesChanged.one": "{count} 个文件已更改", // 官方 zh-CN.ts:1961
  "chat.changeSummary.filesChanged.other": "{count} 个文件已更改", // 官方 zh-CN.ts:1962
  "chat.queue.paused.error": "由于当前响应出错，队列已暂停（内容未丢失）", // 官方 zh-CN.ts:4494
  "chat.queue.paused.generic": "队列已暂停", // 官方 zh-CN.ts:4495
  "chat.queue.paused.stopped": "由于你中断了当前响应，队列已暂停", // 官方 zh-CN.ts:4493
  "chat.queue.title": "待发送消息（{count}）", // 官方 zh-CN.ts:4483
  "mobileShell.interaction.questionBadge": "提问", // P3b 自建键（官方无 mobileShell.interaction 命名空间）
  "mobileShell.interaction.addFeedback": "附加反馈…", // P3b 自建键（官方无 mobileShell.interaction 命名空间）
  "mobileShell.organize.title": "整理", // 自建键（官方 mobileHome 族无菜单标题键，结构取证 bundle :185807）
  "mobileShell.organize.organizeBy": "整理方式", // 自建键（官方 mobileHome 族无对应键）
  "mobileShell.organize.byWorkspace": "按工作区", // 官方逐字（webRemoteControl.mobileHome.organizeByWorkspace zh）
  "mobileShell.organize.byTimeline": "按时间线", // 官方逐字（webRemoteControl.mobileHome.organizeByTimeline zh）
  "mobileShell.organize.sortBy": "排序方式", // 官方逐字（webRemoteControl.mobileHome.sortBy zh，§32.21 校准）
  "mobileShell.organize.byCreated": "创建时间", // 官方逐字（webRemoteControl.mobileHome.sortByCreated zh，§32.21 校准）
  "mobileShell.organize.byUpdated": "更新时间", // 官方逐字（webRemoteControl.mobileHome.sortByUpdated zh，§32.21 校准）
  // —— P3c 模型选择器第一档 + 上下文用量：官方键，值逐字取自 packages/ui/src/i18n/locales/zh-CN.ts ——
  "chat.toolbar.model.label": "选择模型", // 官方 zh-CN.ts:4643
  "chat.toolbar.model.manageModels": "管理模型", // 官方 locale chunk 逐字（§32.10 双行触发器）
  "chat.statusPanel.terminals": "终端", // 官方逐字（§32.14 侧板终端标签）
  "chat.toolbar.model.loadFailedRetry": "模型加载失败，重试", // 官方 zh-CN.ts:965
  "chat.toolbar.model.remoteWaiting": "等待远程模型", // 官方 zh-CN.ts:966
  "chat.toolbar.model.targetMissing": "暂无模型目标", // 官方 zh-CN.ts:967
  "chat.contextUsage": "上下文已用 {used} / 总量 {total}", // 官方 zh-CN.ts:4514
  "mobileShell.model.thoughtLevel": "推理档", // P3c 自建键（官方 ui locales 无现成菜单内档位分组标题）
  "notification.permissionRequired": "需要你的确认", // P4b 官方键（值取自 ui locales zh-CN.ts）
  // —— P3d 首页任务搜索：自建键（官方无 mobileShell.search 命名空间；值逐字对齐冻结 bundle
  // workspaceSidebar.searchTasks* 官方文案，见 src/recovered/remote/v4/3.14.3/assets/IntlProvider-BiPABK16.js）——
  "mobileShell.search.title": "搜索任务", // P3d 自建键（值 = 官方 workspaceSidebar.searchTasks）
  "mobileShell.search.placeholder": "搜索任务...", // P3d 自建键（值 = 官方 workspaceSidebar.searchTasksPlaceholder）
  "mobileShell.search.close": "关闭任务搜索", // P3d 自建键（值 = 官方 workspaceSidebar.closeTaskSearch 同义）
  "mobileShell.search.history": "搜索历史", // P3d 自建键
  "mobileShell.search.empty": "未找到匹配的任务", // P3d 自建键
  // —— P5b 宽视口全壳（spec §19）：mobileShell.wide.* 自建键（官方无该命名空间；值逐字
  // 对齐官方 ui locales 同义键，出处随键注明）——
  "mobileShell.wide.brand": "Drora", // P5b 自建键（产品名，双语文案同值）
  "mobileShell.wide.sidebar": "侧栏", // P5b 自建键（nav aria-label）
  "mobileShell.wide.newTask": "新建任务", // P5b 自建键（值 = 官方 taskList.newTask）
  "mobileShell.wide.search": "搜索任务", // P5b 自建键（值 = 官方 workspaceSidebar.searchTasks zh:1609）
  "commandCenter.open": "搜索", // 官方逐字（§32.42 宽壳左栏搜索行）
  "mobileShell.wide.plugins": "插件市场", // P5b 自建键（值 = 官方 workspace.openPluginsSettings zh:1483；入口 disabled，P5c 接插件商店）
  "mobileShell.wide.actionPending": "该入口将在后续版本开放", // P5b 自建键（禁用占位说明）
  "mobileShell.wide.collapseSidebar": "收起侧栏", // P5b 自建键
  "mobileShell.wide.expandSidebar": "展开侧栏", // P5b 自建键
  "mobileShell.wide.projectsSection": "项目", // P5b 自建键（值 = 官方 workspaceSidebar.projectsSection zh:1596）
  "mobileShell.wide.userFooter": "用户", // P5b 自建键（页脚占位；P5c 接用量/账户面板）
  "mobileShell.wide.greeting.morning": "上午好呀，有什么想让我帮忙的吗", // P5b 自建键（值 = 官方 chat.empty.greeting.morning zh:4363）
  "mobileShell.wide.greeting.noon": "中午好呀，要不要先休息一下", // P5b 自建键（值 = 官方 chat.empty.greeting.noon zh:4364）
  "mobileShell.wide.greeting.afternoon": "下午好呀，接下来交给我吧", // P5b 自建键（值 = 官方 chat.empty.greeting.afternoon zh:4365）
  "mobileShell.wide.greeting.evening": "晚上好呀，今天辛苦啦", // P5b 自建键（值 = 官方 chat.empty.greeting.evening zh:4366）
  "mobileShell.wide.greeting.lateNight": "夜深啦，别忘了照顾好自己哦", // P5b 自建键（值 = 官方 chat.empty.greeting.lateNight zh:4367）
  // —— P6 workspaceFileTree 文件树面（spec §23）：官方 zh 值逐字提取（formatMessage 权威形态 12 id，
  // locale chunk 11 有值）；title 官方 chunk 无 zh 值 → 按面语义补译并注明（官方行为即 en fallback）——
  "workspaceFileTree.title": "文件树", // 官方 locale chunk 缺 zh 值，按面语义补译
  "workspaceFileTree.backToTasks": "返回任务", // 官方逐字
  "workspaceFileTree.addToChat": "添加到聊天", // 官方逐字
  "workspaceFileTree.clearSearch": "清空文件搜索", // 官方逐字
  "workspaceFileTree.searchLabel": "搜索文件", // 官方逐字
  "workspaceFileTree.searchPlaceholder": "搜索文件...", // 官方逐字
  "workspaceFileTree.refresh": "刷新文件树", // 官方逐字
  "workspaceFileTree.gitStatus.ignored": "已忽略", // 官方逐字
  "workspaceFileTree.openFailed": "无法打开该条目", // 官方逐字
  "workspaceFileTree.readFailed": "读取目录失败", // 官方逐字
  "workspaceFileTree.openInBrowser": "用内置浏览器打开", // 官方逐字
  "workspaceFileTree.openWith": "打开方式", // 官方逐字
  // —— P6 quickPick 快选框面（spec §23）：官方 zh 值逐字（10/10 全有值，含 {error} 插值）——
  "quickPick.title": "命令面板", // 官方逐字
  "quickPick.description": "搜索并执行当前工作区可用的命令。", // 官方逐字
  "quickPick.command.goBack": "返回", // 官方逐字
  "quickPick.command.goForward": "前进", // 官方逐字
  "quickPick.commandFailed": "命令执行失败：{error}", // 官方逐字（{error} 插值）
  "quickPick.find.title": "在任务中查找", // 官方逐字
  "quickPick.find.description": "搜索当前任务中的消息和文件变更。", // 官方逐字
  "quickPick.find.next": "下一个结果", // 官方逐字
  "quickPick.find.previous": "上一个结果", // 官方逐字
  "quickPick.find.scope.tooltip": "切换搜索范围消息/文件", // 官方逐字
  // —— P6 automations 定时任务面（spec §23）：官方 zh 值逐字（92/92 全有值；{interval}/{unit}/
  // {month}/{day}/{time}/{limit}/{count}/{when}/{error} 插值族官方形态）。分两段落键——
  "automations.breadcrumbLabel": "自动化路径", // 官方逐字
  "automations.chatCreated.defaultTitle": "定时任务", // 官方逐字
  "automations.chatCreated.open": "去到定时任务", // 官方逐字
  "automations.chatCreated.scheduleFallback": "已创建", // 官方逐字
  "automations.create": "新建", // 官方逐字
  "automations.createManually": "创建定时任务", // 官方逐字
  "automations.createViaChat": "去会话中创建", // 官方逐字
  "automations.createViaChat.prompt": "每个工作日 9 点，汇总当前项目的代码变更和待跟进事项。", // 官方逐字
  "automations.createdLabel": "已创建任务", // 官方逐字
  "automations.customRepeat.byDate": "按日期", // 官方逐字
  "automations.customRepeat.byWeekday": "按星期", // 官方逐字
  "automations.customRepeat.compactFrequency": "每{interval}{unit}", // 官方逐字
  "automations.customRepeat.ends": "结束", // 官方逐字
  "automations.customRepeat.endsOption": "指定日期", // 官方逐字
  "automations.customRepeat.frequency": "重复频率", // 官方逐字
  "automations.customRepeat.minutes": "分钟", // 官方逐字
  "automations.customRepeat.monthLabel": "{year}年{month}月", // 官方逐字
  "automations.customRepeat.neverEnds": "永不结束", // 官方逐字
  "automations.customRepeat.nextMonth": "下个月", // 官方逐字
  "automations.customRepeat.previousMonth": "上个月", // 官方逐字
  "automations.customRepeat.rule": "重复规则", // 官方逐字
  "automations.customRepeat.title": "自定义重复", // 官方逐字
  "automations.customRepeat.unit.day": "天", // 官方逐字
  "automations.customRepeat.unit.hour": "小时", // 官方逐字
  "automations.customRepeat.unit.minute": "分钟", // 官方逐字
  "automations.customRepeat.unit.month": "个月", // 官方逐字
  "automations.customRepeat.unit.week": "周", // 官方逐字
  "automations.customRepeat.unit.year": "年", // 官方逐字
  "automations.delete": "删除", // 官方逐字
  "automations.delete.description": "确定删除“{title}”？此操作无法撤销。", // 官方逐字
  "automations.delete.title": "删除定时任务", // 官方逐字
  // —— 31-92 段（官方逐字，form/field/validate/schedule/weekday/confirm 交互族）——
  "automations.edit.newTask": "新建任务", // 官方逐字
  "automations.edit.promptPlaceholder": "例如：Review 最近 24 小时的提交，总结可能引入的 bug 和修复建议", // 官方逐字
  "automations.edit.tab.history": "历史", // 官方逐字
  "automations.edit.tab.settings": "设置", // 官方逐字
  "automations.edit.titlePlaceholder": "未命名定时任务", // 官方逐字
  "automations.empty.title": "还没有定时任务", // 官方逐字
  "automations.error.createLimit": "最多可保留 {limit} 个定时任务（包含已暂停、已完成和失败任务），请先删除一个任务后再创建。", // 官方逐字
  "automations.error.targetNotFound": "未找到该定时任务，可能已被删除", // 官方逐字
  "automations.form.dayOfMonth": "{day} 号", // 官方逐字
  "automations.form.editTitle": "编辑定时任务", // 官方逐字
  "automations.form.project.localRequired": "请先打开一个本地项目", // 官方逐字
  "automations.form.prompt.label": "指令", // 官方逐字
  "automations.form.schedule.at": "于", // 官方逐字
  "automations.form.schedule.label": "调度", // 官方逐字
  "automations.form.schedule.minutePrefix": "第", // 官方逐字
  "automations.form.schedule.minuteSuffix": "分钟", // 官方逐字
  "automations.form.schedule.monthDayValue": "{month} 月 {day} 日", // 官方逐字
  "automations.form.schedule.weekdaysLabel": "选择星期", // 官方逐字
  "automations.form.schedule.yearDateLabel": "选择月份和日期", // 官方逐字
  "automations.form.status.label": "状态", // 官方逐字
  "automations.form.title.label": "任务标题", // 官方逐字
  "automations.frequency.custom": "自定义", // 官方逐字
  "automations.lifecycle.failed": "已失败", // 官方逐字
  "automations.moreActions": "更多操作", // 官方逐字
  "automations.moreIdeas": "定时任务模板", // 官方逐字
  "automations.nextRun": "下次运行 {when}", // 官方逐字
  "automations.noWorkspace": "打开一个工作区以管理它的定时任务。", // 官方逐字
  "automations.pageTab.ariaLabel": "自动化页面", // 官方逐字
  "automations.refresh": "刷新", // 官方逐字
  "automations.restart": "重新启动", // 官方逐字
  "automations.runCount": "已运行 {count} 次", // 官方逐字
  "automations.runNow": "立即运行", // 官方逐字
  "automations.runs.col.duration": "时长", // 官方逐字
  "automations.runs.col.status": "状态", // 官方逐字
  "automations.runs.col.trigger": "来源", // 官方逐字
  "automations.runs.col.triggered": "触发时间", // 官方逐字
  "automations.runs.delete": "删除记录", // 官方逐字
  "automations.runs.empty": "还没有运行记录。", // 官方逐字
  "automations.runs.errorUnavailable": "暂无错误详情", // 官方逐字
  "automations.runs.nextPage": "下一页", // 官方逐字
  "automations.runs.openSession": "跳到会话", // 官方逐字
  "automations.runs.openSessionFailed": "目标项目当前未连接，无法打开该会话", // 官方逐字
  "automations.runs.prevPage": "上一页", // 官方逐字
  "automations.schedule.custom": "每 {interval} {unit}，{time}", // 官方逐字
  "automations.schedule.customHourly": "每 {interval} 小时的第 {time} 分", // 官方逐字
  "automations.schedule.customMinutes": "每 {interval} 分钟", // 官方逐字
  "automations.schedule.customMonthlyDates": "每 {interval} 个月的 {days} 日，{time}", // 官方逐字
  "automations.schedule.customMonthlyWeekday": "每 {interval} 个月的第一个周{day}，{time}", // 官方逐字
  "automations.schedule.customWeekly": "每 {interval} 周的周{days}，{time}", // 官方逐字
  "automations.schedule.customYearly": "每 {interval} 年的 {month} 月 {day} 日，{time}", // 官方逐字
  "automations.schedule.daily": "每天 {time}", // 官方逐字
  "automations.schedule.hourly": "每小时的第 {minute} 分", // 官方逐字
  "automations.schedule.monthly": "每月 {day} 号 {time}", // 官方逐字
  "automations.schedule.weekdays": "每工作日 {time}", // 官方逐字
  "automations.schedule.weekly": "每周{days} {time}", // 官方逐字
  "automations.statusFilter.empty": "没有符合条件的任务", // 官方逐字
  "automations.templates.unavailable": "无可用模板", // 官方逐字
  "automations.unsaved.description": "你对这个定时任务的更改将会丢失", // 官方逐字
  "automations.unsaved.discard": "丢弃", // 官方逐字
  "automations.unsaved.title": "丢弃定时任务的草稿？", // 官方逐字
  "automations.weekday.separator": "、", // 官方逐字（分隔符逐字）
  // —— P6 补录：automations.weekday.{0-6} 七键（官方 locale chunk 逐字取证——rX 经运行时模板
  // `weekday.${e}` 拼接，为静态字面提取盲区；zh 日/一/二/三/四/五/六 + en Sun-Sat 双向实锤；
  // $Y=[1,2,3,4,5,6,0] 周一起始序，rX(id)=weekday 名，iX 构造器 weekly/customWeekly/
  // customMonthlyWeekday 三分支依赖）——
  "automations.weekday.0": "日", // 官方 locale chunk 逐字
  "automations.weekday.1": "一", // 官方逐字
  "automations.weekday.2": "二", // 官方逐字
  "automations.weekday.3": "三", // 官方逐字
  "automations.weekday.4": "四", // 官方逐字
  "automations.weekday.5": "五", // 官方逐字
  "automations.weekday.6": "六", // 官方逐字
  // —— P6 workspaceSidebar 宽壳侧栏深面（spec §23）：官方 zh 值逐字（32 id：29 有值 +
  // sshConnection{Alias,Host,Path} 三键官方 locale 缺值 → 按插值形态语义补译并注明）——
  "workspaceSidebar.addProject": "添加项目", // 官方逐字
  "workspaceSidebar.connecting": "连接中", // 官方逐字
  "workspaceSidebar.conversationsSection": "任务", // 官方逐字
  "workspaceSidebar.newConversation": "新建任务", // 官方逐字
  "workspaceSidebar.noConversations": "还没有任务", // 官方逐字
  "workspaceSidebar.noProjects": "尚未打开项目", // 官方逐字
  "workspaceSidebar.notConnected": "未连接", // 官方逐字
  "workspaceSidebar.organize": "视图", // 官方逐字
  "workspaceSidebar.organizeByProject": "项目", // 官方逐字
  "workspaceSidebar.organizeChronologicalList": "时间线", // 官方逐字
  "workspaceSidebar.organizeGrouped": "分组", // 官方逐字
  "workspaceSidebar.projectsSection": "项目", // 官方逐字
  "workspaceSidebar.reconnect": "重新连接", // 官方逐字
  "workspaceSidebar.remove": "移除", // 官方逐字
  "workspaceSidebar.removeRunningWorkspace.confirm": "移除并停止运行", // 官方逐字
  "workspaceSidebar.removeRunningWorkspace.description": "该项目还有运行中的对话或 Agent。移除项目会停止并释放相关运行状态，历史任务不会被删除。", // 官方逐字
  "workspaceSidebar.removeRunningWorkspace.title": "移除运行中的项目？", // 官方逐字
  "workspaceSidebar.reorderSection": "移动{section}分区", // 官方逐字
  "workspaceSidebar.resizeSidebar": "调整侧边栏宽度", // 官方逐字
  "workspaceSidebar.showFileTree": "查看文件", // 官方逐字
  "workspaceSidebar.sortBy": "排序方式", // 官方逐字
  "workspaceSidebar.sortByCreated": "创建时间", // 官方逐字
  "workspaceSidebar.sortByUpdated": "更新时间", // 官方逐字
  "workspaceSidebar.sshConnectionAlias": "{alias}（SSH）", // 官方 locale 缺值，按插值语义补译
  "workspaceSidebar.sshConnectionHost": "主机：{host}", // 官方 locale 缺值，按插值语义补译
  "workspaceSidebar.sshConnectionPath": "路径：{path}", // 官方 locale 缺值，按插值语义补译
  "workspaceSidebar.sshConnectionTitle": "SSH 连接", // 官方逐字
  "workspaceSidebar.taskViewOptions": "筛选和排序", // 官方逐字
  "workspaceSidebar.toggleSidebar": "切换侧边栏", // 官方逐字
  "workspaceSidebar.unavailableLocalDirectory": "工作区目录不存在或无法访问，当前仅可查看历史记录。恢复该目录后重启 ZCode 即可继续使用。", // 官方逐字
  "workspaceSidebar.viewByWorkspace": "按项目", // 官方逐字
  "workspaceSidebar.windowsReservedNameRisk": "已移除项目，但检测到 {count} 个 Windows 保留名文件，可能影响后续删除或重命名目录：{path}", // 官方逐字
  // —— P6 sidePane 侧板面（spec §23）：官方 zh 值逐字（25/25 全有值，{title} 插值）——
  "sidePane.addTab": "新增标签", // 官方逐字
  "sidePane.closeAllTabs": "关闭所有标签", // 官方逐字
  "sidePane.closeCurrentTab": "关闭标签", // 官方逐字
  "sidePane.closeOtherTabs": "关闭其他标签", // 官方逐字
  "sidePane.closeTab": "关闭 {title}", // 官方逐字
  "sidePane.collapse": "收起侧边面板", // 官方逐字
  "sidePane.noTabsFound": "没有找到标签页。", // 官方逐字
  "sidePane.openFileLoading": "正在加载文件...", // 官方逐字
  "sidePane.openTab": "打开标签页", // 官方逐字
  "sidePane.openTabDescription": "选择要在侧边面板中打开的标签。", // 官方逐字
  "sidePane.openTabs": "打开的标签页", // 官方逐字
  "sidePane.recentlyClosedTabs": "最近关闭的标签页", // 官方逐字
  "sidePane.review": "审查", // 官方逐字
  "sidePane.searchTabs": "搜索标签页...", // 官方逐字
  "sidePane.selectionChat": "辅助对话", // 官方逐字
  "sidePane.subagent": "子智能体", // 官方逐字
  "sidePane.subagentDirectory": "子智能体目录", // 官方逐字
  "sidePane.tabOverview": "搜索标签页", // 官方逐字
  "sidePane.time.justNow": "刚刚", // 官方逐字
  "sidePane.togglePanel": "切换面板", // 官方逐字
  "sidePane.workflowActor": "工作流子代理", // 官方逐字
  "sidePane.workflowArtifact": "产物", // 官方逐字
  "sidePane.workflowDirectory": "工作流目录", // 官方逐字
  "sidePane.workflowRun": "工作流实例", // 官方逐字
  "sidePane.workflowScript": "脚本步骤", // 官方逐字
  "common.cancel": "取消", // 官方 locale chunk 逐字
  "common.confirm": "确认", // 官方 locale chunk 逐字（§32.3 重命名对话框）
  "appHeader.copyPath": "复制路径", // 官方 locale chunk 逐字（§32.3 更多菜单一期）
  "appHeader.copySessionId": "复制会话 ID", // 官方 locale chunk 逐字（§32.3 更多菜单一期）
  "mode.label.glm.default": "默认模式", // 官方逐字（medium 按族规律补）
  "mode.label.glm.plan": "计划模式", // 官方逐字（medium 按族规律补）
  "mode.label.glm.edit": "自动编辑", // 官方逐字（medium 按族规律补）
  "mode.label.glm.build": "变更前确认", // 官方逐字（medium 按族规律补）
  "mode.label.glm.yolo": "完全访问", // 官方逐字（medium 按族规律补）
  "chat.toolbar.thoughtLevel.label": "推理强度", // 官方逐字（medium 按族规律补）
  "chat.toolbar.thoughtLevel.placeholder": "选择思考档位", // 官方逐字（medium 按族规律补）
  "chat.toolbar.thoughtLevel.value.low": "低", // 官方逐字（medium 按族规律补）
  "chat.toolbar.thoughtLevel.value.medium": "中", // 官方逐字（medium 按族规律补）
  "chat.toolbar.thoughtLevel.value.high": "高", // 官方逐字（medium 按族规律补）
  "chat.toolbar.thoughtLevel.value.max": "最高", // 官方逐字（medium 按族规律补）
  "chat.attachments.add": "添加附件", // 官方逐字
  "chat.composer.contextShortcut": "添加上下文", // 官方逐字（§32.64 composer 附件钮，非附件上传面）
  "chat.toolbar.thoughtLevel.value.off": "关闭", // 官方逐字
  "chat.toolbar.thoughtLevel.value.minimal": "极低", // 官方逐字
  "chat.plan.removeMarker": "关闭计划模式", // 官方逐字（§32.22 composer plan 标记钮）
  // §32.9 新建任务草稿页（官方 chat.empty/chat.draft 族逐字，zh）
  "chat.empty.greeting.morningEarly": "早上好呀，新的一天开始啦", // 官方逐字
  "chat.placeholder.newTaskMobile": "向 ZCode 提问…", // 官方逐字
  "workspace.context.lastActivity": "最近活动 {time}", // 官方逐字（§32.11 信息弹层）
  "chat.draft.suggestedPrompt.recentCommits": "检查近 7 天的 commit", // 官方逐字
  "chat.draft.suggestedPrompt.recentCommits.prompt": "检查当前工作区近 7 天的 Git commit，概括主要改动并指出潜在风险。", // 官方逐字
  "chat.draft.suggestedPrompt.createPdf": "制作一份 PDF", // 官方逐字
  "chat.draft.suggestedPrompt.createPdf.prompt": "根据当前工作区内容制作一份 PDF 文档。", // 官方逐字
};
