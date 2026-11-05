/**
 * auto 信任门（04 详设 §2；spec §6 P4 落地注记）。
 *
 * 统计口径（单一事实源=admission_decision 表实时 SQL，与快照 trust 同一查询）：
 *   releaseRate = 人工放行数 /（would_accept 数 + 人工放行数）
 *   样本数 = would_accept 数 + 人工放行数
 * kv `trust_gate_stats` 是 watchdog 同轮落账的**审计投影**（跨重启可查当时的判定输入），
 * setMode("auto") 判定读实时 counts，不读 kv——不建第二条判定路径。
 *
 * 阈值 kv 可调（`trust_gate_min_rate`/`trust_gate_min_samples`；坏/缺值逐键回落
 * ASSISTANT_TRUST_GATE_DEFAULTS，照 readAssistantConfig 纪律）。
 *
 * 纯模块：无 IO（raw 连接由调用方传入，事务纪律归服务/watchdog 闭包）。
 */
import {
  ASSISTANT_OUTCOMES,
  ASSISTANT_TRUST_GATE_DEFAULTS,
} from "@drora/shared";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";

/** kv 配置键（mate.sqlite kv 表；键名即 kv.key 字面量，单出处；模块内自产自读）。 */
export const ASSISTANT_TRUST_GATE_KV_KEYS = {
  /** watchdog 同轮落账的统计审计投影（JSON）。 */
  stats: "trust_gate_stats",
  /** 放行率开放线（数字字符串；0~1）。 */
  minRate: "trust_gate_min_rate",
  /** 样本数开放线（整数字符串）。 */
  minSamples: "trust_gate_min_samples",
} as const;

/** 信任门统计（放行率+样本数；判定输入）。 */
export interface AssistantTrustStats {
  readonly wouldAcceptCount: number;
  readonly releaseCount: number;
  /** releaseCount/(wouldAcceptCount+releaseCount)；分母 0 恒 0（不猜测）。 */
  readonly releaseRate: number;
  readonly sampleCount: number;
}

/** 信任门生效阈值（kv 覆盖后的当前值）。 */
export interface AssistantTrustGateThresholds {
  readonly minRate: number;
  readonly minSamples: number;
}

/** admission_decision 实时 counts → 统计（快照 trust 与 setMode 判定共用同一函数）。 */
export function computeTrustStats(counts: {
  wouldAcceptCount: number;
  releaseCount: number;
}): AssistantTrustStats {
  const sampleCount = counts.wouldAcceptCount + counts.releaseCount;
  const releaseRate =
    sampleCount > 0 ? counts.releaseCount / sampleCount : 0;
  return {
    wouldAcceptCount: counts.wouldAcceptCount,
    releaseCount: counts.releaseCount,
    releaseRate,
    sampleCount,
  };
}

/** 台账实时 counts（与 assistantSnapshot trust 两段 COUNT 同口径，收口一处）。 */
export function readTrustCounts(raw: AssistantDatabaseRaw): {
  wouldAcceptCount: number;
  releaseCount: number;
} {
  const wouldAcceptCount = (
    raw
      .prepare("SELECT COUNT(*) AS n FROM admission_decision WHERE outcome = ?")
      .get(ASSISTANT_OUTCOMES.wouldAccept) as { n: number }
  ).n;
  const releaseCount = (
    raw
      .prepare(
        "SELECT COUNT(*) AS n FROM admission_decision WHERE outcome = ? AND decided_by = ?",
      )
      .get(ASSISTANT_OUTCOMES.decisionCard, "user") as { n: number }
  ).n;
  return { wouldAcceptCount, releaseCount };
}

/** 阈值读取（坏/缺值逐键回落缺省：非有限数/越界不采纳，不猜测）。 */
export function readTrustGateThresholds(
  kvGet: (key: string) => string | undefined,
): AssistantTrustGateThresholds {
  let minRate: number = ASSISTANT_TRUST_GATE_DEFAULTS.minReleaseRate;
  const rateRaw = kvGet(ASSISTANT_TRUST_GATE_KV_KEYS.minRate);
  if (rateRaw !== undefined) {
    const parsed = Number(rateRaw);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
      minRate = parsed;
    }
  }
  let minSamples: number = ASSISTANT_TRUST_GATE_DEFAULTS.minSamples;
  const samplesRaw = kvGet(ASSISTANT_TRUST_GATE_KV_KEYS.minSamples);
  if (samplesRaw !== undefined) {
    const parsed = Number(samplesRaw);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      minSamples = parsed;
    }
  }
  return { minRate, minSamples };
}

/** 开放判定（04 详设 §2：releaseRate ≥ 阈值 且 样本 ≥ 阈值）。 */
export function isTrustGateOpen(
  stats: Pick<AssistantTrustStats, "releaseRate" | "sampleCount">,
  thresholds: AssistantTrustGateThresholds,
): boolean {
  return stats.releaseRate >= thresholds.minRate && stats.sampleCount >= thresholds.minSamples;
}

/** setMode("auto") 的一次性判定（实时 counts + kv 阈值；single 口径，服务与测试共用）。 */
export function isAssistantTrustGateSatisfied(raw: AssistantDatabaseRaw): {
  readonly open: boolean;
  readonly stats: AssistantTrustStats;
  readonly thresholds: AssistantTrustGateThresholds;
} {
  const stats = computeTrustStats(readTrustCounts(raw));
  const kvGet = (key: string) => {
    const row = raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  };
  const thresholds = readTrustGateThresholds(kvGet);
  return { open: isTrustGateOpen(stats, thresholds), stats, thresholds };
}

/** watchdog 同轮落账的审计投影读取（坏/缺值 → null，不猜测）。 */
export function readTrustGateStatsRecord(
  raw: AssistantDatabaseRaw,
): { releaseRate: number; sampleCount: number; updatedAtMs: number } | null {
  const row = raw
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(ASSISTANT_TRUST_GATE_KV_KEYS.stats) as { value: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as {
      releaseRate?: unknown;
      sampleCount?: unknown;
      updatedAtMs?: unknown;
    };
    if (
      typeof parsed.releaseRate === "number" &&
      typeof parsed.sampleCount === "number" &&
      typeof parsed.updatedAtMs === "number"
    ) {
      return {
        releaseRate: parsed.releaseRate,
        sampleCount: parsed.sampleCount,
        updatedAtMs: parsed.updatedAtMs,
      };
    }
    return null;
  } catch {
    return null;
  }
}
