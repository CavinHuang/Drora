import type { IModelCapabilitiesService } from "../model-capabilities/index.js";
import type { KnowledgeEmbeddingPort } from "../knowledge/search/embeddingPort.js";
import { resolveKnowledgeJevAssembly } from "../knowledge/decision/jevAssembly.js";
import {
  createLocalEmbeddingPort,
  resolveKnowledgeModelRoot,
} from "../knowledge/search/localEmbeddingPort.js";

/**
 * 知识扩展的 Host 装配；解析失败保持零出站的词法模式。
 *
 * 数据源（specs/model-capabilities.md §9 批次一）：Jev 开关/提供商/端点/模型与语义
 * 开关读模型能力档案（ModelCapabilitiesService 唯一所有者），不再读 AppSettings
 * 的 knowledgeJev 系列与 knowledgeSemanticEnabled（旧键已一次性迁移，spec §3.3）。
 */
export async function assembleDroraKnowledgeHost(
  modelCapabilitiesService: IModelCapabilitiesService,
  logger: { warn(...args: unknown[]): void },
  /** §13 附带：settings.httpProxy 读取器（hf 镜像直连被墙环境经代理下载模型）。 */
  readHttpProxy?: () => Promise<string | undefined>,
) {
  // Jev 配置动态源（obsidian-knowledge.md §5d.10 配置热生效）：解析闭包携带
  // 档案服务，每个决策 stage 解析当前装配——配置变更即时生效（免重启）。
  // 解析失败（如凭据文件损坏）只降级为功能关闭，绝不阻断 Host 初始化。
  type JevAssemblyResult = Awaited<ReturnType<typeof resolveKnowledgeJevAssembly>>;
  const knowledgeJevConfigSource = async (): Promise<JevAssemblyResult> => {
    try {
      const snapshot = await modelCapabilitiesService.get();
      return await resolveKnowledgeJevAssembly({
        modelCapabilities: snapshot.capabilities,
      });
    } catch (error) {
      logger.warn("[host] Jev 配置解析失败，本轮功能关闭", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  // 本地语义端口动态源（obsidian-knowledge.md §5b.9 配置热生效 + specs/model-
  // capabilities.md §4）：按当前档案 embedding.enabled 解析（enabled → lazy 本地
  // 端口，构造不 IO，首次 embed 才下载/建会话，推理零出站；disabled/解析失败 →
  // null 纯词法）。refreshDecisionConfig 热切换端口；失败降级不阻断 refresh。
  const knowledgeSemanticSource = async (): Promise<KnowledgeEmbeddingPort | null> => {
    try {
      const snapshot = await modelCapabilitiesService.get();
      if (snapshot.capabilities.embedding.enabled !== true) {
        return null;
      }
      const httpProxy = readHttpProxy
        ? (await readHttpProxy().catch(() => undefined))?.trim()
        : undefined;
      return createLocalEmbeddingPort({
        modelRoot: resolveKnowledgeModelRoot(),
        logger: { warn: (message, details) => logger.warn(message, details) },
        ...(httpProxy ? { httpProxy } : {}),
      });
    } catch (error) {
      logger.warn("[host] 语义检索端口解析失败，保持纯词法", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  // 初始化期预构建（既有语义）：与 refresh 同一解析路径，失败已在源内降级。
  const knowledgeEmbeddingPort = await knowledgeSemanticSource();
  return {
    knowledgeJevConfigSource,
    knowledgeSemanticSource,
    knowledgeEmbeddingPort,
    knowledgeAutoIndex: true,
  };
}
