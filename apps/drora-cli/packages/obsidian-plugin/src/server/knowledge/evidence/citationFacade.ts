// 迁自 packages/services/src/knowledge/evidence/citationFacade.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * 引用/Evidence 的服务面封装（W03；从 knowledgeServices 拆出收口 max-lines 门禁）。
 *
 * 每次调用先解析当前源（vault-config.json 唯一事实源），再经安全门面建只读 reader；
 * run 的内存视图由调用方注入（orchestrator 持有）。行为契约见 spec §5/§5b.1。
 */
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";
import { createVaultFileReader } from "./evidenceRegistry.js";
import { prepareEvidenceFromRun, resolveCitationReceipt } from "./evidenceRegistry.js";
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
