// R3 P5b 宽视口全壳纯模型（specs/mobile-relay-r3-frontend.md §19）：断点判定、侧栏折叠
// 持久化、项目树分组计数、问候时段桶。全部纯函数（无 IO 副作用；localStorage/matchMedia
// 经参数注入或防御式读取），node:test 直测（test/wideShellModel.test.ts）。
// 形态依据（P5a 取证，只读参照 ui D6 冻结件，不 import）：断点 = 官方字面
// `(max-width: 767px)`（width-only matchMedia）；侧栏宽 264（可折叠持久化）。
import { compareHomeTasks } from "../OrganizeMenu.js";

/** 官方断点字面（width-only；命中 = 窄视口单列壳，未命中 = ≥768px 宽壳）。 */
export const MOBILE_WIDE_BREAKPOINT_QUERY = "(max-width: 767px)";

/** 侧栏折叠持久化键（Drora 化单键，specs/drora-rename.md 同款命名空间）。 */
export const WIDE_SIDEBAR_COLLAPSED_STORAGE_KEY = "drora-mobile-sidebar-collapsed";

/** 宽壳结构面（ui/wide 自持，结构化满足 src/app/entry.ts 的 ProjectedWorkspace 投影，不反向 import app）。 */
export interface WideShellTask {
  sessionId: string;
  title: string;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  status: "running" | "completed" | "idle";
  /** §32.16 三态 membership（宽壳「已置顶」节消费；投影侧缺省 undefined=未置顶）。 */
  pinned?: boolean;
}

export interface WideShellWorkspace {
  /** workspace 身份 key（workspaceIdentity?.trim() || workspacePath 语义，由装配方归一）。 */
  workspaceKey: string;
  name: string;
  kind: "local" | "remote";
  path: string;
  updatedAtMs: number | null;
  tasks: readonly WideShellTask[];
}

/** 任务打开请求（开任务面最小面；侧栏/搜索面回传的完整对象结构化满足）。 */
export interface WideTaskOpenRequest {
  sessionId: string;
  title: string;
}

/** 任务打开的归属定位（AGENTS Workspace Identity：key 装配方归一，path 供开桥）。 */
export interface WideWorkspaceRef {
  workspaceKey: string;
  path: string;
}

// —— 断点判定 ——

/**
 * 断点判定纯函数：matchMedia（或同形 mock）对官方 query 的命中取反。宽壳 = 未命中
 * `(max-width: 767px)`（即 ≥768px）。matchMedia 缺失（旧 webview/node）或抛错时按
 * 窄视口处理——回落既有单列壳，零回归默认。
 */
export function isWideViewport(
  matchMedia: ((query: string) => { matches: boolean }) | null | undefined,
): boolean {
  if (typeof matchMedia !== "function") {
    return false;
  }
  try {
    return matchMedia(MOBILE_WIDE_BREAKPOINT_QUERY)?.matches !== true;
  } catch {
    return false;
  }
}

// —— 侧栏折叠持久化（闭集防御同 searchHistory.ts 收口） ——

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读侧栏折叠态：仅字面 "1" 视为折叠；缺失 / 脏值 / storage 不可用一律展开（缺省态）。
 * storage 可注入（node 测试缝）；缺省读 window.localStorage。
 */
export function loadSidebarCollapsed(storage?: StorageLike | null): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    return store.getItem(WIDE_SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 写侧栏折叠态（"1"/"0" 字面，闭集序列化；storage 不可用时静默跳过，不阻断 UI）。 */
export function storeSidebarCollapsed(collapsed: boolean, storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.setItem(WIDE_SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // 隐私模式/配额满：折叠态只是偏好快照，失败不影响本次交互。
  }
}

// —— 项目树分组计数（P5b 骨架：count 自投影 tasks 推导；sessions-index 实时数归 P5c） ——

export interface SidebarWorkspaceGroup extends WideShellWorkspace {
  /** 任务数（= tasks.length，投影内推导）。 */
  taskCount: number;
  /** 运行中任务数（状态点展示用）。 */
  runningCount: number;
  /** 组内任务已按官方比较器 updated 降序重排（compareHomeTasks 同源，含并列兜底）。 */
  tasks: WideShellTask[];
}

/**
 * 工作区投影 → 侧栏项目树分组：保持工作区原有顺序，组内任务按 updated 降序
 * （复用 OrganizeMenu.compareHomeTasks，与首页/搜索面同源排序），并推导任务/运行中计数。
 */
export function buildSidebarProjectTree(
  workspaces: readonly WideShellWorkspace[],
): SidebarWorkspaceGroup[] {
  return workspaces.map((workspace) => {
    const tasks = [...workspace.tasks].sort((a, b) => compareHomeTasks(a, b, "updated"));
    return {
      ...workspace,
      tasks,
      taskCount: workspace.tasks.length,
      runningCount: workspace.tasks.filter((task) => task.status === "running").length,
    };
  });
}

// —— 问候时段桶（官方 ConversationDraftEmptyState 同构；桶边界为 P5b 裁定五桶） ——

export type WideGreetingSlot = "morning" | "noon" | "afternoon" | "evening" | "lateNight";

/**
 * 时段桶（本地时钟）：morning 5-11 / noon 11-13 / afternoon 13-18 / evening 18-23 /
 * lateNight 23-5。文案键 mobileShell.wide.greeting.*（值 = 官方 chat.empty.greeting.*
 * 五桶对应值；官方六桶含 morningEarly 5-9，本侧五桶为有意归并，见文件头 spec §19）。
 */
export function resolveGreetingSlot(hour: number): WideGreetingSlot {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 13) return "noon";
  if (hour >= 13 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "lateNight";
}

/** 距下一个时段边界的毫秒数（≥1ms；问候语跨档自动换用，官方同构）。 */
export function nextGreetingBoundaryDelayMs(date: Date): number {
  const boundaries = [5, 11, 13, 18, 23];
  const candidates = boundaries.map((hour) => {
    const boundary = new Date(date);
    boundary.setHours(hour, 0, 0, 0);
    return boundary;
  });
  const tomorrowFirst = new Date(date);
  tomorrowFirst.setDate(tomorrowFirst.getDate() + 1);
  tomorrowFirst.setHours(boundaries[0]!, 0, 0, 0);
  const next =
    candidates.find((candidate) => candidate.getTime() > date.getTime()) ?? tomorrowFirst;
  return Math.max(1, next.getTime() - date.getTime());
}
