/**
 * §13 供应商引用式迁移器（specs/model-capabilities.md §13.4）。
 *
 * 三件事：
 * 1. upgradeV1FileToV2：v1 档案 JSON（schemaVersion:1，asr/tts/image-generation 自含
 *    baseUrl 形态）→ v2 路由表形态（providerRef/modelId/baseUrlOverride）。纯形状
 *    变换、无 IO——自含 baseUrl 无法离线推断 providerRef（供应商卡可能还不存在），
 *    统一落空路由（fail-closed），由 migrateSelfContainedEntries 建卡后回填。
 * 2. migrateSelfContainedEntries：读 v1 时代三个自含凭据键，按条目 baseUrl 分组
 *    自动建自定义供应商卡（官方 createPersonalProvider + overlay 写 baseUrl/apiKey），
 *    条目回填 providerRef。
 * 3. deleteSelfContainedCredentialKeys：§13 标记落盘成功后删三个旧凭据键
 *    （顺序不变式与 §3.3 同款：建卡成功才删键，失败保留供下次重试）。
 */

import type { ICredentialService } from "../credential/credential.js";
import {
  MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS,
  type ModelCapabilitiesFile,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";

const logger = createServiceLogger("modelCapabilities");

/** Host 装配注入的建卡函数（生产实现走 providerSettings facade 公开入口）。 */
export type ProviderCardCreator = (input: {
  name: string;
  baseUrl: string;
  apiKey: string;
}) => Promise<string>;

/** v1 自含条目（读取层升级前的形状；宽松读取用）。 */
interface V1SelfContainedEntry {
  enabled?: boolean;
  engine?: string;
  baseUrl?: string;
  modelId?: string;
  voice?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * v1 JSON → v2 JSON（无 IO）。已是非 1 的 schemaVersion 原样返回（zod 终判）；
 * 自含 baseUrl 不猜 providerRef（空路由 fail-closed，迁移器建卡后回填）。
 */
export function upgradeV1FileToV2(raw: unknown): unknown {
  if (!isRecord(raw) || raw.schemaVersion !== 1) return raw;
  const caps = isRecord(raw.capabilities) ? raw.capabilities : {};
  const pick = (key: string): V1SelfContainedEntry =>
    isRecord(caps[key]) ? (caps[key] as V1SelfContainedEntry) : {};
  const asr = pick("asr");
  const tts = pick("tts");
  const image = pick("image-generation");
  return {
    ...raw,
    schemaVersion: 2,
    capabilities: {
      ...caps,
      // v1 自含 baseUrl 保底进 baseUrlOverride：它是 §13 自动建卡的唯一线索
      // （key 在 credentialService、不进档案），迁移器建卡成功后清空 override
      // （卡片持有正式 baseUrl）。用户 pre-§13 手动配置因此无感保留。
      asr: {
        engine: asr.engine === "remote" ? "remote" : "webSpeech",
        providerRef: "",
        modelId: typeof asr.modelId === "string" ? asr.modelId : "",
        baseUrlOverride: typeof asr.baseUrl === "string" ? asr.baseUrl : "",
      },
      tts: {
        engine: tts.engine === "cloud" ? "cloud" : "system",
        providerRef: "",
        modelId: typeof tts.modelId === "string" ? tts.modelId : "",
        voice: typeof tts.voice === "string" ? tts.voice : "",
        baseUrlOverride: typeof tts.baseUrl === "string" ? tts.baseUrl : "",
      },
      "image-generation": {
        enabled: image.enabled === true,
        providerRef: "",
        modelId: typeof image.modelId === "string" ? image.modelId : "",
        baseUrlOverride: typeof image.baseUrl === "string" ? image.baseUrl : "",
      },
    },
    migratedFromLegacySettings: raw.migratedFromLegacySettings === true,
    migratedToProviderRef: false,
  };
}

/** §13 迁移主流程：返回新档案与本次成功建卡的 providerId 集。 */
export async function migrateSelfContainedEntries(input: {
  base: ModelCapabilitiesFile;
  credentialService: Pick<ICredentialService, "load" | "save" | "delete">;
  createProviderCard: ProviderCardCreator;
}): Promise<{ file: ModelCapabilitiesFile; createdProviderIds: Set<string> }> {
  const { base, credentialService, createProviderCard } = input;
  const caps = structuredClone(base.capabilities);
  const created = new Set<string>();
  // baseUrl 分组：asr/tts 常共用一个厂商端点，同 baseUrl 只建一张卡。
  const cardByBaseUrl = new Map<string, string>();
  const LEGACY = MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.selfContained;

  const resolveCard = async (
    baseUrl: string,
    fallbackName: string,
    apiKey: string,
  ): Promise<string | null> => {
    const trimmed = baseUrl.trim();
    if (!trimmed || !apiKey.trim()) return null;
    const existing = cardByBaseUrl.get(trimmed);
    if (existing) return existing;
    const providerId = await createProviderCard({
      name: fallbackName,
      baseUrl: trimmed,
      apiKey: apiKey.trim(),
    });
    cardByBaseUrl.set(trimmed, providerId);
    created.add(providerId);
    return providerId;
  };

  const migrate = async (
    purpose: "asr" | "tts" | "image-generation",
    legacyKey: string,
    displayName: string,
  ): Promise<void> => {
    const entry = caps[purpose] as (typeof caps)["asr"] & { baseUrlOverride?: string };
    // 迁移动机 = 引擎/开关启用 + 无 providerRef + 有 baseUrlOverride 线索
    // （v1 自含 baseUrl 的保底；三缺一即 fail-closed 空路由，UI 重选即恢复）。
    const active =
      purpose === "image-generation"
        ? caps["image-generation"].enabled
        : purpose === "asr"
          ? caps.asr.engine === "remote"
          : caps.tts.engine === "cloud";
    if (!active || entry.providerRef || !entry.baseUrlOverride?.trim()) return;
    const apiKey = await credentialService.load(legacyKey);
    if (!apiKey?.trim()) return;
    const baseUrl = entry.baseUrlOverride.trim();
    const providerId = await resolveCard(baseUrl, displayName, apiKey);
    if (!providerId) return;
    entry.providerRef = providerId;
    entry.baseUrlOverride = "";
  };

  await migrate("asr", LEGACY.asr, "语音识别");
  await migrate("tts", LEGACY.tts, "语音合成");
  await migrate("image-generation", LEGACY.imageGeneration, "图像生成");

  return {
    file: { ...base, schemaVersion: 2, capabilities: caps, migratedToProviderRef: true },
    createdProviderIds: created,
  };
}

/** §13 标记落盘成功后删三个自含凭据键（未建卡时保留——下次启动可重试）。 */
export async function deleteSelfContainedCredentialKeys(
  credentialService: Pick<ICredentialService, "delete">,
  migratedAny: boolean,
): Promise<void> {
  if (!migratedAny) return;
  const LEGACY = MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.selfContained;
  for (const key of [LEGACY.asr, LEGACY.tts, LEGACY.imageGeneration]) {
    await credentialService.delete(key).catch((error: unknown) => {
      logger.warn(undefined, "legacy capability credential key cleanup failed; key kept", {
        legacyKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
