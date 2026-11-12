// 迁自 packages/services/src/knowledge/review/reviewRuntimeOwnership.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
/**
 * 同一 SQLite 账本上 Apply/Undo/reconcile 的跨进程互斥。
 * 仅确认旧进程死亡才接管，绝不按 TTL 猜测；PID 重用/权限不明时保守阻断。
 * 所有权短事务不持有文件 IO，文件账本仍是崩溃后恢复的唯一事实源。
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { KnowledgeDatabase } from "../store/knowledgeDatabase.js";

interface RuntimeOwnerRow {
  owner_pid: number;
  owner_host: string;
  token: string;
}

function definitelyDead(row: RuntimeOwnerRow): boolean {
  if (row.owner_host !== hostname() || !Number.isSafeInteger(row.owner_pid) || row.owner_pid <= 0)
    return false;
  try {
    process.kill(row.owner_pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

export function createReviewRuntimeOwnership(db: KnowledgeDatabase) {
  return {
    acquire(vaultId: string): string | null {
      return db.transaction((tx) => {
        const row = tx.raw
          .prepare(
            "SELECT owner_pid, owner_host, token FROM review_runtime_owners WHERE vault_id = ?",
          )
          .get(vaultId) as RuntimeOwnerRow | undefined;
        if (row && !definitelyDead(row)) return null;
        const token = randomUUID();
        tx.raw
          .prepare(`INSERT INTO review_runtime_owners(vault_id, owner_pid, owner_host, token)
          VALUES (?, ?, ?, ?) ON CONFLICT(vault_id) DO UPDATE SET
          owner_pid = excluded.owner_pid, owner_host = excluded.owner_host, token = excluded.token`)
          .run(vaultId, process.pid, hostname(), token);
        return token;
      });
    },
    release(vaultId: string, token: string): void {
      // 迟到的释放不能删掉另一个 owner 的声明。
      db.transaction((tx) => {
        tx.raw
          .prepare("DELETE FROM review_runtime_owners WHERE vault_id = ? AND token = ?")
          .run(vaultId, token);
      });
    },
  };
}
