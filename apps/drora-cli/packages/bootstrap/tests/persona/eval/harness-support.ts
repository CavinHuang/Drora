/**
 * 拟人系统真实模型评测 harness 公共支撑（specs/drora-persona-system.md §13 第十四批）。
 *
 * 形态沿用 PM57 先例（apps/drora-cli/packages/adapters/tests/persona/
 * pm57-capture-performance.test.ts）：env 门控默认跳过、只断言采集完整性不设达标
 * 阈值、证据 JSON 落 artifacts 由报告消费。本模块提供：本地凭据 env 加载、artifacts
 * 断点续跑（JSONL append + 已完成键跳过）、种子化随机（盲评标签可复现）、成本台账、
 * JSON Schema 子集校验器、限流退避。
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** 评测总开关（1=启用真实调用；mock 干跑用 DRORA_PERSONA_EVAL_MOCK=1 且无需本开关）。 */
export const EVAL_ENABLED = process.env.DRORA_PERSONA_EVAL === "1";
/** mock 干跑：全部模型调用走本地假实现，不发包，验证管线/断点/汇总/盲评材料。 */
export const EVAL_MOCK = process.env.DRORA_PERSONA_EVAL_MOCK === "1";
export const EVAL_ARTIFACTS_ROOT = resolve(process.cwd(), "../../../../.persona-eval-artifacts");

/** 语料/参数冻结记录在 artifacts 固定文件，报告引用。 */
export function artifactsDir(kind: "pm47" | "pm48" | "connectivity" | "blind"): string {
  const dir = join(EVAL_ARTIFACTS_ROOT, kind);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 解析仓库根的 .env.persona-eval.local（KEY=VALUE 行；不入仓、不落日志）。 */
export function loadEvalEnvFile(): Record<string, string> {
  const path = resolve(process.cwd(), "../../../../.env.persona-eval.local");
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

// ---------------------------------------------------------------------------
// 断点续跑：JSONL 逐行 append；重启后按 runKey 跳过已完成行
// ---------------------------------------------------------------------------

export function openJsonl(name: string): {
  path: string;
  completedKeys(): Set<string>;
  append(record: Record<string, unknown>): void;
} {
  const path = name;
  const completed = new Set<string>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { runKey?: string };
        if (typeof parsed.runKey === "string") completed.add(parsed.runKey);
      } catch {
        /* 损坏行忽略：续跑以完整行为准 */
      }
    }
  }
  return {
    path,
    completedKeys: () => completed,
    append(record) {
      appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
      completed.add(String(record.runKey));
    },
  };
}

// ---------------------------------------------------------------------------
// 种子化随机（盲评 A/B 标签分配可复现；种子写入 artifacts）
// ---------------------------------------------------------------------------

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 成本台账（合同 §8「按轮报告额外 token；新旧抽取合计成本单列」——旧链路本实验为 0）
// ---------------------------------------------------------------------------

export interface CostEntry {
  readonly model: string;
  readonly purpose: "pm48-extract" | "pm47-main" | "pm48-precondition" | "connectivity";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly at: string;
}

export class CostLedger {
  readonly #entries: CostEntry[] = [];

  record(entry: Omit<CostEntry, "at">): void {
    this.#entries.push({ ...entry, at: new Date().toISOString() });
  }

  summary(): Record<string, { calls: number; inputTokens: number; outputTokens: number }> {
    const byKey = new Map<string, { calls: number; inputTokens: number; outputTokens: number }>();
    for (const entry of this.#entries) {
      const key = `${entry.model}/${entry.purpose}`;
      const current = byKey.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
      current.calls += 1;
      current.inputTokens += entry.inputTokens;
      current.outputTokens += entry.outputTokens;
      byKey.set(key, current);
    }
    return Object.fromEntries(byKey);
  }

  readonly all = (): readonly CostEntry[] => this.#entries;
}

// ---------------------------------------------------------------------------
// 限流退避：429/5xx/网络错按指数退避重试（不吞 4xx 语义错误）
// ---------------------------------------------------------------------------

export async function withBackoff<T>(
  operation: () => Promise<T>,
  options: { readonly maxRetries?: number; readonly baseDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 2_000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /429|rate|limit|timeout|network|5[0-9][0-9]|ECONN|fetch failed|temporarily/i.test(
        message,
      );
      if (!transient || attempt === maxRetries) throw error;
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((wait) => setTimeout(wait, delay));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// JSON Schema 子集校验器（覆盖语料用到的关键字；未支持关键字如实报不支持）
// ---------------------------------------------------------------------------

export type SchemaCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function checkJsonSchema(value: unknown, schema: unknown, path = "$"): SchemaCheck {
  if (typeof schema !== "object" || schema === null) return { ok: true };
  const node = schema as Record<string, unknown>;
  if (node.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return { ok: false, reason: `${path}: 期望 object` };
    const record = value as Record<string, unknown>;
    for (const key of (node.required as string[] | undefined) ?? []) {
      if (!(key in record)) return { ok: false, reason: `${path}.${key}: 缺必填键` };
    }
    const properties = (node.properties as Record<string, unknown> | undefined) ?? {};
    for (const [key, child] of Object.entries(properties)) {
      if (key in record) {
        const childResult = checkJsonSchema(record[key], child, `${path}.${key}`);
        if (!childResult.ok) return childResult;
      }
    }
    if (node.additionalProperties === false) {
      const known = new Set(Object.keys(properties));
      for (const key of Object.keys(record)) {
        if (!known.has(key)) return { ok: false, reason: `${path}.${key}: 多余键（additionalProperties=false）` };
      }
    }
    return { ok: true };
  }
  if (node.type === "array") {
    if (!Array.isArray(value)) return { ok: false, reason: `${path}: 期望 array` };
    if (typeof node.minItems === "number" && value.length < node.minItems)
      return { ok: false, reason: `${path}: 少于 minItems=${node.minItems}` };
    if (typeof node.maxItems === "number" && value.length > node.maxItems)
      return { ok: false, reason: `${path}: 超过 maxItems=${node.maxItems}` };
    if (node.items !== undefined) {
      for (const [index, item] of value.entries()) {
        const itemResult = checkJsonSchema(item, node.items, `${path}[${index}]`);
        if (!itemResult.ok) return itemResult;
      }
    }
    return { ok: true };
  }
  if (node.type === "string") {
    if (typeof value !== "string") return { ok: false, reason: `${path}: 期望 string` };
  } else if (node.type === "number") {
    if (typeof value !== "number") return { ok: false, reason: `${path}: 期望 number` };
  } else if (node.type === "boolean") {
    if (typeof value !== "boolean") return { ok: false, reason: `${path}: 期望 boolean` };
  }
  if (Array.isArray(node.enum) && !node.enum.includes(value as never))
    return { ok: false, reason: `${path}: 值不在 enum 内` };
  return { ok: true };
}

/** 从模型文本输出提取首个 JSON 对象并校验；失败返回原因（不抛）。 */
export function parseAndCheckSchema(
  text: string,
  schema: unknown,
): { parsed?: unknown; check: SchemaCheck } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { check: { ok: false, reason: "输出不含 JSON 对象" } };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return { parsed, check: checkJsonSchema(parsed, schema) };
  } catch (error) {
    return { check: { ok: false, reason: `JSON 解析失败: ${String(error)}` } };
  }
}

/** anyOf 命中判定（大小写不敏感 contains）。 */
export function matchesAnyOf(text: string, anyOf: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return anyOf.some((candidate) => lower.includes(candidate.toLowerCase()));
}
