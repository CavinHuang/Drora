// R3 P3c 整理任务特征模块：菜单面板 + 偏好持久化 + 任务组织纯函数 + 任务行/时间线列表
// 渲染面（specs/mobile-relay-r3-frontend.md §16 第 1 条）。渲染原语（HomeTaskRow /
// HomeTimelineTaskList）一并落在本文件：它们只被首页整理两模式消费，且 D6 自包含约束下
// 本轮仅允许本文件一个新增源码文件（HomeShell.tsx 亦受 max-lines 约束）。
// 官方取证（upstream 冻结 bundle src/recovered/remote/v4/3.14.3/assets/index-NjWRUABD.js）：
// - 持久化键原名为 `zcode-web-remote-control-mobile-task-home-preferences`（:185390 Vrn），
//   按改名规则 Drora 化为 `drora-web-remote-control-mobile-task-home-preferences`
//   （specs/drora-rename.md；与桌面侧栏键/值域是两套独立偏好，不共用）；
// - 官方默认值 `{ organizeBy: "workspace", sortBy: "updated" }`（:185391 B0），读取闭集
//   校验非法回默认（:185397 Urn 组织方式∈{workspace,timeline}、排序∈{created,updated}；
//   :185404 Wrn JSON.parse 异常/缺键同样回默认）；
// - 菜单结构（:185807-:185857）：触发按钮 → w-52 面板 → 标题 → organizeBy RadioGroup
//   （onValueChange 闭集守卫 :185810）→ 分隔线 → sortBy RadioGroup（闭集守卫 :185841）；
// - 任务排序比较器（:6757 Fle）：主字段降序 → 并列回退另一字段降序 → 双双并列时
//   taskId 后排（`t.taskId.localeCompare(e.taskId)`，即 taskId 降序，本实现同向）；
// - 任务粒度时间分桶（:185188 Trn）：时间戳随 sortBy 取 createdAt/updatedAt 落
//   taskTimeline 八桶（算法即 timeBuckets.ts 的 resolveTaskTimelineBucketLabel 同源），
//   同 key 段用 Map 就近合并（非相邻同 key 并回首次组，与线性会话分桶的相邻语义不同），
//   桶序 = 排序后首次出现序；时间戳缺失时官方经 NaN 比较自然落入 older，本实现显式化。
// 定位差异：absolute 定位盖在触发按钮附近由调用方处理，本组件只渲染菜单面板；
// 官方面板 token 为 bg-popover，本包 styles.css 无该 token，用同族面板色 bg-card（D6 自包含）。
import { Check, CircleCheck, LoaderCircle } from "lucide-react";
import { cn } from "./cn.js";
import { useIntl } from "./intl.js";
import { formatTaskRelativeTime } from "./formatRelative.js";
import {
  resolveTaskTimelineBucketLabel,
  serializeTaskTimelineBucketLabel,
  taskTimelineBucketMessage,
  type TaskTimelineBucketLabel,
  type TaskTimelineBucketLocale,
} from "./timeBuckets.js";

/** 整理方式闭集（官方 Urn 值域；与桌面侧栏 sidebar 的 project/chronological 是两套）。 */
export type HomeOrganizeBy = "workspace" | "timeline";

/** 排序闭集（官方 Urn 值域）。 */
export type HomeSortBy = "created" | "updated";

export interface HomeOrganizePreferences {
  organizeBy: HomeOrganizeBy;
  sortBy: HomeSortBy;
}

/** 官方默认偏好（:185391 B0 逐字段对齐）。 */
export const DEFAULT_HOME_ORGANIZE_PREFERENCES: HomeOrganizePreferences = {
  organizeBy: "workspace",
  sortBy: "updated",
};

/** localStorage 键：官方原键（见文件头取证）按 specs/drora-rename.md 前缀改名。 */
export const HOME_ORGANIZE_PREFERENCES_STORAGE_KEY =
  "drora-web-remote-control-mobile-task-home-preferences";

/**
 * 偏好闭集校验纯函数（官方 Urn/Wrn 同语义：非对象、缺键、值出闭集一律回默认）。
 * 独立导出以便 node:test 直测（storage 不可注入，窗口面由 load/store 自行守卫）。
 */
export function parseHomeOrganizePreferences(raw: unknown): HomeOrganizePreferences {
  if (typeof raw !== "object" || raw === null) return DEFAULT_HOME_ORGANIZE_PREFERENCES;
  const { organizeBy, sortBy } = raw as Record<string, unknown>;
  // 逐字面量闭集校验（官方 `(t.organizeBy === \`workspace\` || ...) && (...)` 同款），
  // 字面量比较同时完成 unknown 收窄。
  if (organizeBy !== "workspace" && organizeBy !== "timeline") {
    return DEFAULT_HOME_ORGANIZE_PREFERENCES;
  }
  if (sortBy !== "created" && sortBy !== "updated") {
    return DEFAULT_HOME_ORGANIZE_PREFERENCES;
  }
  // 官方返回原解析对象；此处构造两字段净对象，等价且不携带存储外的多余键。
  return { organizeBy, sortBy };
}

/** 读取偏好（SSR/非浏览器环境回默认；parse/存储异常回默认，官方 Hrn/Wrn 同语义）。 */
export function loadHomeOrganizePreferences(): HomeOrganizePreferences {
  if (typeof window === "undefined") return DEFAULT_HOME_ORGANIZE_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(HOME_ORGANIZE_PREFERENCES_STORAGE_KEY);
    if (raw === null) return DEFAULT_HOME_ORGANIZE_PREFERENCES;
    return parseHomeOrganizePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_HOME_ORGANIZE_PREFERENCES;
  }
}

/** 写入偏好（官方 Grn 同语义：序列化全量两字段；存储异常静默忽略）。 */
export function storeHomeOrganizePreferences(preferences: HomeOrganizePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOME_ORGANIZE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // 忽略：偏好写入失败不影响会话（官方 Grn catch 空块同语义）。
  }
}

/** 排序/分桶共用的任务最小结构面（MobileHomeShellTask / ProjectedTask 天然满足）。 */
export interface HomeOrganizeTask {
  sessionId: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
}

/** 防御归一：官方数据恒为 epoch ms；投影侧 null/非有限值按 0（最旧）参与降序比较。 */
function organizeTimestamp(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 任务排序比较器（官方 :6757 Fle 同构）：sortBy=created 以 createdAtMs 为主键、
 * updated 以 updatedAtMs 为主键，均降序；主键并列回退另一字段降序；再并列时
 * taskId 后排（官方 `t.taskId.localeCompare(e.taskId)` 同向，即 id 降序）。
 */
export function compareHomeTasks(
  a: HomeOrganizeTask,
  b: HomeOrganizeTask,
  sortBy: HomeSortBy,
): number {
  const primaryKey = sortBy === "created" ? "createdAtMs" : "updatedAtMs";
  const secondaryKey = primaryKey === "createdAtMs" ? "updatedAtMs" : "createdAtMs";
  const aPrimary = organizeTimestamp(a[primaryKey]);
  const bPrimary = organizeTimestamp(b[primaryKey]);
  if (aPrimary !== bPrimary) return bPrimary - aPrimary;
  const aSecondary = organizeTimestamp(a[secondaryKey]);
  const bSecondary = organizeTimestamp(b[secondaryKey]);
  if (aSecondary !== bSecondary) return bSecondary - aSecondary;
  return b.sessionId.localeCompare(a.sessionId);
}

/** 任务粒度时间桶（官方 Trn 输出形状）：key 为桶标识，tasks 保持传入顺序。 */
export interface HomeTimelineBucket<TRow> {
  key: string;
  label: TaskTimelineBucketLabel;
  tasks: TRow[];
}

/**
 * 任务粒度八桶分桶（官方 :185188 Trn 同构，复用 timeBuckets.ts 的桶判定）：
 * 每个任务按 sortBy 取 createdAtMs/updatedAtMs 落桶；同 key 任务经 Map 就近合并
 * （非相邻同 key 并回首次组）；桶序 = 传入（应为 compareHomeTasks 排序后）序列的
 * 首次出现序。主时间戳缺失 → older（官方 NaN 比较的自然落点，此处显式化）。
 */
export function bucketHomeTasksByTime<TRow extends HomeOrganizeTask>(
  tasks: readonly TRow[],
  options: { sortBy: HomeSortBy; now: number; locale: TaskTimelineBucketLocale },
): HomeTimelineBucket<TRow>[] {
  const buckets: HomeTimelineBucket<TRow>[] = [];
  const byKey = new Map<string, HomeTimelineBucket<TRow>>();
  for (const task of tasks) {
    const primary = options.sortBy === "created" ? task.createdAtMs : task.updatedAtMs;
    const label =
      typeof primary === "number" && Number.isFinite(primary)
        ? resolveTaskTimelineBucketLabel(primary, options.now, options.locale)
        : { kind: "older" as const };
    const key = serializeTaskTimelineBucketLabel(label);
    const existing = byKey.get(key);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }
    const bucket: HomeTimelineBucket<TRow> = { key, label, tasks: [task] };
    byKey.set(key, bucket);
    buckets.push(bucket);
  }
  return buckets;
}

// —— 渲染面（organize 两模式共用；与 HomeShell 的分工见文件头） ——

/** 任务行展示所需的最小结构面（MobileHomeShellTask 天然满足，避免与 HomeShell 循环依赖；
 * 字段集与 MobileHomeShellTask 全同，保证 onTaskOpen 反变可赋值）。 */
export interface OrganizeTaskRowTask {
  sessionId: string;
  title: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  status: "running" | "completed" | "idle";
  /** §32.16 三态 membership。 */
  pinned?: boolean;
}

/** 任务行状态 pill（官方 shell：rounded-full border px-1.5 py-0.5 text-ui-xs）。 */
function OrganizeTaskStatusPill({ status }: { status: OrganizeTaskRowTask["status"] }) {
  const { formatMessage } = useIntl();
  const running = status === "running";
  const completed = status === "completed";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-ui-xs leading-none",
        running
          ? "border-brand/40 bg-accent text-foreground"
          : completed
            ? "border-success/40 bg-success text-success-foreground"
            : "border-border bg-background text-foreground-subtle",
      )}
    >
      {running ? (
        <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
      ) : completed ? (
        <CircleCheck aria-hidden="true" className="size-3" />
      ) : null}
      {formatMessage({
        id: running
          ? "mobileShell.task.status.running"
          : completed
            ? "mobileShell.task.status.completed"
            : "mobileShell.task.status.idle",
      })}
    </span>
  );
}

/**
 * 任务行（workspace 分组与 timeline 平铺两模式同一行布局/触控/选中态；
 * workspace 仅透传回 onTaskOpen，泛型避免与 HomeShell 的类型循环依赖）。
 */
export function HomeTaskRow<TWorkspace>({
  task,
  workspace,
  selected,
  onTaskOpen,
}: {
  task: OrganizeTaskRowTask;
  workspace: TWorkspace;
  selected: boolean;
  onTaskOpen?: (task: OrganizeTaskRowTask, workspace: TWorkspace) => void;
}) {
  const intl = useIntl();
  return (
    <li>
      <button
        type="button"
        className={cn(
          "flex min-h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-wait disabled:opacity-70",
          selected ? "bg-selected text-foreground" : "hover:bg-surface-hover",
        )}
        onClick={onTaskOpen ? () => onTaskOpen(task, workspace) : undefined}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {task.pinned ? (
            <span aria-hidden="true" className="text-ui-xs text-warning">📌</span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-base text-foreground">{task.title}</span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-ui-base text-foreground-subtle">
            <span className="truncate">
              {task.updatedAtMs !== null ? formatTaskRelativeTime(task.updatedAtMs, intl) : null}
            </span>
          </span>
        </span>
        <OrganizeTaskStatusPill status={task.status} />
      </button>
    </li>
  );
}

/** timeline 模式的分桶列表（organizeBy=timeline 渲染面）：桶标题复用 taskTimeline.* 文案。 */
export function HomeTimelineTaskList<TWorkspace>({
  buckets,
  selectedTaskId = null,
  onTaskOpen,
}: {
  buckets: readonly HomeTimelineBucket<OrganizeTaskRowTask & { workspace: TWorkspace }>[];
  selectedTaskId?: string | null;
  onTaskOpen?: (task: OrganizeTaskRowTask, workspace: TWorkspace) => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <ul className="mt-3 space-y-2">
      {buckets.map((bucket) => (
        <li
          key={bucket.key}
          className="overflow-hidden rounded-lg border border-card-border bg-card"
        >
          <div className="border-b border-card-border px-3 py-2 text-ui-xs font-medium text-foreground-subtle">
            {formatMessage(taskTimelineBucketMessage(bucket.label))}
          </div>
          <ul className="px-2 py-2">
            {bucket.tasks.map((entry) => (
              <HomeTaskRow
                key={entry.sessionId}
                task={entry}
                workspace={entry.workspace}
                selected={entry.sessionId === selectedTaskId}
                onTaskOpen={onTaskOpen}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export interface OrganizeMenuProps {
  /** 当前偏好（受控：值由调用方持有并回灌）。 */
  preferences: HomeOrganizePreferences;
  /** 任一单选变化（已过闭集守卫）；调用方负责持久化与回灌。 */
  onChange: (next: HomeOrganizePreferences) => void;
  /** 请求关闭（选项选中后 / Escape）；开合状态与定位由调用方处理。 */
  onClose: () => void;
  className?: string;
}

/** 菜单选项行：44px 触控目标，选中项尾随打勾（官方 DropdownMenu RadioItem 同语义）。 */
function OrganizeMenuOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-surface-hover",
        selected ? "text-foreground" : "text-foreground-subtle",
      )}
      onClick={onSelect}
    >
      <span className="min-w-0 truncate">{label}</span>
      {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
    </button>
  );
}

/**
 * 整理任务菜单面板（官方 :185807-:185857 菜单体自包含移植）：两段 RadioGroup
 * （整理方式 workspace|timeline / 排序 created|updated），onValueChange 白名单守卫，
 * 非闭集值不落偏好不关菜单。选中即回调 onChange + onClose（官方 DropdownMenu 选择即收起）。
 */
export function OrganizeMenu({ preferences, onChange, onClose, className }: OrganizeMenuProps) {
  const { formatMessage } = useIntl();

  const select = (patch: Partial<HomeOrganizePreferences>) => {
    // 闭集白名单守卫（官方 onValueChange `(e === \`workspace\` || ...) && commit` 同款：
    // 非白名单值不落偏好不关菜单；本组件入参是闭集字面量，守卫保留运行时对齐面）。
    const organizeBy = patch.organizeBy;
    if (organizeBy !== undefined && organizeBy !== "workspace" && organizeBy !== "timeline") {
      return;
    }
    const sortBy = patch.sortBy;
    if (sortBy !== undefined && sortBy !== "created" && sortBy !== "updated") {
      return;
    }
    onChange({ ...preferences, ...patch });
    onClose();
  };

  return (
    // 面板：官方 `w-52 min-w-52` + 圆角边框阴影面板；本包无 bg-popover token，用 bg-card。
    <div
      className={cn(
        "w-52 min-w-52 rounded-lg border border-card-border bg-card p-1 text-ui-base shadow-lg",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="px-2.5 pb-1 pt-2 text-ui-xs font-medium text-foreground-subtlest">
        {formatMessage({ id: "mobileShell.organize.title" })}
      </div>
      <div role="radiogroup" aria-label={formatMessage({ id: "mobileShell.organize.organizeBy" })}>
        <div className="px-2.5 py-1 text-ui-xs text-foreground-subtle">
          {formatMessage({ id: "mobileShell.organize.organizeBy" })}
        </div>
        <OrganizeMenuOption
          label={formatMessage({ id: "mobileShell.organize.byWorkspace" })}
          selected={preferences.organizeBy === "workspace"}
          onSelect={() => select({ organizeBy: "workspace" })}
        />
        <OrganizeMenuOption
          label={formatMessage({ id: "mobileShell.organize.byTimeline" })}
          selected={preferences.organizeBy === "timeline"}
          onSelect={() => select({ organizeBy: "timeline" })}
        />
      </div>
      <div className="mx-2 my-1 border-t border-border" />
      <div role="radiogroup" aria-label={formatMessage({ id: "mobileShell.organize.sortBy" })}>
        <div className="px-2.5 py-1 text-ui-xs text-foreground-subtle">
          {formatMessage({ id: "mobileShell.organize.sortBy" })}
        </div>
        <OrganizeMenuOption
          label={formatMessage({ id: "mobileShell.organize.byCreated" })}
          selected={preferences.sortBy === "created"}
          onSelect={() => select({ sortBy: "created" })}
        />
        <OrganizeMenuOption
          label={formatMessage({ id: "mobileShell.organize.byUpdated" })}
          selected={preferences.sortBy === "updated"}
          onSelect={() => select({ sortBy: "updated" })}
        />
      </div>
    </div>
  );
}
