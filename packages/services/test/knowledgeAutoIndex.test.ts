/**
 * 索引自动 reconcile 单测（spec §5b.8 / AI-1..AI-4）。
 *
 * 断言：装配后自动完成一次索引（不调 startReconcile）；缺省关闭零 job；TTL 过期后
 * search 触发后台刷新且本次检索正常落定（陈旧一度）；未配置源静默跳过（无未处理
 * 拒绝）。全部使用合成临时 Vault，绝不触碰用户真实 Vault。
 * 运行：node --import tsx --test packages/services/test/knowledgeAutoIndex.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/knowledge/knowledgeServices.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时");
    await sleep(25);
  }
}

interface Env {
  root: string;
  pluginDataDir: string;
  vault: string;
}

async function createEnv(): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-auto-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vault = join(root, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(join(vault, "a.md"), "# A\n\n上下文窗口优化笔记\n", "utf-8");
  return { root, pluginDataDir, vault };
}

function createServices(env: Env, auto: boolean, extra: { staleTtlMs?: number } = {}): KnowledgeServices {
  return createKnowledgeServices({
    databasePath: join(env.root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir: env.pluginDataDir,
    ...(auto ? { autoIndexEnabled: true } : {}),
    autoIndexInitialDelayMs: 30,
    ...(extra.staleTtlMs === undefined ? {} : { autoIndexStaleTtlMs: extra.staleTtlMs }),
    leaseTtlMs: 2000,
    heartbeatIntervalMs: 250,
  });
}

test("AI-1：装配后自动完成一次索引（不调 startReconcile）", async () => {
  const env = await createEnv();
  const services = createServices(env, true);
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    // 显式轮询：等待自动 job 出现并到达终态。
    let latest: Awaited<ReturnType<KnowledgeServices["indexService"]["getStatus"]>> | null = null;
    const deadline = Date.now() + 8000;
    for (;;) {
      latest = await services.indexService.getStatus();
      if (latest.job && latest.job.status !== "running") break;
      if (Date.now() > deadline) throw new Error("自动索引任务未在时限内结束");
      await sleep(25);
    }
    assert.equal(latest.job?.kind, "reconcile");
    const status = await services.indexService.getStatus();
    assert.ok(status.coverage.indexedFiles >= 1, "自动索引应已覆盖至少一个文件");
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("AI-2：缺省关闭 → 不产生任何 job", async () => {
  const env = await createEnv();
  const services = createServices(env, false);
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await sleep(300);
    const status = await services.indexService.getStatus();
    assert.equal(status.job, null);
    assert.equal(status.coverage.indexedFiles, 0);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("AI-3：TTL 过期后 search 触发后台刷新，本次检索照常落定（陈旧一度）", async () => {
  const env = await createEnv();
  const services = createServices(env, true, { staleTtlMs: 0 });
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    // 等首次自动索引完成后新增文件，再走 search：本次应命中旧快照（0 候选也合法），
    // 同时 TTL=0 触发后台 reconcile；下一次查询应能看到新文件。
    await waitFor(async () => {
      const status = await services.indexService.getStatus();
      return status.job !== null && status.job.status !== "running" && status.coverage.indexedFiles >= 1;
    });
    await writeFile(join(env.vault, "b.md"), "# B\n\n量子纠缠实验记录\n", "utf-8");

    const run = await services.queryService.createRun({ query: "上下文窗口", clientRequestId: "ai3-1" });
    const finished = await services.queryService.search({ runId: run.runId });
    // 陈旧一度语义只保证「结构化落定」——并发 reconcile 按文档替换表内容，本次命中数
    // 可能是 ready/empty/partial 任意一种（快照一致性由 per-document 事务保证）。
    assert.ok(
      finished.status === "ready" || finished.status === "empty" || finished.status === "partial",
      `本次检索应结构化落定，实际 ${finished.status}`,
    );

    await waitFor(async () => {
      const status = await services.indexService.getStatus();
      return status.job !== null && status.job.status !== "running" && status.coverage.indexedFiles >= 2;
    });
    // TTL=0 时每次 search 都会并发触发刷新；per-document 替换窗口内的检索可能看不到
    // 单个文档（W02 既有并发语义）——用重试窗口断言「刷新后的索引对新查询可见」。
    let sawNew = false;
    for (let attempt = 0; attempt < 20 && !sawNew; attempt++) {
      const retryRun = await services.queryService.createRun({
        query: "量子纠缠",
        clientRequestId: `ai3-2-${attempt}`,
      });
      const retry = await services.queryService.search({ runId: retryRun.runId });
      sawNew = retry.candidates.some((candidate) => candidate.relativePath === "b.md");
      if (!sawNew) await sleep(50);
    }
    assert.ok(sawNew, "刷新后的索引对新查询可见（重试窗口内）");
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("AI-4：未配置源 → 静默跳过（无未处理拒绝，状态保持未配置）", async () => {
  const env = await createEnv();
  const services = createServices(env, true);
  try {
    await sleep(300);
    const status = await services.indexService.getStatus();
    assert.equal(status.configured, false);
    assert.equal(status.job, null);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});
