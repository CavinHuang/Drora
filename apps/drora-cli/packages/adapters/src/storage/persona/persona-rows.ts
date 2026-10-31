/**
 * persona 库行严格解码与事务结果原语（cli-persona-store 内部模块，非公开入口；
 * 供 persona-store.ts 的事务实现复用）。行内容与声明 schema 不符按损坏处理
 * （schema_incompatible，合同 §2），不静默容忍。
 */
import { DatabaseSync } from "node:sqlite";
import {
  PERSONA_ERROR_CODES,
  PERSONA_LEARNING_BUDGET,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_POLICY_DEFAULTS,
  PERSONA_STORE_SCHEMA_VERSION,
  type PersonaEditableCore,
  type PersonaErrorCode,
  type PersonaManagementResult,
  type PersonaReceiptResultCode,
  type PersonaPolicyFacts,
  type PersonaPreferenceFacts,
  type PersonaPreferenceKey,
  type PersonaPendingCandidateFacts,
} from "@drora/shared";
import { PersonaStoreError, type PersonaStoreAuthorityFacts } from "./contract.js";

/**
 * authority 单例行（含 schemaVersion 校验）：管理面与学习面共用。历史库带着更大的
 * schemaVersion 说明被更新版本写过，拒绝打开（schema_incompatible，只停扩展）。
 */
export function readAuthorityRow(db: DatabaseSync): PersonaStoreAuthorityFacts | undefined {
  const row = db
    .prepare(
      "select authority_id, persona_id, schema_version, time_created from persona_authority where id = 1",
    )
    .get() as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const schemaVersion = asInteger(row.schema_version);
  if (schemaVersion !== PERSONA_STORE_SCHEMA_VERSION) {
    throw new PersonaStoreError(
      `Persona database schema version ${schemaVersion} is not supported by this build (${PERSONA_STORE_SCHEMA_VERSION})`,
      { code: PERSONA_ERROR_CODES.schemaIncompatible },
    );
  }
  return {
    authorityId: asString(row.authority_id),
    personaId: asString(row.persona_id),
    schemaVersion,
    createdAt: asInteger(row.time_created),
  };
}

export function asString(rowValue: unknown): string {
  return typeof rowValue === "string" ? rowValue : failCorruptRow();
}

export function asInteger(rowValue: unknown): number {
  return typeof rowValue === "number" && Number.isSafeInteger(rowValue)
    ? rowValue
    : failCorruptRow();
}

/** 行内容与声明 schema 不符的内部哨兵；对外必须分类为 schema_incompatible（合同 §2）。 */
export class CorruptPersonaRowError extends Error {}

export function failCorruptRow(): never {
  throw new CorruptPersonaRowError("persona row content does not match its declared schema");
}

const WARMTH_VALUES: readonly string[] = ["restrained", "balanced", "warm"];
const DIRECTNESS_VALUES: readonly string[] = ["gentle", "balanced", "direct"];
const HUMOR_VALUES: readonly string[] = ["off", "light"];
/** 与 shared contracts 加宽后的来源/认识状态封闭集一致（合同 §1.2，迁移 CHECK 同词汇）。 */
const PROVENANCE_VALUES: readonly string[] = ["settings", "extraction"];
const EPISTEMIC_VALUES: readonly string[] = ["explicit", "inferred"];

export function decodeEditableCore(row: Record<string, unknown>): PersonaEditableCore {
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

export function coreContentEquals(a: PersonaEditableCore, b: PersonaEditableCore): boolean {
  return (
    a.displayName === b.displayName &&
    a.selfDescription === b.selfDescription &&
    a.warmth === b.warmth &&
    a.directness === b.directness &&
    a.humor === b.humor
  );
}

// 受控四键单一出处是 shared contracts 的 PERSONA_PREFERENCE_KEYS（AGENTS.md）；
// 仓储层只做键集合校验，扩展键时这里自动跟随。
const PREFERENCE_KEYS: readonly string[] = Object.values(PERSONA_PREFERENCE_KEYS);

/**
 * 严格解码一个偏好槽行（P1b 起 join 待确认候选）；内容与声明 schema 不符按损坏处理
 * （schema_incompatible）。行 SELECT 形状见 PREFERENCE_SLOT_SELECT。
 */
export function decodePreferenceRow(row: Record<string, unknown>): PersonaPreferenceFacts {
  const key = asString(row.key);
  if (!PREFERENCE_KEYS.includes(key)) failCorruptRow();
  const status = asString(row.status);
  if (status !== "active" && status !== "forgotten") failCorruptRow();
  const value = row.value;
  if (status === "active") {
    if (typeof value !== "string") failCorruptRow();
  } else if (value !== null) {
    // forgotten 槽不保留旧值（合同 §1.2）；残留正文属于库内容损坏。
    failCorruptRow();
  }
  const pinned = asInteger(row.pinned);
  const autoSuppressed = asInteger(row.auto_suppressed);
  const disputed = asInteger(row.disputed);
  if (
    (pinned !== 0 && pinned !== 1) ||
    (autoSuppressed !== 0 && autoSuppressed !== 1) ||
    (disputed !== 0 && disputed !== 1)
  ) {
    failCorruptRow();
  }
  const provenance = asString(row.provenance_kind);
  const epistemic = asString(row.epistemic_status);
  if (!PROVENANCE_VALUES.includes(provenance) || !EPISTEMIC_VALUES.includes(epistemic)) {
    failCorruptRow();
  }
  // 候选关联只在候选表存在对应行时出现（被拒/被取代候选整行删除，无正文残留）。
  let pendingCandidate: PersonaPendingCandidateFacts | undefined;
  if (row.candidate_value !== null && row.candidate_value !== undefined) {
    pendingCandidate = {
      proposedValue: asString(row.candidate_value),
      evidenceId: asString(row.candidate_evidence_id),
      expectedGeneration: asInteger(row.candidate_expected_generation),
      createdAt: asInteger(row.candidate_created_at),
    };
  }
  return {
    key: key as PersonaPreferenceKey,
    value: status === "active" ? (value as string) : "",
    revision: asInteger(row.revision),
    keyGeneration: asInteger(row.key_generation),
    provenanceKind: provenance as PersonaPreferenceFacts["provenanceKind"],
    epistemicStatus: epistemic as PersonaPreferenceFacts["epistemicStatus"],
    pinned: pinned === 1,
    disputed: disputed === 1,
    autoSuppressed: autoSuppressed === 1,
    pendingCandidate,
    updatedAt: asInteger(row.time_updated),
    status,
  };
}

/** 槽行＋待确认候选关联的统一 SELECT（候选表 LEFT JOIN；P1b 起含 disputed 列）。 */
const PREFERENCE_SLOT_SELECT = `
  select p.key, p.value, p.revision, p.key_generation, p.provenance_kind,
         p.epistemic_status, p.status, p.pinned, p.auto_suppressed, p.disputed, p.time_updated,
         c.proposed_value as candidate_value, c.evidence_id as candidate_evidence_id,
         c.expected_generation as candidate_expected_generation,
         c.time_created as candidate_created_at
  from persona_preference p
  left join persona_learning_candidate c on c.key = p.key`;

export function readPolicyRow(db: DatabaseSync): PersonaPolicyFacts {
  const row = db
    .prepare(
      `select use_preferences, auto_learn, learning_generation, policy_revision, policy_epoch
       from persona_policy where id = 1`,
    )
    .get() as Record<string, unknown> | undefined;
  // 行缺席＝读侧默认（迁移不回填；首次 setPersonalPolicy 才创建）。learningBudget 是
  // shared contracts 的首版冻结常量（合同 §6「不允许运行中自动扩大预算」）。
  if (!row) {
    return { ...PERSONA_POLICY_DEFAULTS, learningBudget: PERSONA_LEARNING_BUDGET };
  }
  const usePreferences = asInteger(row.use_preferences);
  const autoLearn = asInteger(row.auto_learn);
  if (usePreferences !== 0 && usePreferences !== 1) failCorruptRow();
  if (autoLearn !== 0 && autoLearn !== 1) failCorruptRow();
  return {
    usePreferences: usePreferences === 1,
    autoLearn: autoLearn === 1,
    learningGeneration: asInteger(row.learning_generation),
    policyRevision: asInteger(row.policy_revision),
    policyEpoch: asInteger(row.policy_epoch),
    learningBudget: PERSONA_LEARNING_BUDGET,
  };
}

export function readPreferenceSlotRows(db: DatabaseSync): PersonaPreferenceFacts[] {
  const rows = db
    .prepare(`${PREFERENCE_SLOT_SELECT} order by p.key`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(decodePreferenceRow);
}

/** 单键槽读取（含候选关联）；槽缺席返回 undefined。 */
export function readPreferenceSlotRow(
  db: DatabaseSync,
  key: string,
): PersonaPreferenceFacts | undefined {
  const row = db.prepare(`${PREFERENCE_SLOT_SELECT} where p.key = ?`).get(key) as
    | Record<string, unknown>
    | undefined;
  return row ? decodePreferenceRow(row) : undefined;
}

/**
 * 键级联清理（合同 §3/§4.2）：显式保存「清该键候选」、忘记「清 value/版本/候选」。
 * P1b 起同时清除该键的待确认候选正文与合并来源（旧来源不描述新值，不随槽复活）。
 */
export function deleteLearningBodiesForKey(db: DatabaseSync, key: string): void {
  db.prepare("delete from persona_learning_candidate where key = ?").run(key);
  db.prepare("delete from persona_learning_source where key = ?").run(key);
}

// ---------------------------------------------------------------------------
// mutation receipt 行读写（合同 §1/§2：receipt(scope,mutationId) 幂等键；result_generation
// 记录屏障值——preference 存 keyGeneration、policy 存 policyEpoch、authority/core 恒 0）
// ---------------------------------------------------------------------------

export interface PersonaReceiptRow {
  requestDigest: string;
  resultCode: PersonaReceiptResultCode;
  resultRevision: number;
  resultGeneration: number;
}

export function readReceiptRow(
  db: DatabaseSync,
  scope: string,
  mutationId: string,
): PersonaReceiptRow | undefined {
  const row = db
    .prepare(
      `select request_digest, result_code, result_revision, result_generation
       from persona_mutation_receipt where scope = ? and mutation_id = ?`,
    )
    .get(scope, mutationId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const resultCode = asString(row.result_code);
  if (
    resultCode !== "created" &&
    resultCode !== "saved" &&
    resultCode !== "unchanged" &&
    resultCode !== "forgotten"
  ) {
    failCorruptRow();
  }
  return {
    requestDigest: asString(row.request_digest),
    resultCode,
    resultRevision: asInteger(row.result_revision),
    resultGeneration: asInteger(row.result_generation),
  };
}

export function insertReceiptRow(
  db: DatabaseSync,
  scope: string,
  mutationId: string,
  requestDigest: string,
  resultCode: PersonaReceiptResultCode,
  resultRevision: number,
  resultGeneration: number,
  now: number,
): void {
  db.prepare(
    `insert into persona_mutation_receipt
       (scope, mutation_id, request_digest, result_code, result_revision, result_generation, time_created)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(scope, mutationId, requestDigest, resultCode, resultRevision, resultGeneration, now);
}

/**
 * 容量闸门（合同 §2）：达到每 authority 上限时先清 7 天窗口外的过期项；窗口内幂等
 * 凭据不驱逐；仍满则拒绝本次管理写（调用方返回 storage_capacity，事务回滚）。
 */
export function ensureReceiptCapacity(
  db: DatabaseSync,
  receiptMaxPerAuthority: number,
  receiptRetentionMs: number,
  now: number,
): boolean {
  const count = (): number => {
    const row = db.prepare("select count(*) as n from persona_mutation_receipt").get() as
      | Record<string, unknown>
      | undefined;
    return asInteger(row?.n);
  };
  if (count() < receiptMaxPerAuthority) return true;
  db.prepare("delete from persona_mutation_receipt where time_created < ?").run(now - receiptRetentionMs);
  return count() < receiptMaxPerAuthority;
}

// ---------------------------------------------------------------------------
// 事务结果原语（PersonaSqliteStore 的 withTxn 协议）
// ---------------------------------------------------------------------------

/** 事务内函数的返回：value=提交；code=回滚并把封闭错误码交给调用方。 */
export type StoreOutcome<T> = { kind: "value"; value: T } | { kind: "code"; code: PersonaErrorCode };

export function value<T>(value: T): StoreOutcome<T> {
  return { kind: "value", value };
}

export function code(code: PersonaErrorCode): StoreOutcome<never> {
  return { kind: "code", code };
}

export function unwrap<T>(outcome: StoreOutcome<T>): T {
  if (outcome.kind === "value") return outcome.value;
  throw new PersonaStoreError(`Persona store rejected the operation: ${outcome.code}`, {
    code: outcome.code,
  });
}

export function toManagementResult<T>(outcome: StoreOutcome<T>): PersonaManagementResult<T> {
  return outcome.kind === "value"
    ? { ok: true, value: outcome.value }
    : { ok: false, code: outcome.code };
}
