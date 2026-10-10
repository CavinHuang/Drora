/**
 * W03 EvidenceReceipt 主场景测试（A12/A13/A14/A15/A18/A19 + spec §5 验收映射）。
 *
 * 全部使用 mkdtemp 合成临时 Vault，绝不触碰用户真实 Vault；
 * 全链零模型/零网络（services 不携带任何模型依赖——A18 的结构性保证）。
 * 运行：node --import tsx --test packages/services/test/knowledgeEvidence.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, unlink, writeFile, readFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS,
  knowledgeSourceFingerprint,
} from "@drora/shared";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/knowledge/knowledgeServices.js";
import { openKnowledgeDatabase } from "../src/knowledge/store/knowledgeDatabase.js";

interface TestEnv {
  root: string;
  pluginDataDir: string;
  vaultA: string;
  vaultB: string;
  services: KnowledgeServices;
  databasePath: string;
}

async function createEnv(): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), "drora-evidence-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vaultA = join(root, "vault-a");
  const vaultB = join(root, "vault-b");
  await mkdir(vaultA, { recursive: true });
  await mkdir(vaultB, { recursive: true });
  const databasePath = join(root, "knowledge", "knowledge-index.sqlite");
  const services = createKnowledgeServices({
    databasePath,
    pluginDataDir,
    leaseTtlMs: 2000,
    heartbeatIntervalMs: 250,
  });
  return { root, pluginDataDir, vaultA, vaultB, services, databasePath };
}

async function destroyEnv(env: TestEnv): Promise<void> {
  env.services.dispose();
  await rm(env.root, { recursive: true, force: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJobTerminal(services: KnowledgeServices, jobId: string): Promise<string> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const status = await services.indexService.getStatus();
    if (status.job && status.job.jobId === jobId && status.job.status !== "running") {
      return status.job.status;
    }
    if (Date.now() > deadline) throw new Error(`任务未在时限内结束: ${jobId}`);
    await sleep(40);
  }
}

async function writeNote(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolute = join(vaultRoot, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf-8");
}

/** 检索并返回首条命中候选（测试定位用单一标记词，避免 OR 降级引入噪声）。 */
async function searchOne(
  env: TestEnv,
  query: string,
  sessionId?: string,
): Promise<Awaited<ReturnType<KnowledgeServices["queryService"]["search"]>>> {
  const run = await env.services.queryService.createRun({
    query,
    clientRequestId: `ev-${query}-${Math.random()}`,
    ...(sessionId ? { sessionId } : {}),
  });
  assert.equal(run.status, "retrieving");
  assert.equal(run.sessionId, sessionId ?? null);
  const done = await env.services.queryService.search({ runId: run.runId });
  assert.equal(done.candidates.length, 1, `应恰好命中一篇: ${query}`);
  return done;
}

interface PreparedRun {
  run: Awaited<ReturnType<KnowledgeServices["queryService"]["search"]>>;
  articleId: string;
}

async function prepareCurrent(
  env: TestEnv,
  marker: string,
  sessionId = "session-1",
): Promise<PreparedRun> {
  const run = await searchOne(env, marker, sessionId);
  const candidate = run.candidates[0];
  assert.ok(candidate);
  const prepared = await env.services.queryService.prepareEvidence({
    runId: run.runId,
    articleId: candidate.articleId,
  });
  assert.equal(prepared.status, "current");
  assert.ok(prepared.receipt);
  return { run, articleId: candidate.articleId };
}

test("A12 前置：prepare 签发绑定完整的 opaque receipt，resolveCitation 返回 current", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "notes/evidence.md", "# 证据标题\n\n独特的证据句子 evidence marker one");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    const { run } = await prepareCurrent(env, "evidence marker", "session-A");
    const prepared = await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    });
    assert.equal(prepared.status, "current");
    const receipt = prepared.receipt!;
    assert.ok(receipt.receiptId.startsWith("evr_"));
    assert.equal(receipt.sessionId, "session-A");
    assert.equal(receipt.runId, run.runId);
    assert.equal(receipt.relativePath, "notes/evidence.md");
    assert.equal(receipt.title, "证据标题");
    assert.ok(receipt.fileSha256.length === 64);
    assert.ok(receipt.chunkSha256.length === 64);
    assert.ok(receipt.quote.endOffset > receipt.quote.startOffset);
    assert.ok(receipt.excerpt.includes("evidence marker"));
    assert.ok(receipt.excerpt.length <= 241); // 有界（240 + 省略号）
    const summary = await env.services.queryService.resolveCitation({
      receiptId: receipt.receiptId,
      sessionId: "session-A",
    });
    assert.equal(summary.status, "current");
    assert.equal(summary.citation!.relativePath, "notes/evidence.md");
    assert.equal(summary.citation!.sessionId, "session-A");
    assert.equal(summary.citation!.quote.startLine, receipt.quote.startLine);
  } finally {
    await destroyEnv(env);
  }
});

test("A12：文件修改 → stale；文件删除 → missing", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nstale-check-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const { run } = await prepareCurrent(env, "stale-check-marker");
    const receiptId = (await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    })).receipt!.receiptId;

    await writeNote(env.vaultA, "a.md", "# A\n\n内容已被修改 stale-changed");
    const stale = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-1",
    });
    assert.equal(stale.status, "stale");
    assert.equal(stale.citation, null);

    await unlink(join(env.vaultA, "a.md"));
    const missing = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-1",
    });
    assert.equal(missing.status, "missing");
  } finally {
    await destroyEnv(env);
  }
});

test("A13：切库 → forbidden/vault_switched；撤权 → forbidden；重授权 → stale/source_reauthorized", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nswitch-check-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const { run } = await prepareCurrent(env, "switch-check-marker");
    const receiptId = (await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    })).receipt!.receiptId;

    // 切库到 B：旧 receipt 指向的 vaultId 不再是当前源。
    await configureVaultAt(env.pluginDataDir, env.vaultB);
    const switched = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-1",
    });
    assert.equal(switched.status, "forbidden");

    // 撤权（配置删除，与面板「未配置」同语义）。
    await unlink(join(env.pluginDataDir, "vault-config.json"));
    const revoked = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-1",
    });
    assert.equal(revoked.status, "forbidden");

    // 重新授权同一根：configuredAt 变化 → 指纹变化 → stale（不是 current）。
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    const regranted = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-1",
    });
    assert.equal(regranted.status, "stale");
  } finally {
    await destroyEnv(env);
  }
});

test("A14：伪造/未知 receiptId → forbidden/unknown_receipt，绝不当可信引用", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nforge-check-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    for (const forged of ["evr_deadbeefdeadbeefdeadbeefdeadbeef", "not-even-a-receipt", ""]) {
      const result = await env.services.queryService.resolveCitation({
        receiptId: forged || "evr_x",
        sessionId: "session-1",
      });
      assert.equal(result.status, "forbidden");
      assert.equal(result.citation, null);
    }
  } finally {
    await destroyEnv(env);
  }
});

test("A15：quote 切片校验——账本行被篡改（chunk sha 不符）→ stale/quote_moved 不静默", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nquote-move-marker\n\nsecond paragraph");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const { run } = await prepareCurrent(env, "quote-move-marker");
    const receiptId = (await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    })).receipt!.receiptId;

    // 直接改账本行（模拟账本损坏/写入 bug）：文件与 file sha 都没变，只有 quote 绑定坏了。
    const raw = new DatabaseSync(env.databasePath);
    try {
      raw
        .prepare("UPDATE evidence_receipts SET chunk_sha256 = ? WHERE receipt_id = ?")
        .run("0".repeat(64), receiptId);
    } finally {
      raw.close();
    }
    const moved = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-1",
    });
    assert.equal(moved.status, "stale");
  } finally {
    await destroyEnv(env);
  }
});

test("A19：会话绑定——他 session 与未携 session 都不得解析绑定 receipt", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\ncross-session-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const { run } = await prepareCurrent(env, "cross-session-marker", "session-alpha");
    const receiptId = (await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    })).receipt!.receiptId;

    const other = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-beta",
    });
    assert.equal(other.status, "forbidden");
    // 未携带会话同样不放行（保守面）。
    const anonymous = await env.services.queryService.resolveCitation({ receiptId });
    assert.equal(anonymous.status, "forbidden");
    const same = await env.services.queryService.resolveCitation({
      receiptId,
      sessionId: "session-alpha",
    });
    assert.equal(same.status, "current");

    // 无会话 run 的 receipt 不绑会话：跨会话可解析（仍受源/文件校验）。
    const anonRun = await searchOne(env, "cross-session-marker");
    const anonReceipt = (await env.services.queryService.prepareEvidence({
      runId: anonRun.runId,
      articleId: anonRun.candidates[0]!.articleId,
    })).receipt!;
    assert.equal(anonReceipt.sessionId, "");
    const fromOther = await env.services.queryService.resolveCitation({
      receiptId: anonReceipt.receiptId,
      sessionId: "session-beta",
    });
    assert.equal(fromOther.status, "current");
  } finally {
    await destroyEnv(env);
  }
});

test("prepare 的复验门：源失效/文件已改/未知候选 → 结构化拒绝且不签发 receipt", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nprepare-gate-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    // 未知 run / 未知候选 → forbidden。
    assert.equal(
      (await env.services.queryService.prepareEvidence({ runId: "run-nope", articleId: "x" })).status,
      "forbidden",
    );
    const run = await searchOne(env, "prepare-gate-marker", "session-1");
    assert.equal(
      (await env.services.queryService.prepareEvidence({ runId: run.runId, articleId: "nope" })).status,
      "forbidden",
    );

    // 文件已改 → stale，不签发（receipt 只为 current 证据存在）。
    await writeNote(env.vaultA, "a.md", "# A\n\nprepare-gate-changed");
    const stale = await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    });
    assert.equal(stale.status, "stale");
    assert.equal(stale.receipt, null);

    // 源失效（撤权）→ 结构化拒绝。
    await unlink(join(env.pluginDataDir, "vault-config.json"));
    const revoked = await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    });
    assert.ok(revoked.status === "source_stale" || revoked.status === "no_source");
    assert.equal(revoked.receipt, null);
  } finally {
    await destroyEnv(env);
  }
});

test("A18（W03 部分）：无模型/断网下检索与 Receipt 全链可用", async () => {
  const env = await createEnv();
  try {
    // 不配置任何 provider/model——FIND_ARTICLE 不强制触发 Agent 回答。
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\noffline-check-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const run = await searchOne(env, "offline-check-marker");
    const prepared = await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    });
    assert.equal(prepared.status, "current");
    const resolved = await env.services.queryService.resolveCitation({
      receiptId: prepared.receipt!.receiptId,
      sessionId: "session-1",
    });
    assert.equal(resolved.status, "current");
  } finally {
    await destroyEnv(env);
  }
});

test("账本持久化：跨服务实例（进程重启模型）receipt 仍可解析", async () => {
  const env = await createEnv();
  let receiptId = "";
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\npersist-check-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const run = await searchOne(env, "persist-check-marker", "session-1");
    const prepared = await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: run.candidates[0]!.articleId,
    });
    assert.equal(prepared.status, "current");
    receiptId = prepared.receipt!.receiptId;
  } finally {
    env.services.dispose();
  }
  // 重新打开同一 DB（新实例；run 内存态已丢，但账本在盘上）。
  const db = openKnowledgeDatabase(env.databasePath);
  try {
    const row = db.raw
      .prepare("SELECT receipt_id, source_fingerprint FROM evidence_receipts WHERE receipt_id = ?")
      .get(receiptId) as { receipt_id: string; source_fingerprint: string } | undefined;
    assert.ok(row);
    assert.equal(row.receipt_id, receiptId);
    // 指纹 = sha256(realpath 根):configuredAt（与当前 vault-config.json 一致）。
    const config = JSON.parse(
      await readFile(join(env.pluginDataDir, "vault-config.json"), "utf-8"),
    ) as { configuredAt: number };
    const realRoot = await realpath(env.vaultA);
    const expected = knowledgeSourceFingerprint(
      createHash("sha256").update(realRoot, "utf-8").digest("hex"),
      config.configuredAt,
    );
    assert.equal(row.source_fingerprint, expected);
  } finally {
    db.close();
    await rm(env.root, { recursive: true, force: true });
  }
});

// 与 W02 测试同款：evidence_receipts 的 DDL 与 migration v2 必须同源（共享常量）。
test("migration v2 建表与共享 DDL 常量同源（CLI 只读侧契约）", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nddl-parity-marker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const raw = new DatabaseSync(env.databasePath);
    try {
      const version = raw.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
      assert.ok(version.v >= 2);
      const columns = raw.prepare("PRAGMA table_info(evidence_receipts)").all() as Array<{ name: string }>;
      // 共享 DDL 的列名都在实际表中（列清单单一出处）。
      const ddlColumns = [...KNOWLEDGE_EVIDENCE_RECEIPTS_TABLE_STATEMENTS[0]!.matchAll(/^\s+(\w+)\s+(?:TEXT|INTEGER)/gmu)].map(
        (match) => match[1]!,
      );
      assert.ok(ddlColumns.length >= 18);
      for (const column of ddlColumns) {
        assert.ok(columns.some((actual) => actual.name === column), `列缺失: ${column}`);
      }
    } finally {
      raw.close();
    }
  } finally {
    await destroyEnv(env);
  }
});
