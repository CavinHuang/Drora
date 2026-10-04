// R3 P3d 首页任务搜索历史（specs/mobile-relay-r3-frontend.md §18）：纯函数自包含移植自
// packages/ui/src/command-center/commandCenterSearchHistory.ts（D6 冻结 ui，本包自持；
// 防御面同构：storage 不可用 / 非法 JSON / 非数组 / 条目形状不符一律回空，不抛错）。
// 与桌面命令中心的有意分歧：手机首页为单 tab 全工作区搜索，无 scope 维度 → 条目只存
// query；上限 5（桌面 20）；localStorage 键按 specs/zcode-rename.md ZCode 化为
// `zcode-mobile-search-history`（与桌面 `zcode-command-center-search-history:<key>` 是
// 两套独立键空间，不共用不迁移）。

/** localStorage 键（手机首页任务搜索历史专用单键）。 */
export const MOBILE_SEARCH_HISTORY_STORAGE_KEY = "zcode-mobile-search-history";

/** 历史默认上限（chips 的移动触控密度：超出去旧，最新在前）。 */
export const MOBILE_SEARCH_HISTORY_MAX = 5;

export interface SearchHistoryEntry {
  query: string;
  updatedAt: number;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSearchHistoryEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<SearchHistoryEntry>;
  return (
    typeof entry.query === "string" &&
    entry.query.length > 0 &&
    typeof entry.updatedAt === "number" &&
    Number.isFinite(entry.updatedAt)
  );
}

/** 解析存储原始值：null → 空；脏 JSON / 非数组 → 空；形状不符条目过滤（桌面同语义）。 */
function parseSearchHistory(raw: string | null): SearchHistoryEntry[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSearchHistoryEntry) : [];
  } catch {
    return [];
  }
}

/** 读取历史（key 缺省 = ZCode 化单键；storage 不可用回空）。 */
export function loadSearchHistory(
  key: string = MOBILE_SEARCH_HISTORY_STORAGE_KEY,
): SearchHistoryEntry[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    return parseSearchHistory(storage.getItem(key));
  } catch {
    return [];
  }
}

function writeSearchHistory(key: string, entries: SearchHistoryEntry[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(entries));
  } catch {
    // 搜索历史只是快捷入口，localStorage 不可用（隐私模式/配额）时不阻断面板主流程。
  }
}

/**
 * 记录一次搜索（entry = 搜索词原文）：trim 去空 → 大小写不敏感去重（命中条目移到首位并
 * 刷新时间戳，即「去重去旧」）→ 截到 max。返回写后全量，调用方可直接回灌 state。
 */
export function addSearchHistory(
  key: string,
  entry: string,
  max: number = MOBILE_SEARCH_HISTORY_MAX,
): SearchHistoryEntry[] {
  const query = entry.trim();
  const current = loadSearchHistory(key);
  if (!query) {
    return current;
  }
  const dedupeKey = query.toLocaleLowerCase();
  const next = [
    { query, updatedAt: Date.now() },
    ...current.filter((existing) => existing.query.toLocaleLowerCase() !== dedupeKey),
  ].slice(0, max);
  writeSearchHistory(key, next);
  return next;
}

/** 清空历史（第一档面板不暴露入口；与桌面命令中心同款收口，留作后续档位）。 */
export function clearSearchHistory(key: string = MOBILE_SEARCH_HISTORY_STORAGE_KEY): void {
  writeSearchHistory(key, []);
}
