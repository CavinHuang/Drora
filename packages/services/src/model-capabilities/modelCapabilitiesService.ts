/**
 * 模型能力档案服务（specs/model-capabilities.md §4 唯一所有者；§13 供应商引用式重构）。
 *
 * v2（§13）：asr/tts/image-generation 条目为路由表形态（providerRef 指向官方供应商卡，
 * baseUrl+apiKey 归 provider_config.json 单点持有）；档案不再为这三者存凭据。
 * decision-jev（System One 线协议）与 embedding（本地资产）维持自含现状。
 *
 * 迁移链（读取层升级，双标记幂等）：
 * - migratedFromLegacySettings（§3.3 v1 迁移）：AppSettings 14 键 + 旧凭据 5 键 → v1 档案
 * - migratedToProviderRef（§13 v2 迁移）：v1 自含条目（baseUrl+独立凭据键）→ 自动建
 *   供应商卡 + providerRef。两段迁移独立幂等，旧档案无论停在哪个版本都能收敛。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MODEL_CAPABILITIES_FILE_NAME,
  defaultModelCapabilitiesFile,
  modelCapabilitiesFileSchema,
  modelCapabilityCredentialKey,
  type ModelCapabilities,
  type ModelCapabilitiesFile,
  type ModelCapabilityEntriesPatch,
  type ModelCapabilitiesUpdate,
} from "@drora/shared";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@drora/shared/node";
import { createCredentialService } from "../credential/credentialService.js";
import type { ICredentialService } from "../credential/credential.js";
import type { ISettingService } from "../setting/setting.js";
import { readRawLegacyAppSettings } from "../setting/settingService.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";
import {
  resolveLegacyMigration,
  deleteLegacySettingsKeys,
  deleteLegacyCredentialKeys,
} from "./legacyMigration.js";
import type { IModelCapabilitiesService } from "./contract.js";
import {
  upgradeV1FileToV2,
  migrateSelfContainedEntries,
  deleteSelfContainedCredentialKeys,
  type ProviderCardCreator,
} from "./providerRefMigration.js";

const logger = createServiceLogger("modelCapabilities");

interface FileReadResult {
  file: ModelCapabilitiesFile | null;
  backupPath?: string;
}

function getErrorCodeSafe(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** 读档案并按 §3.2 校验；损坏文件按内容确定性备份后降级（MC-1），绝不向上抛解析错。 */
async function readModelCapabilitiesFile(filePath: string): Promise<FileReadResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if (getErrorCodeSafe(error) === "ENOENT") return { file: null };
    throw error;
  }
  try {
    const parsedUnknown: unknown = JSON.parse(raw);
    // v1 档案（schemaVersion:1，自含 baseUrl 形态）读取层直接升级为 v2 路由表形态；
    // §13 迁移器随后按需补建供应商卡（见 initialize 的 migratedToProviderRef 段）。
    const upgraded = upgradeV1FileToV2(parsedUnknown);
    const parsed = modelCapabilitiesFileSchema.parse(upgraded);
    return { file: parsed };
  } catch (error) {
    // 坏 JSON/坏 schema：备份证据后降级全默认，下一轮 update 原子替换原文件。
    const backupPath = await backupCorruptFile(filePath).catch(() => undefined);
    logger.warn(undefined, "model capabilities file corrupt; degrading to defaults", {
      filePath,
      backupPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { file: null, backupPath };
  }
}

/** capabilities 浅合并：逐 purpose 条目浅覆盖，缺省条目/字段不动（逐条显式展开保类型精确）。 */
function applyCapabilityPatch(
  base: ModelCapabilities,
  patch: ModelCapabilityEntriesPatch | undefined,
): ModelCapabilities {
  if (!patch) return base;
  return {
    ...base,
    ...(patch["decision-jev"] !== undefined
      ? { "decision-jev": { ...base["decision-jev"], ...patch["decision-jev"] } }
      : {}),
    ...(patch.embedding !== undefined
      ? { embedding: { ...base.embedding, ...patch.embedding } }
      : {}),
    ...(patch.asr !== undefined ? { asr: { ...base.asr, ...patch.asr } } : {}),
    ...(patch.tts !== undefined ? { tts: { ...base.tts, ...patch.tts } } : {}),
    ...(patch["image-generation"] !== undefined
      ? { "image-generation": { ...base["image-generation"], ...patch["image-generation"] } }
      : {}),
  };
}

export interface ModelCapabilitiesServiceDependencies {
  /**
   * Host 进程内直调（迁移旧键清理；RPC patch 会吞 undefined 删不掉键）。
   */
  settingService: Pick<ISettingService, "update">;
  /**
   * 迁移旧值读取（原始 setting.json；批次二 schema 删 14 键后 settingService.get()
   * 会 strip 旧键，spec §3.3 迁移源必须读原始文件）。缺省 readRawLegacyAppSettings
   * （settingService 模块的单一出处 reader）；测试注入内存假实现隔离真实 HOME。
   */
  readLegacySettings?: () => Promise<Record<string, unknown>>;
  /** 缺省自建无状态实例（同一加密文件；生产注入与装配共享实例更优，测试注入假实现）。 */
  credentialService?: Pick<ICredentialService, "load" | "save" | "delete">;
  /**
   * §13 迁移器（可选注入）：按 v1 自含条目的 baseUrl 在官方模型管理自动建
   * 自定义供应商卡并返回 providerId。生产由 Host 装配注入（走 providerSettings
   * facade 公开入口）；缺席（测试桩/远端 Host）时跳过 §13 迁移，条目保持空
   * 路由形态（fail-closed），UI 重选供应商即恢复。
   */
  createProviderCard?: (input: {
    name: string;
    baseUrl: string;
    apiKey: string;
  }) => Promise<string>;
}

export function createModelCapabilitiesService(
  dependencies: ModelCapabilitiesServiceDependencies,
): IModelCapabilitiesService {
  const credentialService = dependencies.credentialService ?? createCredentialService();
  const filePath = join(getAppConfigDir(), MODEL_CAPABILITIES_FILE_NAME);
  const listeners = new Set<(snapshot: ModelCapabilitiesFile) => void>();
  let current: ModelCapabilitiesFile = defaultModelCapabilitiesFile();
  let ready: Promise<void> | null = null;
  // §13 late-bind 建卡器（Host 装配回填；构造注入受时序限制不可行，见契约注释）。
  let attachedCreator: ProviderCardCreator | undefined = dependencies.createProviderCard;

  async function persist(file: ModelCapabilitiesFile): Promise<void> {
    await atomicWritePrivateTextFile(filePath, `${JSON.stringify(file, null, 2)}\n`);
  }

  /**
   * 首次初始化：读档案（缺失/损坏 → 全默认；v1 → 读取层升级）→ 两段迁移各自未完成则执行。
   * 迁移任何异常都按降级处理，不阻断读路径。
   */
  async function initialize(): Promise<void> {
    const { file } = await readModelCapabilitiesFile(filePath);
    const base = file ?? defaultModelCapabilitiesFile();
    if (base.migratedFromLegacySettings !== true) {
      const migration = await resolveLegacyMigration(
        {
          settingService: dependencies.settingService,
          credentialService,
          readLegacySettings: dependencies.readLegacySettings ?? readRawLegacyAppSettings,
        },
        base.capabilities,
      );
      base.capabilities = migration.capabilities;
      base.migratedFromLegacySettings = true;
      // §3.3 顺序不变式：标记落盘成功后才清理旧键（语义见 v1 注释，完整保留）。
      let markerPersisted = false;
      try {
        await persist(base);
        markerPersisted = true;
      } catch (error) {
        logger.warn(
          undefined,
          "model capabilities migration persist failed; legacy keys kept for retry",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      if (markerPersisted) {
        if (migration.hasLegacySettingsKeys) {
          await deleteLegacySettingsKeys(dependencies.settingService);
        }
        await deleteLegacyCredentialKeys(credentialService, migration.legacyCredentialKeysToDelete);
      }
    }
    if (base.migratedToProviderRef !== true) {
      // §13 迁移：v1 自含条目（baseUrl 有值且旧凭据键有值）→ 自动建供应商卡 +
      // 条目转 providerRef。迁移器缺席（测试桩/远端 Host）时跳过，条目保持升级后的
      // 空路由形态（fail-closed，不出站），用户在 UI 重选供应商即可。
      const createProviderCard = attachedCreator;
      if (createProviderCard) {
        try {
          const { file: migrated, createdProviderIds } = await migrateSelfContainedEntries({
            base,
            credentialService,
            createProviderCard,
          });
          let markerPersisted = false;
          try {
            await persist(migrated);
            markerPersisted = true;
          } catch (error) {
            logger.warn(undefined, "provider-ref migration persist failed; retry next launch", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          if (markerPersisted) {
            await deleteSelfContainedCredentialKeys(credentialService, createdProviderIds.size > 0);
            base.capabilities = migrated.capabilities;
            base.migratedToProviderRef = true;
            current = base;
            return;
          }
        } catch (error) {
          logger.warn(undefined, "provider-ref migration degraded; entries stay empty", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      // 未迁移或迁移失败：仍以升级后的档案服务（标记保持 false，下次启动重试）。
      base.migratedToProviderRef = false;
    }
    current = base;
  }

  async function ensureReady(): Promise<void> {
    if (ready === null) {
      ready = initialize().catch((error) => {
        logger.warn(undefined, "model capabilities initialization degraded", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    await ready;
  }

  /** 凭据写删（§13 后仅 decision-jev）：null/空串 = 删除。 */
  async function writeOrDeleteCredential(key: string, value: string | null): Promise<void> {
    const trimmed = value?.trim();
    if (!trimmed) {
      await credentialService.delete(key);
      return;
    }
    await credentialService.save(key, trimmed);
  }

  async function applyCredentials(params: ModelCapabilitiesUpdate): Promise<void> {
    const credentials = params.credentials;
    if (!credentials) return;
    if (credentials.decisionJev !== undefined) {
      await writeOrDeleteCredential(
        modelCapabilityCredentialKey.decisionJev(credentials.decisionJev.providerKind),
        credentials.decisionJev.value,
      );
    }
  }

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener(current);
      } catch (error) {
        logger.warn(undefined, "model capabilities listener failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    async get(): Promise<ModelCapabilitiesFile> {
      await ensureReady();
      // 文件是唯一事实源：每次读重读盘（多窗口 Host 并发写后不服务陈旧快照）。
      const { file } = await readModelCapabilitiesFile(filePath);
      current = file ?? current;
      return structuredClone(current);
    },

    async update(params: ModelCapabilitiesUpdate): Promise<ModelCapabilitiesFile> {
      await ensureReady();
      // 文件锁内重读-合并-写盘：多窗口 Host 并发 update 不丢对方字段。
      const next = await withFileLock(filePath, async () => {
        const { file } = await readModelCapabilitiesFile(filePath);
        const base = file ?? current;
        const merged = modelCapabilitiesFileSchema.parse({
          schemaVersion: 2,
          capabilities: applyCapabilityPatch(base.capabilities, params.capabilities),
          migratedFromLegacySettings: base.migratedFromLegacySettings,
          migratedToProviderRef: base.migratedToProviderRef,
        });
        await persist(merged);
        return merged;
      });
      current = next;
      // 凭据变更在档案落盘后写 credentialService（spec §4 顺序），失败向上抛
      // （档案面已生效、凭据面保持旧值 = fail-closed 不出站）。
      await applyCredentials(params);
      notify();
      return structuredClone(current);
    },

    attachProviderCardCreator(
      creator: (input: { name: string; baseUrl: string; apiKey: string }) => Promise<string>,
    ): void {
      attachedCreator = creator as ProviderCardCreator;
    },

    onDidChange(listener: (snapshot: ModelCapabilitiesFile) => void): { dispose(): void } {
      listeners.add(listener);
      return {
        dispose(): void {
          listeners.delete(listener);
        },
      };
    },
  };
}
