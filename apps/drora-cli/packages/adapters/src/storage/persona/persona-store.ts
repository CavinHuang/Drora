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
  type PersonaAllowLearningResult,
  type PersonaForgetResult,
  type PersonaManagementResult,
  type PersonaPolicyMutationResult,
  type PersonaPreferenceFacts,
  type PersonaPreferenceMutationResult,
} from "@drora/shared";
import { ensureSqliteSchemaMigrationTable, sqliteMigrations } from "@drora/shared/sqlite-migrations";
import {
  PERSONA_STORE_DEFAULTS,
  PersonaStoreError,
  type ResolvedPersonaStoreOptions,
} from "./contract.js";
import type {
  PersonaStoreAuthorityFacts,
  PersonaStoreCoreFacts,
  PersonaStoreExportSnapshot,
  PersonaStoreAllowLearningInput,
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
import type { PersonaLearningStorePort } from "./persona-learning-contract.js";
import { PersonaLearningSqliteStore } from "./persona-learning-store.js";
import {
  asInteger,
  code,
  coreContentEquals,
  decodeEditableCore,
  deleteLearningBodiesForKey,
  ensureReceiptCapacity,
  failCorruptRow,
  insertReceiptRow,
  readPreferenceSlotRow,
  readPreferenceSlotRows,
  readPolicyRow,
  readReceiptRow,
  readAuthorityRow as readAuthorityRowShared,
  toManagementResult,
  unwrap,
  value,
} from "./persona-rows.js";
import {
  clearAllPendingCandidates,
  terminateNonTerminalWorksForPolicy,
} from "./persona-learning-rows.js";
import { isMemoryDatabase, readJournalMode } from "./persona-store-errors.js";
import { PersonaSqliteTxnRunner } from "./persona-store-txn.js";

export { toPersonaStoreError } from "./persona-store-errors.js";

const INITIAL_CORE_REVISION = 1;


export class PersonaSqliteStore implements PersonaStorePort {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly lockWaitTimeoutMs: number;
  private readonly receiptRetentionMs: number;
  private readonly receiptMaxPerAuthority: number;
  /**
   * 管理事务与学习事务共享的队列化运行器（persona-store-txn.ts）：单连接上重叠的 begin
   * 会被误分类为 storage_unavailable，两个仓储面的所有短事务都按到达顺序经同一队列
   * 串行执行（含提交/回滚完全落定）；每个事务的预算在真正开跑时才起算，排队等待不消耗
   * 管理请求总预算（合同 §2）。队列自身不会 reject，失败只通过事务自己的 Promise 传播。
   */
  private readonly txn: PersonaSqliteTxnRunner;
  /** P1b 学习面（证据接收/工作队列/预算/候选提交）；与本实例同库同队列。 */
  readonly learning: PersonaLearningStorePort;

  private constructor(db: DatabaseSync, options: ResolvedPersonaStoreOptions) {
    this.db = db;
    this.dbPath = options.dbPath;
    this.lockWaitTimeoutMs = options.lockWaitTimeoutMs;
    this.receiptRetentionMs = options.receiptRetentionMs;
    this.receiptMaxPerAuthority = options.receiptMaxPerAuthority;
    this.txn = new PersonaSqliteTxnRunner(db, options.dbPath, options.adminRequestBudgetMs);
    this.learning = new PersonaLearningSqliteStore(db, this.txn, options);
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
    const outcome = await this.txn.withTxn(false, () => {
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
    const outcome = await this.txn.withTxn(true, () => {
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
    const outcome = await this.txn.withTxn(true, () => {
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
    const outcome = await this.txn.withTxn(true, () => {
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
      // P1b（合同 §1 Policy/P1b、§4.2）：autoLearn 是 patch 字段（缺省＝保持当前值）；
      // 关闭 U 必须同一事务强制 L=false。learningGeneration 在 autoLearn 真值变 false
      // 的事务内递增（学习域单调屏障）。
      const nextUsePreferences = input.usePreferences;
      const nextAutoLearn = nextUsePreferences ? (input.autoLearn ?? current.autoLearn) : false;
      const contentChanged =
        current.usePreferences !== nextUsePreferences || current.autoLearn !== nextAutoLearn;
      if (!contentChanged) {
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
      const learningDisabled = current.autoLearn && !nextAutoLearn;
      const nextLearningGeneration = learningDisabled
        ? current.learningGeneration + 1
        : current.learningGeneration;
      this.db
        .prepare(
          `insert into persona_policy (id, use_preferences, auto_learn, learning_generation,
                                       policy_revision, policy_epoch, time_updated)
           values (1, ?, ?, ?, ?, ?, ?)
           on conflict(id) do update set use_preferences = excluded.use_preferences,
             auto_learn = excluded.auto_learn,
             learning_generation = excluded.learning_generation,
             policy_revision = excluded.policy_revision,
             policy_epoch = excluded.policy_epoch,
             time_updated = excluded.time_updated`,
        )
        .run(
          nextUsePreferences ? 1 : 0,
          nextAutoLearn ? 1 : 0,
          nextLearningGeneration,
          nextRevision,
          nextEpoch,
          input.now,
        );
      if (learningDisabled) {
        // 合同 §4.2 级联（U=false 或 L=false 同事务）：撤全部学习租约＝非终态工作终态化
        // （rejected/policy_off，无正文可清），清全部未提交候选正文。在飞提交随后被
        // epoch/工作状态屏障拒绝，不能靠预算重试复活。
        terminateNonTerminalWorksForPolicy(this.db, input.now);
        clearAllPendingCandidates(this.db);
      }
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
    const outcome = await this.txn.withTxn(true, () => {
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
      const slot = readPreferenceSlotRow(this.db, input.key);
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
      // 显式保存解决该键争议并清候选（合同 §3「savePreference…清该键候选」）；旧 inferred
      // 合并来源不描述新值，一并清除。
      deleteLearningBodiesForKey(this.db, input.key);
      this.db
        .prepare(
          `insert into persona_preference
             (key, value, revision, key_generation, provenance_kind, epistemic_status,
              status, pinned, auto_suppressed, disputed, time_updated)
           values (?, ?, ?, ?, 'settings', 'explicit', 'active', 1, 0, 0, ?)
           on conflict(key) do update set value = excluded.value,
             revision = excluded.revision,
             key_generation = excluded.key_generation,
             provenance_kind = excluded.provenance_kind,
             epistemic_status = excluded.epistemic_status,
             status = excluded.status,
             pinned = excluded.pinned,
             auto_suppressed = excluded.auto_suppressed,
             disputed = excluded.disputed,
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
    const outcome = await this.txn.withTxn(true, () => {
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
      const slot = readPreferenceSlotRow(this.db, input.key);
      if ((slot?.revision ?? 0) !== input.expectedRevision) {
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
      const nextRevision = (slot?.revision ?? 0) + 1;
      const nextGeneration = (slot?.keyGeneration ?? 0) + 1;
      // 忘记是逻辑撤销屏障：清候选正文/合并来源、disputed 归零（忘记是并列解决路径）。
      deleteLearningBodiesForKey(this.db, input.key);
      this.db
        .prepare(
          `insert into persona_preference
             (key, value, revision, key_generation, provenance_kind, epistemic_status,
              status, pinned, auto_suppressed, disputed, time_updated)
           values (?, NULL, ?, ?, 'settings', 'explicit', 'forgotten', 0, 1, 0, ?)
           on conflict(key) do update set value = excluded.value,
             revision = excluded.revision,
             key_generation = excluded.key_generation,
             status = excluded.status,
             pinned = excluded.pinned,
             auto_suppressed = excluded.auto_suppressed,
             disputed = excluded.disputed,
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

  async allowLearningForKey(
    input: PersonaStoreAllowLearningInput,
  ): Promise<PersonaManagementResult<PersonaAllowLearningResult>> {
    const outcome = await this.txn.withTxn(true, () => {
      const authority = this.readAuthorityRow();
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      const receipt = readReceiptRow(this.db, PERSONA_RECEIPT_SCOPES.preference, input.mutationId);
      if (receipt) {
        if (receipt.requestDigest !== input.requestDigest) {
          return code(PERSONA_ERROR_CODES.mutationConflict);
        }
        return receipt.resultCode === "unchanged"
          ? value<PersonaAllowLearningResult>({ status: "unchanged" })
          : value<PersonaAllowLearningResult>({
              status: "saved",
              revision: receipt.resultRevision,
              keyGeneration: receipt.resultGeneration,
            });
      }
      const slot = readPreferenceSlotRow(this.db, input.key);
      // CAS 前置＝该键当前 generation（合同 §3；槽缺席按 0），失效凭据不能绕过（合同 §2）。
      if ((slot?.keyGeneration ?? 0) !== input.expectedGeneration) {
        return code(PERSONA_ERROR_CODES.revisionConflict);
      }
      if (!slot || !slot.autoSuppressed) {
        // 无抑制可解除：unchanged 不推进 generation（合同 §2），不为不存在的抑制建屏障槽。
        if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
        insertReceiptRow(this.db,
          PERSONA_RECEIPT_SCOPES.preference,
          input.mutationId,
          input.requestDigest,
          "unchanged",
          slot?.revision ?? 0,
          slot?.keyGeneration ?? 0,
          input.now,
        );
        return value<PersonaAllowLearningResult>({ status: "unchanged" });
      }
      if (!ensureReceiptCapacity(this.db, this.receiptMaxPerAuthority, this.receiptRetentionMs, input.now)) return code(PERSONA_ERROR_CODES.storageCapacity);
      const nextRevision = slot.revision + 1;
      const nextGeneration = slot.keyGeneration + 1;
      // 只解除抑制（status/value/pinned/disputed 原样——争议仍由保存/忘记解决，合同 §8；
      // 「不恢复旧源/旧值」）。generation++ 使旧工作/候选的接收期快照失效（合同 §4.2
      // 「只接受之后的新机会」），旧工作提交被 generation 屏障拒绝，不复活旧来源。
      this.db
        .prepare(
          `update persona_preference
             set revision = ?, key_generation = ?, auto_suppressed = 0, time_updated = ?
           where key = ?`,
        )
        .run(nextRevision, nextGeneration, input.now, input.key);
      insertReceiptRow(this.db,
        PERSONA_RECEIPT_SCOPES.preference,
        input.mutationId,
        input.requestDigest,
        "saved",
        nextRevision,
        nextGeneration,
        input.now,
      );
      return value<PersonaAllowLearningResult>({
        status: "saved",
        revision: nextRevision,
        keyGeneration: nextGeneration,
      });
    });
    return toManagementResult(outcome);
  }

  async listPreferences(): Promise<PersonaManagementResult<readonly PersonaPreferenceFacts[]>> {
    const outcome = await this.txn.withTxn(false, () => {
      const authority = this.readAuthorityRow();
      // 未初始化是查询成功的空答案。返回全部槽（含 forgotten 屏障槽及其 revision）：
      // 忘记并列于保存是解决路径（合同 §4.2），重设的 CAS 需要可观测的当前 revision。
      if (!authority) return value<readonly PersonaPreferenceFacts[]>([]);
      return value<readonly PersonaPreferenceFacts[]>(readPreferenceSlotRows(this.db));
    });
    return toManagementResult(outcome);
  }

  async readExportSnapshot(): Promise<PersonaManagementResult<PersonaStoreExportSnapshot>> {
    const outcome = await this.txn.withTxn(false, () => {
      const authority = this.readAuthorityRow();
      // 无资料返回 uninitialized，不为导出初始化默认身份（合同 §7）。
      if (!authority) return code(PERSONA_ERROR_CODES.uninitialized);
      // 导出快照冻结全部未忘记且有效的当前值（合同 §7「只含未忘记且有效的当前值」）：
      // 显式（settings）与 inferred（extraction）一并携带；inferred 槽的来源复验与
      // 「不可验证→省略」计数发生在事务外（服务层，合同 §7 时序「仅复验 inferred 来源」）
      // ——仓储无法验证来源，不做预省略、不把「未尝试验证」预记为「不可验证」。
      const slots = readPreferenceSlotRows(this.db).filter((slot) => slot.status === "active");
      return value<PersonaStoreExportSnapshot>({
        core: this.readCoreRowOrThrow(),
        policy: readPolicyRow(this.db),
        preferences: slots,
      });
    });
    return toManagementResult(outcome);
  }

  async close(): Promise<void> {
    this.txn.markClosed();
    try {
      this.db.close();
    } catch {
      /* 幂等关闭。 */
    }
  }

  // ---------------------------------------------------------------------------
  // 打开期 schema 处置（迁移未知版本/损坏 → schema_incompatible，只停扩展）
  // ---------------------------------------------------------------------------

  private async initializeSchema(): Promise<void> {
    try {
      if (!isMemoryDatabase(this.dbPath)) {
        await this.txn.acquireDuringOpen(() => {
          if (readJournalMode(this.db, true) !== "wal") {
            throw new Error(`SQLite refused WAL journal mode for ${this.dbPath}`);
          }
        });
      }
      await this.txn.acquireDuringOpen(() => this.rejectForeignMigrations());
      await this.txn.acquireDuringOpen(() => this.db.exec("begin immediate"));
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
      throw this.txn.toOpenError(error);
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

  /** 行读取（严格解码）；authority 读取委托 persona-rows 的共享实现（学习面同源）。 */
  private readAuthorityRow(): PersonaStoreAuthorityFacts | undefined {
    return readAuthorityRowShared(this.db);
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
