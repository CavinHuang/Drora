// 迁自 packages/services/src/knowledge/store/indexLease.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * index_lease：跨 Host 索引写互斥（W02 / spec §5b.3）。
 *
 * W00 Spike3/§4 纪律：
 * - epoch 单调递增作为 fence token；
 * - fence 校验必须发生在**每个写事务内部**（owner+epoch+未过期三条件同时成立），
 *   只按列戳做 CAS 不设防（spike3 反例：stale writer 写入成功）；
 * - 死亡检测只能靠 TTL+心跳，死进程的租约照样拒人（spike4）；
 * - 接管成功后做 checkpoint + integrity 体检。
 */
import { KnowledgeDatabase } from "./knowledgeDatabase.js";

export const KNOWLEDGE_INDEX_LEASE_NAME = "knowledge-index-writer";

export interface LeaseState {
  owner: string | null;
  epoch: number;
  expiresAtMs: number;
}

/** fence 校验失败：当前写者已不是租约持有者（被接管/过期）。 */
export class KnowledgeLeaseLostError extends Error {
  readonly code = "knowledge_lease_lost";
  constructor(readonly lease: LeaseState) {
    super("knowledge 索引租约已失效（fence 拒绝）");
  }
}

function readLease(db: KnowledgeDatabase, name: string): LeaseState {
  const row = db.raw
    .prepare("SELECT owner, epoch, expires_at_ms FROM index_lease WHERE name = ?")
    .get(name) as { owner: string | null; epoch: number; expires_at_ms: number } | undefined;
  if (!row) return { owner: null, epoch: 0, expiresAtMs: 0 };
  return { owner: row.owner, epoch: row.epoch, expiresAtMs: row.expires_at_ms };
}

export interface AcquireLeaseResult {
  acquired: boolean;
  fence: number;
  lease: LeaseState;
}

/**
 * 抢占/续接租约。已在手（owner+epoch 匹配且未过期）→ 原样续期；
 * 空闲或过期 → epoch+1 接管（fence 提升）；他人持有 → 拒绝（不等待，调用方决定策略）。
 */
export function acquireIndexLease(
  db: KnowledgeDatabase,
  name: string,
  owner: string,
  ttlMs: number,
  nowMs: number,
): AcquireLeaseResult {
  return db.transaction((tx) => {
    const lease = readLease(tx, name);
    const mine = lease.owner === owner && lease.epoch > 0 && lease.expiresAtMs > nowMs;
    if (mine || !lease.owner || lease.expiresAtMs <= nowMs) {
      const epoch = mine ? lease.epoch : lease.epoch + 1;
      const expiresAtMs = nowMs + ttlMs;
      tx.raw
        .prepare(
          `INSERT INTO index_lease(name, owner, epoch, expires_at_ms, heartbeat_at_ms)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, epoch=excluded.epoch,
             expires_at_ms=excluded.expires_at_ms, heartbeat_at_ms=excluded.heartbeat_at_ms`,
        )
        .run(name, owner, epoch, expiresAtMs, nowMs);
      return { acquired: true, fence: epoch, lease: { owner, epoch, expiresAtMs } };
    }
    return { acquired: false, fence: lease.epoch, lease };
  });
}

/** 心跳：仅持有者本人可续期；返回是否仍然在手。 */
export function heartbeatIndexLease(
  db: KnowledgeDatabase,
  name: string,
  owner: string,
  fence: number,
  ttlMs: number,
  nowMs: number,
): boolean {
  return db.transaction((tx) => {
    const lease = readLease(tx, name);
    if (lease.owner !== owner || lease.epoch !== fence) return false;
    tx.raw
      .prepare("UPDATE index_lease SET expires_at_ms = ?, heartbeat_at_ms = ? WHERE name = ?")
      .run(nowMs + ttlMs, nowMs, name);
    return true;
  });
}

export function releaseIndexLease(
  db: KnowledgeDatabase,
  name: string,
  owner: string,
  fence: number,
): void {
  db.transaction((tx) => {
    const lease = readLease(tx, name);
    if (lease.owner !== owner || lease.epoch !== fence) return;
    tx.raw
      .prepare(
        "UPDATE index_lease SET owner = NULL, expires_at_ms = 0, heartbeat_at_ms = 0 WHERE name = ?",
      )
      .run(name);
  });
}

export function readIndexLease(db: KnowledgeDatabase, name: string): LeaseState {
  return db.transaction((tx) => readLease(tx, name));
}

/**
 * 写事务内 fence 校验（§5b.3 纪律 2）：必须在调用方已开启的事务里执行，
 * 与写入同事务提交，杜绝「校验后、提交前被接管」的窗口。
 * 校验点直读表内当前值，不信任调用方缓存。
 */
export function verifyLeaseInsideTransaction(
  tx: KnowledgeDatabase,
  name: string,
  owner: string,
  fence: number,
  nowMs: number,
): void {
  const lease = readLease(tx, name);
  const valid = lease.owner === owner && lease.epoch === fence && lease.expiresAtMs > nowMs;
  if (!valid) {
    throw new KnowledgeLeaseLostError(lease);
  }
}
