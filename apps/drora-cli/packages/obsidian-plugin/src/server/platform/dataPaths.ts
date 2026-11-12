/**
 * 插件侧数据路径解析（specs/obsidian-vault-phase2-true-extraction.md §5/§11-D14，
 * P3 交付、P6 切换首建缺省）：双轨期（P3-P7）知识栈实现已在插件包，旧 host 四服务仍
 * 在本体读旧路径；P7 已拆除本体实现，P6（本批）把「搬迁 + 首建」缺省切到插件目录：
 *
 * - 两目录都有库 → `dual_db_conflict`：拒绝启动数据面并给结构化状态（人工取舍提示，
 *   不静默合并——D14 建议值先行）；
 * - 仅旧路径有库 → `legacy`：升级用户首启态——server 启动链随即执行 §5 自动搬迁
 *   （platform/knowledgeMigration.ts：checkpoint + owner 活性校验 + move + 计数校验
 *   + 失败回退），搬迁成功后本进程内重解析为 `plugin`；搬迁被拒（活跃 writer）或
 *   失败回退后仍以 legacy 数据面继续服务（原件保留）；
 * - 仅插件目录有库，或两处都没有 → `plugin`：目标态路径 `<插件数据目录>/knowledge/`
 *   （§3 数据目录）。**两处都没有时首建也落插件目录**（P6 切换，撤销 P3 的旧路径
 *   首建缺省——P7 后旧 host 已不存在，旧路径不再有人开库，继续落旧路径只会给下一次
 *   升级制造多余的搬迁）。
 *
 * 数据根推导与 services paths.getDataBaseDir 同式（setDataBaseDir 进程内覆写 >
 * env DRORA_DATA_BASE_DIR > homedir()）：测试用 setDataBaseDir 注入临时根，生产经
 * env 跨进程对齐。插件数据目录优先取宿主注入的 DRORA_PLUGIN_DATA（official-plugin-
 * runtime 的 appService/env 注入面），缺省回落与 services
 * resolveObsidianPluginDataDir 同式的本地推导（公式以注释锁定，见 vault/
 * obsidianVaultService.ts 同款）。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { KNOWLEDGE_INDEX_DB_FILE_NAME } from "./knowledgeEvidence.js";

let dataBaseDirOverride: string | null = null;
const envDataBaseDir = process.env.DRORA_DATA_BASE_DIR?.trim() || null;
// 进程启动期快照默认值：与 services paths.ts 同式（HOME 优先于 homedir()，防止运行中
// 环境变化导致旧实例写新目录）——旧路径推导必须与本体逐字节一致，否则双轨期插件侧
// 会指向另一个目录制造假 dual_db_conflict。
const defaultDataBaseDir = process.env.HOME?.trim() || homedir();

/** 与 services paths.setDataBaseDir 同语义：进程内覆写数据基目录（测试注入用）。 */
export function setDataBaseDir(dir: string | null): void {
  dataBaseDirOverride = dir?.trim() || null;
}

/** 数据基目录：setDataBaseDir() > env DRORA_DATA_BASE_DIR > homedir()。 */
export function getDataBaseDir(): string {
  if (dataBaseDirOverride) return dataBaseDirOverride;
  if (envDataBaseDir) return envDataBaseDir;
  return defaultDataBaseDir;
}

/** {dataBaseDir}/.drora —— 与 services getDroraDataRootDir 同式。 */
export function getDroraDataRootDir(): string {
  return join(getDataBaseDir(), ".drora");
}

/**
 * 官方插件 id；与 services obsidianVaultService / bootstrap official-plugin-
 * definitions 的本地常量同值（各侧依赖方向约束不允许互相 import，值的一致性由
 * 各自注释锁定；本处是插件包内的引用点）。
 */
const OBSIDIAN_PLUGIN_ID = "obsidian@drora-plugins-official";

/**
 * 插件数据目录：优先宿主注入的 DRORA_PLUGIN_DATA（appService/会话级 MCP 两条启动
 * 链一致注入），缺省按 services resolveObsidianPluginDataDir 同式本地推导。
 */
export function resolvePluginDataDir(): string {
  const injected = process.env.DRORA_PLUGIN_DATA?.trim();
  if (injected) return injected;
  const storageRoot = getDroraDataRootDir();
  const cliStorageRoot = basename(storageRoot) === "cli" ? storageRoot : join(storageRoot, "cli");
  return join(cliStorageRoot, "data", OBSIDIAN_PLUGIN_ID);
}

/** 旧路径知识库：`<数据根>/.drora/knowledge/knowledge-index.sqlite`（§5 迁移源）。 */
export function resolveLegacyKnowledgeDatabasePath(): string {
  return join(getDroraDataRootDir(), "knowledge", KNOWLEDGE_INDEX_DB_FILE_NAME);
}

/** 目标态知识库：`<插件数据目录>/knowledge/knowledge-index.sqlite`（§3 数据目录）。 */
export function resolvePluginKnowledgeDatabasePath(): string {
  return join(resolvePluginDataDir(), "knowledge", KNOWLEDGE_INDEX_DB_FILE_NAME);
}

export type KnowledgeDataPlan =
  | {
      mode: "legacy";
      databasePath: string;
      /** 模型根随库同侧（§5：localEmbeddingPort 数据根口径随迁移一并进插件目录）。 */
      modelRoot: string;
      pluginDataDir: string;
    }
  | {
      mode: "plugin";
      databasePath: string;
      modelRoot: string;
      pluginDataDir: string;
    }
  | {
      mode: "dual_db_conflict";
      /** 结构化冲突事实：两路径都存在，交人工取舍（D14：不静默合并）。 */
      legacyDatabasePath: string;
      pluginDatabasePath: string;
      pluginDataDir: string;
    };

/**
 * 数据路径状态机（§5/§11-D14）。按文件系统事实判定（两个进程看到的同一份
 * 事实，解析天然一致）；P6 起「无库首建」缺省落插件目录（见文件头）。
 */
export function resolveKnowledgeDataPlan(): KnowledgeDataPlan {
  const legacyDatabasePath = resolveLegacyKnowledgeDatabasePath();
  const pluginDatabasePath = resolvePluginKnowledgeDatabasePath();
  const pluginDataDir = resolvePluginDataDir();
  const legacyExists = existsSync(legacyDatabasePath);
  const pluginExists = existsSync(pluginDatabasePath);
  if (legacyExists && pluginExists) {
    return {
      mode: "dual_db_conflict",
      legacyDatabasePath,
      pluginDatabasePath,
      pluginDataDir,
    };
  }
  if (legacyExists) {
    // 仅旧路径有库：升级用户首启态，server 启动链执行 §5 自动搬迁（P6）。
    return {
      mode: "legacy",
      databasePath: legacyDatabasePath,
      modelRoot: join(getDroraDataRootDir(), "knowledge", "models"),
      pluginDataDir,
    };
  }
  // 仅插件目录有库（搬迁完成/插件态新建），或两处都没有（首建落插件目录，P6 切换）。
  return {
    mode: "plugin",
    databasePath: pluginDatabasePath,
    modelRoot: join(pluginDataDir, "knowledge", "models"),
    pluginDataDir,
  };
}
