/**
 * Embedding 端口（W02 / spec §5b.5）。
 *
 * 默认无端口：检索诊断显式 `semantic_unavailable`，词法候选照常返回。
 * 端口实现自带出站授权责任——Drora 默认不注入任何端口 = 零出站（ADR #11）。
 * 接口保持最小：给定文本批次返回等长向量；返回 null/抛错视为不可用（显式降级）。
 */
/** 本地嵌入端口的生命周期状态（spec §5b.9 状态面；出站实现可不提供 status）。 */
export type KnowledgeSemanticPortState = "model_missing" | "downloading" | "ready" | "failed";

export interface KnowledgeSemanticPortStatus {
  state: KnowledgeSemanticPortState;
  /** 最近一次失败的机器可读原因；健康时 null。 */
  lastError: string | null;
}

export interface KnowledgeEmbeddingPort {
  /** 实现标识（如 "noul-embed-v1"）；写入诊断，不外传其他语义。 */
  readonly id: string;
  /** 批量嵌入：返回与入参等长的向量数组；null 或抛错 = 本批不可用（调用方降级）。 */
  embed(texts: string[]): Promise<number[][] | null>;
  /** 状态面（可选，spec §5b.9 状态 RPC 用）：本地实现提供。 */
  status?(): KnowledgeSemanticPortStatus;
  /** 手动就绪（模型下载 + 会话初始化）；长耗时，失败上抛。可选。 */
  ensureReady?(): Promise<void>;
}

/** 服务面状态映射：null 端口 = 功能关闭；无 status 的实现 = 无法确认（按缺模型处理）。 */
export function semanticStatusOf(port: KnowledgeEmbeddingPort | null): KnowledgeSemanticPortStatus {
  if (port === null) return { state: "model_missing", lastError: "semantic_disabled" };
  return port.status?.() ?? { state: "model_missing", lastError: null };
}

/** 服务面状态映射：null 端口 = 功能关闭；无 status 的实现 = 无法确认（按缺模型处理）。 */
export function semanticDownloadViaPort(
  port: KnowledgeEmbeddingPort | null,
): Promise<{ started: boolean; error: string | null }> {
  if (!port?.ensureReady) return Promise.resolve({ started: false, error: "semantic_disabled" });
  return port.ensureReady().then(
    () => ({ started: true, error: null }),
    (error: unknown) => ({
      started: true,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export interface KnowledgeSemanticContext {
  /** 当前端口（getter 实时读——配置热生效换端口后所有持有方即刻可见，spec §5b.9）。 */
  readonly port: KnowledgeEmbeddingPort | null;
  /** 配置热生效换端口（knowledgeSemanticEnabled 开关/模型变更路径）。 */
  setPort(port: KnowledgeEmbeddingPort | null): void;
}

export function createSemanticContext(port: KnowledgeEmbeddingPort | null = null): KnowledgeSemanticContext {
  let current: KnowledgeEmbeddingPort | null = port;
  return {
    get port() {
      return current;
    },
    setPort(next: KnowledgeEmbeddingPort | null): void {
      current = next;
    },
  };
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
