// §32.69 模式菜单弹层（官方活体 mv2-mode-official 结构）：plan 独立首组 + 分隔线 +
// build/edit/yolo 组；条目 = 图标（plan=Lightbulb/build=Hand/edit=ShieldCheck/
// yolo=ShieldAlert）+ 名称（mode.label.glm.*）+ 描述行（mode.description.glm.*，
// locale chunk 5408-5412/11565-11569 逐字）+ 当前模式右侧 ✓。锚 composer 内
// chat-mode-select-trigger 上方弹出（bottom-full left-0，官方同位）。
import type { CollaborationMode } from "./taskSession.js";
import {
  Check,
  ChevronDown,
  Hand,
  Lightbulb,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useIntl } from "../ui/intl.js";
import { cn } from "../ui/cn.js";

/** 官方 switchCollaborationMode 值域闭集（顺序照官方 schema Si([build,edit,plan,yolo])）。 */
export const MODE_SELECT_ITEMS: readonly CollaborationMode[] = ["build", "edit", "plan", "yolo"];

/** 官方 mode.label.glm.* 闭集（config.mode 未知值回落 build 文案同官方缺省语义）。 */
export const MODE_LABEL_IDS: Record<string, string> = {
  default: "mode.label.glm.default",
  plan: "mode.label.glm.plan",
  edit: "mode.label.glm.edit",
  build: "mode.label.glm.build",
  yolo: "mode.label.glm.yolo",
};

/** §32.69 官方 mode.description.glm.*（模式菜单描述行）。 */
const MODE_DESCRIPTION_IDS: Record<string, string> = {
  default: "mode.description.glm.default",
  plan: "mode.description.glm.plan",
  edit: "mode.description.glm.edit",
  build: "mode.description.glm.build",
  yolo: "mode.description.glm.yolo",
};

export interface TaskModeMenuProps {
  open: boolean;
  /** 当前模式（snapshot.config.mode 回流；✓ 标记与文案随值）。 */
  configMode?: string | null;
  onSelect: (mode: CollaborationMode) => void;
  onClose: () => void;
}

export function TaskModeMenu({ open, configMode, onSelect, onClose }: TaskModeMenuProps) {
  const { formatMessage } = useIntl();
  if (!open) return null;
  const pick = (mode: CollaborationMode) => {
    onClose();
    if (mode !== configMode) onSelect(mode);
  };
  const item = (mode: CollaborationMode, Icon: typeof Hand) => (
    <button
      key={mode}
      type="button"
      role="menuitem"
      data-testid={`chat-mode-select-item-${mode}`}
      className="flex min-h-12 w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-hover"
      onClick={() => pick(mode)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ui-sm text-foreground">
          {formatMessage({ id: MODE_LABEL_IDS[mode] ?? MODE_LABEL_IDS.build! })}
        </span>
        <span className="text-ui-xs text-foreground-subtle">
          {formatMessage({ id: MODE_DESCRIPTION_IDS[mode] ?? MODE_DESCRIPTION_IDS.build! })}
        </span>
      </span>
      {mode === configMode ? (
        <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-foreground" />
      ) : null}
    </button>
  );
  return (
    <div
      role="menu"
      aria-label={formatMessage({
        id: MODE_LABEL_IDS[configMode ?? "build"] ?? MODE_LABEL_IDS.build!,
      })}
      className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-border bg-card p-1 shadow-lg"
    >
      {(["plan"] as CollaborationMode[]).map((mode) => item(mode, Lightbulb))}
      <div role="separator" aria-orientation="horizontal" className="my-1 h-px bg-border" />
      {MODE_SELECT_ITEMS.filter((m) => m !== "plan").map((mode) =>
        item(mode, mode === "build" ? Hand : mode === "edit" ? ShieldCheck : ShieldAlert),
      )}
    </div>
  );
}

/** §33.18.13 触发钮图标随模式（与上方菜单条目同源）；宽窄双形态见 TaskModeTrigger。 */
const MODE_TRIGGER_ICONS: Record<string, typeof Hand> = {
  plan: Lightbulb,
  build: Hand,
  edit: ShieldCheck,
  yolo: ShieldAlert,
};

export interface TaskModeTriggerProps {
  configMode?: string | null;
  /** §33.18.13 响应式双形态：宽壳=图标+模式名+ChevronDown（§32.68 markup，59702
   *  真机宽壳活体「完全访问 ⌄」）；窄壳=纯图标（§33.18.12 窄壳活体）。aria 恒=切换模式。 */
  desktopComposer?: boolean;
  modeMenuOpen: boolean;
  onToggle: () => void;
  onCloseMenu: () => void;
  /** 缺省=只读展示（aria-disabled，旧装配/测试无切换能力时）。 */
  onModeSelect?: (mode: CollaborationMode) => void;
}

export function TaskModeTrigger({
  configMode,
  desktopComposer,
  modeMenuOpen,
  onToggle,
  onCloseMenu,
  onModeSelect,
}: TaskModeTriggerProps) {
  const { formatMessage } = useIntl();
  const Icon = MODE_TRIGGER_ICONS[configMode ?? "build"] ?? Hand;
  const modeLabelId = MODE_LABEL_IDS[configMode ?? "build"] ?? MODE_LABEL_IDS.build!;
  const trigger = (readOnly: boolean) => (
    <button
      type="button"
      data-testid="chat-mode-select-trigger"
      aria-haspopup={readOnly ? undefined : "menu"}
      aria-expanded={readOnly ? undefined : modeMenuOpen}
      aria-disabled={readOnly ? "true" : undefined}
      aria-label={formatMessage({ id: "chat.toolbar.mode.label" })}
      className={cn(
        desktopComposer
          ? cn(
              "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-ui-base",
              readOnly ? "text-foreground-subtle" : "text-foreground transition-colors hover:bg-hover hover:text-foreground",
            )
          : cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-lg",
              readOnly ? "text-foreground-subtle" : "text-foreground transition-colors hover:bg-hover hover:text-foreground",
            ),
        !readOnly && modeMenuOpen && "bg-hover",
      )}
      onClick={onToggle}
    >
      <Icon aria-hidden="true" className="size-4" />
      {desktopComposer ? (
        <>
          <span className="inline">{formatMessage({ id: modeLabelId })}</span>
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </>
      ) : null}
    </button>
  );
  if (!onModeSelect) return trigger(true);
  return (
    <div className="relative shrink-0">
      {/* §32.69 官方活体结构（图标+描述+✓+plan 首组分组）。 */}
      <TaskModeMenu
        open={modeMenuOpen}
        configMode={configMode}
        onSelect={onModeSelect}
        onClose={onCloseMenu}
      />
      {trigger(false)}
    </div>
  );
}

/** §32.22 官方 v4-composer-plan-marker（bundle @2029871）：plan 生效时工具栏出现可
 *  移除标记（竖分隔 + ghost 钮，悬停换 X，chat.plan.removeMarker 文案）。官方动作为
 *  正交的 plan/plan-off 命令——本协议把 plan 折进 mode 闭集（§32.3），移除等价映射为
 *  切回 build。仅在有切换能力（onModeSelect）时渲染。 */
export function TaskModePlanMarker({
  onRemove,
}: {
  onRemove: () => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <span data-testid="v4-composer-plan-marker" className="flex items-center gap-1">
      <span
        role="separator"
        aria-orientation="vertical"
        className="h-3 w-px shrink-0 bg-border"
      />
      <button
        type="button"
        aria-label={formatMessage({ id: "chat.plan.removeMarker" })}
        title={formatMessage({ id: "chat.plan.removeMarker" })}
        className="group/plan inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface-hover hover:text-foreground-subtle"
        onClick={onRemove}
      >
        <Shield
          aria-hidden="true"
          className="size-4 group-hover/plan:hidden group-focus-visible/plan:hidden"
        />
        <X
          aria-hidden="true"
          className="hidden size-4 group-hover/plan:block group-focus-visible/plan:block"
        />
      </button>
    </span>
  );
}
