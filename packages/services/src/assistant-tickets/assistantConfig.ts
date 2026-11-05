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
import { ASSISTANT_DEFAULTS, ASSISTANT_MODES, type AssistantMode } from "@drora/shared";
import type { AssistantDatabaseRaw } from "./assistantDatabase.js";
import type { AssistantConfigView } from "./assistantTickets.js";

/** kv 配置键（mate.sqlite kv 表；存储键单出处，键名即 kv.key 字面量）。 */
export const ASSISTANT_KV_KEYS = {
  mode: "mode",
  allowlist: "allowlist",
  budgetMaxActivePerWorkspace: "budget_max_active_per_workspace",
  worktreeDisabled: "worktree_disabled",
} as const;

/** 配置缺省（P1 形态：模式 observe、名单=本机 identity、软预算 3、W1 开）。 */
export function defaultAssistantConfig(localIdentity: string): AssistantConfigView {
  return {
    mode: ASSISTANT_MODES.observe,
    allowlist: [localIdentity],
    budgetMaxActivePerWorkspace: ASSISTANT_DEFAULTS.budgetMaxActivePerWorkspace,
    worktreeDisabled: false,
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
  return { mode, allowlist, budgetMaxActivePerWorkspace, worktreeDisabled };
}
