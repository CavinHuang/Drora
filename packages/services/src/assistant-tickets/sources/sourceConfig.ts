/**
 * Source 配置与身份映射的 kv 读取（03 详设 §1「按 config.enabled 惰性启停」+ §2/§4 名单映射）。
 *
 * kv 键单出处（本文件；模块内持久化字面量，仅 host 侧 mate.sqlite 自产自读，与
 * assistantConfig.ts ASSISTANT_KV_KEYS 同口径）。读路径=注册表 reconcile 与 Source 工厂；
 * **写路径在装配层**（node.ts kvSet，照 Router 轮转簿记先例；UI 配置面随 P3 下一棒——
 * 本阶段无写入口是诚实边界，测试直写 kv）。
 *
 * 坏/缺值逐键回落缺省（坏 JSON 不炸、缺 repo 不启用），照 readAssistantConfig 纪律。
 */

import type { MateSourceIdentityMap, MateSourcesConfig } from "./contract.js";

/** kv 配置键（mate.sqlite kv 表；键名即 kv.key 字面量，单出处）。 */
export const ASSISTANT_SOURCE_KV_KEYS = {
  /** 三 Source 开关与参数 JSON（MateSourcesConfig）。 */
  sourcesConfig: "source_config",
  /** 外部 id → 本地 identity 映射 JSON（MateSourceIdentityMap；03 §2/§4 名单）。 */
  identityMap: "source_identity_map",
} as const;

/** kv 单键读取（缺行 → undefined）。 */
export type SourceKvGet = (key: string) => string | undefined;

function readJson<T>(kvGet: SourceKvGet, key: string): T | undefined {
  const raw = kvGet(key);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Source 开关配置（坏/缺值 → 空配置=全关，诚实缺省）。 */
export function readSourcesConfig(kvGet: SourceKvGet): MateSourcesConfig {
  return readJson<MateSourcesConfig>(kvGet, ASSISTANT_SOURCE_KV_KEYS.sourcesConfig) ?? {};
}

/** 外部 id → identity 映射（坏/缺值 → 空映射；未映射 id 原样透传，gate 拒绝）。 */
export function readIdentityMap(kvGet: SourceKvGet): MateSourceIdentityMap {
  return readJson<MateSourceIdentityMap>(kvGet, ASSISTANT_SOURCE_KV_KEYS.identityMap) ?? {};
}

/** 单 Source 开关（显式 true 才启用——缺席/坏值=关闭，不猜测）。 */
export function isSourceEnabled(
  config: MateSourcesConfig,
  kind: "feishu" | "phone" | "github",
): boolean {
  switch (kind) {
    case "feishu":
      return config.feishu?.enabled === true;
    case "phone":
      return config.phone?.enabled === true;
    case "github":
      return config.github?.enabled === true;
    default:
      return false;
  }
}

/** 映射解析（03 §2/§4：外部 id ↔ identity；未映射 → 原样外部 id，由 gate 拒绝并记录）。 */
export function resolveMappedIdentity(
  map: MateSourceIdentityMap,
  kind: "feishu" | "github",
  externalId: string,
): string {
  const table = kind === "feishu" ? map.feishu : map.github;
  const mapped = table?.[externalId];
  return typeof mapped === "string" && mapped.trim() ? mapped : externalId;
}
