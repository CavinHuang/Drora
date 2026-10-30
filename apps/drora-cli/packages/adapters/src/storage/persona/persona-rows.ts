/**
 * persona 库行严格解码与事务结果原语（cli-persona-store 内部模块，非公开入口；
 * 供 persona-store.ts 的事务实现复用）。行内容与声明 schema 不符按损坏处理
 * （schema_incompatible，合同 §2），不静默容忍。
 */
import { DatabaseSync } from "node:sqlite";
import {
  PERSONA_PREFERENCE_KEYS,
  PERSONA_POLICY_DEFAULTS,
  type PersonaEditableCore,
  type PersonaErrorCode,
  type PersonaManagementResult,
  type PersonaReceiptResultCode,
  type PersonaPolicyFacts,
  type PersonaPreferenceFacts,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { PersonaStoreError } from "./contract.js";

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

/** 严格解码一个偏好槽行；内容与声明 schema 不符按损坏处理（schema_incompatible）。 */
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
  if ((pinned !== 0 && pinned !== 1) || (autoSuppressed !== 0 && autoSuppressed !== 1)) {
    failCorruptRow();
  }
  return {
    key: key as PersonaPreferenceKey,
    value: status === "active" ? (value as string) : "",
    revision: asInteger(row.revision),
    keyGeneration: asInteger(row.key_generation),
    provenanceKind: asString(row.provenance_kind) as "settings",
    epistemicStatus: asString(row.epistemic_status) as "explicit",
    pinned: pinned === 1,
    updatedAt: asInteger(row.time_updated),
    status,
  };
}

export function readPolicyRow(db: DatabaseSync): PersonaPolicyFacts {
  const row = db
    .prepare(
      "select use_preferences, policy_revision, policy_epoch from persona_policy where id = 1",
    )
    .get() as Record<string, unknown> | undefined;
  // 行缺席＝读侧默认（迁移不回填；首次 setPersonalPolicy 才创建）。
  if (!row) return { ...PERSONA_POLICY_DEFAULTS };
  const usePreferences = asInteger(row.use_preferences);
  if (usePreferences !== 0 && usePreferences !== 1) failCorruptRow();
  return {
    usePreferences: usePreferences === 1,
    policyRevision: asInteger(row.policy_revision),
    policyEpoch: asInteger(row.policy_epoch),
  };
}

export function readPreferenceSlotRows(db: DatabaseSync): PersonaPreferenceFacts[] {
  const rows = db
    .prepare(
      `select key, value, revision, key_generation, provenance_kind,
              epistemic_status, status, pinned, auto_suppressed, time_updated
       from persona_preference order by key`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(decodePreferenceRow);
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
