/**
 * 旧路径知识库首启自动搬迁（specs/obsidian-vault-phase2-true-extraction.md §5、§10-P6）。
 *
 * 触发条件（§5 时序，评审 2 轮 M4：P7 拆除旧实现后仅新版首启搬迁）：数据面状态机
 * （platform/dataPaths.ts）解析为 legacy——旧路径 `<数据根>/.drora/knowledge/` 有库且
 * 插件数据目录 `knowledge/` 无库。搬迁步骤与 spec §5 逐条对应：
 *
 * 1. 对旧库 `PRAGMA wal_checkpoint(TRUNCATE)`（收敛 WAL，目录 move 前把未落盘帧写回
 *    主库；checkpoint 返回 busy=1 说明有并发连接活跃 → 拒绝搬迁）；
 * 2. 读 v6 `review_runtime_owners` 做 owner PID 活性校验：有活跃（或无法判定已死亡的）
 *    writer 即拒绝搬迁并提示关闭旧窗口后重试——活性判定与
 *    knowledge/review/reviewRuntimeOwnership.ts 的 definitelyDead 同语义（本模块只观察
 *    不接管，不能复用 acquire 的写入路径，谓词以本地副本 + 注释锁定一致性）；
 * 3. move 目录内容 + 计数校验：枚举旧目录全部文件（DB 主文件最后搬，中断时状态机仍
 *    解析回 legacy、下次启动幂等续搬），逐文件 rename（跨设备回退 copy+字节数校验+
 *    unlink），搬完复走旧目录断言 0 文件；任一步失败 → 逆序搬回（回退保留原件）；
 * 4. 旧路径留空壳不删（用户手工清理；spec 不自动删本体数据根目录）。
 *
 * 并发串行化：resident appService 与会话级 MCP client 可能同时首启（g1 singleton 是
 * 宿主进程级，跨进程不成立）——两只搬迁器交错 rename 同一批文件会互相 ENOENT。用旧
 * 目录内文件锁（`.drora-knowledge-migration.lock`，wx 独占创建 + PID/host 活性判死，
 * 与 review_runtime_owners 同款保守语义）串行化；锁被活进程持有 → blocked_concurrent，
 * 调用方短轮询重试（对端搬完后重解析即 plugin 态，无需再搬）。
 *
 * 已知边界（如实，不静默）：搬迁期间另一实例若已按 legacy 计划惰性打开旧库，move 后
 * 其连接仍指向原 inode（POSIX 语义，读写落在已搬文件上，数据不撕裂）；但该实例若在
 * 搬迁后才首次惰性开库（knowledgeDatabase 连接是惰性的），会在旧路径新建空库，下一
 * 次启动按 dual_db_conflict fail-closed 拒绝（D14 不静默合并，人工取舍，无数据损失）。
 * 本模块的锁 + server 启动链「blocked_concurrent 不建 legacy 数据面」已把该窗口收窄到
 * 「锁死亡误判 + 恰好惰性未开库」的双重巧合。
 */
import { existsSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { KNOWLEDGE_INDEX_DB_FILE_NAME } from "./knowledgeEvidence.js";
import { type KnowledgeDataPlan } from "./dataPaths.js";
import { openKnowledgeDatabase } from "../knowledge/store/knowledgeDatabase.js";

/** 搬迁锁文件名（落旧目录内；枚举搬迁文件时排除，搬迁后随空壳留存/释放）。 */
const MIGRATION_LOCK_FILE_NAME = ".drora-knowledge-migration.lock";

/** SQLite 家族后缀（checkpoint + 干净关闭后通常只剩主库，存在则一并最后搬）。 */
function isSqliteFamilyFile(name: string): boolean {
  return (
    name === KNOWLEDGE_INDEX_DB_FILE_NAME ||
    name === `${KNOWLEDGE_INDEX_DB_FILE_NAME}-wal` ||
    name === `${KNOWLEDGE_INDEX_DB_FILE_NAME}-shm`
  );
}

export type KnowledgeMigrationOutcome =
  | { phase: "completed"; movedFiles: number; databasePath: string }
  | {
      /** §5：活跃 writer（review_runtime_owners 存活 owner）→ 拒绝搬迁，提示关旧窗口重试。 */
      phase: "blocked_active_writer";
      reason: string;
      ownerPids: number[];
    }
  | {
      /** checkpoint busy / 开库 SQLITE_BUSY：有并发连接活跃，同「有活跃 writer」语义拒搬。 */
      phase: "blocked_busy";
      reason: string;
    }
  | {
      /** 另一实例正在搬迁（文件锁被活进程持有）：调用方短轮询重试/重解析。 */
      phase: "blocked_concurrent";
      reason: string;
    }
  | {
      /** 搬迁失败已回退（原件保留，legacy 数据面可继续服务）；reason 供结构化提示。 */
      phase: "failed";
      reason: string;
      rollbackRestored: boolean;
    };

interface RuntimeOwnerRow {
  owner_pid: number;
  owner_host: string;
}

/**
 * owner 活性判定：与 reviewRuntimeOwnership.ts definitelyDead 同语义的本地副本
 * （迁入件纪律不就地改 exported 面）——host 不匹配或 PID 不可判定一律按存活处理
 * （保守阻断；PID 重用时 kill(pid,0) 成功也按存活）。
 */
function runtimeOwnerIsAlive(row: RuntimeOwnerRow): boolean {
  if (row.owner_host !== hostname() || !Number.isSafeInteger(row.owner_pid) || row.owner_pid <= 0) {
    return true;
  }
  try {
    process.kill(row.owner_pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ESRCH");
  }
}

interface MigrationLock {
  release(): void;
}

function lockHolderIsDead(lockPath: string): boolean {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown; host?: unknown };
    if (typeof holder.pid !== "number" || holder.host !== hostname()) return false;
    process.kill(holder.pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ESRCH";
  }
}

/** 独占文件锁（wx 创建；持有者死亡可判定时破锁重试一次，防 SIGKILL 残锁卡死升级）。 */
function acquireMigrationLock(lockPath: string): MigrationLock | null {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, `${JSON.stringify({ pid: process.pid, host: hostname(), startedAtMs: Date.now() })}\n`);
      } finally {
        closeSync(fd);
      }
      return {
        release() {
          try {
            unlinkSync(lockPath);
          } catch {
            // 释放失败只留一个可判死的残锁，不影响正确性（下次启动按 PID 破锁）。
          }
        },
      };
    } catch (error) {
      if (!existsSync(lockPath)) throw error;
      if (lockHolderIsDead(lockPath)) {
        try {
          unlinkSync(lockPath);
        } catch {
          return null;
        }
        continue;
      }
      return null;
    }
  }
  return null;
}

/** 递归枚举目录下全部文件（相对路径，目录归一化 `/`）；排除搬迁锁自身。 */
async function enumerateFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel);
      } else if (entry.isFile() && entry.name !== MIGRATION_LOCK_FILE_NAME) {
        out.push(rel);
      }
    }
  };
  await walk(root, "");
  return out;
}

/** 搬迁排序：普通文件（模型/向量等）先搬、SQLite 家族最后搬（主库绝对末位）。 */
function orderFilesForMove(files: string[]): string[] {
  const ordinary = files.filter((rel) => !isSqliteFamilyFile(rel.split("/").pop() ?? "")).sort();
  const family = files
    .filter((rel) => isSqliteFamilyFile(rel.split("/").pop() ?? ""))
    .sort()
    // 主库最后：中断时旧路径仍有主库 → 状态机解析回 legacy → 下次启动幂等续搬。
    .sort((a, b) => Number(a.endsWith(KNOWLEDGE_INDEX_DB_FILE_NAME)) - Number(b.endsWith(KNOWLEDGE_INDEX_DB_FILE_NAME)));
  return [...ordinary, ...family];
}

interface MoveOutcome {
  moved: string[];
  failedRel: string | null;
  error: unknown;
}

/**
 * 单文件搬迁：rename 优先；EXDEV（DRORA_PLUGIN_DATA 跨设备注入）回退 copy + 字节数
 * 校验 + unlink（校验不过不删原件，按失败回退处理）。目标已存在（上次中断的半程
 * 残留）→ 覆盖（rm 后 rename），保证重跑幂等。
 */
async function moveOneFile(sourceRoot: string, targetRoot: string, rel: string): Promise<void> {
  const from = join(sourceRoot, rel);
  const to = join(targetRoot, rel);
  await fsp.mkdir(join(to, ".."), { recursive: true });
  try {
    await fsp.rm(to, { force: true, recursive: true });
    await fsp.rename(from, to);
    return;
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "EXDEV") throw error;
  }
  const fromStat = await fsp.stat(from);
  await fsp.copyFile(from, to);
  const toStat = await fsp.stat(to);
  if (fromStat.size !== toStat.size) {
    // 字节数不一致绝不删原件：按失败处理走回退（copy 残片留在目标，回退/重跑时覆盖）。
    throw new Error(`跨设备拷贝字节数不一致: ${rel} (${fromStat.size} -> ${toStat.size})`);
  }
  await fsp.unlink(from);
}

async function moveAllFiles(sourceRoot: string, targetRoot: string, ordered: string[]): Promise<MoveOutcome> {
  const moved: string[] = [];
  for (const rel of ordered) {
    try {
      await moveOneFile(sourceRoot, targetRoot, rel);
      moved.push(rel);
    } catch (error) {
      return { moved, failedRel: rel, error };
    }
  }
  return { moved, failedRel: null, error: null };
}

/** 失败回退：逆序搬回已搬文件（主库最先回去），全部成功才报告 restored=true。 */
async function rollbackMoves(sourceRoot: string, targetRoot: string, moved: string[]): Promise<boolean> {
  let restored = true;
  for (const rel of [...moved].sort((a, b) => Number(b.endsWith(KNOWLEDGE_INDEX_DB_FILE_NAME)) - Number(a.endsWith(KNOWLEDGE_INDEX_DB_FILE_NAME)))) {
    try {
      await moveOneFile(targetRoot, sourceRoot, rel);
    } catch {
      restored = false;
    }
  }
  return restored;
}

/**
 * 执行一次 §5 搬迁（单次尝试语义；并发/忙碌由调用方轮询重试）。前置：状态机解析为
 * legacy（源=plan.databasePath 所在旧目录，目标=`<plan.pluginDataDir>/knowledge/`）。
 * 返回结构化结局；除 completed 外一律不改写旧目录终态语义（blocked 不动文件、
 * failed 已回退保留原件）。
 */
export async function migrateLegacyKnowledgeData(
  plan: KnowledgeDataPlan & { mode: "legacy" },
): Promise<KnowledgeMigrationOutcome> {
  const input = {
    legacyDatabasePath: plan.databasePath,
    pluginDatabasePath: join(plan.pluginDataDir, "knowledge", KNOWLEDGE_INDEX_DB_FILE_NAME),
  };
  const sourceRoot = join(input.legacyDatabasePath, "..");
  const targetRoot = join(input.pluginDatabasePath, "..");
  const lockPath = join(sourceRoot, MIGRATION_LOCK_FILE_NAME);
  const lock = acquireMigrationLock(lockPath);
  if (lock === null) {
    return {
      phase: "blocked_concurrent",
      reason: "另一实例正在搬迁旧路径知识库（文件锁被持有）；稍后重试或重启宿主。",
    };
  }
  try {
    // ── 步骤 1：checkpoint(TRUNCATE) 收敛 WAL（busy=1 或开库 SQLITE_BUSY → 拒搬）──
    let checkpointBusy = false;
    let ownerRows: RuntimeOwnerRow[] = [];
    try {
      const db = openKnowledgeDatabase(input.legacyDatabasePath);
      try {
        void db.raw; // 惰性开库（含 v6 迁移：确保 review_runtime_owners 表存在）
        const row = db.raw.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as
          | { busy?: number }
          | undefined;
        checkpointBusy = (row?.busy ?? 0) !== 0;
        if (!checkpointBusy) {
          ownerRows = db.raw
            .prepare("SELECT owner_pid, owner_host FROM review_runtime_owners")
            .all() as unknown as RuntimeOwnerRow[];
        }
      } finally {
        db.close();
      }
    } catch (error) {
      // 开库/迁移 SQL 忙（活跃 writer 持写锁，busy_timeout 耗尽）与 checkpoint busy 同语义。
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("SQLITE_BUSY") || message.includes("knowledge_busy")) {
        return { phase: "blocked_busy", reason: "旧库有并发连接活跃（checkpoint 忙），拒绝搬迁。" };
      }
      return { phase: "failed", reason: `打开旧库失败: ${message}`, rollbackRestored: true };
    }
    if (checkpointBusy) {
      return { phase: "blocked_busy", reason: "旧库 WAL checkpoint 忙（有并发读者/写者），拒绝搬迁。" };
    }

    // ── 步骤 2：v6 owner PID 活性校验（活跃 writer → 拒搬 + 提示关旧窗口）──
    const liveOwners = ownerRows.filter((row) => runtimeOwnerIsAlive(row));
    if (liveOwners.length > 0) {
      return {
        phase: "blocked_active_writer",
        reason: "旧版本窗口仍在运行（review 活跃 writer），请关闭旧窗口后重启再搬迁。",
        ownerPids: liveOwners.map((row) => row.owner_pid),
      };
    }

    // ── 步骤 3：move + 计数校验；失败回退保留原件 ──
    await fsp.mkdir(targetRoot, { recursive: true });
    const enumerated = await enumerateFiles(sourceRoot);
    const ordered = orderFilesForMove(enumerated);
    const outcome = await moveAllFiles(sourceRoot, targetRoot, ordered);
    if (outcome.failedRel !== null) {
      const restored = await rollbackMoves(sourceRoot, targetRoot, outcome.moved);
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      return {
        phase: "failed",
        reason: `搬迁 ${outcome.failedRel} 失败: ${message}`,
        rollbackRestored: restored,
      };
    }
    const remaining = await enumerateFiles(sourceRoot);
    if (remaining.length !== 0) {
      const restored = await rollbackMoves(sourceRoot, targetRoot, outcome.moved);
      return {
        phase: "failed",
        reason: `搬迁后旧目录仍有 ${remaining.length} 个文件（计数校验不过）`,
        rollbackRestored: restored,
      };
    }
    if (!existsSync(input.pluginDatabasePath)) {
      return {
        phase: "failed",
        reason: "搬迁后插件目录未见知识库主文件（计数校验不过）",
        rollbackRestored: await rollbackMoves(sourceRoot, targetRoot, outcome.moved),
      };
    }
    // 步骤 4：旧目录留空壳（只含已释放的锁残名），不删 —— 见文件头。
    return { phase: "completed", movedFiles: ordered.length, databasePath: input.pluginDatabasePath };
  } finally {
    lock.release();
  }
}
