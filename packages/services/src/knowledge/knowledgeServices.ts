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
import { QueryOrchestrator, type KnowledgeDecisionContext } from "./query/queryOrchestrator.js";
import { createSemanticContext, type KnowledgeEmbeddingPort } from "./search/embeddingPort.js";
import { loadCoverage } from "./store/indexRepository.js";
import { resolveKnowledgeDatabasePath, resolveKnowledgeSource } from "./source/sourceRegistry.js";
import {
  createVaultFileReader,
  prepareEvidenceFromRun,
  resolveCitationReceipt,
} from "./evidence/evidenceRegistry.js";
import { DecisionConsentRegistry } from "./decision/decisionConsent.js";
import { DecisionCache } from "./decision/decisionCache.js";
import { DecisionTelemetry } from "./decision/decisionTelemetry.js";
import { DecisionPipeline } from "./decision/decisionPipeline.js";
import { resolvePolicyConfig } from "./decision/decisionPolicy.js";
import { createKnowledgeReviewService } from "./review/reviewEngine.js";
import type { KnowledgeDecisionProvider, KnowledgeDecisionPolicyConfig } from "./decision/decisionTypes.js";
import type { IKnowledgeIndexService } from "./knowledgeIndex.js";
import type { IKnowledgeQueryService } from "./knowledgeQuery.js";
import type { IKnowledgeReviewService } from "./review/reviewService.js";
import type {
  KnowledgeIndexStatus,
  KnowledgePrepareEvidenceParams,
  KnowledgePrepareEvidenceResult,
  KnowledgeResolveCitationParams,
  KnowledgeResolveCitationResult,
} from "./knowledgeTypes.js";
import type { KnowledgeCreateRunParams, KnowledgeSearchParams } from "./knowledgeQuery.js";

export interface KnowledgeServicesOptions {
  /** 覆盖 DB 路径（测试用）；生产默认按 Profile 数据根推导。 */
  databasePath?: string;
  /** 覆盖插件数据目录（测试用；生产默认与面板服务同式推导）。 */
  pluginDataDir?: string;
  /** Embedding 端口；缺省 = semantic_unavailable（显式降级，零出站）。 */
  embeddingPort?: KnowledgeEmbeddingPort;
  /**
   * Jev 决策 provider（W05 §5d）；**缺省 = 功能关闭**（零出站，grant 返回 disabled）。
   * 注入即代表 Host 侧已完成 feature flag 与安全凭证配置（ADR #5/#11）。
   * 适合不需要逐调用授权重查的 provider（本地 stub/评测 reranker）。
   */
  decisionProvider?: KnowledgeDecisionProvider;
  /**
   * provider 工厂（优先于 decisionProvider）：接收服务自有授权账本，供出站 provider
   * （JevAdapter）做「实际调用前逐候选重查」——**出站实现必须走工厂**，否则逐调用
   * 重查落在与授权账本不同的实例上（fail-closed 失效）。
   */
  decisionProviderFactory?: (deps: {
    consentRegistry: DecisionConsentRegistry;
    config: KnowledgeDecisionPolicyConfig;
  }) => KnowledgeDecisionProvider;
  /** 决策策略覆写（阈值/预算/权重；实验初值见 DEFAULT_DECISION_POLICY）。 */
  decisionPolicyOverrides?: Partial<KnowledgeDecisionPolicyConfig>;
  /**
   * 审核写路径总门（W06 修复轮 1）：**生产装配（node.ts）绝不传——保持缺省 false**，
   * S03 Hard Write Safety GO 门禁未满足前 apply/undo 返回 `write_path_disabled`
   * （见 docs/vaultview/delivery/WRITE_SAFETY_NO_GO.md）。仅测试环境显式置 true。
   */
  reviewWritePathEnabled?: boolean;
  /** 租约 TTL/心跳（测试可收紧）。 */
  leaseTtlMs?: number;
  heartbeatIntervalMs?: number;
}

export interface KnowledgeServices {
  indexService: IKnowledgeIndexService;
  queryService: IKnowledgeQueryService;
  /**
   * 审核写入服务（W06 §5e）：L2 治理写唯一入口。与索引/检索共享同一 DB 连接与
   * 同一份 vault-config.json 推导；账本四表不在任何索引清除路径上。
   */
  reviewService: IKnowledgeReviewService;
  /**
   * 决策上下文（W05；关闭时 null）。**绝不挂到 queryService 上**——RPC 面只暴露
   * 接口方法（ProxyChannel.fromService 会把一切函数属性暴露为命令）；
   * telemetry 快照供评测/测试观察 A23。
   */
  decision: KnowledgeDecisionContext | null;
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

  // 决策上下文（W05）：管线恒在（provider 可为 null → off 分支产出零出站诊断，A23）。
  const config = resolvePolicyConfig(options.decisionPolicyOverrides);
  const registry = new DecisionConsentRegistry();
  const cache = new DecisionCache(config.cacheMaxEntries);
  const telemetry = new DecisionTelemetry();
  const provider = options.decisionProviderFactory
    ? options.decisionProviderFactory({ consentRegistry: registry, config })
    : (options.decisionProvider ?? null);
  const pipeline = new DecisionPipeline({
    provider,
    config,
    consentRegistry: registry,
    cache,
    telemetry,
  });
  const decision: KnowledgeDecisionContext = {
    provider,
    pipeline,
    registry,
    cache,
    telemetry,
    config,
  };

  const orchestrator = new QueryOrchestrator(db, semantic, pluginDataDir, decision);

  // 审核写入服务（W06）：与索引/检索共享同一 DB 连接；账本随 dispose 统一关闭。
  // 写路径总门默认关闭（S03 门禁未满足，WRITE_SAFETY_NO_GO.md）；生产装配不透传使能。
  const reviewService = createKnowledgeReviewService({
    db,
    pluginDataDir,
    writePathEnabled: options.reviewWritePathEnabled === true,
  });

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
    async search(params: KnowledgeSearchParams) {
      if (!params || typeof params.runId !== "string" || !params.runId) {
        throw new Error("runId 不能为空");
      }
      if (params.decisionConsentId !== undefined && typeof params.decisionConsentId !== "string") {
        throw new Error("decisionConsentId 非法");
      }
      return orchestrator.search(params);
    },
    async grantDecisionConsent(params: { runId: string; candidateIds?: string[] }) {
      if (!params || typeof params.runId !== "string" || !params.runId) {
        throw new Error("runId 不能为空");
      }
      return orchestrator.grantDecisionConsent(params);
    },
    async revokeDecisionConsent(params: { consentId: string }) {
      if (!params || typeof params.consentId !== "string" || !params.consentId) {
        throw new Error("consentId 不能为空");
      }
      return orchestrator.revokeDecisionConsent(params);
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
    async prepareEvidence(
      params: KnowledgePrepareEvidenceParams,
    ): Promise<KnowledgePrepareEvidenceResult> {
      if (!params || typeof params.runId !== "string" || !params.runId) {
        throw new Error("runId 不能为空");
      }
      if (typeof params.articleId !== "string" || !params.articleId) {
        throw new Error("articleId 不能为空");
      }
      const run = orchestrator.getRun({ runId: params.runId });
      const source = await resolveKnowledgeSource(db, pluginDataDir, Date.now());
      const rootPath = source.config?.rootPath ?? null;
      const reader = rootPath ? createVaultFileReader(rootPath) : null;
      return prepareEvidenceFromRun({
        db,
        run,
        articleId: params.articleId,
        source,
        readVaultFile: reader ? reader.read : async () => null,
        nowMs: Date.now(),
      });
    },
    async resolveCitation(
      params: KnowledgeResolveCitationParams,
    ): Promise<KnowledgeResolveCitationResult> {
      if (!params || typeof params.receiptId !== "string" || !params.receiptId) {
        throw new Error("receiptId 不能为空");
      }
      const source = await resolveKnowledgeSource(db, pluginDataDir, Date.now());
      const rootPath = source.config?.rootPath ?? null;
      const reader = rootPath ? createVaultFileReader(rootPath) : null;
      return resolveCitationReceipt({
        db,
        receiptId: params.receiptId,
        sessionId: typeof params.sessionId === "string" ? params.sessionId : null,
        source,
        readVaultFile: reader ? reader.read : async () => null,
      });
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
    reviewService,
    decision,
    dispose(): void {
      // 停 run 事件流（检索是易失状态）；心跳定时器已 unref，
      // 租约正常路径由任务 finally 释放，异常路径靠 TTL 过期兜底（W00 spike §4.4）。
      orchestrator.dispose();
      db.close();
    },
  };
}
