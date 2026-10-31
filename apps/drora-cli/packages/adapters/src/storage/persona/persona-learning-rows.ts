/**
 * persona 学习域行读写原语（cli-persona-store 内部模块，非公开入口；供
 * persona-learning-store.ts 复用）。行内容与声明 schema 不符按损坏处理
 * （schema_incompatible，合同 §2），不静默容忍。source_handle/key_generations/
 * evidence_refs 以严格 JSON 存储：编码走本文件的规范化函数，解码失败按损坏处理。
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  PERSONA_LEARNING_WORK_STATES,
  PERSONA_PREFERENCE_KEYS,
  type PersonaLearningWorkState,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { failCorruptRow, asInteger, asString } from "./persona-rows.js";
import type { PersonaLearningSourceHandle } from "./persona-learning-contract.js";

// ---------------------------------------------------------------------------
// sourceHandle 规范化与摘要（合同 §6：结构完整性在本仓储边界校验；语义字段由可信 owner
// 提供，本层不解释）
// ---------------------------------------------------------------------------

const HANDLE_TEXT_FIELDS = [
  "authorityId",
  "workspaceKey",
  "sessionId",
  "origin",
  "sourceRevision",
  "messageBoundary",
  "branchEvidence",
] as const;

/** 校验 sourceHandle 最少字段（合同 §6 逐项）；返回固定键序的规范化副本供稳定序列化。 */
export function normalizeSourceHandle(
  handle: PersonaLearningSourceHandle,
): PersonaLearningSourceHandle {
  for (const field of HANDLE_TEXT_FIELDS) {
    const raw = handle[field];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new Error(`persona learning sourceHandle is missing required field: ${field}`);
    }
  }
  if (
    (!handle.productTurnId || handle.productTurnId.trim().length === 0) &&
    (!handle.sourceCommandId || handle.sourceCommandId.trim().length === 0)
  ) {
    throw new Error(
      "persona learning sourceHandle requires productTurnId or sourceCommandId (合同 §6)",
    );
  }
  return {
    authorityId: handle.authorityId,
    workspaceKey: handle.workspaceKey,
    sessionId: handle.sessionId,
    productTurnId: handle.productTurnId,
    sourceCommandId: handle.sourceCommandId,
    origin: handle.origin,
    sourceRevision: handle.sourceRevision,
    messageBoundary: handle.messageBoundary,
    branchEvidence: handle.branchEvidence,
    permissionDescription: handle.permissionDescription,
  };
}

/** 固定键序 JSON（幂等摘要的稳定输入；不是通用 canonical JSON）。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** keyGenerations 快照：键必须是受控偏好键、值非负安全整数；返回排序后的规范副本。 */
export function normalizeKeyGenerations(
  keyGenerations: Readonly<Record<string, number>>,
): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const key of Object.keys(keyGenerations).sort()) {
    if (!(PERSONA_PREFERENCE_KEYS as Readonly<Record<string, string>>)[key]) {
      throw new Error(`persona learning keyGenerations has unknown preference key: ${key}`);
    }
    const generation = keyGenerations[key];
    if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0) {
      throw new Error(`persona learning keyGenerations has invalid generation for key: ${key}`);
    }
    normalized[key] = generation;
  }
  return normalized;
}

export function encodeKeyGenerations(keyGenerations: Record<string, number>): string {
  return JSON.stringify(keyGenerations);
}

export function decodeKeyGenerations(text: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    failCorruptRow();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) failCorruptRow();
  return normalizeKeyGenerations(parsed as Record<string, number>);
}

/** 解码存储的 source_handle JSON；形状不符按库内容损坏处理。 */
export function decodeStoredSourceHandle(text: string): PersonaLearningSourceHandle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    failCorruptRow();
  }
  if (parsed === null || typeof parsed !== "object") failCorruptRow();
  try {
    return normalizeSourceHandle(parsed as PersonaLearningSourceHandle);
  } catch {
    failCorruptRow();
  }
}

// ---------------------------------------------------------------------------
// 工作行（状态机字面量唯一出处＝shared PERSONA_LEARNING_WORK_STATES）
// ---------------------------------------------------------------------------

const WORK_STATES: readonly string[] = Object.values(PERSONA_LEARNING_WORK_STATES);

export function decodeWorkState(raw: unknown): PersonaLearningWorkState {
  const state = asString(raw);
  if (!WORK_STATES.includes(state)) failCorruptRow();
  return state as PersonaLearningWorkState;
}

export interface PersonaLearningWorkRow {
  readonly workId: string;
  readonly evidenceId: string;
  readonly state: PersonaLearningWorkState;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
  readonly fence: number;
  readonly attempts: number;
  readonly policyEpoch: number;
  readonly keyGenerations: Record<string, number>;
  readonly failReason: string | null;
  readonly timeCreated: number;
  readonly timeUpdated: number;
}

const WORK_ROW_SELECT = `
  select work_id, evidence_id, state, lease_owner, lease_expires_at, fence, attempts,
         policy_epoch, key_generations, fail_reason, time_created, time_updated
  from persona_learning_work`;

export function readWorkRowById(db: DatabaseSync, workId: string): PersonaLearningWorkRow | undefined {
  const row = db.prepare(`${WORK_ROW_SELECT} where work_id = ?`).get(workId) as
    | Record<string, unknown>
    | undefined;
  return row ? decodeWorkRow(row) : undefined;
}

/** FIFO 领取选择：accepted / 过期 running / retry_wait，按到达序取最旧一行。 */
export function readNextClaimableWorkRow(
  db: DatabaseSync,
  now: number,
): PersonaLearningWorkRow | undefined {
  const row = db
    .prepare(
      `${WORK_ROW_SELECT}
       where state in ('accepted', 'retry_wait')
          or (state = 'running' and (lease_expires_at is null or lease_expires_at <= ?))
       order by time_created asc
       limit 1`,
    )
    .get(now) as Record<string, unknown> | undefined;
  return row ? decodeWorkRow(row) : undefined;
}

function decodeWorkRow(row: Record<string, unknown>): PersonaLearningWorkRow {
  const leaseOwner = row.lease_owner;
  const leaseExpiresAt = row.lease_expires_at;
  const failReason = row.fail_reason;
  return {
    workId: asString(row.work_id),
    evidenceId: asString(row.evidence_id),
    state: decodeWorkState(row.state),
    leaseOwner: leaseOwner === null ? null : asString(leaseOwner),
    leaseExpiresAt: leaseExpiresAt === null ? null : asInteger(leaseExpiresAt),
    fence: asInteger(row.fence),
    attempts: asInteger(row.attempts),
    policyEpoch: asInteger(row.policy_epoch),
    keyGenerations: decodeKeyGenerations(asString(row.key_generations)),
    failReason: failReason === null ? null : asString(failReason),
    timeCreated: asInteger(row.time_created),
    timeUpdated: asInteger(row.time_updated),
  };
}

export function countNonTerminalWorkRows(db: DatabaseSync): number {
  const row = db
    .prepare(
      "select count(*) as n from persona_learning_work where state in ('accepted', 'running', 'retry_wait')",
    )
    .get() as Record<string, unknown> | undefined;
  return asInteger(row?.n);
}

/** U=false / L=false 同事务级联：非终态工作全部终态化（撤租约；无正文可清）。 */
export function terminateNonTerminalWorksForPolicy(db: DatabaseSync, now: number): void {
  db.prepare(
    `update persona_learning_work
     set state = 'rejected', fail_reason = 'policy_off', lease_owner = null,
         lease_expires_at = null, time_updated = ?
     where state in ('accepted', 'running', 'retry_wait')`,
  ).run(now);
}

/** 终态工作 7 天窗口清理（容量路径先清过期项；窗口内记录不驱逐）。 */
export function pruneTerminalWorks(db: DatabaseSync, retentionMs: number, now: number): void {
  db.prepare(
    `delete from persona_learning_work
     where state in ('applied', 'no_change', 'rejected') and time_updated < ?`,
  ).run(now - retentionMs);
}

// ---------------------------------------------------------------------------
// 候选行与合并来源
// ---------------------------------------------------------------------------

/** 候选 evidence_refs：≤4 条、每条非空字符串 ≤512 code point（合同 §6 有界引用）。 */
export function normalizeEvidenceRefs(refs: readonly string[]): string[] {
  if (refs.length > 4) {
    throw new Error("persona learning candidate exceeds 4 evidenceRefs");
  }
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.length === 0 || [...ref].length > 512) {
      throw new Error("persona learning evidenceRef must be a non-empty string within 512 code points");
    }
  }
  return [...refs];
}

export function clearAllPendingCandidates(db: DatabaseSync): void {
  db.prepare("delete from persona_learning_candidate").run();
}

export function upsertPendingCandidate(
  db: DatabaseSync,
  input: {
    key: PersonaPreferenceKey;
    proposedValue: string;
    evidenceId: string;
    evidenceRefs: readonly string[];
    expectedGeneration: number;
    expectedRevision: number;
    now: number;
  },
): void {
  // 每键最多一项待确认（合同 §2）：被取代候选整行删除＝被拒候选不留正文（合同 §6）。
  db.prepare("delete from persona_learning_candidate where key = ?").run(input.key);
  db.prepare(
    `insert into persona_learning_candidate
       (key, proposed_value, evidence_id, evidence_refs, expected_generation,
        expected_revision, time_created, time_updated)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.key,
    input.proposedValue,
    input.evidenceId,
    JSON.stringify(input.evidenceRefs),
    input.expectedGeneration,
    input.expectedRevision,
    input.now,
    input.now,
  );
}

/** 同值合并来源：每键 ≤4 行（ordinal 0..3，先到先保留）；同 evidence 幂等。 */
export function mergeSlotSource(
  db: DatabaseSync,
  input: {
    key: PersonaPreferenceKey;
    evidenceId: string;
    sourceSummary: string;
    now: number;
  },
): "merged" | "known" | "full" {
  const existing = db
    .prepare("select 1 as present from persona_learning_source where key = ? and evidence_id = ?")
    .get(input.key, input.evidenceId) as Record<string, unknown> | undefined;
  if (existing) return "known";
  const countRow = db
    .prepare("select count(*) as n from persona_learning_source where key = ?")
    .get(input.key) as Record<string, unknown> | undefined;
  const count = asInteger(countRow?.n);
  if (count >= 4) return "full";
  db.prepare(
    `insert into persona_learning_source (key, ordinal, evidence_id, source_summary, time_merged)
     values (?, ?, ?, ?, ?)`,
  ).run(input.key, count, input.evidenceId, input.sourceSummary, input.now);
  return "merged";
}

/**
 * inferred 槽的合并来源 × evidence 定位联读（capture 读取侧复验用，合同 §8）：只投影
 * 复验所需的定位/校验元数据。evidence 行缺失＝库内容损坏（source 与 evidence 同事务成对
 * 写入）；source_summary 解码失败同按损坏处理。
 */
export function readInferredSlotSourceBindings(
  db: DatabaseSync,
): Array<{
  key: PersonaPreferenceKey;
  evidenceId: string;
  workspaceKey: string;
  sessionId: string;
  sourceRevision: string;
  messageBoundary: string;
}> {
  const rows = db
    .prepare(
      `select s.key as key, s.evidence_id as evidence_id, e.source_handle as source_handle
       from persona_learning_source s
       join persona_learning_evidence e on e.evidence_id = s.evidence_id
       order by s.key asc, s.ordinal asc`,
    )
    .all() as Array<Record<string, unknown>>;
  const bindings: Array<{
    key: PersonaPreferenceKey;
    evidenceId: string;
    workspaceKey: string;
    sessionId: string;
    sourceRevision: string;
    messageBoundary: string;
  }> = [];
  for (const row of rows) {
    const handle = decodeStoredSourceHandle(asString(row.source_handle));
    bindings.push({
      key: asString(row.key) as PersonaPreferenceKey,
      evidenceId: asString(row.evidence_id),
      workspaceKey: handle.workspaceKey,
      sessionId: handle.sessionId,
      sourceRevision: handle.sourceRevision,
      messageBoundary: handle.messageBoundary,
    });
  }
  return bindings;
}

// ---------------------------------------------------------------------------
// 预算台账（UTC 日窗口；时钟倒退落到既有 day 行继续记账＝不补额度）
// ---------------------------------------------------------------------------

/** 服务时间（UTC ms）→ UTC 日键 YYYY-MM-DD。 */
export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface PersonaLearningBudgetRow {
  readonly day: string;
  readonly attemptsUsed: number;
  readonly inputTokensUsed: number;
  readonly outputTokensUsed: number;
}

export function readBudgetDayRow(
  db: DatabaseSync,
  day: string,
): PersonaLearningBudgetRow | undefined {
  const row = db
    .prepare(
      "select day, attempts_used, input_tokens_used, output_tokens_used from persona_learning_budget_day where day = ?",
    )
    .get(day) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    day: asString(row.day),
    attemptsUsed: asInteger(row.attempts_used),
    inputTokensUsed: asInteger(row.input_tokens_used),
    outputTokensUsed: asInteger(row.output_tokens_used),
  };
}

export function upsertBudgetDayRow(
  db: DatabaseSync,
  row: PersonaLearningBudgetRow,
  now: number,
): void {
  db.prepare(
    `insert into persona_learning_budget_day
       (day, attempts_used, input_tokens_used, output_tokens_used, time_updated)
     values (?, ?, ?, ?, ?)
     on conflict(day) do update set attempts_used = excluded.attempts_used,
       input_tokens_used = excluded.input_tokens_used,
       output_tokens_used = excluded.output_tokens_used,
       time_updated = excluded.time_updated`,
  ).run(row.day, row.attemptsUsed, row.inputTokensUsed, row.outputTokensUsed, now);
}
