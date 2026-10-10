/**
 * knowledge-index.sqlite 连接与短事务纪律（W02）。
 *
 * W00 DB Spike §4 全量采纳（docs/vaultview/delivery/W00_DB_HOST_SPIKE.md）：
 * - 每条连接显式 WAL + busy_timeout（node:sqlite 默认 0，持锁即 0ms 失败）；
 * - 写路径一律 BEGIN IMMEDIATE 短事务，SQLITE_BUSY(errcode=5) 单独分类；
 * - DB 按 Profile 数据根隔离（<数据根>/knowledge/knowledge-index.sqlite），
 *   源/epoch 隔离在库内 sources 表完成，不按路径另建文件。
 *
 * node:sqlite（node 24 内置）在 node 24.1 会打印 ExperimentalWarning；Electron 41
 * main 进程已由 W00 spike 实测可用（SQLite 3.51.2），此处不引入第三方 sqlite 依赖。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runKnowledgeMigrations, type KnowledgeDatabaseRaw } from "./migrations.js";

/** SQLITE_BUSY：W00 spike 实测 node:sqlite errcode=5；等待 busy_timeout 耗尽后抛出。 */
export class KnowledgeBusyError extends Error {
  readonly code = "knowledge_busy";
  constructor(cause: unknown) {
    super("knowledge 索引库忙（SQLITE_BUSY）");
    this.cause = cause;
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
  return isSqliteBusyError(error) ? new KnowledgeBusyError(error) : error;
}

/** 默认 busy 预算：跨进程写互斥等待上限（spike2 实测 holder 1.5s 可等待成功）。 */
export const KNOWLEDGE_BUSY_TIMEOUT_MS = 5000;

export interface KnowledgeDatabaseOptions {
  /** 仅供测试收紧等待；生产固定 5000。 */
  busyTimeoutMs?: number;
}

/**
 * 打开（必要时创建）知识索引库。连接是**惰性**的：首次访问 `raw` 才真正建文件，
 * 因为 createLocalServices 会无条件装配本服务，不能让环境问题在启动期炸掉整个
 * 服务集合；首次真正使用时再暴露磁盘/权限故障。同步 IO：调用方是 host 常驻服务，
 * 依赖 §5b.3 的短事务纪律控制阻塞预算，不在事务内做任何文件/网络 IO。
 */
export function openKnowledgeDatabase(dbPath: string, options: KnowledgeDatabaseOptions = {}): KnowledgeDatabase {
  return new KnowledgeDatabase(dbPath, options);
}

export class KnowledgeDatabase {
  private _raw: KnowledgeDatabaseRaw | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly options: KnowledgeDatabaseOptions = {},
  ) {}

  get raw(): KnowledgeDatabaseRaw {
    if (this._raw) return this._raw;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const raw = new DatabaseSync(this.dbPath) as KnowledgeDatabaseRaw;
    raw.exec(`PRAGMA journal_mode=WAL`);
    raw.exec(`PRAGMA busy_timeout=${this.options.busyTimeoutMs ?? KNOWLEDGE_BUSY_TIMEOUT_MS}`);
    // 缓存库可安全重建：崩溃后靠 WAL 自动恢复，不引入额外同步原语。
    raw.exec("PRAGMA synchronous=NORMAL");
    raw.exec("PRAGMA foreign_keys=ON");
    runKnowledgeMigrations(raw);
    this._raw = raw;
    return raw;
  }

  /**
   * 短事务：BEGIN IMMEDIATE 取写锁 → fn（纯 DB 操作）→ COMMIT；异常 ROLLBACK。
   * 事务内首条语句就会等待 busy_timeout；fn 只做同步 DB 调用。
   */
  transaction<T>(fn: (db: KnowledgeDatabase) => T): T {
    try {
      this.raw.exec("BEGIN IMMEDIATE");
    } catch (error) {
      throw wrapBusy(error);
    }
    try {
      const result = fn(this);
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

  /** 接管/定期体检（W00 spike §4.5）：checkpoint + integrity，异常如实上抛。 */
  healthCheck(): { integrity: string } {
    this.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const row = this.raw.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    return { integrity: row.integrity_check ?? "unknown" };
  }

  close(): void {
    this._raw?.close();
    this._raw = null;
  }
}
