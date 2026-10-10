/**
 * 离线评测指标（W05 / spec §5d.8）。
 *
 * 纯函数，逐个可单测。真值永远来自人工标注（relevantArticles / hasAnswer），
 * Jev 自身评分不作为真值（EVAL_DATASET_SPEC）。
 */

/** Recall@K：相关文章进入前 K 名的比例（按标注文章数归一，无标注样例不计分母）。 */
export function recallAtK(
  rankedArticlePaths: string[],
  relevantPaths: ReadonlySet<string>,
  k: number,
): number | null {
  if (relevantPaths.size === 0) return null;
  const topK = rankedArticlePaths.slice(0, k);
  let found = 0;
  for (const path of topK) {
    if (relevantPaths.has(path)) found += 1;
  }
  return found / relevantPaths.size;
}

/** Hit@K：前 K 名内是否出现任一相关文章（0/1）。 */
export function hitAtK(
  rankedArticlePaths: string[],
  relevantPaths: ReadonlySet<string>,
  k: number,
): number | null {
  if (relevantPaths.size === 0) return null;
  return rankedArticlePaths.slice(0, k).some((path) => relevantPaths.has(path)) ? 1 : 0;
}

/** MRR：第一个相关文章名次的倒数（无命中 = 0）。 */
export function reciprocalRank(
  rankedArticlePaths: string[],
  relevantPaths: ReadonlySet<string>,
): number | null {
  if (relevantPaths.size === 0) return null;
  const index = rankedArticlePaths.findIndex((path) => relevantPaths.has(path));
  return index === -1 ? 0 : 1 / (index + 1);
}

/**
 * No-answer FP 的单样例判定：无答案样本上系统是否「宣布找到」。
 * 宣布 = 返回了候选且决策动作不是 NO_RELIABLE_MATCH（off/无决策时 = 返回了候选）。
 */
export function isNoAnswerFalsePositive(declared: boolean): boolean {
  return declared;
}

/** 证据精度（可选 chunk 标注）：top-1 候选 chunk 是否属于标注的相关 chunk 集合。 */
export function evidencePrecisionTop1(
  top1ChunkSha256: string | null,
  relevantChunkShas: ReadonlySet<string>,
): boolean | null {
  if (relevantChunkShas.size === 0 || top1ChunkSha256 === null) return null;
  return relevantChunkShas.has(top1ChunkSha256);
}

/** 最近邻位百分位（nearest-rank；输入须非空）。P95 = 第 ceil(0.95×n) 个升序样本。 */
export function percentileNearestRank(values: number[], p: number): number {
  if (values.length === 0) throw new Error("百分位计算需要非空样本");
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 聚合工具：忽略 null（未标注样例不进分母），全 null 返回 null。 */
export function averageNonNull(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return mean(present);
}
