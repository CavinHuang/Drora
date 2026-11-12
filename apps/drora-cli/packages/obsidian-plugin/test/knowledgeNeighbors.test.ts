// 迁自 packages/services/test/knowledgeNeighbors.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
/**
 * vault_neighbors 服务面测试（specs/obsidian-vault-plugin-extraction.md §4.3，B5）。
 *
 * 全部使用合成临时 Vault + 确定性 stub 嵌入端口（按内容标记词映射固定向量，与
 * knowledgeVectorRecall.test.ts 同款手法）。断言：近邻按余弦排序且排除自身与
 * 下限外文档；候选白名单（无 score/sha/绝对路径）；note_not_found /
 * semantic_unavailable（端口关闭与模型不匹配两形态）/ no_source / empty 结构化
 * 返回不抛业务错；limit 生效。
 * 运行：node --import tsx --test packages/services/test/knowledgeNeighbors.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setDataBaseDir } from "../src/server/platform/dataPaths.js";
import { configureVaultAt } from "../src/server/vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/server/knowledge/knowledgeServices.js";
import type { KnowledgeEmbeddingPort } from "../src/server/knowledge/search/embeddingPort.js";
import { NEIGHBOR_SIMILARITY_FLOOR } from "../src/server/knowledge/query/knowledgeNeighbors.js";

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

/** 确定性 stub：标记词 → 固定 4 维向量（苹果/水果族、深度学习族、面试族）。 */
function createStubEmbedding(id = "stub-neighbors-test"): KnowledgeEmbeddingPort {
  return {
    id,
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
  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-neighbors-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vault = join(root, "vault");
  await mkdir(vault, { recursive: true });
  return { root, pluginDataDir, vault, dbPath: join(root, "knowledge", "knowledge-index.sqlite") };
}

function createServices(
  env: Env,
  port?: KnowledgeEmbeddingPort,
): KnowledgeServices {
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

test("VN-S1：近邻按余弦排序，排除自身与下限外文档；候选白名单无 score/sha", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "seed.md", "# 苹果种草\n\n苹果水果手机的使用体验记录。\n");
    await writeNote(env, "near-1.md", "# 苹果手机\n\n苹果水果生态与续航观察。\n");
    await writeNote(env, "near-2.md", "# 水果笔记\n\n水果店采购清单苹果偏好。\n");
    await writeNote(env, "far.md", "# 深度学习\n\n神经网络训练技巧摘要。\n");
    await runReconcileToTerminal(services);

    const result = await services.queryService.neighbors({ notePath: "seed.md" });
    assert.equal(result.status, "ready");
    assert.equal(result.reason, null);
    // far.md 是另一族向量，余弦 ≈ 0.0001 远低于 NEIGHBOR_SIMILARITY_FLOOR，不进候选。
    assert.ok(
      result.candidates.every((candidate) => candidate.relativePath !== "far.md"),
      "下限外文档不应出现在候选中",
    );
    const paths = result.candidates.map((candidate) => candidate.relativePath);
    assert.ok(!paths.includes("seed.md"), "自身不进候选");
    assert.deepEqual([...paths].sort(), ["near-1.md", "near-2.md"]);
    // rank 从 1 连续递增；quote 行号真实存在（1-based）。
    result.candidates.forEach((candidate, index) => {
      assert.equal(candidate.rank, index + 1);
      assert.ok(candidate.quote.startLine >= 1);
      assert.ok(candidate.matchedChunkCount >= 1);
      assert.ok(candidate.excerpt.length <= 240);
    });
    // 白名单边界（§4.3）：键集恰为协议候选字段，无 score/sha/绝对路径。
    assert.deepEqual(
      Object.keys(result.candidates[0]!).sort(),
      [
        "articleId",
        "excerpt",
        "matchedChunkCount",
        "matchedHeading",
        "quote",
        "rank",
        "relativePath",
        "title",
      ],
    );
    // 下限常量在位（校准锚点：改值必须显式改测试）。
    assert.equal(NEIGHBOR_SIMILARITY_FLOOR, 0.3);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("VN-S2：notePath 不在索引 → note_not_found 结构化返回", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "a.md", "# 苹果\n\n苹果水果内容。\n");
    await runReconcileToTerminal(services);
    const result = await services.queryService.neighbors({ notePath: "missing.md" });
    assert.equal(result.status, "note_not_found");
    assert.equal(result.reason, "note_not_indexed");
    assert.deepEqual(result.candidates, []);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("VN-S3a：语义端口关闭 → semantic_unavailable（显式降级，不静默回退）", async () => {
  const env = await createEnv();
  // 无 embeddingPort 装配：索引不写向量、语义上下文无端口。
  const services = createServices(env);
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "a.md", "# 苹果\n\n苹果水果内容。\n");
    await runReconcileToTerminal(services);
    const result = await services.queryService.neighbors({ notePath: "a.md" });
    assert.equal(result.status, "semantic_unavailable");
    assert.equal(result.reason, "semantic_port_disabled");
    assert.deepEqual(result.candidates, []);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("VN-S3b：换模型后向量未回填（模型 id 不匹配）→ semantic_unavailable", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding("model-v1"));
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "a.md", "# 苹果\n\n苹果水果内容。\n");
    await runReconcileToTerminal(services);
    services.dispose();
    // 同一 DB 换 model-v2 端口重建服务：存量向量是 model-v1 的，种子在新模型下无向量。
    const servicesV2 = createServices(env, createStubEmbedding("model-v2"));
    try {
      const result = await servicesV2.queryService.neighbors({ notePath: "a.md" });
      assert.equal(result.status, "semantic_unavailable");
      assert.equal(result.reason, "note_vectors_missing");
      assert.deepEqual(result.candidates, []);
    } finally {
      servicesV2.dispose();
    }
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test("VN-S4：未配置 vault → no_source", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    const result = await services.queryService.neighbors({ notePath: "any.md" });
    assert.equal(result.status, "no_source");
    assert.equal(result.reason, "vault_not_configured");
    assert.deepEqual(result.candidates, []);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("VN-S5：全库无同族文档 → empty；limit 截断候选数", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    await configureVaultAt(env.pluginDataDir, env.vault);
    await writeNote(env, "only.md", "# 苹果\n\n苹果水果内容。\n");
    await writeNote(env, "other.md", "# 深度学习\n\n神经网络内容。\n");
    await runReconcileToTerminal(services);
    const empty = await services.queryService.neighbors({ notePath: "only.md" });
    assert.equal(empty.status, "empty");
    assert.deepEqual(empty.candidates, []);

    // limit：三个同族近邻时 limit=2 只回前 2 名。
    await writeNote(env, "n1.md", "# 苹果一\n\n苹果水果补充一。\n");
    await writeNote(env, "n2.md", "# 苹果二\n\n苹果水果补充二。\n");
    await writeNote(env, "n3.md", "# 苹果三\n\n苹果水果补充三。\n");
    await runReconcileToTerminal(services);
    const limited = await services.queryService.neighbors({ notePath: "only.md", limit: 2 });
    assert.equal(limited.status, "ready");
    assert.equal(limited.candidates.length, 2);
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});

test("VN-S6：入参形态校验——空 notePath / 非法 limit 拒绝", async () => {
  const env = await createEnv();
  const services = createServices(env, createStubEmbedding());
  try {
    await assert.rejects(() => services.queryService.neighbors({ notePath: "" }));
    await assert.rejects(() => services.queryService.neighbors({ notePath: "a.md", limit: 0 }));
    await assert.rejects(() =>
      services.queryService.neighbors({ notePath: "a.md", limit: Number.NaN }),
    );
  } finally {
    services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});
