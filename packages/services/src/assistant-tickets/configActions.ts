/**
 * P5 设置中心写入口（06 号详设 §2；spec §14 P5 行）。
 *
 * 从 assistantTicketsService 拆出（单文件 ≤800 行纪律，先例：triggerRecord/
 * sourceIngest 拆分）：budget/信任门阈值/watchdog 间隔/Source 配置/身份映射/模型
 * 偏好六类参数的统一写入口——**服务仍是 mate.sqlite kv 的唯一生产写者**（本模块
 * 即该写者的实现件；此前这些键生产无写入口，kv 手改属测试驱动先例）。
 *
 * 统一纪律：
 *   - 入参 bounds/结构 fail-closed 校验（ASSISTANT_CONFIG_LIMITS 单出处；越界/坏
 *     结构 → validationFailed，不猜测收敛）；
 *   - kv 事务写 + publish()——publish 即触发 sourceRegistry reconcile（03 注册表
 *     语义），Source 启停/映射改动即时生效，不再等下一次快照推送；
 *   - 返回 AssistantResult；sqlite busy 分类照 setAllowlist 先例。
 *
 * 纯模块：无 IO（db 连接与 publish 由服务闭包注入）。
 */
import {
  ASSISTANT_CONFIG_LIMITS,
  ASSISTANT_ERROR_CODES,
  modelSelectionSchema,
  type AssistantErrorCode,
} from "@drora/shared";
import {
  AssistantStoreBusyError,
  type AssistantDatabase,
} from "./assistantDatabase.js";
import { ASSISTANT_KV_KEYS } from "./assistantConfig.js";
import { ASSISTANT_SOURCE_KV_KEYS } from "./sources/sourceConfig.js";
import type { MateSourceIdentityMap, MateSourcesConfig } from "./sources/contract.js";
import type { AssistantResult } from "./assistantTickets.js";

/** UI/装配面传入的扁平模型偏好（view 形态；kv 存 modelSelectionSchema 嵌套形态）。 */
export interface AssistantModelPreferenceInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly reasoningLevel?: string;
}

export interface AssistantConfigActionsDeps {
  readonly db: AssistantDatabase;
  /** 快照推送（publish 即 sourceRegistry reconcile——Source 配置即时生效）。 */
  readonly publish: () => void;
}

function nowMs(): number {
  return Date.now();
}

function fail<T>(code: AssistantErrorCode, reason?: string): AssistantResult<T> {
  return { ok: false, error: { code, reason } };
}

export function createAssistantConfigActions(deps: AssistantConfigActionsDeps): {
  setBudget(input: { maxActivePerWorkspace: number }): Promise<AssistantResult<{ ok: true }>>;
  setTrustGateThresholds(input: {
    minRate?: number;
    minSamples?: number;
  }): Promise<AssistantResult<{ ok: true }>>;
  setWatchdogIntervalMinutes(input: { minutes: number }): Promise<AssistantResult<{ ok: true }>>;
  setSourcesConfig(input: MateSourcesConfig): Promise<AssistantResult<{ ok: true }>>;
  setSourceIdentityMap(input: MateSourceIdentityMap): Promise<AssistantResult<{ ok: true }>>;
  setModelPreference(
    input: AssistantModelPreferenceInput | null,
  ): Promise<AssistantResult<{ ok: true }>>;
} {
  const { db, publish } = deps;

  /** kv 事务写 + publish（三段纪律的公共尾；err 分类照 setAllowlist 先例）。 */
  async function writeKv(
    entries: ReadonlyArray<{ key: string; value: string }>,
  ): Promise<AssistantResult<{ ok: true }>> {
    try {
      const ts = nowMs();
      db.transaction((raw) => {
        for (const entry of entries) {
          raw
            .prepare(
              "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_ms = excluded.updated_ms",
            )
            .run(entry.key, entry.value, ts);
        }
      });
      publish();
      return { ok: true, value: { ok: true } };
    } catch (error) {
      if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
      throw error;
    }
  }

  const budgetLimits = ASSISTANT_CONFIG_LIMITS.budgetMaxActivePerWorkspace;
  const rateLimits = ASSISTANT_CONFIG_LIMITS.trustGateMinRate;
  const sampleLimits = ASSISTANT_CONFIG_LIMITS.trustGateMinSamples;
  const intervalLimits = ASSISTANT_CONFIG_LIMITS.watchdogIntervalMinutes;

  return {
    async setBudget(input) {
      const value = input.maxActivePerWorkspace;
      if (
        !Number.isInteger(value) ||
        value < budgetLimits.min ||
        value > budgetLimits.max
      ) {
        return fail(
          ASSISTANT_ERROR_CODES.validationFailed,
          `软预算须为 ${budgetLimits.min}-${budgetLimits.max} 的整数`,
        );
      }
      return writeKv([
        { key: ASSISTANT_KV_KEYS.budgetMaxActivePerWorkspace, value: String(value) },
      ]);
    },

    async setTrustGateThresholds(input) {
      // 部分更新：缺省侧不动 kv（保留既有自定义），仅写传入键——读写均以 kv 现值为准。
      const entries: Array<{ key: string; value: string }> = [];
      if (input.minRate !== undefined) {
        if (input.minRate < rateLimits.min || input.minRate > rateLimits.max) {
          return fail(
            ASSISTANT_ERROR_CODES.validationFailed,
            `放行率阈值须在 ${rateLimits.min}-${rateLimits.max} 之间`,
          );
        }
        entries.push({ key: ASSISTANT_KV_KEYS.trustGateMinRate, value: String(input.minRate) });
      }
      if (input.minSamples !== undefined) {
        if (
          !Number.isInteger(input.minSamples) ||
          input.minSamples < sampleLimits.min ||
          input.minSamples > sampleLimits.max
        ) {
          return fail(
            ASSISTANT_ERROR_CODES.validationFailed,
            `样本数阈值须为 ${sampleLimits.min}-${sampleLimits.max} 的整数`,
          );
        }
        entries.push({ key: ASSISTANT_KV_KEYS.trustGateMinSamples, value: String(input.minSamples) });
      }
      if (entries.length === 0) {
        return fail(ASSISTANT_ERROR_CODES.validationFailed, "未提供任何阈值");
      }
      return writeKv(entries);
    },

    async setWatchdogIntervalMinutes(input) {
      const minutes = input.minutes;
      if (
        !Number.isInteger(minutes) ||
        minutes < intervalLimits.min ||
        minutes > intervalLimits.max
      ) {
        return fail(
          ASSISTANT_ERROR_CODES.validationFailed,
          `watchdog 间隔须为 ${intervalLimits.min}-${intervalLimits.max} 分钟`,
        );
      }
      // 服务内换算 ms 落 kv（watchdog 读侧 intervalMs 语义不变，06 详设 §1）。
      return writeKv([
        { key: ASSISTANT_KV_KEYS.watchdogIntervalMs, value: String(minutes * 60 * 1000) },
      ]);
    },

    async setSourcesConfig(input) {
      // 结构 fail-closed（不猜测收敛；github enabled=true 须带合法 repo 与点名词）。
      const errors: string[] = [];
      const feishu = input.feishu;
      if (feishu !== undefined && typeof feishu.enabled !== "boolean") {
        errors.push("feishu.enabled 须为布尔");
      }
      const phone = input.phone;
      if (phone !== undefined && typeof phone.enabled !== "boolean") {
        errors.push("phone.enabled 须为布尔");
      }
      const github = input.github;
      if (github !== undefined) {
        if (typeof github.enabled !== "boolean") errors.push("github.enabled 须为布尔");
        if (github.repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(github.repo)) {
          errors.push("github.repo 须为 owner/repo 形态");
        }
        if (github.mentionName !== undefined && typeof github.mentionName !== "string") {
          errors.push("github.mentionName 须为字符串");
        }
        if (github.enabled === true) {
          if (!github.repo || !/^[\w.-]+\/[\w.-]+$/.test(github.repo)) {
            errors.push("github 启用须提供合法 repo（owner/repo）");
          }
          if (!github.mentionName?.trim()) {
            errors.push("github 启用须提供点名词（mentionName）");
          }
        }
      }
      if (errors.length > 0) {
        return fail(ASSISTANT_ERROR_CODES.validationFailed, errors.join("；"));
      }
      return writeKv([
        { key: ASSISTANT_SOURCE_KV_KEYS.sourcesConfig, value: JSON.stringify(input) },
      ]);
    },

    async setSourceIdentityMap(input) {
      // 嵌套形态（MateSourceIdentityMap）：feishu/github 两子表，外部 id → 本地
      // identity；两子表合并计数 ≤ 上限，键值 trim 非空（fail-closed 不猜测）。
      const cleaned: { feishu?: Record<string, string>; github?: Record<string, string> } = {};
      let total = 0;
      for (const kind of ["feishu", "github"] as const) {
        const table = input[kind];
        if (table === undefined) continue;
        const clean: Record<string, string> = {};
        for (const [externalId, identity] of Object.entries(table)) {
          const key = externalId.trim();
          const value = typeof identity === "string" ? identity.trim() : "";
          if (!key || !value) {
            return fail(
              ASSISTANT_ERROR_CODES.validationFailed,
              "身份映射的键与值均不能为空（外部 id → 本地 identity）",
            );
          }
          clean[key] = value;
          total += 1;
        }
        cleaned[kind] = clean;
      }
      if (total > ASSISTANT_CONFIG_LIMITS.identityMapMaxEntries) {
        return fail(
          ASSISTANT_ERROR_CODES.validationFailed,
          `身份映射至多 ${ASSISTANT_CONFIG_LIMITS.identityMapMaxEntries} 条`,
        );
      }
      return writeKv([
        { key: ASSISTANT_SOURCE_KV_KEYS.identityMap, value: JSON.stringify(cleaned) },
      ]);
    },

    async setModelPreference(input) {
      // null=清除（空串语义；读侧空值回落「未设置→CLI 缺省」）。
      if (input === null) {
        return writeKv([{ key: ASSISTANT_KV_KEYS.modelPreference, value: "" }]);
      }
      const nested = {
        providerId: input.providerId,
        modelId: input.modelId,
        ...(input.reasoningLevel
          ? { options: { reasoningLevel: input.reasoningLevel } }
          : {}),
      };
      const parsed = modelSelectionSchema.safeParse(nested);
      if (!parsed.success) {
        return fail(
          ASSISTANT_ERROR_CODES.validationFailed,
          "模型偏好须为合法 modelSelection（providerId/modelId 非空）",
        );
      }
      return writeKv([
        { key: ASSISTANT_KV_KEYS.modelPreference, value: JSON.stringify(parsed.data) },
      ]);
    },
  };
}
