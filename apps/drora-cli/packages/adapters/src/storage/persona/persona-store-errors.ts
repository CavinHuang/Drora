/**
 * persona 库传输层错误分类与 SQLite 连接原语（cli-persona-store 内部模块，非公开入口）。
 * 分类语义（合同 §2/§3）：损坏/checksum 不符 → schema_incompatible（只停扩展，不降级写旧
 * schema）；写超预算的 BUSY → outcome_unknown（不谎报失败或成功）；其余 → storage_unavailable。
 * 独立模块导出 toPersonaStoreError 是为了让测试能用真实 SQLITE_BUSY 错误对象直接断言
 * 读/写分支——WAL 读侧 BUSY 无法在本进程对已附加连接稳定复现，但分类语义必须可验证。
 */
import { DatabaseSync } from "node:sqlite";
import { MigrationChecksumError } from "@drora/shared/sqlite-migrations";
import { PERSONA_ERROR_CODES, type DatabaseStartupErrorCode, classifyDatabaseStartupError } from "@drora/shared";
import { PersonaStoreError } from "./contract.js";
import { CorruptPersonaRowError } from "./persona-rows.js";

const SQLITE_BUSY = 5;

export function isSqliteBusyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    typeof error.errcode === "number" &&
    (error.errcode & 0xff) === SQLITE_BUSY
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readJournalMode(db: DatabaseSync, enableWal: boolean): string {
  const row = db.prepare(enableWal ? "pragma journal_mode = wal" : "pragma journal_mode").get() as
    | Record<string, unknown>
    | undefined;
  const mode = row?.journal_mode;
  return typeof mode === "string" ? mode.toLowerCase() : "unknown";
}

export function isMemoryDatabase(dbPath: string): boolean {
  return dbPath === ":memory:";
}

/**
 * 传输层错误分类（合同 §2/§3）。模块级纯函数：PersonaSqliteStore 的事务/打开路径经
 * toStoreError 使用它。
 */
export function toPersonaStoreError(
  error: unknown,
  context: { write: boolean; dbPath: string },
): PersonaStoreError {
  if (error instanceof PersonaStoreError) return error;
  if (error instanceof CorruptPersonaRowError) {
    return new PersonaStoreError("Persona database content is corrupted", {
      code: PERSONA_ERROR_CODES.schemaIncompatible,
      cause: error,
      dbPath: context.dbPath,
    });
  }
  if (error instanceof MigrationChecksumError) {
    return new PersonaStoreError(
      `Persona database migration checksum mismatch: ${error.migrationId}`,
      { code: PERSONA_ERROR_CODES.schemaIncompatible, cause: error, dbPath: context.dbPath },
    );
  }
  const kind: DatabaseStartupErrorCode = classifyDatabaseStartupError(error);
  if (kind === "corrupt" || kind === "checksum_mismatch") {
    return new PersonaStoreError("Persona database is corrupted or uses an unknown schema", {
      code: PERSONA_ERROR_CODES.schemaIncompatible,
      cause: error,
      dbPath: context.dbPath,
    });
  }
  if (isSqliteBusyError(error)) {
    return new PersonaStoreError("Persona database lock wait exceeded its budget", {
      code: context.write
        ? PERSONA_ERROR_CODES.outcomeUnknown
        : PERSONA_ERROR_CODES.storageUnavailable,
      cause: error,
      dbPath: context.dbPath,
    });
  }
  return new PersonaStoreError("Persona database storage is unavailable", {
    code: PERSONA_ERROR_CODES.storageUnavailable,
    cause: error,
    dbPath: context.dbPath,
  });
}
