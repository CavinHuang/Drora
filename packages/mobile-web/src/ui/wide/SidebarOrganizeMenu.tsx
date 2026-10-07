// R3 P6 宽壳侧栏深面第一档（specs/mobile-relay-r3-frontend.md §23）：organize 视图 + sortBy 排序。
// 纯展示受控组件：视图/排序状态归上层（WideShell/装配缝）所有，本组件只渲染选择面。
// 官方形态取证（upstream index chunk）：
//   organize = RadioGroup（value/onValueChange + aria-label=workspaceSidebar.organize「视图」
//     + w-fit），三 value：project（organizeByProject「项目」）/ chronological
//     （organizeChronologicalList「时间线」）/ workspace（organizeGrouped「分组」），
//     选中项带 check 图标（官方 size-3 shrink-0）；
//   sortBy = 两 value：updated（sortByUpdated「更新时间」）/ created（sortByCreated
//     「创建时间」），每项带图标（官方 size-4）；官方官方图标名经 minify 不可考（Hv/z_/Uv），
//     用同族 lucide 图标对位（D6 不 import @drora/ui）。
//   taskViewOptions「筛选和排序」为入口按钮文案（本组件由调用方做入口）。
// 文案：workspaceSidebar.* 官方 zh 逐字（32 键已入库，spec §23.3）。装配缝缺省：sort 段
// 仅在传 onSortChange 时渲染（零回归——不传即纯 organize 面）。
import { CalendarPlus, Check, History, ListOrdered } from "lucide-react";
import { useIntl } from "../intl.js";
import { cn } from "../cn.js";

/** 官方 organize 三值（RadioGroup value 字面：project/chronological/workspace）。 */
export type SidebarOrganizeMode = "project" | "chronological" | "workspace";
/** 官方 sortBy 两值（value 字面：updated/created）。 */
export type SidebarSortMode = "updated" | "created";

const ORGANIZE_ITEMS: readonly { value: SidebarOrganizeMode; labelId: string }[] = [
  { value: "project", labelId: "workspaceSidebar.organizeByProject" },
  { value: "chronological", labelId: "workspaceSidebar.organizeChronologicalList" },
  { value: "workspace", labelId: "workspaceSidebar.organizeGrouped" },
];

const SORT_ITEMS: readonly { value: SidebarSortMode; labelId: string }[] = [
  { value: "updated", labelId: "workspaceSidebar.sortByUpdated" },
  { value: "created", labelId: "workspaceSidebar.sortByCreated" },
];

export interface SidebarOrganizeMenuProps {
  organize: SidebarOrganizeMode;
  onOrganizeChange: (mode: SidebarOrganizeMode) => void;
  /** 官方两值排序面；缺省（undefined）不渲染 sortBy 段（装配缝零回归）。 */
  sort?: SidebarSortMode;
  onSortChange?: (mode: SidebarSortMode) => void;
  className?: string;
}

export function SidebarOrganizeMenu({
  organize,
  onOrganizeChange,
  sort,
  onSortChange,
  className,
}: SidebarOrganizeMenuProps) {
  const { formatMessage } = useIntl();
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        role="radiogroup"
        aria-label={formatMessage({ id: "workspaceSidebar.organize" })}
        className="flex flex-col gap-0.5"
      >
        {ORGANIZE_ITEMS.map(({ value, labelId }) => {
          const selected = organize === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`sidebar-organize-${value}`}
              className={cn(
                "flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-ui-sm transition-colors hover:bg-surface-hover",
                selected ? "text-foreground" : "text-foreground-subtle",
              )}
              onClick={() => onOrganizeChange(value)}
            >
              {selected ? (
                <Check aria-hidden="true" className="size-3 shrink-0" />
              ) : (
                <span aria-hidden="true" className="size-3 shrink-0" />
              )}
              {value === "chronological" ? (
                <ListOrdered aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
              ) : null}
              {formatMessage({ id: labelId })}
            </button>
          );
        })}
      </div>
      {sort !== undefined && onSortChange ? (
        <div
          role="radiogroup"
          aria-label={formatMessage({ id: "workspaceSidebar.sortBy" })}
          className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1"
        >
          {SORT_ITEMS.map(({ value, labelId }) => {
            const selected = sort === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`sidebar-sort-${value}`}
                className={cn(
                  "flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-ui-sm transition-colors hover:bg-surface-hover",
                  selected ? "text-foreground" : "text-foreground-subtle",
                )}
                onClick={() => onSortChange(value)}
              >
                {value === "updated" ? (
                  <History aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
                ) : (
                  <CalendarPlus aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
                )}
                {formatMessage({ id: labelId })}
                {selected ? <Check aria-hidden="true" className="size-3 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
