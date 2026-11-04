/**
 * 模型能力档案一次性旧键迁移（specs/model-capabilities.md §3.3；F-7）。
 *
 * 档案服务首次初始化时执行：AppSettings 14 旧键 + 旧凭据 5 键 → 档案 + 新凭据键；
 * 写 migratedFromLegacySettings: true 标记后旧键删除；标记已存在即跳过（幂等）。
 * 迁移解析异常按「旧值缺失」处理、不阻断（fail-closed 到各能力默认关闭态）——
 * 逐字段/逐凭据容错，任何一步失败都不抛出到初始化路径。
 *
 * 迁移必须在 Host 进程内直调 settingService（RPC patch 会吞 undefined，删不掉旧键）；
 * 批次二起旧值读取走 readRawLegacyAppSettings（原始 setting.json，schema strip 不影响），
 * 旧键物理清理走空补丁整写（见 deleteLegacySettingsKeys）。
 */
import {
  KNOWLEDGE_JEV_PROVIDERS,
  MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS,
  MODEL_CAPABILITIES_LEGACY_SETTINGS_KEYS,
  modelCapabilityCredentialKey,
  type KnowledgeJevProvider,
  type ModelCapabilities,
} from "@drora/shared";
import type { ICredentialService } from "../credential/credential.js";
import type { ISettingService } from "../setting/setting.js";
import { createServiceLogger } from "../logger/serviceLogger.js";

const logger = createServiceLogger("modelCapabilities");

export interface LegacyMigrationDependencies {
  /** 旧键清理（空补丁整写；spec §3.3 顺序不变式：标记落盘成功后才调用）。 */
  settingService: Pick<ISettingService, "update">;
  /** 旧值读取（原始 setting.json；缺省由服务层注入 readRawLegacyAppSettings）。 */
  readLegacySettings: () => Promise<Record<string, unknown>>;
  credentialService: Pick<ICredentialService, "load" | "save" | "delete">;
}

export interface LegacyMigrationResult {
  /** 基于现有档案（或全默认）叠加旧值后的能力面。 */
  capabilities: ModelCapabilities;
  /** 迁移落盘后应删除的旧凭据键（只删确实读到值的键，避免无谓写盘）。 */
  legacyCredentialKeysToDelete: string[];
  /** 是否存在需要清理的旧 AppSettings 键。 */
  hasLegacySettingsKeys: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJevProvider(value: unknown): value is KnowledgeJevProvider {
  return (
    typeof value === "string" && (KNOWLEDGE_JEV_PROVIDERS as readonly string[]).includes(value)
  );
}

/** 旧 AppSettings 快照的宽松读取形状（批次一 schema 仍含 14 键；这里按 unknown 容错解析）。 */
type LegacySettingsSnapshot = Record<string, unknown>;

function readLegacySettings(
  settings: Record<string, unknown>,
  key: (typeof MODEL_CAPABILITIES_LEGACY_SETTINGS_KEYS)[number],
): unknown {
  return settings[key];
}

/**
 * 旧值 → 能力面映射（spec §3.3 表逐行）。只覆盖「旧值存在且合法」的字段；
 * 异常/缺省一律保持现有档案值（首次即全默认）。
 */
function applyLegacySettings(
  capabilities: ModelCapabilities,
  settings: LegacySettingsSnapshot,
): void {
  // --- decision-jev ---
  const jevEnabled = readLegacySettings(settings, "knowledgeJevEnabled");
  if (typeof jevEnabled === "boolean") {
    capabilities["decision-jev"].enabled = jevEnabled;
  }
  const jevProvider = readLegacySettings(settings, "knowledgeJevProvider");
  if (isJevProvider(jevProvider)) {
    capabilities["decision-jev"].providerKind = jevProvider;
  }
  // baseUrl/modelId 按激活提供商取对应旧键（spec §3.3「对应激活时」）。
  const activeKind = capabilities["decision-jev"].providerKind;
  if (activeKind === "typesafe") {
    const baseUrl = readLegacySettings(settings, "knowledgeJevBaseUrl");
    if (isNonEmptyString(baseUrl)) capabilities["decision-jev"].baseUrl = baseUrl.trim();
  } else if (activeKind === "openrouter") {
    const baseUrl = readLegacySettings(settings, "knowledgeJevOpenrouterBaseUrl");
    if (isNonEmptyString(baseUrl)) capabilities["decision-jev"].baseUrl = baseUrl.trim();
    const model = readLegacySettings(settings, "knowledgeJevOpenrouterModel");
    if (isNonEmptyString(model)) capabilities["decision-jev"].modelId = model.trim();
  } else {
    const baseUrl = readLegacySettings(settings, "knowledgeJevAiGatewayBaseUrl");
    if (isNonEmptyString(baseUrl)) capabilities["decision-jev"].baseUrl = baseUrl.trim();
    const model = readLegacySettings(settings, "knowledgeJevAiGatewayModel");
    if (isNonEmptyString(model)) capabilities["decision-jev"].modelId = model.trim();
  }

  // --- embedding ---
  const semanticEnabled = readLegacySettings(settings, "knowledgeSemanticEnabled");
  if (typeof semanticEnabled === "boolean") {
    capabilities.embedding.enabled = semanticEnabled;
  }

  // --- asr ---
  const asrEngine = readLegacySettings(settings, "voiceAsrEngine");
  if (asrEngine === "webSpeech" || asrEngine === "remote") {
    capabilities.asr.engine = asrEngine;
  }
  // voiceVendorBaseUrl 双写同值到 asr 与 tts 的 baseUrlOverride（§13 v2 形态：
  // override 是 §13 迁移器自动建卡的线索，建卡后清空；两腿此后独立演化）。
  const vendorBaseUrl = readLegacySettings(settings, "voiceVendorBaseUrl");
  if (isNonEmptyString(vendorBaseUrl)) {
    capabilities.asr.baseUrlOverride = vendorBaseUrl.trim();
    capabilities.tts.baseUrlOverride = vendorBaseUrl.trim();
  }
  const asrModel = readLegacySettings(settings, "voiceAsrVendorModel");
  if (isNonEmptyString(asrModel)) capabilities.asr.modelId = asrModel.trim();

  // --- tts ---
  const ttsEngine = readLegacySettings(settings, "voiceTtsEngine");
  if (ttsEngine === "system" || ttsEngine === "cloud") {
    capabilities.tts.engine = ttsEngine;
  }
  const ttsModel = readLegacySettings(settings, "voiceTtsVendorModel");
  if (isNonEmptyString(ttsModel)) capabilities.tts.modelId = ttsModel.trim();
  const ttsVoice = readLegacySettings(settings, "voiceTtsVendorVoice");
  if (isNonEmptyString(ttsVoice)) capabilities.tts.voice = ttsVoice.trim();
}

/**
 * 新凭据键写成功 → true；写失败 → warn 并返回 false。
 * spec §3.3「迁移后删旧键」以新键写成功为前提：半迁移状态下删旧键 = API key
 * 既没迁走又删了源（永久丢失）。失败保留旧键，下次启动幂等重试。
 */
async function saveCredentialOrWarn(
  credentialService: Pick<ICredentialService, "save">,
  newKey: string,
  value: string,
  legacyKey: string,
): Promise<boolean> {
  try {
    await credentialService.save(newKey, value);
    return true;
  } catch (error) {
    logger.warn(undefined, "legacy credential migration save failed; legacy key kept", {
      legacyKey,
      newKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * 旧凭据 → 新凭据键迁移（spec §3.3）：decision-jev 三键一一对应；
 * voice:vendor:api-key 单键双写 asr + tts 同值。读到空值/读取失败 = 旧值缺失，跳过；
 * 只有对应新键全部写成功的旧键才进删除清单（任一写失败保留旧键待重试）。
 */
async function migrateLegacyCredentials(
  credentialService: Pick<ICredentialService, "load" | "save">,
): Promise<string[]> {
  const keysToDelete: string[] = [];
  for (const kind of KNOWLEDGE_JEV_PROVIDERS) {
    const legacyKey = MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.decisionJev[kind];
    const value = await credentialService.load(legacyKey).catch(() => null);
    if (!isNonEmptyString(value)) {
      continue;
    }
    const saved = await saveCredentialOrWarn(
      credentialService,
      modelCapabilityCredentialKey.decisionJev(kind),
      value.trim(),
      legacyKey,
    );
    if (saved) {
      keysToDelete.push(legacyKey);
    }
  }
  const legacyVoiceKey = MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.voiceVendor;
  const voiceValue = await credentialService.load(legacyVoiceKey).catch(() => null);
  if (isNonEmptyString(voiceValue)) {
    const trimmed = voiceValue.trim();
    // 单键双写：asr 与 tts 都写成功才删旧键。已写入的一腿保留（同值双写，
    // 重试幂等覆盖），旧键保留保证任一腿失败时值不丢。
    // §13：voice 旧键值转存到自含键（selfContained.asr/tts），由 §13 迁移器
    // 按 baseUrlOverride 自动建卡后删除；不再有 modelCapabilityCredentialKey.asr/tts。
    const asrSaved = await saveCredentialOrWarn(
      credentialService,
      MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.selfContained.asr,
      trimmed,
      legacyVoiceKey,
    );
    const ttsSaved = await saveCredentialOrWarn(
      credentialService,
      MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.selfContained.tts,
      trimmed,
      legacyVoiceKey,
    );
    if (asrSaved && ttsSaved) {
      keysToDelete.push(legacyVoiceKey);
    }
  }
  return keysToDelete;
}

/**
 * 执行迁移解析（不动磁盘）：读旧设置与旧凭据，产出能力面与待删旧键清单。
 * 任何读取异常按「旧值缺失」降级，不抛出。
 */
export async function resolveLegacyMigration(
  dependencies: LegacyMigrationDependencies,
  currentCapabilities: ModelCapabilities,
): Promise<LegacyMigrationResult> {
  const capabilities = structuredClone(currentCapabilities);
  // 批次二（spec §3.3）把 14 个旧键从 appSettings schema 删除后，settingService.get()
  // 的 z.object 解析会 strip 文件里的旧键——迁移源改读原始 setting.json（服务层注入的
  // 单一出处 reader）；任何失败按「旧值缺失」降级，不抛出。
  const settings: LegacySettingsSnapshot = await dependencies.readLegacySettings().catch(() => {
    logger.warn(undefined, "legacy settings raw read failed; treating as missing");
    return {} as LegacySettingsSnapshot;
  });

  applyLegacySettings(capabilities, settings);
  const legacyCredentialKeysToDelete = await migrateLegacyCredentials(
    dependencies.credentialService,
  );

  const hasLegacySettingsKeys = MODEL_CAPABILITIES_LEGACY_SETTINGS_KEYS.some(
    (key) => readLegacySettings(settings, key) !== undefined,
  );
  return { capabilities, legacyCredentialKeysToDelete, hasLegacySettingsKeys };
}

/**
 * 迁移收尾：物理清理 setting.json 中的旧 AppSettings 14 键。
 *
 * 批次二起（schema 已删 14 键）patch 不再承载旧键（strip 未知键），清理改为空补丁
 * 整写一次——update 在写锁内以 appSettingsSchema 重解析当前值（strip 掉旧键）后原子
 * 写回。失败不阻断（标记已存在即跳过重试；下次任意设置写盘同样会去掉旧键）。
 */
export async function deleteLegacySettingsKeys(
  settingService: Pick<ISettingService, "update">,
): Promise<void> {
  // 批次二 schema 删除 14 键后，patch schema 同样 strip 未知键——「按键传 undefined」
  // 不再可达。物理清理改为空补丁整写一次：update 在写锁内以 appSettingsSchema 重解析
  // 当前值（strip 掉文件里的旧键）后原子写回，setting.json 中的旧键随即消失。
  // MODEL_CAPABILITIES_LEGACY_SETTINGS_KEYS 仍是旧键清单的唯一出处（迁移值读取用）。
  void MODEL_CAPABILITIES_LEGACY_SETTINGS_KEYS;
  await settingService.update({}).catch((error) => {
    logger.warn(undefined, "legacy settings key cleanup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/** 删除已完成迁移的旧凭据键（只删确实迁走值的键）。 */
export async function deleteLegacyCredentialKeys(
  credentialService: Pick<ICredentialService, "delete">,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    await credentialService.delete(key).catch((error: unknown) => {
      // §12 修复：删除失败至少留诊断痕迹（与设置键清理的 warn 对齐）。方向 fail-safe
      // ——旧键保留无害（迁移后无运行时读方），但完全静默会让 credentials.json 残键
      // 无据可查；marker 已落盘导致不会重试，这是唯一的排查线索。
      logger.warn(undefined, "legacy credential key cleanup failed; legacy key kept", {
        legacyKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
