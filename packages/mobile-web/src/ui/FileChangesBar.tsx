// R3 P3b 文件变更统计条第一档（specs/mobile-relay-r3-frontend.md §15 第 3 条）。
// 纯展示受控组件：数据来自上层 conversationFileChangesV4 查询（打开任务面拉取一次 +
// 发送后刷新），本组件不持数据源、不发命令（rewind/review 管理面归 P3 后续）。
// 文案取官方键 chat.changeSummary.filesChanged.one/.other（复数选择对齐官方
// ui ConversationFileSummaryPanel：files === 1 用 one，否则 other；插值 {count} 为字符串）。
// 增删行数沿用官方 "+N / -N" 形状（官方 text-diff-added/removed 色在本包无 token，
// 按任务口径映射 success/destructive 主题色）；files 为 null 或 <=0 时整体不渲染
// （对齐官方 `!summary || summary.files <= 0 → null` 的隐藏语义）。
// D6 自包含：不 import @drora/ui；文案经上层 IntlProvider 的 useIntl 取键。
import { useIntl } from "./intl.js";
import { cn } from "./cn.js";

export interface FileChangesBarProps {
  /** 变更文件数（v4 conversationFileChanges summary.files）；null/<=0 不渲染。 */
  files: number | null;
  /** 累计新增行数；null 时该段不渲染。 */
  additions: number | null;
  /** 累计删除行数；null 时该段不渲染。 */
  deletions: number | null;
  className?: string;
}

export function FileChangesBar({ files, additions, deletions, className }: FileChangesBarProps) {
  const { formatMessage } = useIntl();
  if (files === null || files <= 0) return null;

  const filesChangedLabel = formatMessage(
    {
      id:
        files === 1
          ? "chat.changeSummary.filesChanged.one"
          : "chat.changeSummary.filesChanged.other",
    },
    { count: String(files) },
  );

  return (
    <div
      className={cn(
        "flex min-h-10 items-center gap-2 overflow-hidden rounded-xl border border-border bg-card px-3 text-ui-sm text-foreground",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate font-medium">{filesChangedLabel}</span>
      {additions !== null || deletions !== null ? (
        <span className="shrink-0 font-mono text-ui-xs tabular-nums">
          {additions !== null ? <span className="text-success">+{additions}</span> : null}
          {additions !== null && deletions !== null ? <span aria-hidden="true"> </span> : null}
          {deletions !== null ? <span className="text-destructive">-{deletions}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
