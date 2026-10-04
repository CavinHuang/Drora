// R3 P2a 自包含相对时间（taskList.* 官方对齐键）。
// 移植自 packages/ui/src/lib/taskListItemPresentation.ts 的 formatTaskRelativeTime；
// ui 冻结，本包自持。分钟/小时/天三段式与官方一致，不本地化小时制。
import type { MobileIntl } from "./intl.js";

export function formatTaskRelativeTime(timestamp: number, intl: MobileIntl): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return intl.formatMessage({ id: "taskList.justNow" });
  if (minutes < 60) {
    return intl.formatMessage({ id: "taskList.minutesAgo" }, { minutes: String(minutes) });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return intl.formatMessage({ id: "taskList.hoursAgo" }, { hours: String(hours) });
  }
  const days = Math.floor(hours / 24);
  return intl.formatMessage({ id: "taskList.daysAgo" }, { days: String(days) });
}
