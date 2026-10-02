// R3 P3a 富时间线第一档 + composer 状态驱动（specs/mobile-relay-r3-frontend.md §14 第 2/3 条）。
// TaskTimeline 是纯展示受控组件：rows 由 conversation store 注入（上游保证 rowId 升序），
// 组件无内部数据源、不写任何会话状态（D6 自包含，不 import @drora/ui）；文案经上层
// IntlProvider 的 useIntl 取键。行 schema 对照 packages/shared/src/drora-protocol-v4/rows.ts。
// MobileComposerStateBar / resolveMobileComposerPlaceholderId 是 composer 槽的可复用纯 props
// 形态：数据来自 store.getControlState()（control.canStop/stopState/phase 与 queue.items），
// stop 命令的 payload 组装归调用方，本组件只回调 onStop。
import { useMemo, useState } from "react";
import { Check, Copy, Square } from "lucide-react";
import type { ConversationRow } from "@drora/shared/drora-protocol-v4";
import { cn } from "./cn.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { useIntl, type MobileIntl } from "./intl.js";
import {
  bucketConversationRows,
  taskTimelineBucketMessage,
  type TaskTimelineBucket,
} from "./timeBuckets.js";

type TurnHeaderRow = Extract<ConversationRow, { kind: "turnHeader" }>;
type ToolCallRow = Extract<ConversationRow, { kind: "toolCall" }>;

/** pill tone → StatusCards 同语言配色（warning 进行中 / success 成功 / destructive 失败 / surface 中性）。 */
type PillTone = "running" | "success" | "neutral" | "destructive";

const PILL_TONE_CLASSES: Record<PillTone, string> = {
  running: "border-warning/30 bg-warning/10 text-warning-foreground",
  success: "border-success/30 bg-success/10 text-success-foreground",
  neutral: "border-border bg-surface text-foreground-subtle",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
};

export interface TaskTimelineProps {
  /** 会话行（conversation store 投影，rowId 升序；受控，组件不持有数据源）。 */
  rows: ConversationRow[];
  /** 分桶基准时间（epoch ms，调用方注入；测试可固定 now）。 */
  now: number;
  className?: string;
}

/** 富时间线：turnHeader.startedAt 八桶分段（timeBuckets.js）+ 行级第一档渲染。 */
export function TaskTimeline({ rows, now, className }: TaskTimelineProps) {
  const { locale, formatMessage } = useIntl();
  const buckets = useMemo(() => bucketConversationRows(rows, { now, locale }), [rows, now, locale]);

  if (rows.length === 0) {
    return (
      <div className={cn("px-4 py-8 text-center text-ui-sm text-foreground-subtlest", className)}>
        {formatMessage({ id: "mobileShell.task.timelineEmpty" })}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1 px-3 py-3", className)}>
      {buckets.map((bucket) => (
        <section key={`${bucket.key}-${bucket.rows[0]?.rowId ?? 0}`}>
          <h3 className="sticky top-0 z-10 bg-background py-1 text-ui-xs font-medium text-foreground-subtle">
            {formatBucketTitle(bucket.label, formatMessage)}
          </h3>
          <div className="space-y-1.5">
            {bucket.rows.map((row) => (
              <TimelineRowView key={row.rowId} row={row} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function formatBucketTitle(
  label: TaskTimelineBucket<ConversationRow>["label"],
  formatMessage: MobileIntl["formatMessage"],
): string {
  const message = taskTimelineBucketMessage(label);
  return formatMessage({ id: message.id }, message.values);
}

// —— turnHeader：轮次状态 pill（文案官方键优先；tone 见 PILL_TONE_CLASSES） ——

/** 轮次四态文案：running/completedSuccess 复用官方 mobileShell.task.status.*；
 * completedInterrupted/failed 官方 ui locales 无现成轮级文案，自建
 * mobileShell.task.turnState.*（P3a 自建键，字典行尾已注明）。 */
const TURN_STATE_COPY: Record<TurnHeaderRow["state"], { id: string; tone: PillTone }> = {
  running: { id: "mobileShell.task.status.running", tone: "running" },
  completedSuccess: { id: "mobileShell.task.status.completed", tone: "success" },
  completedInterrupted: { id: "mobileShell.task.turnState.interrupted", tone: "neutral" },
  failed: { id: "mobileShell.task.turnState.failed", tone: "destructive" },
};

function TurnHeaderView({ row }: { row: TurnHeaderRow }) {
  const { formatMessage } = useIntl();
  const copy = TURN_STATE_COPY[row.state];
  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-ui-xs font-medium",
          PILL_TONE_CLASSES[copy.tone],
        )}
      >
        {row.state === "running" ? (
          <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-warning" />
        ) : null}
        {formatMessage({ id: copy.id })}
      </span>
      <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-border" />
    </div>
  );
}

// —— userInput / assistantText：气泡（沿用现 App 的 bg-accent/bg-card 圆角样式语言） ——

function UserInputView({ row }: { row: Extract<ConversationRow, { kind: "userInput" }> }) {
  return (
    <div className="group/user-row">
      <div className="ml-8 rounded-xl rounded-br-sm bg-accent px-3 py-2 text-ui-base whitespace-pre-wrap text-foreground">
        {row.text}
      </div>
      {/* §32.40 官方用户行复制钮（@3027964/_Jt @3011537）：hover 浮现（远控常显）、
          v4-copy-{rowId} testid、点击变 success 勾 1.2s。 */}
      <div className="mt-1 flex justify-end opacity-100 transition-opacity">
        <CopyButton text={row.text} rowId={row.rowId} />
      </div>
    </div>
  );
}

function AssistantTextView({ row }: { row: Extract<ConversationRow, { kind: "assistantText" }> }) {
  return (
    <div className="mr-8 rounded-xl rounded-bl-sm bg-card px-3 py-2 text-ui-base text-foreground">
      {/* P3b（spec §15 第 2 条）：assistant 正文 markdown 渲染（marked+DOMPurify 净化，
      代码块 mono/表格边框见 .drora-md）；streaming 追加期组件随行重渲染。 */}
      <MarkdownContent text={row.text} />
      {row.state === "streaming" ? (
        <span
          aria-hidden="true"
          className="ml-1 inline-block size-1.5 animate-cursor-pulse rounded-full bg-brand align-baseline"
        />
      ) : null}
    </div>
  );
}

// —— reasoning：折叠行（默认收起，点击展开，italic 弱化色） ——

function ReasoningView({ row }: { row: Extract<ConversationRow, { kind: "reasoning" }> }) {
  const [open, setOpen] = useState(false);
  const { formatMessage } = useIntl();
  // 官方键：streaming 期 chat.reasoning.thinking（正在思考），终态 chat.reasoning.thought（思考）。
  const labelId = row.state === "streaming" ? "chat.reasoning.thinking" : "chat.reasoning.thought";
  return (
    <div className="mr-8">
      <button
        type="button"
        className="flex items-center gap-1 px-1 py-1 text-ui-sm italic text-foreground-subtlest"
        aria-expanded={open}
        aria-label={formatMessage({
          id: open
            ? "mobileShell.timeline.reasoningCollapse"
            : "mobileShell.timeline.reasoningExpand",
        })}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className="text-ui-xs">
          {open ? "▾" : "▸"}
        </span>
        {formatMessage({ id: labelId })}
      </button>
      {open ? (
        <div className="px-1 pb-1 text-ui-sm italic whitespace-pre-wrap text-foreground-subtlest">
          {row.text}
        </div>
      ) : null}
    </div>
  );
}

// —— toolCall：卡片（status pill + inputText 单行截断 + 可展开 output.text 预览） ——

/** 六态 pill：文案全取官方键（inputStreaming 与 running 共用官方「执行中」，官方流式期
 * 不另设状态词；pendingApproval 用官方 chat.permission.awaitingApproval「等待确认」）。 */
const TOOL_CALL_STATUS_COPY: Record<ToolCallRow["status"], { id: string; tone: PillTone }> = {
  inputStreaming: { id: "chat.toolCall.status.running", tone: "running" },
  pendingApproval: { id: "chat.permission.awaitingApproval", tone: "running" },
  running: { id: "chat.toolCall.status.running", tone: "running" },
  success: { id: "chat.toolCall.status.completed", tone: "success" },
  error: { id: "chat.toolCall.status.failed", tone: "destructive" },
  cancelled: { id: "chat.toolCall.status.stopped", tone: "neutral" },
};

/** output.text 预览上限（toolOutputSchema.text 超长截断，官方 task_output display 同为 2000 档）。 */
const TOOL_OUTPUT_PREVIEW_LIMIT = 2000;

function resolveToolOutputPreview(row: ToolCallRow): string {
  const text = row.output?.text ?? row.error?.message ?? "";
  return text.length > TOOL_OUTPUT_PREVIEW_LIMIT
    ? `${text.slice(0, TOOL_OUTPUT_PREVIEW_LIMIT)}…`
    : text;
}

function ToolCallView({ row }: { row: ToolCallRow }) {
  const [open, setOpen] = useState(false);
  const { formatMessage } = useIntl();
  const copy = TOOL_CALL_STATUS_COPY[row.status];
  const outputText = resolveToolOutputPreview(row);
  const expandable = outputText.trim().length > 0;
  return (
    <div className="mr-8 overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-ui-sm"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        aria-label={formatMessage({
          id: open ? "chat.toolCall.collapseDetails" : "chat.toolCall.expandDetails",
        })}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="shrink-0 font-mono text-foreground">{row.toolName}</span>
        <span className="min-w-0 flex-1 truncate text-foreground-subtlest">{row.inputText}</span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-ui-xs font-medium",
            PILL_TONE_CLASSES[copy.tone],
          )}
        >
          {copy.tone === "running" ? (
            <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-warning" />
          ) : null}
          {formatMessage({ id: copy.id })}
        </span>
      </button>
      {open && expandable ? (
        <div className="border-t border-border px-3 py-2">
          <div className="text-ui-xs font-medium text-foreground-subtle">
            {formatMessage({ id: "chat.toolCall.result" })}
          </div>
          <pre className="mt-1 max-h-48 overflow-y-auto font-mono text-ui-xs break-all whitespace-pre-wrap text-foreground-subtle">
            {outputText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// —— 其余 kind（artifact/subagent/hookInvocation/timelineMarker）：折叠占位行 ——

function PlaceholderRowView({ row }: { row: ConversationRow }) {
  return <div className="mr-8 px-3 py-1 text-ui-xs text-foreground-subtlest">[{row.kind}]</div>;
}

function TimelineRowView({ row }: { row: ConversationRow }) {
  switch (row.kind) {
    case "turnHeader":
      return <TurnHeaderView row={row} />;
    case "userInput":
      return <UserInputView row={row} />;
    case "assistantText":
      return <AssistantTextView row={row} />;
    case "reasoning":
      return <ReasoningView row={row} />;
    case "toolCall":
      return <ToolCallView row={row} />;
    default:
      return <PlaceholderRowView row={row} />;
  }
}

// —— composer 状态条（纯 props 形态；数据来自 store.getControlState()） ——

/** 停止按钮状态：idle 无可停任务 / stoppable 可停 / stopping 停止中（转圈禁用）。 */
export type MobileStopState = "idle" | "stoppable" | "stopping";

export interface MobileComposerStateBarProps {
  /** v4 control.phase（如 "running"）：与 queuePending 一起经
   * resolveMobileComposerPlaceholderId 决定输入占位（调用方消费，本组件不渲染）。 */
  phase?: string | null;
  /** v4 control.canStop：false 不渲染停止按钮（与 stopState 双重防护，防 stale run）。 */
  canStop: boolean;
  /** 停止按钮状态。 */
  stopState: MobileStopState;
  /** 是否存在排队消息（store queue.items 非空）：同 phase，供占位解析。 */
  queuePending: boolean;
  /** 触发 v4 stop 命令（payload {expectedForegroundExecutionId} 组装在调用方）。 */
  onStop: () => void;
}

/**
 * composer 状态条：canStop && stopState==="stoppable" 渲染 destructive 圆形停止按钮
 * （样式语言对齐现 composer 发送按钮 size-11 rounded-full）；stopping 禁用转圈；
 * 其余不渲染。输入占位不在本组件内：调用方用 resolveMobileComposerPlaceholderId 解析。
 */
export function MobileComposerStateBar({
  canStop,
  stopState,
  onStop,
}: MobileComposerStateBarProps) {
  const { formatMessage } = useIntl();
  if (!canStop) return null;
  if (stopState !== "stoppable" && stopState !== "stopping") return null;
  const stopping = stopState === "stopping";
  return (
    <button
      type="button"
      data-testid="v4-stop"
      // §32.44 官方停止钮（ui ConversationComposer @2067 逐字）：secondary icon-md 方钮
      // + Square fill-current——非红色圆钮（双页截图对照发现的形态差）。
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground disabled:opacity-50"
      disabled={stopping}
      aria-label={formatMessage({ id: "chat.stop" })}
      onClick={onStop}
    >
      {stopping ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        <Square aria-hidden="true" className="size-3.5 fill-current" />
      )}
    </button>
  );
}

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

/** §32.40 官方复制钮还原（_Jt @3011537）：v4-copy-{rowId}、点击剪贴板写 + 1.2s success 勾。 */
function CopyButton({ text, rowId }: { text: string; rowId: number }) {
  const [copied, setCopied] = useState(false);
  const { formatMessage } = useIntl();
  const label = formatMessage({ id: "chat.message.copy" });
  return (
    <button
      type="button"
      data-testid={`v4-copy-${rowId}`}
      aria-label={label}
      title={label}
      disabled={text.length === 0}
      className="inline-flex min-h-6 items-center gap-1 rounded-md px-1.5 text-ui-xs text-foreground-subtlest transition-colors hover:bg-surface-hover hover:text-foreground-subtle"
      onClick={() => {
        if (!text || !navigator.clipboard) return;
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5 text-success" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}
