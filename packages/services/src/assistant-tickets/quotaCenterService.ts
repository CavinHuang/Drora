/**
 * 配额中心服务面（04 详设 §4；从 assistantTicketsService 拆出——单文件 ≤800 行纪律，
 * 先例：routerEvaluation/sourceIngest/dispatchEngine 拆分）。
 *
 * IAssistantTicketService 的三个配额方法（admitDisturbance/getDisturbanceQuota/
 * markDailyDigestDelivered）+ AppSettings 端口的实时读缓存（判定实时读、快照投影用
 * 缓存值——quotaCenter.ts 注释即对账点）。事务纪律：db.transaction 单写者。
 */
import { ASSISTANT_ERROR_CODES } from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  AssistantStoreBusyError,
  AssistantStoreMigrationError,
  type AssistantDatabase,
  type AssistantDatabaseRaw,
} from "./assistantDatabase.js";
import type { AssistantQuotaView, AssistantResult } from "./assistantTickets.js";
import type { AssistantDisturbanceKind } from "@drora/shared";
import {
  admitAssistantDisturbanceTx,
  assistantQuotaDayTotal,
  assistantQuotaKindCounts,
  collectPendingAssistantDigest,
  formatAssistantQuotaDayKey,
  markAssistantDigestDeliveredTx,
  readAssistantQuotaDay,
  resolveAssistantDailyQuota,
} from "./quotaCenter.js";
import { getAssistantPorts } from "./assistantPorts.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

export interface AssistantQuotaServiceDeps {
  readonly db: AssistantDatabase;
  /** 判定/投递回执后推送快照（服务闭包的 publish）。 */
  readonly publish: () => void;
}

export function createAssistantQuotaService(deps: AssistantQuotaServiceDeps): {
  /** 每日配额实时读（settings 端口；失败/缺席回落 contracts 缺省 5）并刷新闭包缓存。 */
  readDailyQuotaLive(): Promise<number>;
  /** 快照投影用的缓存值（判定不读它——admitDisturbance 每次实时读）。 */
  cachedQuota(): number | undefined;
  admitDisturbance(input: {
    kind: AssistantDisturbanceKind;
    summary?: string;
    atMs?: number;
  }): Promise<
    AssistantResult<{
      allowed: boolean;
      date: string;
      used: number;
      quota: number;
      aggregated: boolean;
    }>
  >;
  getDisturbanceQuota(): Promise<AssistantResult<AssistantQuotaView>>;
  markDailyDigestDelivered(): Promise<AssistantResult<{ ok: true }>>;
} {
  let cachedDailyQuota: number | undefined = undefined;

  async function readDailyQuotaLive(): Promise<number> {
    try {
      const value = await getAssistantPorts().settings?.readDailyQuota();
      cachedDailyQuota = value;
    } catch (error) {
      // 设置读取失败按缺省配额判定（诚实缺省，不炸推送链路）；warn 一次即可。
      logger.warn("assistant-tickets 每日配额读取失败，按缺省判定", error);
      cachedDailyQuota = undefined;
    }
    return resolveAssistantDailyQuota(cachedDailyQuota);
  }
  void readDailyQuotaLive();

  function wrapStoreError<T>(error: unknown): AssistantResult<T> | null {
    if (error instanceof AssistantStoreBusyError) {
      return { ok: false, error: { code: ASSISTANT_ERROR_CODES.storeBusy } };
    }
    if (error instanceof AssistantStoreMigrationError) {
      return {
        ok: false,
        error: { code: ASSISTANT_ERROR_CODES.storeMigration, reason: String(error.message) },
      };
    }
    return null;
  }

  return {
    readDailyQuotaLive,

    cachedQuota: () => cachedDailyQuota,

    async admitDisturbance(input) {
      const quota = await readDailyQuotaLive();
      try {
        const atMs = input.atMs ?? nowMs();
        const verdict = deps.db.transaction((raw: AssistantDatabaseRaw) =>
          admitAssistantDisturbanceTx(raw, {
            kind: input.kind,
            ...(input.summary ? { summary: input.summary } : {}),
            atMs,
            quota,
          }),
        );
        const total = assistantQuotaDayTotal(verdict.record);
        if (verdict.aggregated) {
          logger.info("assistant-tickets 打扰推送超额聚合次日摘要", {
            kind: input.kind,
            date: formatAssistantQuotaDayKey(atMs),
          });
        }
        return {
          ok: true,
          value: {
            allowed: verdict.allowed,
            date: formatAssistantQuotaDayKey(atMs),
            used: total,
            quota,
            aggregated: verdict.aggregated,
          },
        };
      } catch (error) {
        const wrapped = wrapStoreError<{ allowed: boolean; date: string; used: number; quota: number; aggregated: boolean }>(error);
        if (wrapped) return wrapped;
        throw error;
      }
    },

    async getDisturbanceQuota() {
      const quota = await readDailyQuotaLive();
      try {
        const now = nowMs();
        const dayKey = formatAssistantQuotaDayKey(now);
        const record = readAssistantQuotaDay(deps.db.raw, dayKey);
        const total = assistantQuotaDayTotal(record);
        const view: AssistantQuotaView = {
          date: dayKey,
          quota,
          used: assistantQuotaKindCounts(record),
          total,
          remaining: Math.max(0, quota - total),
          pendingDigest: collectPendingAssistantDigest(deps.db.raw, now),
        };
        return { ok: true, value: view };
      } catch (error) {
        const wrapped = wrapStoreError<AssistantQuotaView>(error);
        if (wrapped) return wrapped;
        throw error;
      }
    },

    async markDailyDigestDelivered() {
      try {
        deps.db.transaction((raw: AssistantDatabaseRaw) => {
          markAssistantDigestDeliveredTx(raw, nowMs());
        });
        deps.publish();
        return { ok: true, value: { ok: true } };
      } catch (error) {
        const wrapped = wrapStoreError<{ ok: true }>(error);
        if (wrapped) return wrapped;
        throw error;
      }
    },
  };
}
