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
import { getDroraDataRootDir } from "../../paths.js";
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
  fetchImpl?: typeof fetch;
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

/** 编码单条文本：基础切分 → WordPiece → 截断窗口 + [CLS]/[SEP]。 */
export function encodeForBge(text: string, vocab: Map<string, number>): number[] {
  const ids: number[] = [];
  for (const word of basicTokenize(text)) wordPiece(word, vocab, ids);
  return [CLS_ID, ...ids.slice(0, MAX_SEQUENCE_TOKENS - 2), SEP_ID];
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
        const response = await fetchImpl(`${mirror.baseUrl}/${bound.file}`, {
          signal: AbortSignal.timeout(120_000),
        });
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

export function createLocalEmbeddingPort(options: LocalEmbeddingPortOptions): KnowledgeEmbeddingPort {
  const logger = options.logger;
  const fetchImpl = options.fetchImpl ?? fetch;
  const modelDir = join(options.modelRoot, MODEL_DIR_NAME);
  let runtimePromise: Promise<RuntimeState> | null = null;
  // 状态面（spec §5b.9）：model_missing（缺文件未下载）→ downloading → ready/failed。
  let portState: KnowledgeSemanticPortState = "model_missing";
  let portLastError: string | null = null;

  function ensureRuntime(): Promise<RuntimeState> {
    if (runtimePromise === null) {
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
          await downloadModelFiles(modelDir, logger, fetchImpl);
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
        // 允许下次重试（下载失败后环境可能恢复）；原始异常仍交给首次调用方。
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
      await ensureRuntime();
    },
    async embed(texts: string[]): Promise<number[][] | null> {
      if (texts.length === 0) return [];
      const runtime = await ensureRuntime();
      const embeddings: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += INFERENCE_BATCH) {
        const batch = texts.slice(start, start + INFERENCE_BATCH);
        for (const text of batch) {
          const ids = encodeForBge(text, runtime.vocab);
          const length = ids.length;
          const feeds: Record<string, unknown> = {
            input_ids: new runtime.ort.Tensor("int64", BigInt64Array.from(ids.map((id) => BigInt(id))), [1, length]),
            attention_mask: new runtime.ort.Tensor("int64", BigInt64Array.from({ length }, () => BigInt(1)), [1, length]),
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
          embeddings.push(toEmbedding(raw as { data: ArrayLike<number>; dims: number[] }));
        }
      }
      if (embeddings.length !== texts.length) return null;
      return embeddings.map((vector) => Array.from(vector));
    },
  };
}
