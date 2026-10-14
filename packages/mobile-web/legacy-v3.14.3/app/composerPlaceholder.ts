// composer 输入占位键解析（纯函数，官方 plt @1735719 全语义移植）。§33.18.14 自
// TaskTimeline.tsx 死代码清理中迁入——原文件仅因本 helper 存活。

/**
 * composer 输入占位键解析（纯函数，官方 plt @1735719 全语义移植）：
 * 有历史消息 → 处理中（running/queuePending）= followUpQueue（排队语义）、
 * 否则 followUpAsk（「提出后续修改要求」）；无历史 = newTaskMobile/newTask（草稿面）。
 * 旧自建键 mobileShell.composer.placeholder 淘汰（§32.39 截图对照实证）。
 */
export function resolveMobileComposerPlaceholderId(
  phase: string | null | undefined,
  queuePending: boolean,
  hasHistoryMessages = true,
  // §33.18 官方宽壳活体：running 态占位=followUpAsk「提出后续修改要求」
  //（窄壳 running=followUpQueue 语义不变，探针双视口实测）。
  desktop = false,
): string {
  if (!hasHistoryMessages) return "chat.placeholder.newTaskMobile";
  if (desktop) return "chat.placeholder.followUpAsk";
  return phase === "running" || queuePending
    ? "chat.placeholder.followUpQueue"
    : "chat.placeholder.followUpAsk";
}
