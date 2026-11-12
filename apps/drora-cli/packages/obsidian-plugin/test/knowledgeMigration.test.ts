/**
 * 首启自动搬迁单测（P6 gate，specs/obsidian-vault-phase2-true-extraction.md §5/§10-P6）：
 * 活跃 writer 拒绝 / 中断续搬（幂等）/ 失败回退保留原件 / 计数与数据一致 /
 * 并发锁互斥与残锁判死 / 工具面 migrating 结构化状态。
 *
 * 运行：node --import tsx --test apps/drora-cli/packages/obsidian-plugin/test/knowledgeMigration.test.ts
 * （保留集发现走 .test.ts + node:test 内容判定。）
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setDataBaseDir, resolveKnowledgeDataPlan } from "../src/server/platform/dataPaths.js";
import { migrateLegacyKnowledgeData } from "../src/server/platform/knowledgeMigration.js";
import { openKnowledgeDatabase } from "../src/server/knowledge/store/knowledgeDatabase.js";
import { requireDataPlane, MigrationPendingError, ALL_TOOLS } from "../src/mcp/tools.js";
import type { ToolContext } from "../src/mcp/tools.js";

const MIGRATION_LOCK_FILE_NAME = ".drora-knowledge-migration.lock";

interface Fixture {
  root: string;
  legacyDir: string;
  pluginDataDir: string;
  pluginKnowledgeDir: string;
  legacyDbPath: string;
}

function buildFixture(): Fixture {
  const root = join(tmpdir(), `p6-migration-${process.pid}-${Date.now()}`);
  const legacyDir = join(root, "base", ".drora", "knowledge");
  const pluginDataDir = join(root, "plugin-data");
  const pluginKnowledgeDir = join(pluginDataDir, "knowledge");
  mkdirSync(legacyDir, { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });
  // 数据根/插件数据目录分别经进程内覆写与宿主注入 env 对齐（与生产两条注入面同款）。
  process.env.DRORA_PLUGIN_DATA = pluginDataDir;
  setDataBaseDir(join(root, "base"));
  return {
    root,
    legacyDir,
    pluginDataDir,
    pluginKnowledgeDir,
    legacyDbPath: join(legacyDir, "knowledge-index.sqlite"),
  };
}

function cleanupFixture(fixture: Fixture): void {
  setDataBaseDir(null);
  delete process.env.DRORA_PLUGIN_DATA;
  rmSync(fixture.root, { recursive: true, force: true });
}

/** 造一份「升级用户旧库」：真实 sqlite（含 v6 owners 表）+ sources/documents 数据。 */
function seedLegacyLibrary(fixture: Fixture): { sources: unknown[]; documents: unknown[] } {
  const db = openKnowledgeDatabase(fixture.legacyDbPath);
  try {
    void db.raw;
    db.raw
      .prepare(
        "INSERT INTO sources(vault_id, display_name, fingerprint, current_epoch, updated_at_ms) VALUES (?, ?, ?, ?, ?)",
      )
      .run("vault-1", "我的库", "vault-1:1700000000000", 3, 1700000000000);
    db.raw
      .prepare(
        "INSERT INTO documents(vault_id, source_epoch, relative_path, title, sha256, size_bytes, mtime_ms, chunk_count, indexed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("vault-1", 3, "a.md", "A", "aa", 2, 1700000000000, 1, 1700000000000);
    return {
      sources: db.raw.prepare("SELECT * FROM sources").all(),
      documents: db.raw.prepare("SELECT * FROM documents").all(),
    };
  } finally {
    db.close();
  }
}

function seedModelFiles(fixture: Fixture): void {
  mkdirSync(join(fixture.legacyDir, "models", "bge-small-zh-v1.5"), { recursive: true });
  writeFileSync(join(fixture.legacyDir, "models", "bge-small-zh-v1.5", "model.onnx"), "model-bytes");
  writeFileSync(join(fixture.legacyDir, "extra-config.json"), "{}");
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(current, entry.name));
      else if (entry.isFile() && entry.name !== MIGRATION_LOCK_FILE_NAME) count += 1;
    }
  };
  walk(dir);
  return count;
}

function spawnLiveProcess(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  return {
    pid: child.pid ?? -1,
    kill: () => child.kill("SIGKILL"),
  };
}

test("首启搬迁：completed + 计数一致 + sources/documents 数据与指纹零变化", async () => {
  const fixture = buildFixture();
  try {
    const seeded = seedLegacyLibrary(fixture);
    seedModelFiles(fixture);
    const before = countFiles(fixture.legacyDir);
    const beforeBytes = readFileSync(fixture.legacyDbPath);

    const plan = resolveKnowledgeDataPlan();
    assert.equal(plan.mode, "legacy", "前置：旧库在位 → legacy 态");
    const outcome = await migrateLegacyKnowledgeData(plan);

    assert.ok(
      outcome.phase === "completed" && outcome.movedFiles === before,
      `应 completed 且搬迁计数=${outcome.phase === "completed" ? outcome.movedFiles : "?"} 等于旧目录文件数=${before}`,
    );
    assert.equal(countFiles(fixture.legacyDir), 0, "旧目录只剩空壳（0 文件）");
    assert.ok(existsSync(join(fixture.pluginKnowledgeDir, "knowledge-index.sqlite")));
    assert.ok(existsSync(join(fixture.pluginKnowledgeDir, "models", "bge-small-zh-v1.5", "model.onnx")));
    // move 语义 = 字节不变（§5：vaultId/configuredAt 不变 → 指纹/sourceEpoch 不变 → 零重建）。
    assert.deepEqual(
      readFileSync(join(fixture.pluginKnowledgeDir, "knowledge-index.sqlite")),
      beforeBytes,
    );
    const reopened = openKnowledgeDatabase(join(fixture.pluginKnowledgeDir, "knowledge-index.sqlite"));
    try {
      void reopened.raw;
      assert.deepEqual(reopened.raw.prepare("SELECT * FROM sources").all(), seeded.sources);
      assert.deepEqual(reopened.raw.prepare("SELECT * FROM documents").all(), seeded.documents);
    } finally {
      reopened.close();
    }
    // 搬迁后状态机收敛 plugin 态（无库首建也落插件目录）。
    assert.equal(resolveKnowledgeDataPlan().mode, "plugin");
  } finally {
    cleanupFixture(fixture);
  }
});

test("活跃 writer 拒绝：review_runtime_owners 存活 owner → 不动任何文件", async () => {
  const fixture = buildFixture();
  const live = spawnLiveProcess();
  try {
    seedLegacyLibrary(fixture);
    seedModelFiles(fixture);
    const db = openKnowledgeDatabase(fixture.legacyDbPath);
    try {
      void db.raw;
      db.raw
        .prepare(
          "INSERT INTO review_runtime_owners(vault_id, owner_pid, owner_host, token) VALUES (?, ?, ?, ?)",
        )
        .run("vault-1", live.pid, hostname(), "token-1");
    } finally {
      db.close();
    }
    const before = countFiles(fixture.legacyDir);

    const outcome = await migrateLegacyKnowledgeData(resolveKnowledgeDataPlan());

    assert.ok(
      outcome.phase === "blocked_active_writer" && outcome.ownerPids.includes(live.pid),
      "应 blocked_active_writer 且结构化载荷携带存活 owner PID",
    );
    assert.equal(countFiles(fixture.legacyDir), before, "拒绝搬迁：旧目录文件原样保留");
    assert.ok(!existsSync(join(fixture.pluginKnowledgeDir, "knowledge-index.sqlite")), "插件目录未被写入");
    assert.equal(resolveKnowledgeDataPlan().mode, "legacy", "状态机保持 legacy（下次启动重试）");
  } finally {
    live.kill();
    cleanupFixture(fixture);
  }
});

test("中断续搬：非 DB 文件已在目标侧（上次中断）→ 幂等续搬完成", async () => {
  const fixture = buildFixture();
  try {
    seedLegacyLibrary(fixture);
    seedModelFiles(fixture);
    // 模拟上次搬迁在 DB 之前被 SIGKILL：模型文件已搬过去、DB 仍在旧路径。
    mkdirSync(join(fixture.pluginKnowledgeDir, "models", "bge-small-zh-v1.5"), { recursive: true });
    writeFileSync(
      join(fixture.pluginKnowledgeDir, "models", "bge-small-zh-v1.5", "model.onnx"),
      "model-bytes",
    );
    rmSync(join(fixture.legacyDir, "models"), { recursive: true, force: true });
    assert.equal(resolveKnowledgeDataPlan().mode, "legacy", "DB 仍在旧路径 → 状态机回 legacy 续搬");

    const outcome = await migrateLegacyKnowledgeData(resolveKnowledgeDataPlan());

    assert.equal(outcome.phase, "completed");
    assert.equal(countFiles(fixture.legacyDir), 0);
    assert.equal(resolveKnowledgeDataPlan().mode, "plugin");
    assert.equal(
      readFileSync(join(fixture.pluginKnowledgeDir, "models", "bge-small-zh-v1.5", "model.onnx"), "utf8"),
      "model-bytes",
      "目标侧残留被源侧事实覆盖（幂等）",
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test("失败回退：中途失败 → 已搬文件逆序搬回、原件保留", async () => {
  const fixture = buildFixture();
  try {
    seedLegacyLibrary(fixture);
    seedModelFiles(fixture);
    // 注入中途失败：源侧加 lockeddir/x.bin，其目标父目录预置为只读——排序上
    // extra-config.json 先搬成功、lockeddir/x.bin 再失败，制造「部分已搬」再断言回退。
    mkdirSync(join(fixture.legacyDir, "lockeddir"), { recursive: true });
    writeFileSync(join(fixture.legacyDir, "lockeddir", "x.bin"), "x");
    mkdirSync(join(fixture.pluginKnowledgeDir, "lockeddir"), { recursive: true });
    chmodSync(join(fixture.pluginKnowledgeDir, "lockeddir"), 0o500);
    const before = countFiles(fixture.legacyDir);

    let outcome: Awaited<ReturnType<typeof migrateLegacyKnowledgeData>>;
    try {
      outcome = await migrateLegacyKnowledgeData(resolveKnowledgeDataPlan());
    } finally {
      chmodSync(join(fixture.pluginKnowledgeDir, "lockeddir"), 0o700);
    }

    assert.ok(
      outcome.phase === "failed" && outcome.rollbackRestored,
      "应 failed 且回退恢复全部已搬文件",
    );
    assert.equal(countFiles(fixture.legacyDir), before, "旧目录文件全部回到原位（原件保留）");
    assert.ok(!existsSync(join(fixture.pluginKnowledgeDir, "knowledge-index.sqlite")), "DB 主文件绝不停留目标侧");
    assert.equal(resolveKnowledgeDataPlan().mode, "legacy", "回退后仍 legacy，可重试搬迁");
  } finally {
    cleanupFixture(fixture);
  }
});

test("并发互斥：活进程持锁 → blocked_concurrent；残锁（持有者已死）→ 破锁续搬", async () => {
  const fixture = buildFixture();
  const live = spawnLiveProcess();
  try {
    seedLegacyLibrary(fixture);
    writeFileSync(
      join(fixture.legacyDir, MIGRATION_LOCK_FILE_NAME),
      `${JSON.stringify({ pid: live.pid, host: hostname() })}\n`,
    );

    const blocked = await migrateLegacyKnowledgeData(resolveKnowledgeDataPlan());
    assert.equal(blocked.phase, "blocked_concurrent");
    assert.ok(existsSync(fixture.legacyDbPath), "被锁期间不动任何文件");

    // 持有者死亡（模拟 SIGKILL 残锁）→ 下次搬迁破锁继续。
    live.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const recovered = await migrateLegacyKnowledgeData(resolveKnowledgeDataPlan());
    assert.equal(recovered.phase, "completed", "残锁按 PID 判死破除，搬迁继续");
    assert.equal(countFiles(fixture.legacyDir), 0);
  } finally {
    live.kill();
    cleanupFixture(fixture);
  }
});

test("工具面 migrating 结构化状态：running 态数据工具拒绝、元状态工具如实呈现", async () => {
  const fixture = buildFixture();
  try {
    seedLegacyLibrary(fixture);
    const plan = resolveKnowledgeDataPlan();
    assert.equal(plan.mode, "legacy");
    // server.ts 首启搬迁期间的 context 形态：dataPlane=null + migration running。
    const context: ToolContext = { dataPlane: null, plan, migration: { phase: "running" } };
    assert.throws(
      () => requireDataPlane(context),
      (error: unknown) => {
        assert.ok(error instanceof MigrationPendingError);
        const payload = error.payload as { status: string; phase: string };
        assert.equal(payload.status, "migrating");
        assert.equal(payload.phase, "running");
        return true;
      },
    );
    const statusTool = ALL_TOOLS.find((tool) => tool.name === "knowledge_server_status");
    assert.ok(statusTool, "元状态工具在册");
    const status = (await statusTool.handler({}, context)) as { status: string; phase: string };
    assert.equal(status.status, "migrating");
    assert.equal(status.phase, "running");
  } finally {
    cleanupFixture(fixture);
  }
});
