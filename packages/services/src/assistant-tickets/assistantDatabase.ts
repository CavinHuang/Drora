/**
 * mate.sqlite 连接与短事务纪律（照 knowledge/store/knowledgeDatabase.ts 先例全量采纳）：
 * - 显式 WAL + busy_timeout（node:sqlite 默认 0，持锁即 0ms 失败）；
 * - 写路径 BEGIN IMMEDIATE 短事务，SQLITE_BUSY(errcode=5) 单独分类；
 * - 库文件 <getAppConfigDir()>/<ASSISTANT_STORAGE_KEYS.directory>/<ASSISTANT_STORAGE_KEYS.database>
 *   （路径拼接只引用 contracts/assistant.ts 单一出处的字面量）；
 * - 连接惰性：createLocalServices 无条件装配本服务，不能让环境问题在启动期炸掉服务集合。
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
// 静态 ESM import "node:sqlite" 会被构建器外部化并剥掉 node: 前缀（knowledgeDatabase.ts
// 同因注释）；require 形式在产物中保留完整前缀。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

import { ASSISTANT_STORE_SCHEMA_VERSION, ASSISTANT_STORAGE_KEYS } from "@drora/shared";
import { join } from "node:path";

export class AssistantStoreBusyError extends Error {
  readonly code = "mate.store.busy";
  constructor(cause: unknown) {
    super("mate 台账库忙（SQLITE_BUSY）");
    this.cause = cause;
  }
}

export class AssistantStoreMigrationError extends Error {
  readonly code = "mate.store.migration";
  constructor(message: string) {
    super(message);
  }
}

export function isSqliteBusyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    (error as { errcode?: unknown }).errcode === 5
  );
}

function wrapBusy(error: unknown): unknown {
  return isSqliteBusyError(error) ? new AssistantStoreBusyError(error) : error;
}

export const ASSISTANT_BUSY_TIMEOUT_MS = 5000;

export interface AssistantDatabaseOptions {
  /** 仅供测试收紧等待；生产固定 5000。 */
  busyTimeoutMs?: number;
}

export type AssistantDatabaseRaw = import("node:sqlite").DatabaseSync;

export function resolveAssistantDatabasePath(appConfigDir: string): string {
  return join(appConfigDir, ASSISTANT_STORAGE_KEYS.directory, ASSISTANT_STORAGE_KEYS.database);
}

export function openAssistantDatabase(
  dbPath: string,
  options: AssistantDatabaseOptions = {},
): AssistantDatabase {
  return new AssistantDatabase(dbPath, options);
}

export class AssistantDatabase {
  private _raw: AssistantDatabaseRaw | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly options: AssistantDatabaseOptions = {},
  ) {}

  get raw(): AssistantDatabaseRaw {
    if (this._raw) return this._raw;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const raw = new DatabaseSync(this.dbPath) as AssistantDatabaseRaw;
    raw.exec(`PRAGMA journal_mode=WAL`);
    raw.exec(`PRAGMA busy_timeout=${this.options.busyTimeoutMs ?? ASSISTANT_BUSY_TIMEOUT_MS}`);
    // 台账为可重建的事实记录：崩溃后靠 WAL 自动恢复，synchronous=NORMAL。
    raw.exec("PRAGMA synchronous=NORMAL");
    raw.exec("PRAGMA foreign_keys=ON");
    runAssistantMigrations(raw);
    this._raw = raw;
    return raw;
  }

  transaction<T>(fn: (db: AssistantDatabaseRaw) => T): T {
    try {
      this.raw.exec("BEGIN IMMEDIATE");
    } catch (error) {
      throw wrapBusy(error);
    }
    try {
      const result = fn(this.raw);
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.raw.exec("ROLLBACK");
      } catch {
        // ROLLBACK 失败只发生在连接已损坏场景；原始错误更有诊断价值。
      }
      throw wrapBusy(error);
    }
  }

  close(): void {
    this._raw?.close();
    this._raw = null;
  }
}

/**
 * 迁移只加不破（01 §1.1；bots repo 先例）：v1 建基线；未知未来版本拒绝打开
 * （schema_incompatible 语义），不猜测降级。
 */
function runAssistantMigrations(raw: AssistantDatabaseRaw): void {
  raw.exec(`CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_ms INTEGER NOT NULL
  )`);

  const versionRow = raw.prepare("SELECT value FROM kv WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const currentVersion = versionRow ? Number(versionRow.value) : 0;

  if (currentVersion > ASSISTANT_STORE_SCHEMA_VERSION) {
    throw new AssistantStoreMigrationError(
      `mate.sqlite schema_version=${currentVersion} 高于本进程支持的 ${ASSISTANT_STORE_SCHEMA_VERSION}`,
    );
  }

  if (currentVersion < 1) {
    raw.exec(`CREATE TABLE IF NOT EXISTS trigger (
      id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      simulated_strength TEXT NOT NULL,
      identity TEXT NOT NULL,
      workspace_identity TEXT,
      text TEXT NOT NULL,
      at_ms INTEGER NOT NULL
    )`);
    raw.exec(`CREATE TABLE IF NOT EXISTS admission_decision (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_id TEXT NOT NULL REFERENCES trigger(id),
      strength TEXT NOT NULL,
      mode TEXT NOT NULL,
      outcome TEXT NOT NULL,
      reason_code TEXT,
      decided_by TEXT NOT NULL,
      decided_ms INTEGER NOT NULL
    )`);
    raw.exec(`CREATE TABLE IF NOT EXISTS mandate (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      state TEXT NOT NULL,
      created_cause TEXT NOT NULL DEFAULT 'accept',
      ended_ms INTEGER,
      end_reason TEXT
    )`);
    raw.exec(`CREATE TABLE IF NOT EXISTS ticket (
      id TEXT PRIMARY KEY,
      mandate_id TEXT NOT NULL REFERENCES mandate(id),
      decision_id INTEGER,
      brief TEXT NOT NULL,
      target_workspace_identity TEXT NOT NULL,
      status TEXT NOT NULL,
      incarnation_current TEXT NOT NULL,
      incarnation_generations TEXT NOT NULL DEFAULT '[]',
      usage_accum TEXT NOT NULL DEFAULT '{}',
      output_summary TEXT,
      fail_reason TEXT,
      created_ms INTEGER NOT NULL,
      updated_ms INTEGER NOT NULL
    )`);
    raw.exec(`CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      turn_ref TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      at_ms INTEGER NOT NULL
    )`);
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '1', strftime('%s','now') * 1000) ON CONFLICT(key) DO NOTHING",
    );
  }
}
