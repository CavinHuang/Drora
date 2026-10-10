/**
 * Knowledge 索引/检索 RPC 服务实现 + 装配工厂（W02）。
 *
 * - 服务实例只暴露 RPC 面方法（ProxyChannel.fromService 会把一切函数属性
 *   暴露为可调用命令，dispose 句柄绝不挂在实例上）；
 * - 每次调用先 resolveKnowledgeSource（vault-config.json 唯一事实源），
 *   指纹变化自动 epoch+1 并失效旧缓存（spec §5b.2）；
 * - dispose：停心跳 → 释放租约 → 关闭 DB（记入 node.ts sharedSqliteRepos 链）。
 */
import { createServiceLogger } from "../logger/serviceLogger.js";
import { resolveObsidianPluginDataDir } from "../obsidian-vault/obsidianVaultService.js";
import type { VaultConfig } from "../obsidian-vault/config.js";
import { openKnowledgeDatabase, type KnowledgeDatabase } from "./store/knowledgeDatabase.js";
import { IndexCoordinator } from "./index/indexCoordinator.js";
import { QueryOrchestrator } from "./query/queryOrchestrator.js";
import { createSemanticContext, type KnowledgeEmbeddingPort } from "./search/embeddingPort.js";
import { loadCoverage } from "./store/indexRepository.js";
import { resolveKnowledgeDatabasePath, resolveKnowledgeSource } from "./source/sourceRegistry.js";
import type { IKnowledgeIndexService } from "./knowledgeIndex.js";
import type { IKnowledgeQueryService } from "./knowledgeQuery.js";
import type { KnowledgeIndexStatus } from "./knowledgeTypes.js";
import type { KnowledgeCreateRunParams } from "./knowledgeQuery.js";

export interface KnowledgeServicesOptions {
  /** 覆盖 DB 路径（测试用）；生产默认按 Profile 数据根推导。 */
  databasePath?: string;
  /** 覆盖插件数据目录（测试用；生产默认与面板服务同式推导）。 */
  pluginDataDir?: string;
  /** Embedding 端口；缺省 = semantic_unavailable（显式降级，零出站）。 */
  embeddingPort?: KnowledgeEmbeddingPort;
  /** 租约 TTL/心跳（测试可收紧）。 */
  leaseTtlMs?: number;
  heartbeatIntervalMs?: number;
}

export interface KnowledgeServices {
  indexService: IKnowledgeIndexService;
  queryService: IKnowledgeQueryService;
  /** 生命周期：停心跳 → 释放租约 → 关闭 DB（同步，dispose 链安全）。 */
  dispose(): void;
}

export function createKnowledgeServices(options: KnowledgeServicesOptions = {}): KnowledgeServices {
  const logger = createServiceLogger("knowledge");
  const pluginDataDir = options.pluginDataDir ?? resolveObsidianPluginDataDir();
  const db: KnowledgeDatabase = openKnowledgeDatabase(
    options.databasePath ?? resolveKnowledgeDatabasePath(),
  );
  const coordinator = new IndexCoordinator(db, {
    leaseTtlMs: options.leaseTtlMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
  });
  const semantic = createSemanticContext(options.embeddingPort ?? null);
  const orchestrator = new QueryOrchestrator(db, semantic, pluginDataDir);

  const indexService: IKnowledgeIndexService = {
    async getStatus(): Promise<KnowledgeIndexStatus> {
      const source = await resolveKnowledgeSource(db, pluginDataDir, Date.now());
      if (!source.configured || source.summary === null || source.sourceEpoch === null) {
        return {
          configured: false,
          source: null,
          coverage: {
            indexedFiles: 0,
            indexedChunks: 0,
            excludedHidden: 0,
            excludedSymlink: 0,
            excludedNotMarkdown: 0,
            excludedOverSize: 0,
            excludedOverQuota: 0,
            excludedDepth: 0,
            truncatedFiles: 0,
            partial: false,
          },
          job: coordinator.getLatestJobView(),
          lease: coordinator.getLeaseView(),
          semantic: semantic.port ? "available" : "unavailable",
        };
      }
      const coverage = loadCoverage(db, source.summary.vaultId, source.sourceEpoch) ?? {
        indexedFiles: 0,
        indexedChunks: 0,
        excludedHidden: 0,
        excludedSymlink: 0,
        excludedNotMarkdown: 0,
        excludedOverSize: 0,
        excludedOverQuota: 0,
        excludedDepth: 0,
        truncatedFiles: 0,
        partial: false,
      };
      return {
        configured: true,
        source: {
          vaultId: source.summary.vaultId,
          sourceEpoch: source.sourceEpoch,
          displayName: source.summary.displayName,
        },
        coverage,
        job: coordinator.getActiveOrLatestJobView(),
        lease: coordinator.getLeaseView(),
        semantic: semantic.port ? "available" : "unavailable",
      };
    },

    async startReconcile() {
      const source = await requireSource();
      return coordinator.startJob({ kind: "reconcile", ...source, nowMs: Date.now() });
    },

    async requestRebuild() {
      const source = await requireSource();
      return coordinator.startJob({ kind: "rebuild", ...source, nowMs: Date.now() });
    },

    async cancelJob(params) {
      if (!params || typeof params.jobId !== "string" || !params.jobId) {
        throw new Error("jobId 不能为空");
      }
      return coordinator.cancelJob(params.jobId, Date.now());
    },
  };

  const queryService: IKnowledgeQueryService = {
    async createRun(params: KnowledgeCreateRunParams) {
      if (!params || typeof params !== "object") throw new Error("参数非法");
      return orchestrator.createRun(params);
    },
    async search(params) {
      if (!params || typeof params.runId !== "string" || !params.runId) {
        throw new Error("runId 不能为空");
      }
      return orchestrator.search(params);
    },
    async getRun(params) {
      if (!params || typeof params.runId !== "string") return null;
      return orchestrator.getRun(params);
    },
    async cancelRun(params) {
      if (!params || typeof params.runId !== "string" || !params.runId) {
        throw new Error("runId 不能为空");
      }
      return orchestrator.cancelRun(params);
    },
    onRunUpdated: orchestrator.onRunUpdated,
  };

  async function requireSource(): Promise<{
    config: VaultConfig;
    vaultId: string;
    sourceEpoch: number;
  }> {
    const source = await resolveKnowledgeSource(db, pluginDataDir, Date.now());
    if (!source.configured || source.config === null || source.summary === null || source.sourceEpoch === null) {
      throw new Error("尚未配置 Vault：先在 Vault 面板选择或授权一个根目录");
    }
    logger.debug("源就绪", { vaultId: source.summary.vaultId, epoch: source.sourceEpoch });
    return { config: source.config, vaultId: source.summary.vaultId, sourceEpoch: source.sourceEpoch };
  }

  return {
    indexService,
    queryService,
    dispose(): void {
      // 停 run 事件流（检索是易失状态）；心跳定时器已 unref，
      // 租约正常路径由任务 finally 释放，异常路径靠 TTL 过期兜底（W00 spike §4.4）。
      orchestrator.dispose();
      db.close();
    },
  };
}
