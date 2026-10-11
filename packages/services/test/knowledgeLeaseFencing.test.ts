/**
 * A05：两真实 OS 进程的 index writer 竞争 + 旧 fence 拒绝 + 硬杀后 TTL 接管恢复。
 *
 * 进程模型与 W00 DB spike 一致（父进程 + spawn 独立子进程共享同一 .db 文件）。
 * 运行：node --import tsx --test packages/services/test/knowledgeLeaseFencing.test.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import { setDataBaseDir } from "../src/paths.js";
import { openKnowledgeDatabase } from "../src/knowledge/store/knowledgeDatabase.js";
import {
  acquireIndexLease,
  heartbeatIndexLease,
  KNOWLEDGE_INDEX_LEASE_NAME,
  KnowledgeLeaseLostError,
  releaseIndexLease,
  verifyLeaseInsideTransaction,
} from "../src/knowledge/store/indexLease.js";
import { createKnowledgeServices } from "../src/knowledge/knowledgeServices.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

interface ChildHandle {
  child: ReturnType<typeof spawn>;
  fence: Promise<number>;
}

function spawnLeaseHolder(dbPath: string, owner: string, ttlMs: number): ChildHandle {
  const child = spawn(process.execPath, ["--import", "tsx", join(here, "knowledgeLeaseChild.mjs"), dbPath, owner, String(ttlMs)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  const fence = new Promise<number>((resolveFence, rejectFence) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      const match = /ACQUIRED (\d+)/.exec(stdout);
      if (match) resolveFence(Number(match[1]));
      if (/REJECTED/.test(stdout)) rejectFence(new Error(`child 未能持有租约: ${stdout.trim()}`));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[lease-child] ${chunk.toString("utf-8")}`);
    });
    child.on("exit", (code) => {
      if (!/ACQUIRED/.test(stdout)) rejectFence(new Error(`child 提前退出 code=${code}: ${stdout.trim()}`));
    });
  });
  return { child, fence };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

test("A05：子进程 Host 持有租约时父进程被拒；硬杀后 TTL 到期接管且 fence 提升、旧 fence 写入被拒", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-lease-"));
  setDataBaseDir(root);
  const dbPath = join(root, "knowledge", "knowledge-index.sqlite");
  const vaultRoot = join(root, "vault");
  const pluginDataDir = join(root, "plugin-data");
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(join(vaultRoot, "a.md"), "# A\n\nlease-fencing-content", "utf-8");
  await configureVaultAt(pluginDataDir, vaultRoot);

  const services = createKnowledgeServices({
    databasePath: dbPath,
    pluginDataDir,
    leaseTtlMs: 1500,
    heartbeatIntervalMs: 200,
  });
  try {
    // 1. 子进程（Host B）先持有租约。
    const holder = spawnLeaseHolder(dbPath, "host-B-child", 1000);
    const childFence = await holder.fence;
    assert.ok(childFence >= 1);

    // 2. 父进程（Host A）startJob → 租约被持有 → 明确报错（不排队不覆盖）。
    await assert.rejects(
      () => services.indexService.startReconcile(),
      /租约被其他 Host 持有/,
    );

    // 3. 旧 fence 写入拒绝（父进程模拟持有旧 fence 的迟到 writer）。
    const db = openKnowledgeDatabase(dbPath);
    try {
      await assert.throws(
        () =>
          db.transaction((tx) => {
            verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, "host-A-stale", childFence, Date.now());
          }),
        (error: unknown) => error instanceof KnowledgeLeaseLostError,
      );
    } finally {
      db.close();
    }

    // 4. 硬杀子进程（TerminateProcess）：租约不释放，接管只能等 TTL 过期（spike4 语义）。
    holder.child.kill("SIGKILL");
    const [exitCode] = await new Promise<[number | null]>((resolveExit) => {
      holder.child.on("exit", (code) => resolveExit([code]));
    });
    assert.notEqual(exitCode, 0); // 硬杀 ≠ 干净退出

    // 杀后立即抢租约：TTL 未过期 → 仍被"死者"租约拒绝。
    const dbProbe = openKnowledgeDatabase(dbPath);
    try {
      const immediate = acquireIndexLease(dbProbe, KNOWLEDGE_INDEX_LEASE_NAME, "host-A-early", 1000, Date.now());
      assert.equal(immediate.acquired, false);
    } finally {
      dbProbe.close();
    }

    // 5. TTL 过期后接管成功：fence 提升；接管后库体检通过（WAL 恢复 + integrity）。
    const deadline = Date.now() + 8000;
    let job: { jobId: string; fence: number } | null = null;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        job = await services.indexService.startReconcile();
        break;
      } catch (error) {
        lastError = error;
        await sleep(100);
      }
    }
    assert.ok(job, `TTL 过期后应能接管租约: ${String(lastError)}`);
    assert.ok(job.fence > childFence, `接管 fence(${job.fence}) 应大于子进程 fence(${childFence})`);
    const terminal = await (async () => {
      for (let index = 0; index < 200; index++) {
        const status = await services.indexService.getStatus();
        if (status.job && status.job.jobId === job.jobId && status.job.status !== "running") {
          return status.job.status;
        }
        await sleep(40);
      }
      throw new Error("接管后的任务未在时限内结束");
    })();
    assert.equal(terminal, "completed");
    const health = openKnowledgeDatabase(dbPath);
    try {
      const integrity = health.healthCheck();
      assert.equal(integrity.integrity, "ok");
    } finally {
      health.close();
    }
  } finally {
    services.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("store 级 fencing：接管提升 epoch，旧持有者写事务被拒，新持有者可写", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-fence-"));
  const dbPath = join(root, "fence.sqlite");
  const db = openKnowledgeDatabase(dbPath);
  try {
    db.raw.exec("CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT)");

    // Host A 持有 fence=1 并成功写入。
    const first = acquireIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, "host-A", 60, Date.now());
    assert.equal(first.acquired, true);
    assert.equal(first.fence, 1);
    db.transaction((tx) => {
      verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, "host-A", 1, Date.now());
      tx.raw.prepare("INSERT INTO kv(k, v) VALUES ('a', 'written-by-A')").run();
    });

    // Host A 续期成功（未过期）。
    assert.equal(heartbeatIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, "host-A", 1, 60, Date.now()), true);

    // TTL 过期后 Host B 接管 → fence=2。
    await sleep(90);
    const second = acquireIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, "host-B", 5000, Date.now());
    assert.equal(second.acquired, true);
    assert.equal(second.fence, 2);

    // Host A 心跳被拒（不是持有者）；A 的写事务在事务内被 fence 拒绝（spike3 反例不复现）。
    assert.equal(heartbeatIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, "host-A", 1, 60, Date.now()), false);
    assert.throws(
      () =>
        db.transaction((tx) => {
          verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, "host-A", 1, Date.now());
          tx.raw.prepare("INSERT INTO kv(k, v) VALUES ('stale', 'must-not-commit')").run();
        }),
      (error: unknown) => error instanceof KnowledgeLeaseLostError,
    );
    const staleRow = db.raw.prepare("SELECT v FROM kv WHERE k = 'stale'").get();
    assert.equal(staleRow, undefined); // 事务回滚，迟到写入不存在

    // Host B 同事务写成功；释放后租约空闲。
    db.transaction((tx) => {
      verifyLeaseInsideTransaction(tx, KNOWLEDGE_INDEX_LEASE_NAME, "host-B", 2, Date.now());
      tx.raw.prepare("INSERT INTO kv(k, v) VALUES ('b', 'written-by-B')").run();
    });
    releaseIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, "host-B", 2);
    const after = acquireIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, "host-A", 5000, Date.now());
    assert.equal(after.acquired, true);
    assert.equal(after.fence, 3); // 空闲接管仍提升 epoch（单调）
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
