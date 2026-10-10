/**
 * Embedding 端口（W02 / spec §5b.5）。
 *
 * 默认无端口：检索诊断显式 `semantic_unavailable`，词法候选照常返回。
 * 端口实现自带出站授权责任——Drora 默认不注入任何端口 = 零出站（ADR #11）。
 * 接口保持最小：给定文本批次返回等长向量；返回 null/抛错视为不可用（显式降级）。
 */
export interface KnowledgeEmbeddingPort {
  /** 实现标识（如 "noul-embed-v1"）；写入诊断，不外传其他语义。 */
  readonly id: string;
  /** 批量嵌入：返回与入参等长的向量数组；null 或抛错 = 本批不可用（调用方降级）。 */
  embed(texts: string[]): Promise<number[][] | null>;
}

export interface KnowledgeSemanticContext {
  readonly port: KnowledgeEmbeddingPort | null;
}

export function createSemanticContext(port: KnowledgeEmbeddingPort | null = null): KnowledgeSemanticContext {
  return { port };
}

/** 余弦相似度；零向量/维度不齐返回 0（不猜测）。 */
export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let normL = 0;
  let normR = 0;
  for (let index = 0; index < left.length; index++) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    normL += l * l;
    normR += r * r;
  }
  if (normL === 0 || normR === 0) return 0;
  return dot / Math.sqrt(normL * normR);
}
