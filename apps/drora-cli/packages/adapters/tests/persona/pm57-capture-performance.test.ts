/**
 * PM57 性能实验 harness（specs/drora-persona-system.md §12；数据合同 §8「百分比不是实测
 * 结果；每类 capture 至少 100 次受控样本」）。
 *
 * 只采集与报告证据，不设达标阈值、不宣称达标（合同 §8「阈值实验前冻结」）；对 capture
 * 读路径（readSnapshot，经生产默认的正式异步 worker 传输）采集受控样本：
 * - worker-cold：首开库——每个样本新开 worker 库（库文件已预建并初始化，等价进程首开）
 *   的 open+首次读；
 * - worker-hot：已开库——同一已开连接的逐次读；
 * - engine-hot（参照组）：在程 engine 的逐次读，用于如实呈现 worker 传输开销，不作结论。
 *
 * 默认跳过（不进常规测试通道的耗时路径）：DRORA_PM57_HARNESS=1 时执行。
 * 运行：DRORA_PM57_HARNESS=1 pnpm --dir apps/drora-cli/packages/adapters exec vitest run
 * tests/persona/pm57-capture-performance.test.ts
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERSONA_STORE_DEFAULTS,
  type PersonaStoreSnapshot,
} from "../../src/storage/persona/contract.js";
import { openPersonaStore } from "../../src/storage/persona/persona-store.js";
import { openWorkerPersonaStore } from "../../src/storage/persona/persona-store-worker-client.js";

const HARNESS_ENABLED = process.env.DRORA_PM57_HARNESS === "1";
/** 每组样本数（合同 §8：≥100 次/类）。 */
const SAMPLES = Number(process.env.DRORA_PM57_SAMPLES ?? "120");

interface Sample {
  readonly latencyMs: number;
  readonly outcome: "applied" | "budget_exhausted" | "error";
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const index = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, index)];
}

function summarize(group: string, samples: Sample[]): Record<string, unknown> {
  const latencies = samples
    .filter((s) => s.outcome === "applied")
    .map((s) => s.latencyMs)
    .sort((a, b) => a - b);
  const byOutcome = { applied: 0, budget_exhausted: 0, error: 0 } as Record<string, number>;
  for (const sample of samples) byOutcome[sample.outcome] += 1;
  const mean = latencies.reduce((sum, v) => sum + v, 0) / Math.max(1, latencies.length);
  return {
    group,
    samples: samples.length,
    outcomes: byOutcome,
    appliedRate: Number((byOutcome.applied / Math.max(1, samples.length)).toFixed(4)),
    latencyMs: {
      min: latencies[0] ?? Number.NaN,
      p50: Number(percentile(latencies, 50).toFixed(3)),
      p95: Number(percentile(latencies, 95).toFixed(3)),
      p99: Number(percentile(latencies, 99).toFixed(3)),
      max: latencies[latencies.length - 1] ?? Number.NaN,
      mean: Number(mean.toFixed(3)),
    },
  };
}

/** 读路径单样本：整体限时＝capture 总预算（合同 §2/§6），超时按 budget_exhausted 计。 */
async function readSample(
  read: () => Promise<PersonaStoreSnapshot>,
  budgetMs: number,
): Promise<Sample> {
  const startedAt = performance.now();
  try {
    const snapshot = await read();
    const latencyMs = performance.now() - startedAt;
    return {
      latencyMs,
      outcome:
        latencyMs <= budgetMs && snapshot.state === "initialized" ? "applied" : "budget_exhausted",
    };
  } catch {
    return { latencyMs: performance.now() - startedAt, outcome: "error" };
  }
}

describe.skipIf(!HARNESS_ENABLED)("PM57 capture 读路径性能实验（只采集证据）", () => {
  it(
    `采集 worker-cold/worker-hot/engine-hot 各 ${SAMPLES} 次受控样本并输出分布`,
    { timeout: 900_000 },
    async () => {
      expect(HARNESS_ENABLED).toBe(true);
      const budgetMs = PERSONA_STORE_DEFAULTS.captureBudgetMs;
      const root = await mkdtemp(join(tmpdir(), "drora-persona-pm57-"));
      try {
        // 预建并初始化库（所有样本读同一份已初始化资料；「冷」指进程首开，不是空库首建）。
        const seededPath = join(root, "personas", "persona.sqlite");
        await mkdir(join(root, "personas"), { recursive: true });
        const seeder = await openPersonaStore({ dbPath: seededPath });
        await seeder.initializeAuthority({
          mutationId: "pm57-seed",
          requestDigest: JSON.stringify(["pm57"]),
          now: 1_760_000_000_000,
          initialCore: {
            displayName: "Drora",
            selfDescription: "",
            warmth: "balanced",
            directness: "direct",
            humor: "light",
          },
          templateVersion: 1,
        });
        await seeder.close();

        const samples: Record<string, Sample[]> = {
          "worker-cold": [],
          "worker-hot": [],
          "engine-hot": [],
        };

        // 冷组：每样本独立首开（open+首次读整体计时；读后即关，不命中任何进程内状态）。
        for (let index = 0; index < SAMPLES; index += 1) {
          const startedAt = performance.now();
          try {
            const store = await openWorkerPersonaStore({ dbPath: seededPath });
            const sample = await readSample(() => store.readSnapshot(), budgetMs);
            await store.close();
            samples["worker-cold"].push({
              latencyMs: performance.now() - startedAt,
              outcome: sample.outcome,
            });
          } catch {
            samples["worker-cold"].push({
              latencyMs: performance.now() - startedAt,
              outcome: "error",
            });
          }
        }

        // 热组（worker）：单连接逐次读。
        const hotWorker = await openWorkerPersonaStore({ dbPath: seededPath });
        for (let index = 0; index < SAMPLES; index += 1) {
          samples["worker-hot"].push(await readSample(() => hotWorker.readSnapshot(), budgetMs));
        }
        await hotWorker.close();

        // 参照组（在程 engine，无 worker 传输）：逐次读。
        const hotEngine = await openPersonaStore({ dbPath: seededPath });
        for (let index = 0; index < SAMPLES; index += 1) {
          samples["engine-hot"].push(await readSample(() => hotEngine.readSnapshot(), budgetMs));
        }
        await hotEngine.close();

        const report = {
          capturedAt: new Date().toISOString(),
          budgetMs,
          samplesPerGroup: SAMPLES,
          environment: {
            platform: process.platform,
            node: process.version,
            cpu: process.env.PROCESSOR_IDENTIFIER ?? "unknown",
          },
          groups: Object.entries(samples).map(([group, groupSamples]) =>
            summarize(group, groupSamples),
          ),
          note: "读路径快照受控样本；不等于完整 capture（含编译/来源复验），不设达标阈值（合同 §8「百分比不是实测结果」）。",
        };
        console.log("[pm57-report]", JSON.stringify(report, null, 2));
        // 只断言采集完整性，不断言任何性能值（无阈值宣称）。
        for (const group of Object.values(samples)) {
          expect(group).toHaveLength(SAMPLES);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
