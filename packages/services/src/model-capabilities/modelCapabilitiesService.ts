/**
 * 模型能力档案服务实现（specs/model-capabilities.md §4；F-1）。
 *
 * `~/.drora/v2/model_capabilities.json` 的唯一所有者：
 * - 读：get() 返回档案快照；文件缺失 = 全默认，坏 JSON/坏 schema = 备份原文件后
 *   降级全默认（fail-closed，各能力默认关闭），绝不因档案损坏阻断初始化；
 * - 写：唯一路径 update(patch)——zod 校验 → 原子写盘（进程间文件锁内重读合并，
 *   多窗口 Host 并发写不丢字段）→ 凭据变更写 credentialService → onDidChange 广播；
 * - 迁移：首次访问执行一次性旧键迁移（legacyMigration.ts，幂等标记）。
 *
 * apiKey 一律不进档案文件、不进 onDidChange 载荷，只在 ICredentialService（加密）。
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
  type ModelCapabilitiesUpdate,
  type ModelCapabilityEntriesPatch,
} from "@drora/shared";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@drora/shared/node";
import { createCredentialService } from "../credential/credentialService.js";
import type { ICredentialService } from "../credential/credential.js";
import type { ISettingService } from "../setting/setting.js";
import { readRawLegacyAppSettings } from "../setting/settingService.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getAppConfigDir } from "../paths.js";
import type { IModelCapabilitiesService } from "./contract.js";
import {
  deleteLegacyCredentialKeys,
  deleteLegacySettingsKeys,
  resolveLegacyMigration,
} from "./legacyMigration.js";

const logger = createServiceLogger("modelCapabilities");

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
}

interface FileReadResult {
  /** null = 文件缺失或损坏（损坏已备份并降级全默认）。 */
  file: ModelCapabilitiesFile | null;
  /** 损坏降级发生时携带备份路径（诊断用；缺失不携带）。 */
  backupPath?: string;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** 读档案并按 §3.2 校验；损坏文件按内容确定性备份后降级（MC-1），绝不向上抛解析错。 */
async function readModelCapabilitiesFile(filePath: string): Promise<FileReadResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return { file: null };
    throw error;
  }
  try {
    const parsed = modelCapabilitiesFileSchema.parse(JSON.parse(raw));
    return { file: parsed };
  } catch (error) {
    // 坏 JSON/坏 schema（含未来 schemaVersion 与预留 mode:"remote"）：备份证据后
    // 降级全默认，下一轮 update 原子替换原文件。
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

export function createModelCapabilitiesService(
  dependencies: ModelCapabilitiesServiceDependencies,
): IModelCapabilitiesService {
  const credentialService = dependencies.credentialService ?? createCredentialService();
  const filePath = join(getAppConfigDir(), MODEL_CAPABILITIES_FILE_NAME);
  const listeners = new Set<(snapshot: ModelCapabilitiesFile) => void>();
  let current: ModelCapabilitiesFile = defaultModelCapabilitiesFile();
  let ready: Promise<void> | null = null;

  async function persist(file: ModelCapabilitiesFile): Promise<void> {
    await atomicWritePrivateTextFile(filePath, `${JSON.stringify(file, null, 2)}\n`);
  }

  /**
   * 首次初始化：读档案（缺失/损坏 → 全默认）→ 未迁移则执行一次性旧键迁移
   * （§3.3，标记幂等）。迁移任何异常都按降级处理，不阻断读路径。
   */
  async function initialize(): Promise<void> {
    const { file } = await readModelCapabilitiesFile(filePath);
    const base = file ?? defaultModelCapabilitiesFile();
    if (base.migratedFromLegacySettings === true) {
      current = base;
      return;
    }
    const migration = await resolveLegacyMigration(
      {
        settingService: dependencies.settingService,
        credentialService,
        readLegacySettings: dependencies.readLegacySettings ?? readRawLegacyAppSettings,
      },
      base.capabilities,
    );
    const migrated: ModelCapabilitiesFile = {
      schemaVersion: 1,
      capabilities: migration.capabilities,
      migratedFromLegacySettings: true,
    };
    // spec §3.3 顺序不变式：幂等标记落盘成功后才清理旧 AppSettings 键与旧凭据键。
    // 落盘失败时必须保留全部旧键——下次启动档案无标记会重迁移，旧值俱在，
    // 收敛到同一档案值；若落盘失败仍删旧键，重迁移只能拿到默认值，用户配置
    // 不可逆丢失（两文件可独立失败，删除必须以标记成功为前提）。落盘失败本身
    // 不阻断读路径：进程内仍服务迁移结果，重试在下次启动发生。
    let markerPersisted = false;
    try {
      await persist(migrated);
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
    current = migrated;
  }

  async function ensureReady(): Promise<void> {
    if (ready === null) {
      ready = initialize().catch((error) => {
        // initialize 内部已逐段容错；此处只兜底未预见的异常，保证读路径永不抛。
        logger.warn(undefined, "model capabilities initialization degraded", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    await ready;
  }

  /** 凭据写删：null/空串 = 删除（ApiKeyRow「留空保存即删除」语义）。 */
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
    if (credentials.asr !== undefined) {
      await writeOrDeleteCredential(modelCapabilityCredentialKey.asr, credentials.asr);
    }
    if (credentials.tts !== undefined) {
      await writeOrDeleteCredential(modelCapabilityCredentialKey.tts, credentials.tts);
    }
    if (credentials.imageGeneration !== undefined) {
      await writeOrDeleteCredential(
        modelCapabilityCredentialKey.imageGeneration,
        credentials.imageGeneration,
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
      // 读失败仅读 IO 异常向上抛（损坏已在 readModelCapabilitiesFile 内降级）。
      const { file } = await readModelCapabilitiesFile(filePath);
      current = file ?? current;
      return structuredClone(current);
    },

    async update(params: ModelCapabilitiesUpdate): Promise<ModelCapabilitiesFile> {
      await ensureReady();
      // 文件锁内重读-合并-写盘：多窗口 Host 并发 update 不丢对方字段（整文件
      // read-modify-write 必须与替换同锁，同 credentialService 写队列语义）。
      const next = await withFileLock(filePath, async () => {
        const { file } = await readModelCapabilitiesFile(filePath);
        const base = file ?? current;
        const merged = modelCapabilitiesFileSchema.parse({
          schemaVersion: 1,
          capabilities: applyCapabilityPatch(base.capabilities, params.capabilities),
          migratedFromLegacySettings: base.migratedFromLegacySettings,
        });
        await persist(merged);
        return merged;
      });
      current = next;
      // 凭据变更在档案落盘后写 credentialService（spec §4 顺序），失败向上抛
      // （调用方据此重试；档案面已生效，凭据面保持旧值 = fail-closed 不出站）。
      await applyCredentials(params);
      notify();
      return structuredClone(current);
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
