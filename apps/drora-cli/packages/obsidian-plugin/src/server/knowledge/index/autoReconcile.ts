// 迁自 packages/services/src/knowledge/index/autoReconcile.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
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
