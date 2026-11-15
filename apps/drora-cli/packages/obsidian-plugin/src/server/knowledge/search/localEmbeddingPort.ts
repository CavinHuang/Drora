// 迁自 packages/services/src/knowledge/search/localEmbeddingPort.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄；④2026-11-14 终验修复（spec obsidian-knowledge.md
// §5b.9 同日修订）：ensureRuntime 失败后由「立即清 promise（下次使用重试）」改为
// **失败冷却**——原语义在离线环境使 reconcile 逐文档嵌入/尾部回填/每次查询各自重试
// 整轮镜像下载（2 镜像 × 2 文件 × 单镜像 120s 超时上限），job 爬行至分钟级且
// vaultUiResources N1 用例 30s 轮询超时；现冷却期内 embed 快速失败不出站，ensureReady
// （手动下载）显式重试不受冷却限制。本体原件已于 P7 拆除，本文件为唯一实现。
// 双轨期（P3-P7）本体原件仍在 packages/services 原位由旧 host 装配（P7 拆除），两实现
// 共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁（§3/§6-g8，原样随迁不进程内化）。
/**
 * 本地嵌入端口实现（spec §5b.9，route A：零出站语义召回）。
 *
 * 模型：BAAI/bge-small-zh-v1.5 的 Xenova ONNX int8 量化版（BERT 词表 + CLS 池化 +
 * L2 归一）。运行时 onnxruntime-node **动态 import**（缺模块 = 端口不可用降级）；
 * 模型文件**首次使用时下载**（镜像清单逐个尝试 + 尺寸界校验，sha256 写日志待发布
 * 前 pin），落盘 `<modelRoot>/bge-small-zh-v1.5/`。
 *
 * 惰性初始化：构造不加载任何东西（createLocalServices 同步约束），首次 embed 时
 * 才下载/建会话；之后会话复用。任何初始化/推理失败都以「本批不可用」上抛或返回
 * null——调用方既有降级语义（词法照常）。纯本地推理，零出站（ADR #11）。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDroraDataRootDir } from "../../platform/dataPaths.js";
import type {
  KnowledgeEmbeddingPort,
  KnowledgeSemanticPortState,
  KnowledgeSemanticPortStatus,
} from "./embeddingPort.js";

export const LOCAL_EMBEDDING_MODEL_ID = "local-bge-small-zh-v1.5-int8";
const MODEL_DIR_NAME = "bge-small-zh-v1.5";

/** 模型根目录（与知识索引库同一数据根，spec §5b.9）；装配方经 node 入口取用。 */
export function resolveKnowledgeModelRoot(): string {
  return join(getDroraDataRootDir(), "knowledge", "models");
}
/** token 上限（含 [CLS]/[SEP]）；bge 系模型训练口径 512。 */
const MAX_SEQUENCE_TOKENS = 512;
/** 单次推理批大小：CPU 上保守取小批，避免长尾延迟尖峰。 */
const INFERENCE_BATCH = 8;
/** 特殊 token id：BERT 词表标准布局（[UNK]=100 / [CLS]=101 / [SEP]=102）。 */
const UNK_ID = 100;
const CLS_ID = 101;
const SEP_ID = 102;
/** 下载校验的尺寸界（字节）：越界即弃（sha256 pin 待发布前补，见 spec §5b.9）。 */
const SIZE_BOUNDS: ReadonlyArray<{ file: string; min: number; max: number }> = [
  { file: "model_quantized.onnx", min: 5 * 1024 * 1024, max: 60 * 1024 * 1024 },
  { file: "vocab.txt", min: 100 * 1024, max: 2 * 1024 * 1024 },
];
/** 镜像清单（逐文件逐镜像尝试；后续可插 ModelScope 等国内源）。 */
const MIRRORS: ReadonlyArray<{ name: string; baseUrl: string }> = [
  { name: "hf-mirror", baseUrl: "https://hf-mirror.com/Xenova/bge-small-zh-v1.5/resolve/main" },
  { name: "huggingface", baseUrl: "https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/main" },
];

interface OnnxTensor {
  new (type: string, data: unknown, dims: number[]): unknown;
}
interface OnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** 释放会话与底层原生资源（onnxruntime-common InferenceSession.release 契约）。 */
  release(): Promise<void>;
  inputNames: string[];
  outputNames: string[];
}
interface OnnxRuntime {
  Tensor: OnnxTensor;
  InferenceSession: { create(path: string): Promise<OnnxSession> };
}
interface RuntimeState {
  ort: OnnxRuntime;
  session: OnnxSession;
  vocab: Map<string, number>;
  outputName: string;
}

export interface LocalEmbeddingPortOptions {
  /** 模型根目录（装配方传入，如 `<pluginDataDir>/knowledge/models`）。 */
  modelRoot: string;
  /** 下载/降级日志面（host logger）。 */
  logger?: { warn(message: string, details?: Record<string, unknown>): void };
  /** 下载实现（缺省全局 fetch；测试注入假实现）。 */
  /** §13：settings.httpProxy 注入（hf 镜像直连被墙环境经代理下载）。 */
  httpProxy?: string;
  fetchImpl?: typeof fetch;
  /**
   * 下载/初始化失败冷却时长（毫秒；spec §5b.9 2026-11-14 修订）。缺省 10 分钟（对齐
   * §5b.8 autoReconcile 陈旧 TTL）；测试注入收紧以覆盖冷却到期重试分支。
   */
  failureCooldownMs?: number;
}

/** BERT 基础切分：小写化后，CJK 逐字、ASCII 词串整体、空白分隔、标点逐个成词。 */
function basicTokenize(text: string): string[] {
  const lowered = text.toLowerCase();
  const tokens: string[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer) {
      tokens.push(buffer);
      buffer = "";
    }
  };
  for (const char of lowered) {
    const code = char.codePointAt(0) ?? 0;
    if (isCjk(code)) {
      flush();
      tokens.push(char);
    } else if (/^[a-z0-9]$/.test(char)) {
      buffer += char;
    } else if (/\s/.test(char)) {
      flush();
    } else {
      flush();
      tokens.push(char);
    }
  }
  flush();
  return tokens;
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

/** WordPiece 贪心最长匹配：整词命中或 ## 续片；任一位置失败 → [UNK]。 */
function wordPiece(word: string, vocab: Map<string, number>, out: number[]): void {
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let matched: number | null = null;
    while (start < end) {
      const candidate = (start === 0 ? "" : "##") + word.slice(start, end);
      const id = vocab.get(candidate);
      if (id !== undefined) {
        matched = id;
        break;
      }
      end -= 1;
    }
    if (matched === null) {
      out.push(UNK_ID);
      return;
    }
    out.push(matched);
    start = end;
  }
}

/** 内容 token 的单窗口容量（512 减去 [CLS]/[SEP]）。 */
const CONTENT_TOKENS_PER_WINDOW = MAX_SEQUENCE_TOKENS - 2;

/** 编码单条文本：基础切分 → WordPiece → [CLS] + 内容 + [SEP]（单窗）。 */
export function encodeForBge(text: string, vocab: Map<string, number>): number[] {
  const ids: number[] = [];
  for (const word of basicTokenize(text)) wordPiece(word, vocab, ids);
  return [CLS_ID, ...ids.slice(0, CONTENT_TOKENS_PER_WINDOW), SEP_ID];
}

/**
 * 窗口化编码（spec §5b.9 准确性保障）：超窗文本按内容 token 切多窗，每窗独立
 * [CLS]/[SEP]——整段语义保留，不做静默截断（截断会让 1200 字符 chunk 的尾部
 * 近半内容对语义检索不可见）。短文本恒为单窗。
 */
export function encodeWindowsForBge(text: string, vocab: Map<string, number>): number[][] {
  const ids: number[] = [];
  for (const word of basicTokenize(text)) wordPiece(word, vocab, ids);
  if (ids.length <= CONTENT_TOKENS_PER_WINDOW) {
    return [[CLS_ID, ...ids, SEP_ID]];
  }
  const windows: number[][] = [];
  for (let start = 0; start < ids.length; start += CONTENT_TOKENS_PER_WINDOW) {
    windows.push([CLS_ID, ...ids.slice(start, start + CONTENT_TOKENS_PER_WINDOW), SEP_ID]);
  }
  return windows;
}

async function fileWithinBounds(path: string, min: number, max: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size >= min && info.size <= max;
  } catch {
    return false;
  }
}

async function loadVocab(modelDir: string): Promise<Map<string, number>> {
  const content = await readFile(join(modelDir, "vocab.txt"), "utf-8");
  const vocab = new Map<string, number>();
  content.split("\n").forEach((token, index) => {
    const trimmed = token.replace(/\r$/, "");
    if (trimmed && !vocab.has(trimmed)) vocab.set(trimmed, index);
  });
  return vocab;
}

async function downloadModelFiles(
  modelDir: string,
  logger: LocalEmbeddingPortOptions["logger"],
  fetchImpl: typeof fetch,
  dispatcher?: unknown,
): Promise<void> {
  await mkdir(modelDir, { recursive: true });
  for (const bound of SIZE_BOUNDS) {
    const target = join(modelDir, bound.file);
    if (await fileWithinBounds(target, bound.min, bound.max)) continue;
    let lastError = "unknown";
    let downloaded = false;
    for (const mirror of MIRRORS) {
      try {
        // 单镜像尝试 120s 超时：镜像失联时快速轮换下一个，而非无限挂起。
        // §13 附带修复：用户环境直连 hf 镜像被墙（fetch failed），显式走 settings
        // 配置的 HTTP 代理（undici ProxyAgent dispatcher；无代理配置时原样直连）。
        const response = await fetchImpl(`${mirror.baseUrl}/${bound.file}`, {
          signal: AbortSignal.timeout(120_000),
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit);
        if (!response.ok || !response.body) {
          lastError = `http_${response.status}`;
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < bound.min || bytes.length > bound.max) {
          lastError = `size_out_of_bounds:${bytes.length}`;
          continue;
        }
        const staging = `${target}.downloading`;
        await writeFile(staging, bytes);
        await rename(staging, target);
        logger?.warn("模型文件已下载", {
          file: bound.file,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          mirror: mirror.name,
        });
        downloaded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!downloaded) {
      throw new Error(`模型文件下载失败（${bound.file}，last=${lastError}）`);
    }
  }
}

/** CLS 池化 + L2 归一：last_hidden_state [batch, seq, hidden] → batch 首条 [CLS] 行。 */
function toEmbedding(tensor: { data: ArrayLike<number>; dims: number[] }): Float32Array {
  const hidden = tensor.dims[tensor.dims.length - 1] ?? 0;
  let norm = 0;
  for (let index = 0; index < hidden; index++) norm += (tensor.data[index] ?? 0) ** 2;
  norm = Math.sqrt(norm);
  const embedding = new Float32Array(hidden);
  if (norm > 0) {
    for (let index = 0; index < hidden; index++) {
      embedding[index] = (tensor.data[index] ?? 0) / norm;
    }
  }
  return embedding;
}

/** 多窗口向量均值池化 + L2 归一（spec §5b.9 准确性保障：超窗文本整段语义保留）。 */
function meanPool(vectors: Float32Array[]): Float32Array {
  const first = vectors[0];
  if (first === undefined || vectors.length === 0 || first.length === 0) {
    return new Float32Array(0);
  }
  const dim = first.length;
  const mean = new Float32Array(dim);
  for (const vector of vectors) {
    if (vector.length !== dim) continue;
    for (let index = 0; index < dim; index++) {
      mean[index] = mean[index]! + vector[index]! / vectors.length;
    }
  }
  let norm = 0;
  for (let index = 0; index < dim; index++) norm += mean[index]! ** 2;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let index = 0; index < dim; index++) mean[index] = mean[index]! / norm;
  }
  return mean;
}

export function createLocalEmbeddingPort(
  options: LocalEmbeddingPortOptions,
): KnowledgeEmbeddingPort {
  const logger = options.logger;
  const fetchImpl = options.fetchImpl ?? fetch;
  // §13：代理 dispatcher 惰性构建（undici ProxyAgent；仅 httpProxy 配置时创建，
  // 下载期才触发 import，推理路径零开销）。
  let dispatcherPromise: Promise<unknown | null> | null = null;
  const getDispatcher = (): Promise<unknown | null> => {
    if (!options.httpProxy?.trim()) return Promise.resolve(null);
    dispatcherPromise ??= import("undici")
      .then(({ ProxyAgent }) => new ProxyAgent(options.httpProxy!.trim()) as unknown)
      .catch((error: unknown) => {
        logger?.warn("代理 dispatcher 构建失败，回退直连", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
    return dispatcherPromise;
  };
  const modelDir = join(options.modelRoot, MODEL_DIR_NAME);
  // 失败冷却时长（spec §5b.9 2026-11-14 修订）：缺省 10 分钟，对齐 §5b.8 autoReconcile
  // 陈旧 TTL——后台重试节奏与索引自动 reconcile 同档；测试可注入收紧。
  const failureCooldownMs = options.failureCooldownMs ?? 10 * 60_000;
  let runtimePromise: Promise<RuntimeState> | null = null;
  // 状态面（spec §5b.9）：model_missing（缺文件未下载）→ downloading → ready/failed。
  let portState: KnowledgeSemanticPortState = "model_missing";
  let portLastError: string | null = null;
  // 上次 ensureRuntime 失败的时刻（spec §5b.9 2026-11-14 修订）：冷却期内背景路径
  // （embed）快速失败不再出站——原「下次使用重试」在离线环境被 reconcile 逐文档
  // 嵌入/尾部回填/每次查询反复触发整轮镜像重试（2 镜像 × 2 文件 × 单镜像 120s
  // 超时上限），job 爬行至分钟级。手动 ensureReady（显式用户意图）不受此限。
  let runtimeFailedAtMs: number | null = null;

  function ensureRuntime(forceRetry = false): Promise<RuntimeState> {
    if (runtimePromise === null) {
      if (
        !forceRetry &&
        runtimeFailedAtMs !== null &&
        Date.now() - runtimeFailedAtMs < failureCooldownMs
      ) {
        // 复用上次失败原因（如「模型文件下载失败（…last=fetch failed）」），调用方
        // 诊断/日志口径不变；仅从「每次真实出站一轮」变为冷却期内快速失败。
        return Promise.reject(
          new Error(portLastError ?? "本地语义模型不可用（下载失败冷却中）"),
        );
      }
      runtimeFailedAtMs = null;
      runtimePromise = (async () => {
        let filesReady = true;
        for (const bound of SIZE_BOUNDS) {
          const path = join(modelDir, bound.file);
          if (!(await fileWithinBounds(path, bound.min, bound.max))) {
            filesReady = false;
            break;
          }
        }
        if (!filesReady) {
          portState = "downloading";
          portLastError = null;
          const dispatcher = await getDispatcher();
          await downloadModelFiles(modelDir, logger, fetchImpl, dispatcher);
        }
        // 动态 import：onnxruntime-node 是可选运行时（缺模块 = 端口不可用，词法照常）。
        const ort = (await import("onnxruntime-node")) as unknown as OnnxRuntime;
        const session = await ort.InferenceSession.create(join(modelDir, "model_quantized.onnx"));
        const vocab = await loadVocab(modelDir);
        const outputName = session.outputNames[0] ?? "last_hidden_state";
        portState = "ready";
        portLastError = null;
        return { ort, session, vocab, outputName };
      })();
      runtimePromise.catch((error: unknown) => {
        portState = "failed";
        portLastError = error instanceof Error ? error.message : String(error);
        // 失败进入冷却而非立即允许重试（spec §5b.9 2026-11-14 修订，原注释「允许下次
        // 重试（下载失败后环境可能恢复）」语义由冷却期满承接）；原始异常仍交给首次
        // 调用方。
        runtimeFailedAtMs = Date.now();
        runtimePromise = null;
      });
    }
    return runtimePromise;
  }

  return {
    id: LOCAL_EMBEDDING_MODEL_ID,
    status(): KnowledgeSemanticPortStatus {
      return { state: portState, lastError: portLastError };
    },
    async ensureReady(): Promise<void> {
      // 手动下载（knowledge_index_download_semantic_model）是显式用户意图：不受失败
      // 冷却限制，立即重试（spec §5b.9 2026-11-14 修订）。
      await ensureRuntime(true);
    },
    async embed(texts: string[]): Promise<number[][] | null> {
      if (texts.length === 0) return [];
      const runtime = await ensureRuntime();
      const embeddings: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += INFERENCE_BATCH) {
        const batch = texts.slice(start, start + INFERENCE_BATCH);
        for (const text of batch) {
          const windows = encodeWindowsForBge(text, runtime.vocab);
          const windowVectors: Float32Array[] = [];
          for (const ids of windows) {
            const length = ids.length;
            const feeds: Record<string, unknown> = {
              input_ids: new runtime.ort.Tensor(
                "int64",
                BigInt64Array.from(ids.map((id) => BigInt(id))),
                [1, length],
              ),
              attention_mask: new runtime.ort.Tensor(
                "int64",
                BigInt64Array.from({ length }, () => BigInt(1)),
                [1, length],
              ),
            };
            if (runtime.session.inputNames.includes("token_type_ids")) {
              feeds.token_type_ids = new runtime.ort.Tensor(
                "int64",
                BigInt64Array.from({ length }, () => BigInt(0)),
                [1, length],
              );
            }
            const output = await runtime.session.run(feeds);
            const raw = output[runtime.outputName];
            if (!raw) return null;
            windowVectors.push(toEmbedding(raw as { data: ArrayLike<number>; dims: number[] }));
          }
          embeddings.push(meanPool(windowVectors));
        }
      }
      if (embeddings.length !== texts.length) return null;
      return embeddings.map((vector) => Array.from(vector));
    },
    dispose(): void {
      // 补 ONNX InferenceSession 显式释放（2026-11-15 审计 §四：原实现无 release，
      // 会话句柄只随进程退出回收——常驻进程内端口被服务 dispose 或热切换替换后即
      // 泄漏）。幂等安全：release（onnxruntime-common InferenceSession.release →
      // 绑定层 handler.dispose）原生侧自带已释放守卫，本方法对 runtimePromise 的
      // 单次快照也保证只触发一次；释放错误吞掉（dispose 链同步、不因释放失败阻塞，
      // 与 db.close 同链纪律）。释放后清空运行时缓存态：后续 embed 重新走
      // ensureRuntime 重建会话，绝不复用已释放句柄。
      const pending = runtimePromise;
      runtimePromise = null;
      runtimeFailedAtMs = null;
      portState = "model_missing";
      portLastError = null;
      if (pending === null) return;
      void pending.then(
        (state) => state.session.release(),
        () => undefined,
      ).catch(() => undefined);
    },
  };
}
