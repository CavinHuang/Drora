/**
 * mate.sqlite kv 配置读取（01 详设 §1.4：配置全存台账 kv，不动 AppSettings）。
 *
 * 从 assistantTicketsService 抽出（单文件 ≤800 行纪律，先例：routerEvaluation/
 * dispatchEngine/generationRollover 拆分）：键常量、缺省值与读取纯函数单处收口；
 * **写路径仍在服务**（setMode/setAllowlist/setWorktreeDisabled 是唯一写者——
 * IAssistantTicketService 接口面），本文件只读不写。
 *
 * 纯模块：无 IO（raw 连接由调用方传入，事务纪律归服务/引擎闭包）。
 */
import {
  ASSISTANT_CONFIG_LIMITS,
  ASSISTANT_DEFAULTS,
  ASSISTANT_MODES,
  ASSISTANT_TRUST_GATE_DEFAULTS,
  ASSISTANT_WATCHDOG_DEFAULTS,
  modelSelectionSchema,
  type AssistantMode,
} from "@drora/shared";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";
import type { AssistantConfigView } from "./assistantTickets.js";
import { readIdentityMap, readSourcesConfig } from "./sources/sourceConfig.js";

/** kv 配置键（mate.sqlite kv 表；存储键单出处，键名即 kv.key 字面量）。 */
export const ASSISTANT_KV_KEYS = {
  mode: "mode",
  allowlist: "allowlist",
  budgetMaxActivePerWorkspace: "budget_max_active_per_workspace",
  worktreeDisabled: "worktree_disabled",
  // P5 设置中心（06 号详设 §1）：信任门阈值/watchdog 间隔原为 kv 手改键（P4 读点
  // 在 trustGate.ts/watchdog.ts），本批补服务统一写入口；model_preference 为新键
  // （值=modelSelectionSchema JSON；空串=已清除回落 CLI 缺省）。
  trustGateMinRate: "trust_gate_min_rate",
  trustGateMinSamples: "trust_gate_min_samples",
  watchdogIntervalMs: "watchdog_interval_ms",
  modelPreference: "model_preference",
} as const;

/** 配置缺省（P1 形态：模式 observe、名单=本机 identity、软预算 3、W1 开）。 */
export function defaultAssistantConfig(localIdentity: string): AssistantConfigView {
  return {
    mode: ASSISTANT_MODES.observe,
    allowlist: [localIdentity],
    budgetMaxActivePerWorkspace: ASSISTANT_DEFAULTS.budgetMaxActivePerWorkspace,
    worktreeDisabled: false,
    trustGateThresholds: {
      minRate: ASSISTANT_TRUST_GATE_DEFAULTS.minReleaseRate,
      minSamples: ASSISTANT_TRUST_GATE_DEFAULTS.minSamples,
    },
    watchdogIntervalMinutes: ASSISTANT_WATCHDOG_DEFAULTS.intervalMs / 60_000,
    modelPreference: null,
    sourcesConfig: {},
    identityMap: {},
  };
}

/** kv 单键读取（缺行 → undefined，由 readAssistantConfig 回落缺省）。 */
export function readAssistantKv(raw: AssistantDatabaseRaw, key: string): string | undefined {
  const row = raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/** kv 配置读取（坏/缺值逐键回落缺省；allowlist JSON 解析失败按名单缺省处理）。 */
export function readAssistantConfig(
  raw: AssistantDatabaseRaw,
  localIdentity: string,
): AssistantConfigView {
  const fallback = defaultAssistantConfig(localIdentity);
  const mode =
    (readAssistantKv(raw, ASSISTANT_KV_KEYS.mode) as AssistantMode | undefined) ?? fallback.mode;
  const allowlistRaw = readAssistantKv(raw, ASSISTANT_KV_KEYS.allowlist);
  let allowlist = fallback.allowlist;
  if (allowlistRaw) {
    try {
      const parsed = JSON.parse(allowlistRaw) as unknown;
      if (Array.isArray(parsed) && parsed.every((id): id is string => typeof id === "string")) {
        allowlist = parsed;
      }
    } catch {
      allowlist = fallback.allowlist;
    }
  }
  const budgetRaw = readAssistantKv(raw, ASSISTANT_KV_KEYS.budgetMaxActivePerWorkspace);
  const budgetMaxActivePerWorkspace = budgetRaw
    ? Number(budgetRaw)
    : fallback.budgetMaxActivePerWorkspace;
  const worktreeDisabled = readAssistantKv(raw, ASSISTANT_KV_KEYS.worktreeDisabled) === "true";
  // P5 设置中心读取（坏/缺值逐键回落缺省；写侧 bounds 见 ASSISTANT_CONFIG_LIMITS）。
  const rateLimits = ASSISTANT_CONFIG_LIMITS.trustGateMinRate;
  const sampleLimits = ASSISTANT_CONFIG_LIMITS.trustGateMinSamples;
  const rawMinRate = Number(readAssistantKv(raw, ASSISTANT_KV_KEYS.trustGateMinRate));
  const rawMinSamples = Number(readAssistantKv(raw, ASSISTANT_KV_KEYS.trustGateMinSamples));
  const intervalLimits = ASSISTANT_CONFIG_LIMITS.watchdogIntervalMinutes;
  const rawIntervalMinutes =
    Number(readAssistantKv(raw, ASSISTANT_KV_KEYS.watchdogIntervalMs)) / 60_000;
  const modelPreference = readAssistantModelPreferenceView(raw);
  const kvGet = (key: string) => readAssistantKv(raw, key);
  return {
    mode,
    allowlist,
    budgetMaxActivePerWorkspace,
    worktreeDisabled,
    trustGateThresholds: {
      minRate:
        Number.isFinite(rawMinRate) && rawMinRate >= rateLimits.min && rawMinRate <= rateLimits.max
          ? rawMinRate
          : fallback.trustGateThresholds.minRate,
      minSamples:
        Number.isInteger(rawMinSamples) &&
        rawMinSamples >= sampleLimits.min &&
        rawMinSamples <= sampleLimits.max
          ? rawMinSamples
          : fallback.trustGateThresholds.minSamples,
    },
    watchdogIntervalMinutes:
      Number.isInteger(rawIntervalMinutes) &&
      rawIntervalMinutes >= intervalLimits.min &&
      rawIntervalMinutes <= intervalLimits.max
        ? rawIntervalMinutes
        : fallback.watchdogIntervalMinutes,
    modelPreference,
    sourcesConfig: readSourcesConfig(kvGet),
    identityMap: readIdentityMap(kvGet),
  };
}

/**
 * 模型偏好读取（view 形态扁平化：{providerId,modelId,reasoningLevel?}）。
 * 坏/空值 → null（未设置→CLI 缺省模型；空串=已清除语义）。
 */
export function readAssistantModelPreferenceView(
  raw: import("./assistantDatabase.js").AssistantDatabaseRaw,
): AssistantConfigView["modelPreference"] {
  const rawValue = readAssistantKv(raw, ASSISTANT_KV_KEYS.modelPreference);
  if (!rawValue) return null;
  try {
    const parsed = modelSelectionSchema.safeParse(JSON.parse(rawValue));
    if (!parsed.success) return null;
    return {
      providerId: parsed.data.providerId,
      modelId: parsed.data.modelId,
      ...(parsed.data.options?.reasoningLevel
        ? { reasoningLevel: parsed.data.options.reasoningLevel }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * 模型偏好读取（wire 嵌套形态，node.ts createSession config.modelSelection 直用）。
 * 未设置/坏值 → undefined（envelope 不带字段=CLI 缺省，现行为不变）。
 */
export function readAssistantModelSelectionNested(
  raw: import("./assistantDatabase.js").AssistantDatabaseRaw,
): import("@drora/shared").ModelSelection | undefined {
  const rawValue = readAssistantKv(raw, ASSISTANT_KV_KEYS.modelPreference);
  if (!rawValue) return undefined;
  try {
    const parsed = modelSelectionSchema.safeParse(JSON.parse(rawValue));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
