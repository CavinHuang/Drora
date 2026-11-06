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
    // 幂等兜底（PR-1B 三审发现 7；01 §2「decisionId→ticketId 唯一索引」）：一 decision
    // 至多一张票。索引只加不破（v1 旧库补建亦安全）；进程内并发的主防线是 approve
    // 事务内按 decision_id 查重（单写者事务串行化），索引挡跨进程/未来多写者。
    raw.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_decision_id ON ticket(decision_id)");
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '1', strftime('%s','now') * 1000) ON CONFLICT(key) DO NOTHING",
    );
  }

  if (currentVersion < 2) {
    // v2（2026-11-05，P2 host 内核）——只加不破：
    // ① router_evaluation：Router 决策预填（02 详设 §1.2/§1.3；新表，不动 v1 admission_decision），
    //    decision_id 主键即「一决策至多一份评估」幂等约束。
    raw.exec(`CREATE TABLE IF NOT EXISTS router_evaluation (
      decision_id INTEGER PRIMARY KEY,
      state TEXT NOT NULL,
      verdict TEXT,
      error TEXT,
      decided_ms INTEGER NOT NULL
    )`);
    // ② ticket P2 列：写域/派发模式/queued 原因。ALTER ADD COLUMN 幂等守卫（中途失败的
    //    重入安全）；v1 旧行 NULL → 视图回退 workspace 语义（P1 形态诚实降级）。
    addColumnIfMissing(raw, "ticket", "write_domain", "TEXT");
    addColumnIfMissing(raw, "ticket", "dispatch_mode", "TEXT");
    addColumnIfMissing(raw, "ticket", "queued_reason", "TEXT");
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '2', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET value = '2', updated_ms = excluded.updated_ms",
    );
  }

  if (currentVersion < 3) {
    // v3（2026-11-05，P2 审查修复）——只加不破：
    // ticket.dispatch_intent：放行时的派发意图 JSON（mode/attachSessionId/tier）。此前
    // queued 行的派发形态只存在于内存（runPostApproval 局部变量），释放路径读不到——
    // Mode B 退化为 Mode A 直派、Mode C 附着目标无处可取。dispatch_mode 列不能承担该
    // 职责：它由 commitDispatchSuccess 在派发成功后才写入，queued 行恒为 NULL。
    // 旧行 NULL → 释放回退 Mode A/build（P1 形态诚实降级，与 v1/v2 行为一致）。
    addColumnIfMissing(raw, "ticket", "dispatch_intent", "TEXT");
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '3', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET value = '3', updated_ms = excluded.updated_ms",
    );
  }

  if (currentVersion < 4) {
    // v4（2026-11-05，P3 Source 注册表）——只加不破（03 详设 §5）：
    // - trigger.channel_ref：Source 事件的通道绑定（feishu thread / GitHub issue /
    //   手机会话；串接格式 sources/channelRef.ts 单出处）——放行建票时回填 ticket，
    //   同绑定 follow-up 直通 Tier1 的索引源。
    // - trigger.remote_session_id：手机 Source 的 remoteSessionId 贯穿落库（AGENTS.md
    //   远程链路贯穿要求；仅追溯与推送路由用，不参与身份判定）。
    // - ticket.channel_ref + 索引：直通匹配列（活动工单按 channel_ref 等值查）。
    //   旧行 NULL → 不参与直通匹配（P1/P2 工单诚实降级为无通道绑定）。
    addColumnIfMissing(raw, "trigger", "channel_ref", "TEXT");
    addColumnIfMissing(raw, "trigger", "remote_session_id", "TEXT");
    addColumnIfMissing(raw, "ticket", "channel_ref", "TEXT");
    raw.exec(
      "CREATE INDEX IF NOT EXISTS idx_ticket_channel_ref ON ticket(channel_ref)",
    );
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '4', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET value = '4', updated_ms = excluded.updated_ms",
    );
  }

  if (currentVersion < 5) {
    // v5（2026-11-05，P4 watchdog）——只加不破（04 详设 §1；01 §1.1「P4 预留 stale 附加
    // 列」的兑现）：ticket.stale_ms / ticket.stale_kind——watchdog 停滞标记（唯一写者=
    // watchdog 轮；判据解除同轮清除置 NULL；旧行 NULL=未标记）。标记只影响呈现与通知，
    // 不参与状态机（永不自动终止/换代，spec §10）。
    addColumnIfMissing(raw, "ticket", "stale_ms", "INTEGER");
    addColumnIfMissing(raw, "ticket", "stale_kind", "TEXT");
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '5', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET value = '5', updated_ms = excluded.updated_ms",
    );
  }

  if (currentVersion < 6) {
    // v6（2026-11-05，P4 第二棒汇报卡完整版）——只加不破（04 详设 §3）：
    // - ticket.awaiting_since_ms：工件核验滞留起始时刻（W1 工单 turn ended 后只读
    //   核验未通过进入 awaiting_output；出口=核验通过/confirmTicketOutput/stopMandate；
    //   旧行 NULL=不滞留）。watchdog awaiting 判据（§1 判据表第 2 行）的事实源。
    // - ticket.increments_confirmed_ms：换代增量人工确认时刻（唯一写者=
    //   confirmTicketIncrements；旧行 NULL=未确认）。UI「未确认增量」横幅据此常驻/出清。
    addColumnIfMissing(raw, "ticket", "awaiting_since_ms", "INTEGER");
    addColumnIfMissing(raw, "ticket", "increments_confirmed_ms", "INTEGER");
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '6', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET value = '6', updated_ms = excluded.updated_ms",
    );
  }

  if (currentVersion < 7) {
    // v7（2026-11-06，P7 对话式查询直答）——只加不破（08 号详设 §3.1）：
    // - router_evaluation.answer_text：query_status 臂的确定性应答文本（host 生成
    //   零 LLM 加工；界=ASSISTANT_REPLY_LIMITS.replyTextMax）。NULL=非查询臂/未评估。
    //   decision 同事务翻 outcome=status_replied（写者仍是评估循环唯一路径）。
    addColumnIfMissing(raw, "router_evaluation", "answer_text", "TEXT");
    raw.exec(
      "INSERT INTO kv(key, value, updated_ms) VALUES ('schema_version', '7', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET value = '7', updated_ms = excluded.updated_ms",
    );
  }
}

/** ALTER TABLE ADD COLUMN 的幂等封装（PRAGMA table_info 查列存在性；迁移重入安全）。 */
function addColumnIfMissing(
  raw: AssistantDatabaseRaw,
  table: string,
  column: string,
  declaration: string,
): void {
  const columns = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return;
  raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}
