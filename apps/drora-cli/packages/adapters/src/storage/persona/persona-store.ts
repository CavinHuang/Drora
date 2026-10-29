/**
 * persona 独立库仓储实现（specs/drora-persona-system.md §4；存储合同
 * docs/design/drora-persona-data-contracts-2026-10-29.md §2）。
 *
 * 访问模式沿既有 session-store 体系：node:sqlite DatabaseSync 单连接 + 异步方法门面 +
 * 短事务（begin immediate/deferred）+ busy_timeout 有限等待 + 预算内退避重试
 * （migration-runner.ts 的 BUSY 重试先例）。当前实现仍在调用线程上同步执行 SQL：
 * 实施计划 §3.B 的「adapters worker / 正式 worker 最低可运行验证」是切片 B 的剩余交付
 * （合同 §2「SQLite 位于异步 worker」），不得记为已交付；随发行包的三平台打包检查记录
 * 才属切片 D。切片 C 把管理 API 接到 CLI 进程主线程前必须先落地 worker——worker 缺席时
 * BUSY 等待最长阻塞调用线程 lockWaitTimeoutMs，锁竞争会整进程卡顿。
 *
 * 并发串行化：单连接上同一实例的重叠事务由进程内队列互斥（见 txnQueue）；跨连接并发
 * 不受影响，仍由 SQLite WAL/事务与 BUSY 预算重试裁决。
 *
 * 语义要点（逐条对应合同 §2）：
 * - CAS：core 更新必须 expectedRevision 匹配；冲突返回 revision_conflict 且不写 receipt
 *   （失效回执不能绕过 CAS）。
 * - receipt 幂等：同 scope+mutationId 同摘要回放先前终态（saved 带当时的 resultRevision，
 *   即使之后核心又被其他变更推进）；同 ID 异摘要 mutation_conflict；权限/authority 检查
 *   先于 receipt 查询。
 * - 容量：达到 4096 条/authority 时先清 7 天窗口外的过期项；窗口内凭据不驱逐；仍满则拒绝
 *   新管理写并返回 storage_capacity。
 * - 超时：写请求在预算内拿不到锁/提交，对外表达 outcome_unknown（不谎报失败或成功），
 *   读请求表达 storage_unavailable。
 * - 未初始化（无 authority 行）与损坏（非 SQLite 文件、checksum 不符、未知账本、行内容
 *   非法、schemaVersion 更大）严格区分：后者 schema_incompatible 只停扩展，不降级写旧
 *   schema、不静默换默认身份。
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PERSONA_ERROR_CODES,
  PERSONA_RECEIPT_SCOPES,
  PERSONA_STORE_SCHEMA_VERSION,
  classifyDatabaseStartupError,
  type DatabaseStartupErrorCode,
  type PersonaEditableCore,
  type PersonaErrorCode,
  type PersonaManagementResult,
  type PersonaReceiptResultCode,
} from "@drora/shared";
import {
  ensureSqliteSchemaMigrationTable,
  MigrationChecksumError,
  sqliteMigrations,
} from "@drora/shared/sqlite-migrations";
import { PERSONA_STORE_DEFAULTS, PersonaStoreError } from "./contract.js";
import type {
  PersonaStoreAuthorityFacts,
  PersonaStoreCoreFacts,
  PersonaStoreInitializeInput,
  PersonaStoreInitializedValue,
  PersonaStoreOptions,
  PersonaStorePort,
  PersonaStoreSnapshot,
  PersonaStoreUpdateCoreInput,
  PersonaStoreUpdateCoreResult,
} from "./contract.js";
import { PERSONA_MIGRATIONS } from "./migrations.js";

const SQLITE_BUSY = 5;
const BUSY_RETRY_INITIAL_DELAY_MS = 10;
const BUSY_RETRY_MAX_DELAY_MS = 200;
const INITIAL_CORE_REVISION = 1;

/** 事务内函数的返回：value=提交；code=回滚并把封闭错误码交给调用方。 */
type StoreOutcome<T> = { kind: "value"; value: T } | { kind: "code"; code: PersonaErrorCode };

function value<T>(value: T): StoreOutcome<T> {
  return { kind: "value", value };
}

function code(code: PersonaErrorCode): StoreOutcome<never> {
  return { kind: "code", code };
}

function isSqliteBusyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    typeof error.errcode === "number" &&
    (error.errcode & 0xff) === SQLITE_BUSY
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJournalMode(db: DatabaseSync, enableWal: boolean): string {
  const row = db.prepare(enableWal ? "pragma journal_mode = wal" : "pragma journal_mode").get() as
    | Record<string, unknown>
    | undefined;
  const mode = row?.journal_mode;
  return typeof mode === "string" ? mode.toLowerCase() : "unknown";
}

function isMemoryDatabase(dbPath: string): boolean {
  return dbPath === ":memory:";
}

// ---------------------------------------------------------------------------
// 行严格解码：库内容与声明 schema 不符按损坏处理（schema_incompatible），不静默容忍。
// ---------------------------------------------------------------------------

function asString(rowValue: unknown): string {
  return typeof rowValue === "string" ? rowValue : failCorruptRow();
}

function asInteger(rowValue: unknown): number {
  return typeof rowValue === "number" && Number.isSafeInteger(rowValue) ? rowValue : failCorruptRow();
}

/** 行内容与声明 schema 不符的内部哨兵；对外必须分类为 schema_incompatible（合同 §2）。 */
class CorruptPersonaRowError extends Error {}

function failCorruptRow(): never {
  throw new CorruptPersonaRowError("persona row content does not match its declared schema");
}

const WARMTH_VALUES: readonly string[] = ["restrained", "balanced", "warm"];
const DIRECTNESS_VALUES: readonly string[] = ["gentle", "balanced", "direct"];
const HUMOR_VALUES: readonly string[] = ["off", "light"];

function decodeEditableCore(row: Record<string, unknown>): PersonaEditableCore {
  const warmth = asString(row.warmth);
  const directness = asString(row.directness);
  const humor = asString(row.humor);
  if (!WARMTH_VALUES.includes(warmth) || !DIRECTNESS_VALUES.includes(directness) || !HUMOR_VALUES.includes(humor)) {
    failCorruptRow();
  }
  return {
    displayName: asString(row.display_name),
    selfDescription: asString(row.self_description),
    warmth: warmth as PersonaEditableCore["warmth"],
    directness: directness as PersonaEditableCore["directness"],
    humor: humor as PersonaEditableCore["humor"],
  };
}

function coreContentEquals(a: PersonaEditableCore, b: PersonaEditableCore): boolean {
  return (
    a.displayName === b.displayName &&
    a.selfDescription === b.selfDescription &&
    a.warmth === b.warmth &&
    a.directness === b.directness &&
    a.humor === b.humor
  );
}

export class PersonaSqliteStore implements PersonaStorePort {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly lockWaitTimeoutMs: number;
  private readonly adminRequestBudgetMs: number;
  private readonly receiptRetentionMs: number;
  private readonly receiptMaxPerAuthority: number;
  private closed = false;
  /**
   * 进程内事务队列：node:sqlite 单连接上重叠的 begin 会报 errcode 1「cannot start a
   * transaction within a transaction」，而 toStoreError 对 errcode 1 只能归类为
   * storage_unavailable——会把内部串行化缺陷伪装成环境故障。同实例的每个事务按到达顺序
   * 串行执行（含提交/回滚完全落定）；每个事务的预算在真正开跑时才起算，排队等待不消耗
   * 管理请求总预算（合同 §2）。队列自身不会 reject，失败只通过事务自己的 Promise 传播。
   */
  private txnQueue: Promise<unknown> = Promise.resolve();

  private constructor(db: DatabaseSync, options: ResolvedPersonaStoreOptions) {
    this.db = db;
    this.dbPath = options.dbPath;
    this.lockWaitTimeoutMs = options.lockWaitTimeoutMs;
    this.adminRequestBudgetMs = options.adminRequestBudgetMs;
    this.receiptRetentionMs = options.receiptRetentionMs;
    this.receiptMaxPerAuthority = options.receiptMaxPerAuthority;
  }

  /**
   * 打开并迁移库。路径必须由调用方从可信存储根解析后传入；不存在时创建（首次显式
   * 初始化前库文件可以为空库——「未初始化」是可区分的正常状态，不是损坏）。
   */
  static async open(options: PersonaStoreOptions): Promise<PersonaSqliteStore> {
    if (!options.dbPath) {
      throw new PersonaStoreError("Persona store requires a caller-provided database path", {
        code: PERSONA_ERROR_CODES.storageUnavailable,
      });
    }
    const resolved = resolveOptions(options);
    let db: DatabaseSync;
    try {
      if (!isMemoryDatabase(resolved.dbPath)) {
        await mkdir(dirname(resolved.dbPath), { recursive: true });
      }
      db = new DatabaseSync(resolved.dbPath, { timeout: resolved.lockWaitTimeoutMs });
    } catch (error) {
      throw new PersonaStoreError(`Failed to open persona database at ${resolved.dbPath}`, {
        code: PERSONA_ERROR_CODES.storageUnavailable,
        cause: error,
        dbPath: resolved.dbPath,
      });
    }
    const store = new PersonaSqliteStore(db, resolved);
    try {
      await store.initializeSchema();
      return store;
    } catch (error) {
      try {
        db.close();
      } catch {
        /* 关闭失败不能覆盖打开/迁移错误。 */
      }
      throw error;
    }
  }

  async readSnapshot(): Promise<PersonaStoreSnapshot> {
    const outcome = await this.withTxn(false, () => {
      const authority = this.readAuthorityRow();
      if (!authority) return value<PersonaStoreSnapshot>({ state: "uninitialized" });
      return value<PersonaStoreSnapshot>({
        state: "initialized",
        authority,
        core: this.readCoreRowOrThrow(),
      });
    });
    return unwrap(outcome);
  }

  async initializeAuthority(
    input: PersonaStoreInitializeInput,
  ): Promise<PersonaManagementResult<PersonaStoreInitializedValue>> {
    const outcome = await this.withTxn(true, () => {
      // authority 存在性先于 receipt 查询（合同 §2「权限/authority 校验先于 receipt 查询」）。
      const authority = this.readAuthorityRow();
      if (authority) {
        const receipt = this.readReceipt(
          PERSONA_RECEIPT_SCOPES.authority,
          input.mutationId,
        );
        if (receipt) {
          if (receipt.requestDigest !== input.requestDigest) {
            return code(PERSONA_ERROR_CODES.mutationConflict);
          }
          // authority scope 只写 created/unchanged；出现 saved 说明账本被外部改写，按损坏处理。
          if (receipt.resultCode !== "created" && receipt.resultCode !== "unchanged") {
            failCorruptRow();
          }
          // 同 ID 同摘要：回放先前终态（created 原样回放，unchanged 原样回放）。
          return value<PersonaStoreInitializedValue>({
            status: receipt.resultCode,
            snapshot: { state: "initialized", authority, core: this.readCoreRowOrThrow() },
          });
        }
        // 已初始化但该 mutationId 首次出现：并发初始化幂等，记 unchanged 回执。
        const core = this.readCoreRowOrThrow();
        if (!this.ensureReceiptCapacity(input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
        this.insertReceipt(
          PERSONA_RECEIPT_SCOPES.authority,
          input.mutationId,
          input.requestDigest,
          "unchanged",
          core.coreRevision,
          input.now,
        );
        return value<PersonaStoreInitializedValue>({
          status: "unchanged",
          snapshot: { state: "initialized", authority, core },
        });
      }
      // 首次初始化：单事务原子生成 authority+默认核心+created 回执（合同 §1/§3）。
      // opaque ID 用 randomUUID，不从昵称/cwd/用户文本推导。
      if (!this.ensureReceiptCapacity(input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
      const authorityId = randomUUID();
      const personaId = randomUUID();
      this.db
        .prepare(
          `insert into persona_authority (id, authority_id, persona_id, schema_version, time_created)
           values (1, ?, ?, ?, ?)`,
        )
        .run(authorityId, personaId, PERSONA_STORE_SCHEMA_VERSION, input.now);
      this.db
        .prepare(
          `insert into persona_core
             (id, core_revision, template_version, display_name, self_description,
              warmth, directness, humor, time_created, time_updated)
           values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          INITIAL_CORE_REVISION,
          input.templateVersion,
          input.initialCore.displayName,
          input.initialCore.selfDescription,
          input.initialCore.warmth,
          input.initialCore.directness,
          input.initialCore.humor,
          input.now,
          input.now,
        );
      this.insertReceipt(
        PERSONA_RECEIPT_SCOPES.authority,
        input.mutationId,
        input.requestDigest,
        "created",
        INITIAL_CORE_REVISION,
        input.now,
      );
      return value<PersonaStoreInitializedValue>({
        status: "created",
        snapshot: {
          state: "initialized",
          authority: {
            authorityId,
            personaId,
            schemaVersion: PERSONA_STORE_SCHEMA_VERSION,
            createdAt: input.now,
          },
          core: {
            coreRevision: INITIAL_CORE_REVISION,
            templateVersion: input.templateVersion,
            core: input.initialCore,
            updatedAt: input.now,
          },
        },
      });
    });
    return toManagementResult(outcome);
  }

  async updateCore(
    input: PersonaStoreUpdateCoreInput,
  ): Promise<PersonaManagementResult<PersonaStoreUpdateCoreResult>> {
    const outcome = await this.withTxn(true, () => {
      const authority = this.readAuthorityRow();
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      const receipt = this.readReceipt(PERSONA_RECEIPT_SCOPES.core, input.mutationId);
      if (receipt) {
        if (receipt.requestDigest !== input.requestDigest) {
          return code(PERSONA_ERROR_CODES.mutationConflict);
        }
        // 回放先前终态：saved 带当时记录的 revision（之后核心可能又被其他变更推进）。
        return receipt.resultCode === "unchanged"
          ? value<PersonaStoreUpdateCoreResult>({ status: "unchanged" })
          : value<PersonaStoreUpdateCoreResult>({
              status: "saved",
              coreRevision: receipt.resultRevision,
            });
      }
      const core = this.readCoreRowOrThrow();
      // CAS：失效 expectedRevision 返回 revision_conflict，不写 receipt（合同 §2）。
      if (core.coreRevision !== input.expectedRevision) {
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (coreContentEquals(core.core, input.next)) {
        // 无内容变化的有效保存返回 unchanged，不制造新 revision（合同 §2）。
        if (!this.ensureReceiptCapacity(input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
        this.insertReceipt(
          PERSONA_RECEIPT_SCOPES.core,
          input.mutationId,
          input.requestDigest,
          "unchanged",
          core.coreRevision,
          input.now,
        );
        return value<PersonaStoreUpdateCoreResult>({ status: "unchanged" });
      }
      if (!this.ensureReceiptCapacity(input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
      const nextRevision = core.coreRevision + 1;
      this.db
        .prepare(
          `update persona_core
           set core_revision = ?, template_version = ?, display_name = ?, self_description = ?,
               warmth = ?, directness = ?, humor = ?, time_updated = ?
           where id = 1`,
        )
        .run(
          nextRevision,
          core.templateVersion,
          input.next.displayName,
          input.next.selfDescription,
          input.next.warmth,
          input.next.directness,
          input.next.humor,
          input.now,
        );
      this.insertReceipt(
        PERSONA_RECEIPT_SCOPES.core,
        input.mutationId,
        input.requestDigest,
        "saved",
        nextRevision,
        input.now,
      );
      return value<PersonaStoreUpdateCoreResult>({ status: "saved", coreRevision: nextRevision });
    });
    return toManagementResult(outcome);
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      this.db.close();
    } catch {
      /* 幂等关闭。 */
    }
  }

  // ---------------------------------------------------------------------------
  // 事务与预算（合同 §2：锁等待初始 100ms、管理请求总预算初始 5s）
  // ---------------------------------------------------------------------------

  /** 预算内对 BUSY 做退避重试；预算耗尽把最后一个 BUSY 交给调用方按读/写分类。 */
  private async acquire<T>(deadline: number, operation: () => T): Promise<T> {
    let delay = BUSY_RETRY_INITIAL_DELAY_MS;
    for (;;) {
      try {
        return operation();
      } catch (error) {
        if (!isSqliteBusyError(error)) throw error;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw error;
        await sleep(Math.min(delay, remaining));
        delay = Math.min(BUSY_RETRY_MAX_DELAY_MS, delay * 2);
      }
    }
  }

  private async withTxn<T>(write: boolean, fn: () => StoreOutcome<T>): Promise<StoreOutcome<T>> {
    // 单连接互斥：入队等前序事务落定后再开跑，重叠调用不会撞出第二个 begin。
    const outcome = this.txnQueue.then(() => this.runTxn(write, fn));
    this.txnQueue = outcome.then(
      () => undefined,
      () => undefined,
    );
    return outcome;
  }

  private async runTxn<T>(write: boolean, fn: () => StoreOutcome<T>): Promise<StoreOutcome<T>> {
    this.assertOpen();
    const deadline = Date.now() + this.adminRequestBudgetMs;
    try {
      await this.acquire(deadline, () =>
        this.db.exec(write ? "begin immediate" : "begin deferred"),
      );
    } catch (error) {
      throw this.toStoreError(error, { write });
    }
    try {
      const outcome = fn();
      if (outcome.kind === "value") {
        // WAL 下提交也可能与并发写者撞忙；同一预算内重试，超时按写请求表达 outcome_unknown。
        await this.acquire(deadline, () => this.db.exec("commit"));
      } else if (this.db.isTransaction) {
        this.db.exec("rollback");
      }
      return outcome;
    } catch (error) {
      if (this.db.isTransaction) {
        try {
          this.db.exec("rollback");
        } catch {
          /* 保留首个错误。 */
        }
      }
      throw this.toStoreError(error, { write });
    }
  }

  /**
   * 传输层错误分类（合同 §2/§3）：损坏/checksum 不符 → schema_incompatible（只停扩展，
   * 不降级写旧 schema）；写超预算的 BUSY → outcome_unknown；其余 → storage_unavailable。
   * 打开/迁移阶段按读分类（迁移要么已回滚要么已提交，不存在未知结局）。
   */
  private toStoreError(error: unknown, context: { write: boolean }): PersonaStoreError {
    return toPersonaStoreError(error, { write: context.write, dbPath: this.dbPath });
  }

  private assertOpen(): void {
    if (this.closed || !this.db.isOpen) {
      throw new PersonaStoreError("Persona store is closed", {
        code: PERSONA_ERROR_CODES.storageUnavailable,
        dbPath: this.dbPath,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 打开期 schema 处置（迁移未知版本/损坏 → schema_incompatible，只停扩展）
  // ---------------------------------------------------------------------------

  private async initializeSchema(): Promise<void> {
    const deadline = Date.now() + this.adminRequestBudgetMs;
    try {
      if (!isMemoryDatabase(this.dbPath)) {
        await this.acquire(deadline, () => {
          if (readJournalMode(this.db, true) !== "wal") {
            throw new Error(`SQLite refused WAL journal mode for ${this.dbPath}`);
          }
        });
      }
      await this.acquire(deadline, () => this.rejectForeignMigrations());
      await this.acquire(deadline, () => this.db.exec("begin immediate"));
      ensureSqliteSchemaMigrationTable(this.db);
      await sqliteMigrations.migrate(this.db, PERSONA_MIGRATIONS, {
        database: "persona",
        transactionOpen: true,
        appliedAtColumn: "time_applied",
        backupDirectories: [dirname(this.dbPath)],
      });
      // 历史库的 authority 行如果带着更大的 schemaVersion，说明被更新版本写过：拒绝打开。
      this.readAuthorityRow();
    } catch (error) {
      if (this.db.isTransaction) {
        try {
          this.db.exec("rollback");
        } catch {
          /* 保留首个错误。 */
        }
      }
      throw this.toStoreError(error, { write: false });
    }
  }

  /** 账本里出现本版本不认识的迁移＝库被更新版本写过（合同 §2「迁移未知版本」）。 */
  private rejectForeignMigrations(): void {
    const hasLedger = this.db
      .prepare("select 1 from sqlite_master where type='table' and name='schema_migration'")
      .get();
    if (!hasLedger) return;
    const known = new Set(PERSONA_MIGRATIONS.map((migration) => migration.id));
    const rows = this.db.prepare("select id from schema_migration").all() as Array<
      Record<string, unknown>
    >;
    const foreign = rows.map((row) => row.id).filter((id) => typeof id === "string" && !known.has(id));
    if (foreign.length > 0) {
      throw new PersonaStoreError(
        `Persona database contains unknown migration ledger entries: ${foreign.join(", ")}`,
        { code: PERSONA_ERROR_CODES.schemaIncompatible, dbPath: this.dbPath },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 行读取（严格解码）
  // ---------------------------------------------------------------------------

  private readAuthorityRow(): PersonaStoreAuthorityFacts | undefined {
    const row = this.db
      .prepare(
        "select authority_id, persona_id, schema_version, time_created from persona_authority where id = 1",
      )
      .get() as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const schemaVersion = asInteger(row.schema_version);
    if (schemaVersion !== PERSONA_STORE_SCHEMA_VERSION) {
      throw new PersonaStoreError(
        `Persona database schema version ${schemaVersion} is not supported by this build (${PERSONA_STORE_SCHEMA_VERSION})`,
        { code: PERSONA_ERROR_CODES.schemaIncompatible, dbPath: this.dbPath },
      );
    }
    return {
      authorityId: asString(row.authority_id),
      personaId: asString(row.persona_id),
      schemaVersion,
      createdAt: asInteger(row.time_created),
    };
  }

  private readCoreRowOrThrow(): PersonaStoreCoreFacts {
    const row = this.db
      .prepare(
        `select core_revision, template_version, display_name, self_description,
                warmth, directness, humor, time_updated
         from persona_core where id = 1`,
      )
      .get() as Record<string, unknown> | undefined;
    // authority 与 core 在同一事务写入；有 authority 无 core 属于库内容损坏。
    if (!row) failCorruptRow();
    return {
      coreRevision: asInteger(row!.core_revision),
      templateVersion: asInteger(row!.template_version),
      core: decodeEditableCore(row!),
      updatedAt: asInteger(row!.time_updated),
    };
  }

  private readReceipt(
    scope: string,
    mutationId: string,
  ): { requestDigest: string; resultCode: PersonaReceiptResultCode; resultRevision: number } | undefined {
    const row = this.db
      .prepare(
        `select request_digest, result_code, result_revision
         from persona_mutation_receipt where scope = ? and mutation_id = ?`,
      )
      .get(scope, mutationId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const resultCode = asString(row.result_code);
    if (resultCode !== "created" && resultCode !== "saved" && resultCode !== "unchanged") {
      failCorruptRow();
    }
    return {
      requestDigest: asString(row.request_digest),
      resultCode,
      resultRevision: asInteger(row.result_revision),
    };
  }

  private insertReceipt(
    scope: string,
    mutationId: string,
    requestDigest: string,
    resultCode: PersonaReceiptResultCode,
    resultRevision: number,
    now: number,
  ): void {
    this.db
      .prepare(
        `insert into persona_mutation_receipt
           (scope, mutation_id, request_digest, result_code, result_revision, time_created)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(scope, mutationId, requestDigest, resultCode, resultRevision, now);
  }

  /**
   * 容量闸门（合同 §2）：达到每 authority 上限时先清 7 天窗口外的过期项；窗口内幂等
   * 凭据不驱逐；仍满则拒绝本次管理写（调用方返回 storage_capacity，事务回滚）。
   */
  private ensureReceiptCapacity(now: number): boolean {
    if (this.countReceipts() < this.receiptMaxPerAuthority) return true;
    this.db
      .prepare("delete from persona_mutation_receipt where time_created < ?")
      .run(now - this.receiptRetentionMs);
    return this.countReceipts() < this.receiptMaxPerAuthority;
  }

  private countReceipts(): number {
    const row = this.db
      .prepare("select count(*) as n from persona_mutation_receipt")
      .get() as Record<string, unknown> | undefined;
    return asInteger(row?.n);
  }
}

/**
 * 传输层错误分类（合同 §2/§3）。模块级纯函数：PersonaSqliteStore 的事务/打开路径经
 * toStoreError 使用它；独立导出是为了让测试能用真实 SQLITE_BUSY 错误对象直接断言
 * 读/写分支（读→storage_unavailable、写→outcome_unknown）——WAL 读侧 BUSY 无法在
 * 本进程对已附加连接稳定复现，但分类语义必须可验证。
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

function unwrap<T>(outcome: StoreOutcome<T>): T {
  if (outcome.kind === "value") return outcome.value;
  throw new PersonaStoreError(`Persona store rejected the operation: ${outcome.code}`, {
    code: outcome.code,
  });
}

function toManagementResult<T>(
  outcome: StoreOutcome<T>,
): PersonaManagementResult<T> {
  return outcome.kind === "value"
    ? { ok: true, value: outcome.value }
    : { ok: false, code: outcome.code };
}

interface ResolvedPersonaStoreOptions {
  dbPath: string;
  lockWaitTimeoutMs: number;
  adminRequestBudgetMs: number;
  receiptRetentionMs: number;
  receiptMaxPerAuthority: number;
}

function resolveOptions(options: PersonaStoreOptions): ResolvedPersonaStoreOptions {
  return {
    dbPath: options.dbPath,
    lockWaitTimeoutMs: options.lockWaitTimeoutMs ?? PERSONA_STORE_DEFAULTS.lockWaitTimeoutMs,
    adminRequestBudgetMs: options.adminRequestBudgetMs ?? PERSONA_STORE_DEFAULTS.adminRequestBudgetMs,
    receiptRetentionMs: options.receiptRetentionMs ?? PERSONA_STORE_DEFAULTS.receiptRetentionMs,
    receiptMaxPerAuthority:
      options.receiptMaxPerAuthority ?? PERSONA_STORE_DEFAULTS.receiptMaxPerAuthority,
  };
}

export async function openPersonaStore(options: PersonaStoreOptions): Promise<PersonaSqliteStore> {
  return PersonaSqliteStore.open(options);
}
