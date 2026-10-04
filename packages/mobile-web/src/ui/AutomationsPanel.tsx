// R3 P6 automations 定时任务面第一档（specs/mobile-relay-r3-frontend.md §23）。
// 纯展示受控组件：任务/运行记录/工作流经 props 装配缝由上层传入（本组件不持数据源、
// 不发命令——Host automations 服务面归 P7 立项，缺省空态零回归）。
// 官方形态取证（upstream index chunk）：
//   tablist：role="tablist" + aria-label=pageTab.ariaLabel + flex items-baseline gap-5 +
//     button role="tab" aria-selected + tabIndex(0/-1 焦点漫游) + onKeyDown；E1=[automation,workflow]；
//   列表行：`${title} · ${formatMessage(nextRun,{when})}`（" · " 连接）+ runCount {count} +
//     活跃判定 route.endsWith(`:${automationId}`)；th px-4 font-normal + tr h-[46px]；
//   日程描述：describeSchedule/describeCron（src/app/automationsSchedule.ts 官方逐字节还原）。
// 文案：zh 92+weekday 七键官方逐字；en 语义补译（见 intl 注释）。workflow 页签内容（75 id 面）
// 留装配缝（props 传入），缺省空态。D6 自包含：不 import @zcode/ui。
import * as React from "react";
import { useIntl } from "./intl.js";
import { cn } from "./cn.js";
import { describeSchedule, type AutomationSchedule } from "../app/automationsSchedule.js";

/** 官方 E1 双页签键（automation=定时任务 / workflow=工作流）。 */
export type AutomationsTab = "automation" | "workflow";

const TAB_KEYS: readonly AutomationsTab[] = ["automation", "workflow"];

/** 定时任务行投影（上层 Host automations 服务快照；P7 协议面前先本地形状）。 */
export interface AutomationTaskItem {
  automationId: string;
  title: string;
  schedule: AutomationSchedule;
  /** 官方 {when} 插值（下次运行的相对时间串，由上层格式化注入）。 */
  nextRunWhen?: string;
  runCount: number;
  /** 官方活跃判定：路由尾段 `:${automationId}` 匹配（endsWidth 语义）。 */
  activeRouteSuffix?: string;
  enabled?: boolean;
}

export interface AutomationsPanelProps {
  tab: AutomationsTab;
  onTabChange: (tab: AutomationsTab) => void;
  /** 焦点漫游键序（官方 E1 顺序：automation → workflow）。 */
  tasks: AutomationTaskItem[];
  workflowChildren?: React.ReactNode;
  onCreate?: () => void;
  onRefresh?: () => void;
  onRunNow?: (task: AutomationTaskItem) => void;
  onOpenTask?: (task: AutomationTaskItem) => void;
  error?: string | null;
  className?: string;
}

export function AutomationsPanel({
  tab,
  onTabChange,
  tasks,
  workflowChildren,
  onCreate,
  onRefresh,
  onRunNow,
  onOpenTask,
  error,
  className,
}: AutomationsPanelProps) {
  const { formatMessage } = useIntl();
  // 官方 roving tabindex：当前页签 tabIndex=0，其余 -1（onKeyDown 交上层/原生焦点序）。
  const tabAria = formatMessage({ id: "automations.pageTab.ariaLabel" });

  return (
    <section
      className={cn(
        "flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card",
        className,
      )}
      aria-label={tabAria}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-ui-sm font-medium text-foreground">
          {formatMessage({ id: "automations.breadcrumbLabel" })}
        </span>
        {onRefresh ? (
          <button
            type="button"
            className="ml-auto rounded-md px-2 py-1 text-ui-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onRefresh}
          >
            {formatMessage({ id: "automations.refresh" })}
          </button>
        ) : null}
        {onCreate ? (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-ui-sm text-foreground hover:bg-muted"
            onClick={onCreate}
          >
            {formatMessage({ id: "automations.create" })}
          </button>
        ) : null}
      </div>
      <div role="tablist" aria-label={tabAria} className="flex items-baseline gap-5 px-4">
        {TAB_KEYS.map((key) => {
          const selected = key === tab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              data-testid={`automations-tab-${key}`}
              className={cn(
                "border-b-2 pb-1 text-ui-sm",
                selected
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onTabChange(key)}
            >
              {key === "automation"
                ? formatMessage({ id: "automations.chatCreated.defaultTitle" })
                : formatMessage({ id: "automations.moreIdeas" })}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="px-4 text-ui-sm text-destructive">
          {formatMessage({ id: "automations.error.targetNotFound" })}
          {error}
        </p>
      ) : null}
      {tab === "workflow" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {workflowChildren ?? (
            <p className="text-ui-sm text-muted-foreground">
              {formatMessage({ id: "automations.statusFilter.empty" })}
            </p>
          )}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 pb-6">
          <p className="text-ui-sm text-foreground">
            {formatMessage({ id: "automations.empty.title" })}
          </p>
          {onCreate ? (
            <>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-ui-sm text-foreground hover:bg-muted"
                onClick={onCreate}
              >
                {formatMessage({ id: "automations.createManually" })}
              </button>
              <p className="text-ui-xs text-muted-foreground">
                {formatMessage({ id: "automations.createViaChat.prompt" })}
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-4 py-1 text-left font-normal text-ui-xs text-muted-foreground">
                  {formatMessage({ id: "automations.form.title.label" })}
                </th>
                <th className="px-4 py-1 text-left font-normal text-ui-xs text-muted-foreground">
                  {formatMessage({ id: "automations.runs.col.triggered" })}
                </th>
                <th className="px-4 py-1 font-normal" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const when = task.nextRunWhen ?? "";
                const active = task.activeRouteSuffix?.endsWith(`:${task.automationId}`) ?? false;
                return (
                  <tr
                    key={task.automationId}
                    className={cn(
                      "h-[46px] transition-colors hover:bg-muted",
                      active && "bg-muted/60",
                    )}
                    onClick={onOpenTask ? () => onOpenTask(task) : undefined}
                  >
                    <td className="px-4 text-ui-sm text-foreground">
                      {/* 官方行形态：`${title} · ${nextRun}`（" · " 连接）。 */}
                      {when
                        ? `${task.title} · ${formatMessage({ id: "automations.nextRun" }, { when })}`
                        : task.title}
                      <span className="ml-2 text-ui-xs text-muted-foreground">
                        {formatMessage(
                          { id: "automations.runCount" },
                          { count: String(task.runCount) },
                        )}
                      </span>
                      <span className="ml-2 text-ui-xs text-muted-foreground">
                        {describeSchedule(task.schedule, formatMessage)}
                      </span>
                    </td>
                    <td className="px-4 text-ui-sm text-muted-foreground">
                      {task.enabled === false
                        ? formatMessage({ id: "automations.lifecycle.failed" })
                        : formatMessage({ id: "automations.form.status.label" })}
                    </td>
                    <td className="px-4 text-right">
                      {onRunNow ? (
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-ui-xs text-foreground hover:bg-muted"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRunNow(task);
                          }}
                        >
                          {formatMessage({ id: "automations.runNow" })}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
