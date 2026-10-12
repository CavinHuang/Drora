/**
 * 洞察视图纯模型（spec §5g.6）。
 *
 * 覆盖排除明细的呈现顺序、轮询窗口派生、时长格式化——纯函数，供组件与单测共用；
 * 数据事实全部来自 getInsights 快照（host 端聚合，spec §5g.1），此处零派生事实。
 */
import type { KnowledgeCoverage, KnowledgeInsightsSnapshot } from "@drora/services";

/** 与 ask 视图 job 轮询同间隔（1.5s）；进行中 job 离场即停。 */
export const INSIGHTS_POLL_INTERVAL_MS = 1500;

export interface InsightCoverageExclusion {
  /** i18n 键后缀（`vault.insights.exclude.<key>`，两语言字典各有全量成员）。 */
  key: "hidden" | "symlink" | "notMarkdown" | "overSize" | "overQuota" | "depth" | "truncated";
  count: number;
}

/** 覆盖排除明细的固定呈现顺序（spec §5g.3：hidden→symlink→非md→超限→配额→深度→截断）。 */
type ExclusionField =
  | "excludedHidden"
  | "excludedSymlink"
  | "excludedNotMarkdown"
  | "excludedOverSize"
  | "excludedOverQuota"
  | "excludedDepth"
  | "truncatedFiles";

const COVERAGE_EXCLUSION_FIELDS: ReadonlyArray<[InsightCoverageExclusion["key"], ExclusionField]> =
  [
    ["hidden", "excludedHidden"],
    ["symlink", "excludedSymlink"],
    ["notMarkdown", "excludedNotMarkdown"],
    ["overSize", "excludedOverSize"],
    ["overQuota", "excludedOverQuota"],
    ["depth", "excludedDepth"],
    ["truncated", "truncatedFiles"],
  ];

/** 只列非零排除项；全零返回空数组（组件呈现「完整」，不渲染零计数噪声）。 */
export function nonZeroCoverageExclusions(coverage: KnowledgeCoverage): InsightCoverageExclusion[] {
  return COVERAGE_EXCLUSION_FIELDS.flatMap(([key, field]) => {
    const count = coverage[field];
    return count > 0 ? [{ key, count }] : [];
  });
}

/** recentJobs 存在 running 条目 → 轮询窗口开启（spec §5g.6；快照为空/离场即停）。 */
export function deriveInsightsPolling(snapshot: KnowledgeInsightsSnapshot | null): boolean {
  return snapshot?.recentJobs.some((job) => job.status === "running") ?? false;
}

/**
 * 时长格式化（locale 无关数字 + 通用单位）：进行中为空串（组件另呈「进行中」态）；
 * <1s 显示毫秒；<60s 显示秒（一位小数）；其余分钟 + 秒。
 */
export function formatInsightsDuration(durationMs: number | null): string {
  if (durationMs === null) return "";
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60)
    return `${Number.isInteger(seconds) ? seconds : Math.round(seconds * 10) / 10}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return restSeconds > 0 ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
}
