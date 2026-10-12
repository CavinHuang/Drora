/**
 * 引用/Evidence 的服务面封装（W03；从 knowledgeServices 拆出收口 max-lines 门禁）。
 *
 * 每次调用先解析当前源（vault-config.json 唯一事实源），再经安全门面建只读 reader；
 * run 的内存视图由调用方注入（orchestrator 持有）。行为契约见 spec §5/§5b.1。
 */
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { createVaultFileReader } from "./evidenceRegistry.js";
import {
  prepareEvidenceFromRun,
  resolveCitationReceipt,
} from "./evidenceRegistry.js";
import { resolveKnowledgeSource } from "../source/sourceRegistry.js";
import type {
  KnowledgePrepareEvidenceParams,
  KnowledgePrepareEvidenceResult,
  KnowledgeResolveCitationParams,
  KnowledgeResolveCitationResult,
  KnowledgeRunView,
} from "../knowledgeTypes.js";

export interface CitationFacade {
  prepareEvidence(params: KnowledgePrepareEvidenceParams): Promise<KnowledgePrepareEvidenceResult>;
  resolveCitation(params: KnowledgeResolveCitationParams): Promise<KnowledgeResolveCitationResult>;
}

export function createCitationFacade(deps: {
  db: KnowledgeDatabase;
  pluginDataDir: string;
  /** run 内存视图的读取口（orchestrator 持有）。 */
  getRun: (params: { runId: string }) => KnowledgeRunView | null;
}): CitationFacade {
  const { db, pluginDataDir, getRun } = deps;
  return {
    async prepareEvidence(
      params: KnowledgePrepareEvidenceParams,
    ): Promise<KnowledgePrepareEvidenceResult> {
      if (!params || typeof params.runId !== "string" || !params.runId) {
        throw new Error("runId 不能为空");
      }
      if (typeof params.articleId !== "string" || !params.articleId) {
        throw new Error("articleId 不能为空");
      }
      const run = getRun({ runId: params.runId });
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
  };
}
