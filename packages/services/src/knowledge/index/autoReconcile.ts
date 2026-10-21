/**
 * 索引自动 reconcile 控制器（spec §5b.8；从 knowledgeServices 拆出收口 max-lines 门禁）。
 *
 * fire-and-forget：与手动触发走同一 startJob（alreadyRunning 幂等，lease/fence 不变）；
 * 未配置源静默跳过；任何失败只记日志，绝不传播到 search/装配调用方。
 */
import type { IndexCoordinator } from "./indexCoordinator.js";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { resolveKnowledgeSource } from "../source/sourceRegistry.js";

export interface AutoReconcileController {
  /** search 入口的 TTL 门：无 running job 且最近完成 reconcile 超过 TTL 才触发。 */
  onSearch(): void;
  /** 清理延迟定时器（dispose 链同步调用）。 */
  dispose(): void;
}

export function createAutoReconcileController(deps: {
  db: KnowledgeDatabase;
  coordinator: IndexCoordinator;
  pluginDataDir: string;
  enabled: boolean;
  staleTtlMs?: number;
  initialDelayMs?: number;
  logger: {
    info(message: string, details?: Record<string, unknown>): void;
    warn(message: string, details?: Record<string, unknown>): void;
  };
}): AutoReconcileController {
  const { db, coordinator, pluginDataDir, enabled, logger } = deps;
  const staleTtlMs = deps.staleTtlMs ?? 10 * 60_000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(): void {
    if (!enabled) return;
    void (async () => {
      try {
        const source = await resolveKnowledgeSource(db, pluginDataDir, Date.now());
        if (
          !source.configured ||
          source.config === null ||
          source.summary === null ||
          source.sourceEpoch === null
        ) {
          return;
        }
        const started = coordinator.startJob({
          kind: "reconcile",
          config: source.config,
          vaultId: source.summary.vaultId,
          sourceEpoch: source.sourceEpoch,
          nowMs: Date.now(),
        });
        logger.info("自动索引已触发", {
          jobId: started.jobId,
          alreadyRunning: started.alreadyRunning,
        });
      } catch (error) {
        logger.warn("自动索引触发失败（不阻塞调用方）", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  if (enabled) {
    timer = setTimeout(schedule, deps.initialDelayMs ?? 4_000);
    timer.unref?.();
  }

  return {
    onSearch(): void {
      if (!enabled) return;
      const latest = coordinator.getActiveOrLatestJobView();
      if (latest !== null && latest.status === "running") return;
      const finishedAtMs = latest?.finishedAtMs;
      if (typeof finishedAtMs === "number" && Date.now() - finishedAtMs < staleTtlMs) return;
      schedule();
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
