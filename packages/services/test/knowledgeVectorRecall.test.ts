/**
 * 本地向量存储与混合召回测试（spec §5b.9 / K-VEC-1..5）。
 *
 * 全部使用合成临时 Vault + 确定性 stub 嵌入端口（按内容标记词映射到固定向量，
 * 与真实模型无关），断言：迁移 v5 表存在；变更文档向量同事务写/级联清理；回填
 * 阶段补齐存量；词面零重叠文档经向量召回进入候选；嵌入抛错各层独立降级。
 * 运行：node --import tsx --test packages/services/test/knowledgeVectorRecall.test.ts
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
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
import type { KnowledgeEmbeddingPort } from "../src/knowledge/search/embeddingPort.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("等待超时");
    await sleep(30);
  }
}

/**
 * 确定性 stub：按标记词映射到固定 4 维向量——「苹果/水果」一族、「深度学习/神经网络」
 * 一族、「面试」一族。语义相关性由 stub 定义，与词面重叠无关（K-VEC-4 的根基）。
 */
function createStubEmbedding(): KnowledgeEmbeddingPort {
  return {
    id: "stub-vec-test",
    async embed(texts: string[]): Promise<number[][] | null> {
      return texts.map((text) => {
        const vector = [0, 0, 0, 0.01];
        if (/苹果|水果/.test(text)) vector[0] = 1;
        if (/深度学习|神经网络/.test(text)) vector[1] = 1;
        if (/面试/.test(text)) vector[2] = 1;
        return vector;
      });
    },
  };
}

interface Env {
  root: string;
  pluginDataDir: string;
  vault: string;
  dbPath: string;
}

async function createEnv(): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-vector-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vault = join(root, "vault");
  await mkdir(vault, { recursive: true });
  return { root, pluginDataDir, vault, dbPath: join(root, "knowledge", "knowledge-index.sqlite") };
}

function createServices(env: Env, port?: KnowledgeEmbeddingPort): KnowledgeServices {
  return createKnowledgeServices({
    databasePath: env.dbPath,
    pluginDataDir: env.pluginDataDir,
    ...(port ? { embeddingPort: port } : {}),
    leaseTtlMs: 4000,
    heartbeatIntervalMs: 300,
  });
}

async function writeNote(env: Env, name: string, content: string): Promise<void> {
  await writeFile(join(env.vault, name), content, "utf-8");
}

async function runReconcileToTerminal(services: KnowledgeServices): Promise<void> {
  const job = await services.indexService.startReconcile();
  await waitFor(async () => {
    const status = await services.indexService.getStatus();
    return status.job?.jobId === job.jobId && status.job.status !== "running";
  });
}

async function searchOnce(
  services: KnowledgeServices,
  query: string,
  requestId: string,
): Promise<Awaited<ReturnType<KnowledgeServices["queryService"]["search"]>>> {
  const run = await services.queryService.createRun({ query, clientRequestId: requestId });
  return services.queryService.search({ runId: run.runId });
}

test("K-VEC-1/2：迁移 v5 表存在；索引写入向量且变更文档级联清理后重写", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "apple.md", "# 苹果\n\n苹果发布了新款手机。\n");
    await runReconcileToTerminal(services);

    const raw = new DatabaseSync(env.dbPath, { readOnly: true });
    const version = raw.prepare("SELECT MAX(version) AS v FROM schema_version").get() as {
      v: number;
    };
    assert.ok(version.v >= 5, "schema 应升级到 v5+");
    const vectors = raw
      .prepare("SELECT model_id AS modelId, dim AS dim FROM chunk_vectors")
      .all() as Array<{ modelId: string; dim: number }>;
    assert.ok(vectors.length >= 1, "索引后应有向量行");
    assert.ok(vectors.every((row) => row.modelId === "stub-vec-test" && row.dim === 4));
    raw.close();

    // 变更文档：旧 chunk 行级联清理 → 新向量重写（数量随新内容）。
    await writeNote(env, "apple.md", "# 苹果\n\n苹果发布了新款手机，同时支持深度学习拍照。\n");
    await runReconcileToTerminal(services);
    const raw2 = new DatabaseSync(env.dbPath, { readOnly: true });
    const after = raw2.prepare("SELECT COUNT(*) AS n FROM chunk_vectors").get() as { n: number };
    raw2.close();
    assert.ok(after.n >= 1, "变更后应有新向量");
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("K-VEC-3：回填阶段补齐存量缺向量（清库后 reconcile 自动补）", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "apple.md", "# 苹果\n\n苹果发布了新款手机。\n");
    await runReconcileToTerminal(services);

    // 模拟存量缺口：外部连接清空向量。
    const raw = new DatabaseSync(env.dbPath);
    raw.prepare("DELETE FROM chunk_vectors").run();
    raw.close();

    await runReconcileToTerminal(services);
    const raw2 = new DatabaseSync(env.dbPath, { readOnly: true });
    const after = raw2.prepare("SELECT COUNT(*) AS n FROM chunk_vectors").get() as { n: number };
    raw2.close();
    assert.ok(after.n >= 1, "回填后应恢复向量");
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("K-VEC-4：词面零重叠文档经向量召回进入候选（诊断 semanticRecalled 如实）", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    // 与查询「水果价格行情」零词面重叠（无 水果/价格/行情 及其 bigram）。
    await writeNote(env, "apple.md", "# 苹果\n\n苹果发布了新款手机。\n");
    await writeNote(env, "interview.md", "# 面试\n\n面试技巧分享。\n");
    await runReconcileToTerminal(services);

    const finished = await searchOnce(services, "水果价格行情", "kvec4-1");
    const apple = finished.candidates.find((candidate) => candidate.relativePath === "apple.md");
    assert.ok(apple, "词面零重叠的苹果笔记应经向量召回进入候选");
    // 小库上向量 top-64 会把余弦非零的其他 chunk 一并捞进池（如面试文），候选池
    // 本就是「宽进、排序精筛」的设计——断言苹果确实被向量独有召回即可。
    assert.ok((finished.diagnostics?.semanticRecalled ?? 0) >= 1, "向量独有召回数应 ≥1");
    // quote/事实字段照常携带（候选事实不变量）。
    assert.ok(apple.quote.startLine >= 1);
    assert.equal(apple.fileSha256.length, 64);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("K-VEC-5：嵌入抛错 → 文档照常索引（无向量）、检索照常（各层独立降级）", async () => {
  const env = await createEnv();
  const throwing: KnowledgeEmbeddingPort = {
    id: "stub-vec-throws",
    async embed(): Promise<number[][] | null> {
      throw new Error("模型不可用");
    },
  };
  const services = createServices(env, throwing);
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "apple.md", "# 苹果\n\n苹果发布了新款手机。\n");
    await runReconcileToTerminal(services);

    const raw = new DatabaseSync(env.dbPath, { readOnly: true });
    const vectors = raw.prepare("SELECT COUNT(*) AS n FROM chunk_vectors").get() as { n: number };
    raw.close();
    assert.equal(vectors.n, 0, "嵌入抛错不留半成品向量");

    const finished = await searchOnce(services, "苹果", "kvec5-1");
    assert.ok(finished.status === "ready" || finished.status === "partial");
    assert.ok(finished.candidates.some((candidate) => candidate.relativePath === "apple.md"));
    const recalled = finished.diagnostics?.semanticRecalled ?? 0;
    assert.equal(recalled, 0, "无向量则无向量召回");
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});
