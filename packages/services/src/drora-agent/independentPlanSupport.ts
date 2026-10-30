import {
  PERSONA_RUNTIME_PREFERENCE_ENABLED,
  droraProtocolMethods,
  droraRuntimeCapabilitiesSchema,
} from "@drora/shared";
import type { DroraProtocolClient } from "./droraProtocolClient.js";

const checks = new WeakMap<object, Promise<void>>();

/** Host 更新不代表远端 CLI 已更新；旧 CLI 会剥掉 Plan 字段，必须在发送前确认执行端。 */
export function ensureIndependentPlanSupport(
  client: Pick<DroraProtocolClient, "request">,
): Promise<void> {
  const cached = checks.get(client);
  if (cached) return cached;
  const check = client
    .request(droraProtocolMethods.runtimeCapabilities, {}, droraRuntimeCapabilitiesSchema)
    .then((result) => {
      if (result.independentPlanState !== true) throw new Error("proto.independentPlanUnsupported");
    })
    .catch((cause: unknown) => {
      checks.delete(client);
      throw new Error("proto.independentPlanUnsupported", { cause });
    });
  checks.set(client, check);
  return check;
}

const historyChecks = new WeakMap<object, Promise<boolean>>();
/** 远端旧 CLI 的 strict subscribe 不接受新字段，能力确认后才转发。 */
export function supportsHistoryFirst(
  client: Pick<DroraProtocolClient, "request">,
): Promise<boolean> {
  const existing = historyChecks.get(client);
  if (existing) return existing;
  const check = client
    .request(droraProtocolMethods.runtimeCapabilities, {}, droraRuntimeCapabilitiesSchema)
    .then((result) => result.historyFirst === true)
    .catch(() => {
      historyChecks.delete(client);
      return false;
    });
  historyChecks.set(client, check);
  return check;
}

const personaControlChecks = new WeakMap<object, Promise<boolean>>();
/**
 * 能力探测的独立短超时：能力应答是本地 stdio 单往返，正常毫秒级；对不认识
 * runtime/capabilities 的静默端必须快速失败（false），不能拖到默认 3 分钟请求
 * 超时——session/requestRuntimePreferences 的响应预算只有 15s（CLI 侧超时即回退）。
 * lifecycle:"observation" 让超时只拒绝本次探测，不触发进程管理器的 stale 回收
 * （短超时表示「本轮无数据」，不升级为整个 Agent 故障）。
 */
const PERSONA_CAPABILITY_PROBE_TIMEOUT_MS = 3_000;
/**
 * Persona 控制合同 v1 能力检查（合同 §4.1）：缓存按 CLI 连接实例保存（WeakMap 键＝
 * client 对象），重连产生新实例即重查；不按 workspacePath 全局缓存。缺失、
 * method-not-found 或断线一律 false，调用方不发 persona 方法、不附加 personaEnabled。
 */
export function supportsPersonaControlV1(
  client: Pick<DroraProtocolClient, "request">,
): Promise<boolean> {
  const existing = personaControlChecks.get(client);
  if (existing) return existing;
  const check = client
    .request(
      droraProtocolMethods.runtimeCapabilities,
      {},
      droraRuntimeCapabilitiesSchema,
      { timeoutMs: PERSONA_CAPABILITY_PROBE_TIMEOUT_MS, lifecycle: "observation" },
    )
    .then((result) => result.personaControlV1 === true)
    .catch(() => {
      personaControlChecks.delete(client);
      return false;
    });
  personaControlChecks.set(client, check);
  return check;
}

/**
 * 执行许可 E 的附加门（合同 §4.1）：新 Host 只有确认当前 CLI 连接的 personaControlV1
 * 能力后才在 session/requestRuntimePreferences 响应保留 personaEnabled；旧 CLI 的
 * strict schema 不认识该键，收到即解析失败——这里原地把键剥掉（缺失即 false，新 CLI
 * 对缺失值按 false）。就地修改与调用点既有的 preferences 逐字段改写一致。
 */
export async function attachPersonaEnabledForCapability<Preferences extends object>(
  client: Pick<DroraProtocolClient, "request">,
  preferences: Preferences,
): Promise<Preferences> {
  if (!(await supportsPersonaControlV1(client))) {
    delete (preferences as Record<string, unknown>)[PERSONA_RUNTIME_PREFERENCE_ENABLED];
  }
  return preferences;
}
