/**
 * W02 主场景测试（A02/A03/A04/A06/A10/A13-W02 部分 + spec §5b 验收映射）。
 *
 * 全部使用 mkdtemp 合成临时 Vault，绝不触碰用户真实 Vault。
 * 运行：node --import tsx --test packages/services/test/knowledgeIndexQuery.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, rename, unlink, symlink } from "node:fs/promises";
import { symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/knowledge/knowledgeServices.js";
import type { KnowledgeEmbeddingPort } from "../src/knowledge/search/embeddingPort.js";

interface TestEnv {
  root: string;
  pluginDataDir: string;
  vaultA: string;
  vaultB: string;
  services: KnowledgeServices;
}

async function createEnv(options: { embeddingPort?: KnowledgeEmbeddingPort } = {}): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vaultA = join(root, "vault-a");
  const vaultB = join(root, "vault-b");
  await mkdir(vaultA, { recursive: true });
  await mkdir(vaultB, { recursive: true });
  const services = createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir,
    embeddingPort: options.embeddingPort,
    leaseTtlMs: 2000,
    heartbeatIntervalMs: 250,
  });
  return { root, pluginDataDir, vaultA, vaultB, services };
}

async function destroyEnv(env: TestEnv): Promise<void> {
  env.services.dispose();
  await rm(env.root, { recursive: true, force: true });
}

async function waitForJobTerminal(services: KnowledgeServices, jobId: string, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await services.indexService.getStatus();
    if (status.job && status.job.jobId === jobId && status.job.status !== "running") {
      return status.job.status;
    }
    if (Date.now() > deadline) throw new Error(`任务未在时限内结束: ${jobId}`);
    await sleep(40);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeNote(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolute = join(vaultRoot, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf-8");
}

test("A02：新增 10 个笔记 → 索引完成且 coverage 准确（非 partial）", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    for (let index = 1; index <= 9; index++) {
      await writeNote(env.vaultA, `notes/笔记${index}.md`, `# 笔记${index}\n\n上下文窗口优化 第 ${index} 篇 context window note`);
    }
    await writeNote(env.vaultA, "readme.md", "# 说明\n\n全库说明 overview");

    const status0 = await env.services.indexService.getStatus();
    assert.equal(status0.configured, true);
    assert.equal(status0.coverage.indexedFiles, 0);

    const job = await env.services.indexService.startReconcile();
    assert.equal(job.alreadyRunning, false);
    const terminal = await waitForJobTerminal(env.services, job.jobId);
    assert.equal(terminal, "completed");

    const status = await env.services.indexService.getStatus();
    assert.equal(status.coverage.indexedFiles, 10);
    assert.ok(status.coverage.indexedChunks >= 10);
    assert.equal(status.coverage.partial, false);
    assert.equal(status.source?.sourceEpoch, 1);
    assert.equal(status.semantic, "unavailable");
  } finally {
    await destroyEnv(env);
  }
});

test("A03：修改/删除/重命名笔记 → 旧 chunk 不再可信展示", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    // 标记词用互斥单 token：避免 OR 降级（AND 无命中时一次扩搜）让共享词复活候选。
    await writeNote(env.vaultA, "a.md", "# A\n\n长期记忆不能替代上下文窗口 qqoldmarker");
    await writeNote(env.vaultA, "b.md", "# B\n\n普通内容 qqbetamarker");
    const job1 = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job1.jobId);

    // 修改：旧短语消失、新短语出现。
    await writeNote(env.vaultA, "a.md", "# A\n\n改写后的独特表述 qqnewmarker");
    const job2 = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job2.jobId);
    const searchOld = await runSearch(env, "qqoldmarker");
    assert.equal(searchOld.status, "empty");
    assert.equal(searchOld.candidates.length, 0);
    const searchNew = await runSearch(env, "qqnewmarker");
    assert.equal(searchNew.candidates.length, 1);
    assert.equal(searchNew.candidates[0]?.relativePath, "a.md");

    // 删除：内容从候选中消失。
    await unlink(join(env.vaultA, "b.md"));
    const job3 = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job3.jobId);
    const searchDeleted = await runSearch(env, "qqbetamarker");
    assert.equal(searchDeleted.status, "empty");

    // 重命名：旧路径候选消失，新路径可命中（内容未变 → 无需重切）。
    await rename(join(env.vaultA, "a.md"), join(env.vaultA, "renamed.md"));
    const job4 = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job4.jobId);
    const searchRenamed = await runSearch(env, "qqnewmarker");
    assert.equal(searchRenamed.candidates.length, 1);
    assert.equal(searchRenamed.candidates[0]?.relativePath, "renamed.md");
    const searchOldPath = await runSearch(env, "qqnewmarker");
    assert.ok(!searchOldPath.candidates.some((candidate) => candidate.relativePath === "a.md"));
  } finally {
    await destroyEnv(env);
  }
});

test("A04：隐藏/软链(junction)/超限/深度/非 md → 排除计数 + partial", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "visible.md", "# 可见\n\n正常收录 qqvisiblemarker");
    await writeNote(env.vaultA, ".hidden/hidden.md", "# 隐藏\n\n不得收录 qqhiddenmarker");
    await writeNote(env.vaultA, ".obsidian/workspace.md", "# 配置\n\n不得收录 qqobsidianmarker");
    await writeNote(env.vaultA, "notes.txt", "不是 markdown");
    // 超过 2MB 门面读取上限。
    await writeNote(env.vaultA, "oversize.md", `# 超大\n\n${"x".repeat(2 * 1024 * 1024)}`);
    // 深度越界：第 17 层目录内的文件不枚举。
    const deep = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", "l11", "l12", "l13", "l14", "l15", "l16", "l17"];
    let deepPath = env.vaultA;
    for (const segment of deep) deepPath = join(deepPath, segment);
    await mkdir(deepPath, { recursive: true });
    await writeFile(join(deepPath, "deep.md"), "# 深层\n\n不得收录 qqdeepmarker", "utf-8");
    // 软链文件优先；无权限时用目录 junction（Windows 总是可用）补软链排除覆盖。
    try {
      await symlink(join(env.vaultA, "visible.md"), join(env.vaultA, "link.md"), "file");
    } catch {
      symlinkSync(env.vaultA, join(env.vaultA, "link-dir"), "junction");
    }

    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const status = await env.services.indexService.getStatus();
    assert.equal(status.coverage.indexedFiles, 1);
    assert.equal(status.coverage.excludedHidden, 2); // .hidden 目录 + .obsidian 目录
    assert.equal(status.coverage.excludedNotMarkdown, 1);
    assert.equal(status.coverage.excludedOverSize, 1);
    assert.ok(status.coverage.excludedDepth >= 1);
    assert.ok(
      status.coverage.excludedSymlink >= 1 || status.coverage.excludedHidden >= 3,
      `软链/junction 应计入排除: ${JSON.stringify(status.coverage)}`,
    );
    assert.equal(status.coverage.partial, true);

    const hit = await runSearch(env, "qqvisiblemarker");
    assert.equal(hit.candidates.length, 1);
    for (const hidden of ["qqhiddenmarker", "qqobsidianmarker", "qqdeepmarker"]) {
      const miss = await runSearch(env, hidden);
      assert.equal(miss.candidates.length, 0, `${hidden} 不应被索引`);
    }
  } finally {
    await destroyEnv(env);
  }
});

test("切库：sourceEpoch 递增使旧 Query 失效、旧缓存清除（A13-W02）", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    // A 独有标记用单 token：换库后 AND/OR 都不应命中（OR 降级只会扩词，不会造词）。
    await writeNote(env.vaultA, "only-a.md", "# A 独有\n\nqqonlyamarker");
    const job1 = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job1.jobId);

    const staleRun = await env.services.queryService.createRun({ query: "qqonlyamarker", clientRequestId: "pre-switch" });
    assert.equal(staleRun.status, "retrieving");

    // 切库到 B（configureVaultAt 每次写入新 configuredAt → 指纹变化）。
    // epoch 是 vault 内计数：新 vault 从 1 起，旧 run 失效靠 (vaultId, epoch) 对比较。
    await configureVaultAt(env.pluginDataDir, env.vaultB);
    await writeNote(env.vaultB, "only-b.md", "# B 独有\n\nvault-beta-only-content");
    const status = await env.services.indexService.getStatus();
    assert.equal(typeof status.source?.sourceEpoch, "number");
    assert.notEqual(status.source?.vaultId, staleRun.source?.vaultId);
    assert.equal(status.coverage.indexedFiles, 0); // 旧 vault 缓存已清除

    const result = await env.services.queryService.search({ runId: staleRun.runId });
    assert.equal(result.status, "source_stale");
    assert.equal(result.candidates.length, 0);

    const job2 = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job2.jobId);
    const fresh = await runSearch(env, "vault-beta-only-content");
    assert.equal(fresh.candidates.length, 1);
    const old = await runSearch(env, "qqonlyamarker");
    assert.equal(old.candidates.length, 0);
  } finally {
    await destroyEnv(env);
  }
});

test("撤权：配置移除 → no_source；重新授权 → 新 epoch 使旧 run 失效", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nrevoke-test-content");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);
    const run = await env.services.queryService.createRun({ query: "revoke-test-content", clientRequestId: "r1" });
    assert.equal(run.status, "retrieving");

    // 撤权 = 移除源授权（vault-config.json 删除，与面板"未配置"同语义）。
    await unlink(join(env.pluginDataDir, "vault-config.json"));
    const revoked = await env.services.queryService.search({ runId: run.runId });
    assert.equal(revoked.status, "source_stale");
    const noSource = await env.services.queryService.createRun({ query: "revoke-test-content", clientRequestId: "r2" });
    assert.equal(noSource.status, "no_source");
    await assert.rejects(() => env.services.indexService.startReconcile(), /尚未配置 Vault/);
    const status = await env.services.indexService.getStatus();
    assert.equal(status.configured, false);

    // 重新授权同一根：configuredAt 变化 → epoch 递增，旧授权期的 run 全部失效。
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    const regranted = await env.services.indexService.getStatus();
    assert.equal(regranted.source?.sourceEpoch, 2);
    const again = await env.services.queryService.search({ runId: run.runId });
    assert.equal(again.status, "source_stale");
  } finally {
    await destroyEnv(env);
  }
});

test("中英混搜 + 负例不编造（A06/A10）", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "m1.md", "# 上下文工程\n\n上下文窗口优化 是第一优先级 context window tuning");
    await writeNote(env.vaultA, "m2.md", "# Memory\n\n长期记忆系统 memory system design");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    const zh = await runSearch(env, "上下文窗口");
    assert.ok(zh.candidates.some((c) => c.relativePath === "m1.md"));
    const en = await runSearch(env, "memory system");
    assert.ok(en.candidates.some((c) => c.relativePath === "m2.md"));
    const mixed = await runSearch(env, "窗口 context");
    assert.ok(mixed.candidates.some((c) => c.relativePath === "m1.md"));
    const singleChar = await runSearch(env, "窗");
    assert.ok(singleChar.candidates.some((c) => c.relativePath === "m1.md"));

    // 负例：库里只有"上下文窗口优化"，没有"长期记忆不能替代"的观点 → 不得声称找到。
    const negative = await runSearch(env, "长期记忆不能替代");
    assert.equal(negative.status, "empty");
    assert.equal(negative.candidates.length, 0);

    // 候选携带 quote selector 与 sha（W03 Receipt 绑定的输入）。
    const first = zh.candidates[0];
    assert.ok(first);
    assert.ok(first.quote.startLine >= 1);
    assert.ok(first.quote.endOffset > first.quote.startOffset);
    assert.equal(first.fileSha256.length, 64);
    assert.equal(first.chunkSha256.length, 64);
    assert.equal(first.evidenceStatus, "unverified");
  } finally {
    await destroyEnv(env);
  }
});

test("MATCH 注入输入安全降级；无词元查询显式 failed", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\ninjection-safe-content");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    const hostile = await runSearch(env, 'injection" OR 1=1 -- safe');
    assert.ok(hostile.status === "empty" || hostile.status === "ready" || hostile.status === "partial");

    const run = await env.services.queryService.createRun({ query: "*** ||", clientRequestId: "h1" });
    const failed = await env.services.queryService.search({ runId: run.runId });
    assert.equal(failed.status, "failed");
    assert.ok(failed.reason);
  } finally {
    await destroyEnv(env);
  }
});

test("semantic_unavailable 显式呈现；注入端口后 applied 且参与排序", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    // s1 词法 tf 高（BM25 赢家）；s2 携带词法不可检索的 §§ 标记（语义端口可感知）。
    await writeNote(env.vaultA, "s1.md", "gamma gamma gamma");
    await writeNote(env.vaultA, "s2.md", "gamma §§ note tail");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    // 无端口：词法候选照常，诊断显式 unavailable。
    const plain = await runSearch(env, "gamma");
    assert.equal(plain.diagnostics?.semantic, "unavailable");
    assert.equal(plain.diagnostics?.semanticReason, "port_not_configured");
    assert.ok(plain.candidates.length >= 1);
    assert.equal(plain.candidates[0]?.relativePath, "s1.md"); // BM25 tf 高者在前

    // 注入测试端口（确定性向量）：语义重排把 s2 提到最前。
    const port: KnowledgeEmbeddingPort = {
      id: "fake-test-port",
      async embed(texts) {
        return texts.map((text) => [text.includes("§") ? 1 : 0, 1]);
      },
    };
    const semanticEnv = await createEnv({ embeddingPort: port });
    try {
      await configureVaultAt(semanticEnv.pluginDataDir, semanticEnv.vaultA);
      await writeNote(semanticEnv.vaultA, "s1.md", "gamma gamma gamma");
      await writeNote(semanticEnv.vaultA, "s2.md", "gamma §§ note tail");
      const job2 = await semanticEnv.services.indexService.startReconcile();
      await waitForJobTerminal(semanticEnv.services, job2.jobId);
      const status = await semanticEnv.services.indexService.getStatus();
      assert.equal(status.semantic, "available");
      // 查询 "gamma §§"：§§ 不入词法索引（非字母数字），只被端口感知。
      const applied = await runSearch(semanticEnv, "gamma §§");
      assert.equal(applied.diagnostics?.semantic, "applied");
      assert.equal(applied.candidates[0]?.relativePath, "s2.md");
    } finally {
      await destroyEnv(semanticEnv);
    }
  } finally {
    await destroyEnv(env);
  }
});

test("run 语义：clientRequestId 幂等；cancelRun 后 in-flight 结果按代数丢弃", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\ncancel-test-content");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    const run1 = await env.services.queryService.createRun({ query: "cancel-test-content", clientRequestId: "same-key" });
    const run2 = await env.services.queryService.createRun({ query: "cancel-test-content", clientRequestId: "same-key" });
    assert.equal(run1.runId, run2.runId);

    const events: Array<{ seq: number; status: string; runGeneration: number }> = [];
    env.services.queryService.onRunUpdated((event) => {
      events.push({ seq: event.seq, status: event.status, runGeneration: event.runGeneration });
    });

    const cancelled = await env.services.queryService.cancelRun({ runId: run1.runId });
    assert.equal(cancelled.cancelled, true);
    const afterCancel = await env.services.queryService.search({ runId: run1.runId });
    assert.equal(afterCancel.status, "cancelled");
    assert.equal(afterCancel.candidates.length, 0);
    assert.ok(afterCancel.runGeneration > run1.runGeneration);
    assert.ok(events.some((event) => event.status === "cancelled" && event.seq >= 2));

    const unknown = await env.services.queryService.getRun({ runId: "run-nope" });
    assert.equal(unknown, null);
  } finally {
    await destroyEnv(env);
  }
});

test("requestRebuild 清空重建；同 epoch 重复提交幂等", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "a.md", "# A\n\nrebuild-test-content");
    const job1 = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job1.jobId);

    // 上一任务已完成后再次提交：拿到新任务（幂等 onlyRunning 只作用于进行中任务）。
    const again = await env.services.indexService.startReconcile();
    assert.notEqual(again.jobId, job1.jobId);
    await waitForJobTerminal(env.services, again.jobId);

    const rebuild = await env.services.indexService.requestRebuild();
    assert.equal(rebuild.kind, "rebuild");
    await waitForJobTerminal(env.services, rebuild.jobId);
    const status = await env.services.indexService.getStatus();
    assert.equal(status.coverage.indexedFiles, 1);
    const hit = await runSearch(env, "rebuild-test-content");
    assert.equal(hit.candidates.length, 1);
  } finally {
    await destroyEnv(env);
  }
});

async function runSearch(
  env: TestEnv,
  query: string,
): Promise<Awaited<ReturnType<KnowledgeServices["queryService"]["search"]>>> {
  const run = await env.services.queryService.createRun({
    query,
    clientRequestId: `test-${query}-${Math.random()}`,
  });
  assert.equal(run.status, "retrieving", `查询应绑定源: ${query}`);
  return env.services.queryService.search({ runId: run.runId });
}
