import type { ISettingService } from "../setting/setting.js";
import type { KnowledgeEmbeddingPort } from "../knowledge/search/embeddingPort.js";
import { resolveKnowledgeJevAssembly } from "../knowledge/decision/jevAssembly.js";
import {
  createLocalEmbeddingPort,
  resolveKnowledgeModelRoot,
} from "../knowledge/search/localEmbeddingPort.js";

/** 知识扩展的 Host 装配；解析失败保持零出站的词法模式。 */
export async function assembleDroraKnowledgeHost(
  settingService: ISettingService,
  logger: { warn(...args: unknown[]): void },
) {
  // Jev 配置动态源（obsidian-knowledge.md §5d.10 配置热生效）：解析闭包携带
  // settingService，每个决策 stage 解析当前装配——配置变更即时生效（免重启）。
  // 解析失败（如凭据文件损坏）只降级为功能关闭，绝不阻断 Host 初始化。
  type JevAssemblyResult = Awaited<ReturnType<typeof resolveKnowledgeJevAssembly>>;
  const knowledgeJevConfigSource = async (): Promise<JevAssemblyResult> => {
    try {
      return await resolveKnowledgeJevAssembly({ settingService });
    } catch (error) {
      logger.warn("[host] Jev 配置解析失败，本轮功能关闭", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  // 本地语义检索端口（obsidian-knowledge.md §5b.9）：开关开启才注入 lazy 端口
  // （构造不 IO，首次 embed 才下载/建会话，推理零出站）。读取失败只降级为纯词法。
  let knowledgeEmbeddingPort: KnowledgeEmbeddingPort | null = null;
  try {
    if ((await settingService.get()).knowledgeSemanticEnabled === true) {
      knowledgeEmbeddingPort = createLocalEmbeddingPort({
        modelRoot: resolveKnowledgeModelRoot(),
        logger: { warn: (message, details) => logger.warn(message, details) },
      });
    }
  } catch (error) {
    logger.warn("[host-init] 语义检索端口预构建失败，保持纯词法", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { knowledgeJevConfigSource, knowledgeEmbeddingPort, knowledgeAutoIndex: true };
}
