/**
 * persona 独立库仓储实现（specs/drora-persona-system.md §4；存储合同
 * docs/design/drora-persona-data-contracts-2026-10-29.md §2）。行严格解码、receipt 行读写
 * 与事务结果原语在 persona-rows.ts；传输层错误分类在 persona-store-errors.ts。
 * CAS/receipt 幂等/容量/超时/未初始化与损坏区分的实现语义清单见 CONTRACT.md。
 */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PERSONA_ERROR_CODES,
  PERSONA_RECEIPT_SCOPES,
  PERSONA_STORE_SCHEMA_VERSION,
  type PersonaForgetResult,
  type PersonaManagementResult,
  type PersonaPolicyMutationResult,
  type PersonaPreferenceFacts,
  type PersonaPreferenceMutationResult,
} from "@drora/shared";
import { ensureSqliteSchemaMigrationTable, sqliteMigrations } from "@drora/shared/sqlite-migrations";
import { PERSONA_STORE_DEFAULTS, PersonaStoreError } from "./contract.js";
import type {
  PersonaStoreAuthorityFacts,
  PersonaStoreCoreFacts,
  PersonaStoreExportSnapshot,
  PersonaStoreForgetPreferenceInput,
  PersonaStoreInitializeInput,
  PersonaStoreInitializedValue,
  PersonaStoreOptions,
  PersonaStorePort,
  PersonaStoreSavePreferenceInput,
  PersonaStoreSnapshot,
  PersonaStoreUpdateCoreInput,
  PersonaStoreUpdateCoreResult,
  PersonaStoreUpdatePolicyInput,
} from "./contract.js";
import { PERSONA_MIGRATIONS } from "./migrations.js";
import {
  asInteger,
  asString,
  code,
  coreContentEquals,
  decodeEditableCore,
  decodePreferenceRow,
  ensureReceiptCapacity,
  failCorruptRow,
  insertReceiptRow,
  readPreferenceSlotRows,
  readPolicyRow,
  readReceiptRow,
  toManagementResult,
  unwrap,
  value,
  type StoreOutcome,
} from "./persona-rows.js";
import {
  isMemoryDatabase,
  isSqliteBusyError,
  readJournalMode,
  sleep,
  toPersonaStoreError,
} from "./persona-store-errors.js";

export { toPersonaStoreError } from "./persona-store-errors.js";

const BUSY_RETRY_INITIAL_DELAY_MS = 10;
const BUSY_RETRY_MAX_DELAY_MS = 200;
const INITIAL_CORE_REVISION = 1;


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

  /** 打开并迁移库。路径必须由调用方从可信存储根解析后传入；不存在时创建（首次显式初始化前库文件可以为空库——「未初始化」是可区分的正常状态）。 */
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
      // policy/偏好与 authority/core 同一短事务读取（合同 §4.2 cutoff）；U off 时偏好零出库。
      const policy = readPolicyRow(this.db);
      return value<PersonaStoreSnapshot>({
        state: "initialized",
        authority,
        core: this.readCoreRowOrThrow(),
        policy,
        preferences: policy.usePreferences ? readPreferenceSlotRows(this.db) : [],
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
        const receipt = readReceiptRow(this.db, 
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
            snapshot: this.readInitializedSnapshot(authority),
          });
        }
        // 已初始化但该 mutationId 首次出现：并发初始化幂等，记 unchanged 回执。
        const core = this.readCoreRowOrThrow();
        if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
        insertReceiptRow(this.db, 
          PERSONA_RECEIPT_SCOPES.authority,
          input.mutationId,
          input.requestDigest,
          "unchanged",
          core.coreRevision,
          0,
          input.now,
        );
        return value<PersonaStoreInitializedValue>({
          status: "unchanged",
          snapshot: this.readInitializedSnapshot(authority),
        });
      }
      // 首次初始化：单事务原子生成 authority+默认核心+created 回执（合同 §1/§3）。
      // opaque ID 用 randomUUID，不从昵称/cwd/用户文本推导。
      if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
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
      insertReceiptRow(this.db, 
        PERSONA_RECEIPT_SCOPES.authority,
        input.mutationId,
        input.requestDigest,
        "created",
        INITIAL_CORE_REVISION,
        0,
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
          policy: readPolicyRow(this.db),
          preferences: [],
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
      const receipt = readReceiptRow(this.db, PERSONA_RECEIPT_SCOPES.core, input.mutationId);
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
        if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
        insertReceiptRow(this.db, 
          PERSONA_RECEIPT_SCOPES.core,
          input.mutationId,
          input.requestDigest,
          "unchanged",
          core.coreRevision,
          0,
          input.now,
        );
        return value<PersonaStoreUpdateCoreResult>({ status: "unchanged" });
      }
      if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
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
      insertReceiptRow(this.db, 
        PERSONA_RECEIPT_SCOPES.core,
        input.mutationId,
        input.requestDigest,
        "saved",
        nextRevision,
        0,
        input.now,
      );
      return value<PersonaStoreUpdateCoreResult>({ status: "saved", coreRevision: nextRevision });
    });
    return toManagementResult(outcome);
  }

  // ---------------------------------------------------------------------------
  // P1a 策略/偏好/导出（合同 §1.2/§2/§4.2/§7；屏障语义见 contract.ts 端口注释）
  // ---------------------------------------------------------------------------

  async updatePolicy(
    input: PersonaStoreUpdatePolicyInput,
  ): Promise<PersonaManagementResult<PersonaPolicyMutationResult>> {
    const outcome = await this.withTxn(true, () => {
      const authority = this.readAuthorityRow();
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      const receipt = readReceiptRow(this.db, PERSONA_RECEIPT_SCOPES.policy, input.mutationId);
      if (receipt) {
        if (receipt.requestDigest !== input.requestDigest) {
          return code(PERSONA_ERROR_CODES.mutationConflict);
        }
        return receipt.resultCode === "unchanged"
          ? value<PersonaPolicyMutationResult>({ status: "unchanged" })
          : value<PersonaPolicyMutationResult>({
              status: "saved",
              policyRevision: receipt.resultRevision,
              policyEpoch: receipt.resultGeneration,
            });
      }
      const current = readPolicyRow(this.db);
      if (current.policyRevision !== input.expectedPolicyRevision) {
        // CAS：失效回执不能绕过（合同 §2）；冲突不写 receipt。
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (current.usePreferences === input.usePreferences) {
        // 无内容变化的策略提交返回 unchanged，不推进 epoch（屏障只在真实变更时前进）。
        if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
        insertReceiptRow(this.db, 
          PERSONA_RECEIPT_SCOPES.policy,
          input.mutationId,
          input.requestDigest,
          "unchanged",
          current.policyRevision,
          current.policyEpoch,
          input.now,
        );
        return value<PersonaPolicyMutationResult>({ status: "unchanged" });
      }
      if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
      const nextRevision = current.policyRevision + 1;
      const nextEpoch = current.policyEpoch + 1;
      this.db
        .prepare(
          `insert into persona_policy (id, use_preferences, policy_revision, policy_epoch, time_updated)
           values (1, ?, ?, ?, ?)
           on conflict(id) do update set use_preferences = excluded.use_preferences,
             policy_revision = excluded.policy_revision,
             policy_epoch = excluded.policy_epoch,
             time_updated = excluded.time_updated`,
        )
        .run(input.usePreferences ? 1 : 0, nextRevision, nextEpoch, input.now);
      insertReceiptRow(this.db, 
        PERSONA_RECEIPT_SCOPES.policy,
        input.mutationId,
        input.requestDigest,
        "saved",
        nextRevision,
        nextEpoch,
        input.now,
      );
      return value<PersonaPolicyMutationResult>({
        status: "saved",
        policyRevision: nextRevision,
        policyEpoch: nextEpoch,
      });
    });
    return toManagementResult(outcome);
  }

  async savePreference(
    input: PersonaStoreSavePreferenceInput,
  ): Promise<PersonaManagementResult<PersonaPreferenceMutationResult>> {
    const outcome = await this.withTxn(true, () => {
      const authority = this.readAuthorityRow();
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      const receipt = readReceiptRow(this.db, PERSONA_RECEIPT_SCOPES.preference, input.mutationId);
      if (receipt) {
        if (receipt.requestDigest !== input.requestDigest) {
          return code(PERSONA_ERROR_CODES.mutationConflict);
        }
        return receipt.resultCode === "unchanged"
          ? value<PersonaPreferenceMutationResult>({ status: "unchanged" })
          : value<PersonaPreferenceMutationResult>({
              status: "saved",
              revision: receipt.resultRevision,
              keyGeneration: receipt.resultGeneration,
            });
      }
      const slot = this.readPreferenceRow(input.key);
      if ((slot?.revision ?? 0) !== input.expectedRevision) {
        // 同一 preferenceKey 的所有编辑入口共享 revision 与写 API（合同 §2/PM22）。
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (slot?.status === "active" && slot.value === input.value) {
        // 同值重存返回 unchanged，不推进 generation（合同 §2 unchanged 语义）。
        if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
        insertReceiptRow(this.db, 
          PERSONA_RECEIPT_SCOPES.preference,
          input.mutationId,
          input.requestDigest,
          "unchanged",
          slot.revision,
          slot.keyGeneration,
          input.now,
        );
        return value<PersonaPreferenceMutationResult>({ status: "unchanged" });
      }
      if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
      const nextRevision = (slot?.revision ?? 0) + 1;
      const nextGeneration = (slot?.keyGeneration ?? 0) + 1;
      this.db
        .prepare(
          `insert into persona_preference
             (key, value, revision, key_generation, provenance_kind, epistemic_status,
              status, pinned, auto_suppressed, time_updated)
           values (?, ?, ?, ?, 'settings', 'explicit', 'active', 1, 0, ?)
           on conflict(key) do update set value = excluded.value,
             revision = excluded.revision,
             key_generation = excluded.key_generation,
             provenance_kind = excluded.provenance_kind,
             epistemic_status = excluded.epistemic_status,
             status = excluded.status,
             pinned = excluded.pinned,
             auto_suppressed = excluded.auto_suppressed,
             time_updated = excluded.time_updated`,
        )
        .run(input.key, input.value, nextRevision, nextGeneration, input.now);
      insertReceiptRow(this.db, 
        PERSONA_RECEIPT_SCOPES.preference,
        input.mutationId,
        input.requestDigest,
        "saved",
        nextRevision,
        nextGeneration,
        input.now,
      );
      return value<PersonaPreferenceMutationResult>({
        status: "saved",
        revision: nextRevision,
        keyGeneration: nextGeneration,
      });
    });
    return toManagementResult(outcome);
  }

  async forgetPreference(
    input: PersonaStoreForgetPreferenceInput,
  ): Promise<PersonaManagementResult<PersonaForgetResult>> {
    const outcome = await this.withTxn(true, () => {
      const authority = this.readAuthorityRow();
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      const receipt = readReceiptRow(this.db, PERSONA_RECEIPT_SCOPES.preference, input.mutationId);
      if (receipt) {
        if (receipt.requestDigest !== input.requestDigest) {
          return code(PERSONA_ERROR_CODES.mutationConflict);
        }
        // 忘记没有 unchanged 终态：必须建立 generation 屏障（合同 §4.2）；
        // 回放携带当时的 revision（重设 CAS 的预期值）。
        return value<PersonaForgetResult>({
          status: "forgotten",
          revision: receipt.resultRevision,
          keyGeneration: receipt.resultGeneration,
        });
      }
      const slot = this.readPreferenceRow(input.key);
      if ((slot?.revision ?? 0) !== input.expectedRevision) {
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
      const nextRevision = (slot?.revision ?? 0) + 1;
      const nextGeneration = (slot?.keyGeneration ?? 0) + 1;
      this.db
        .prepare(
          `insert into persona_preference
             (key, value, revision, key_generation, provenance_kind, epistemic_status,
              status, pinned, auto_suppressed, time_updated)
           values (?, NULL, ?, ?, 'settings', 'explicit', 'forgotten', 0, 1, ?)
           on conflict(key) do update set value = excluded.value,
             revision = excluded.revision,
             key_generation = excluded.key_generation,
             status = excluded.status,
             pinned = excluded.pinned,
             auto_suppressed = excluded.auto_suppressed,
             time_updated = excluded.time_updated`,
        )
        .run(input.key, nextRevision, nextGeneration, input.now);
      insertReceiptRow(this.db, 
        PERSONA_RECEIPT_SCOPES.preference,
        input.mutationId,
        input.requestDigest,
        "forgotten",
        nextRevision,
        nextGeneration,
        input.now,
      );
      return value<PersonaForgetResult>({
        status: "forgotten",
        revision: nextRevision,
        keyGeneration: nextGeneration,
      });
    });
    return toManagementResult(outcome);
  }

  async listPreferences(): Promise<PersonaManagementResult<readonly PersonaPreferenceFacts[]>> {
    const outcome = await this.withTxn(false, () => {
      const authority = this.readAuthorityRow();
      // 未初始化是查询成功的空答案。返回全部槽（含 forgotten 屏障槽及其 revision）：
      // 忘记并列于保存是解决路径（合同 §4.2），重设的 CAS 需要可观测的当前 revision。
      if (!authority) return value<readonly PersonaPreferenceFacts[]>([]);
      return value<readonly PersonaPreferenceFacts[]>(readPreferenceSlotRows(this.db));
    });
    return toManagementResult(outcome);
  }

  async readExportSnapshot(): Promise<PersonaManagementResult<PersonaStoreExportSnapshot>> {
    const outcome = await this.withTxn(false, () => {
      const authority = this.readAuthorityRow();
      // 无资料返回 uninitialized，不为导出初始化默认身份（合同 §7）。
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      return value<PersonaStoreExportSnapshot>({
        core: this.readCoreRowOrThrow(),
        policy: readPolicyRow(this.db),
        // 导出只含未忘记且有效的当前值（合同 §7「只含未忘记且有效的当前值」）。
        preferences: readPreferenceSlotRows(this.db).filter(
          (slot) => slot.status === "active",
        ),
        counts: { inferredOmittedUnverifiable: 0 },
      });
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

  /** 初始化/回放臂的完整快照：authority/core/policy/偏好同事务一致读（合同 §4.2）。 */
  private readInitializedSnapshot(
    authority: PersonaStoreAuthorityFacts,
  ): Extract<PersonaStoreSnapshot, { state: "initialized" }> {
    const policy = readPolicyRow(this.db);
    return {
      state: "initialized",
      authority,
      core: this.readCoreRowOrThrow(),
      policy,
      preferences: policy.usePreferences ? readPreferenceSlotRows(this.db) : [],
    };
  }

  private readPreferenceRow(key: string): PersonaPreferenceFacts | undefined {
    const row = this.db
      .prepare(
        `select key, value, revision, key_generation, provenance_kind,
                epistemic_status, status, pinned, auto_suppressed, time_updated
         from persona_preference where key = ?`,
      )
      .get(key) as Record<string, unknown> | undefined;
    return row ? decodePreferenceRow(row) : undefined;
  }
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
