/**
 * Agent 工具契约测试（P4 gate，specs/obsidian-vault-phase2-true-extraction.md
 * §4/§10-P4「插件工具契约测试」）：vault_search / vault_neighbors 两个 MCP 工具的
 * 契约面断言——
 * 1. 入参契约随迁 C8（contracts/src/tools/vault-search.ts、vault-neighbors.ts @
 *    bf872a6c0）：strict 拒未知键、限界（query/notePath ≤512、limit 1-10）；
 * 2. vault_search 全链路（createRun+search 零出站）+ **evidence 工具内复验**
 *    （§4.2/D9）：fresh 索引 current、文件改后 stale、文件删后 missing——旧三层
 *    接线收窄为工具内单层的可观察面；
 * 3. 出站白名单（vaultSearchProtocol.ts 同一收口）：候选无 score/sha/绝对路径，
 *    仅增 evidence 注解键；
 * 4. vault_neighbors 服务面 DTO 直通（近邻是向量事实非引用核验，无 evidence 注解）
 *    与结构化降级态（note_not_found / semantic_unavailable / no_source）；
 * 5. dual_db_conflict 数据面拒绝对 agent 工具同样生效（requireDataPlane 共路）；
 * 6. D15 常驻首发声明：manifest mcpServers.knowledge.alwaysLoad === true 且无工具级
 *    deferred（收敛声明留待双轨下线批次）。
 *
 * 全部使用合成临时 Vault + 确定性 stub 嵌入端口（knowledgeNeighbors.test.ts 同款
 * 手法），零模型/零网络。运行（与 P3 冒烟同 runner）：
 * node --import tsx --test apps/drora-cli/packages/obsidian-plugin/test/knowledgeAgentTools.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentTools } from "../src/mcp/agent-tools.js";
import { ALL_TOOLS, DualDbConflictError, type ToolContext, type ToolSpec } from "../src/mcp/tools.js";
import { setDataBaseDir } from "../src/server/platform/dataPaths.js";
import { configureVaultAt } from "../src/server/vault/config.js";
import { createObsidianVaultService } from "../src/server/vault/obsidianVaultService.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/server/knowledge/knowledgeServices.js";
import type { KnowledgeEmbeddingPort } from "../src/server/knowledge/search/embeddingPort.js";

function findTool(name: string): ToolSpec {
  const tool = agentTools.find((candidate) => candidate.name === name);
  assert.ok(tool, `agent 工具 ${name} 应在注册表`);
  return tool;
}

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

/** 确定性 stub：标记词 → 固定 4 维向量（苹果/水果族 vs 深度学习族，近邻可分族）。 */
function createStubEmbedding(): KnowledgeEmbeddingPort {
  return {
    id: "stub-agent-tools-test",
    async embed(texts: string[]): Promise<number[][] | null> {
      return texts.map((text) => {
        const vector = [0, 0.01];
        if (/苹果|水果/.test(text)) vector[0] = 1;
        return vector;
      });
    },
  };
}

interface Env {
  root: string;
  pluginDataDir: string;
  vault: string;
  services: KnowledgeServices;
  context: ToolContext;
}

async function createEnv(options: { embeddingPort?: KnowledgeEmbeddingPort; configure?: boolean } = {}): Promise<Env> {
  const root = await mkdtemp(join(tmpdir(), "drora-agent-tools-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vault = join(root, "vault");
  await mkdir(vault, { recursive: true });
  const services = createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir,
    ...(options.embeddingPort ? { embeddingPort: options.embeddingPort } : {}),
    // 不开 autoIndex：检索不触发后台 reconcile，文件改动后的 stale/missing 复验态确定。
    leaseTtlMs: 4000,
    heartbeatIntervalMs: 300,
  });
  if (options.configure !== false) {
    await configureVaultAt(pluginDataDir, vault);
  }
  const context: ToolContext = {
    dataPlane: {
      services,
      vault: createObsidianVaultService({ pluginDataDir }),
    },
    // plan 仅在 dual_db_conflict 态被 requireDataPlane 消费；happy path 给合法 legacy 形状。
    plan: {
      mode: "legacy",
      databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
      modelRoot: join(root, "knowledge", "models"),
      pluginDataDir,
    },
  };
  return { root, pluginDataDir, vault, services, context };
}

async function destroyEnv(env: Env): Promise<void> {
  env.services.dispose();
  await rm(env.root, { recursive: true, force: true });
}

async function writeNote(env: Env, name: string, content: string): Promise<void> {
  await writeFile(join(env.vault, name), content, "utf-8");
}

async function runReconcileToTerminal(env: Env): Promise<void> {
  const job = await env.services.indexService.startReconcile();
  await waitFor(async () => {
    const status = await env.services.indexService.getStatus();
    return status.job?.jobId === job.jobId && status.job.status !== "running";
  });
}

test("P4-1：入参契约随迁 C8——strict 拒未知键 + 限界", () => {
  const search = findTool("vault_search");
  // 合法形状（与 C8 VaultSearchInputSchema 同形：query 1-512、limit 1-10 可选）。
  assert.deepEqual(search.schema.parse({ query: "苹果" }), { query: "苹果" });
  assert.deepEqual(search.schema.parse({ query: "苹果", limit: 10 }), { query: "苹果", limit: 10 });
  assert.throws(() => search.schema.parse({ query: "苹果", extra: true }));
  assert.throws(() => search.schema.parse({ query: "" }));
  assert.throws(() => search.schema.parse({ query: "x".repeat(513) }));
  assert.throws(() => search.schema.parse({ query: "苹果", limit: 0 }));
  assert.throws(() => search.schema.parse({ query: "苹果", limit: 11 }));

  const neighbors = findTool("vault_neighbors");
  assert.deepEqual(neighbors.schema.parse({ notePath: "seed.md", limit: 1 }), {
    notePath: "seed.md",
    limit: 1,
  });
  assert.throws(() => neighbors.schema.parse({ notePath: "seed.md", tag: "x" }));
  assert.throws(() => neighbors.schema.parse({ notePath: "" }));
  assert.throws(() => neighbors.schema.parse({ notePath: "x".repeat(513) }));
  assert.throws(() => neighbors.schema.parse({ notePath: "seed.md", limit: 11 }));
});

test("P4-2：注册表接线——agent 工具与服务面工具名不冲突（server.ts 装配合并的前提）", () => {
  const serviceNames = new Set(ALL_TOOLS.map((tool) => tool.name));
  for (const tool of agentTools) {
    assert.ok(!serviceNames.has(tool.name), `工具名冲突: ${tool.name}`);
    assert.equal(tool.needsDataPlane, true, "agent 工具均需数据面");
  }
  assert.deepEqual(
    agentTools.map((tool) => tool.name).sort(),
    ["vault_neighbors", "vault_search"],
  );
});

test("P4-3：vault_search 全链路 + evidence 工具内复验 current；白名单无 score/sha/绝对路径", async () => {
  const env = await createEnv({ embeddingPort: createStubEmbedding() });
  try {
    await writeNote(env, "apple.md", "# 苹果种草\n\n苹果水果手机的使用体验记录。\n");
    await writeNote(env, "fruit.md", "# 水果笔记\n\n水果店采购清单与苹果偏好。\n");
    await writeNote(env, "far.md", "# 深度学习\n\n神经网络训练技巧摘要。\n");
    await runReconcileToTerminal(env);

    const tool = findTool("vault_search");
    const result = (await tool.handler({ query: "苹果 水果" }, env.context)) as {
      status: string;
      reason: string | null;
      candidates: Array<Record<string, unknown> & { evidence: { status: string } }>;
      diagnostics: Record<string, unknown> | null;
    };
    assert.equal(result.status, "ready");
    assert.ok(result.candidates.length >= 1, "中文检索应有候选");
    for (const candidate of result.candidates) {
      // 白名单 = C8 候选字段 + evidence 注解（P4/§4.2 新增的唯一键）。
      assert.deepEqual(Object.keys(candidate).sort(), [
        "articleId",
        "evidence",
        "excerpt",
        "matchedChunkCount",
        "matchedHeading",
        "quote",
        "rank",
        "relativePath",
        "title",
      ]);
      // 新鲜索引：摘录在调用时刻对当前文件逐字核验通过。
      assert.deepEqual(candidate.evidence, { status: "current" });
      // 相对路径不含 vault 根（无绝对路径外泄）。
      assert.ok(!String(candidate.relativePath).includes(env.root));
      assert.equal(typeof candidate.excerpt, "string");
    }
    assert.ok(result.diagnostics && "semantic" in result.diagnostics);
  } finally {
    await destroyEnv(env);
  }
});

test("P4-4：evidence 工具内复验降级——文件改后 stale、文件删后 missing（D9 单层复验的可观察面）", async () => {
  const env = await createEnv({ embeddingPort: createStubEmbedding() });
  try {
    await writeNote(env, "apple.md", "# 苹果种草\n\n苹果水果手机的使用体验记录。\n");
    await runReconcileToTerminal(env);
    const tool = findTool("vault_search");

    const baseline = (await tool.handler({ query: "苹果" }, env.context)) as {
      candidates: Array<{ relativePath: string }>;
    };
    assert.equal(baseline.candidates.length, 1);

    // 索引不变（无 autoIndex），文件被改 → fileSha256 漂移 → stale（不签 receipt 同语义）。
    await writeFile(join(env.vault, "apple.md"), "# 苹果种草\n\n改写后的内容。\n", "utf-8");
    const stale = (await tool.handler({ query: "苹果" }, env.context)) as {
      candidates: Array<{ evidence: { status: string } }>;
    };
    assert.equal(stale.candidates.length, 1);
    assert.deepEqual(stale.candidates[0]!.evidence, { status: "stale" });

    // 文件被删 → 门面 readFile 抛错 → missing（不可验证，不给部分真相）。
    await unlink(join(env.vault, "apple.md"));
    const missing = (await tool.handler({ query: "苹果" }, env.context)) as {
      candidates: Array<{ evidence: { status: string } }>;
    };
    assert.equal(missing.candidates.length, 1);
    assert.deepEqual(missing.candidates[0]!.evidence, { status: "missing" });
  } finally {
    await destroyEnv(env);
  }
});

test("P4-5：vault_search no_source——未配置 vault 结构化返回，不抛业务错", async () => {
  const env = await createEnv({ embeddingPort: createStubEmbedding(), configure: false });
  try {
    const tool = findTool("vault_search");
    const result = (await tool.handler({ query: "苹果" }, env.context)) as {
      status: string;
      candidates: unknown[];
      diagnostics: unknown;
    };
    assert.equal(result.status, "no_source");
    assert.deepEqual(result.candidates, []);
    assert.equal(result.diagnostics, null);
  } finally {
    await destroyEnv(env);
  }
});

test("P4-6：vault_neighbors 直通服务面——limit 生效、note_not_found 与 semantic_unavailable 显式降级", async () => {
  const tool = findTool("vault_neighbors");
  const env = await createEnv({ embeddingPort: createStubEmbedding() });
  try {
    await writeNote(env, "seed.md", "# 苹果种草\n\n苹果水果手机的使用体验记录。\n");
    await writeNote(env, "near-1.md", "# 苹果手机\n\n苹果水果生态与续航观察。\n");
    await writeNote(env, "near-2.md", "# 水果笔记\n\n水果店采购清单苹果偏好。\n");
    await runReconcileToTerminal(env);

    const limited = (await tool.handler({ notePath: "seed.md", limit: 1 }, env.context)) as {
      status: string;
      candidates: Array<Record<string, unknown>>;
    };
    assert.equal(limited.status, "ready");
    assert.equal(limited.candidates.length, 1, "limit=1 应只回一名近邻");
    // 近邻 DTO = 服务面白名单（无 evidence 注解：相似是向量事实，非引用核验）。
    assert.deepEqual(Object.keys(limited.candidates[0]!).sort(), [
      "articleId",
      "excerpt",
      "matchedChunkCount",
      "matchedHeading",
      "quote",
      "rank",
      "relativePath",
      "title",
    ]);

    const notFound = (await tool.handler({ notePath: "missing.md" }, env.context)) as {
      status: string;
      reason: string | null;
    };
    assert.equal(notFound.status, "note_not_found");
    assert.equal(notFound.reason, "note_not_indexed");
  } finally {
    await destroyEnv(env);
  }

  // 语义端口关闭（无 embeddingPort 装配）→ 显式降级，不静默回退词法。
  const noPortEnv = await createEnv();
  try {
    await writeNote(noPortEnv, "a.md", "# 苹果\n\n苹果水果内容。\n");
    await runReconcileToTerminal(noPortEnv);
    const unavailable = (await tool.handler({ notePath: "a.md" }, noPortEnv.context)) as {
      status: string;
    };
    assert.equal(unavailable.status, "semantic_unavailable");
  } finally {
    await destroyEnv(noPortEnv);
  }
});

test("P4-7：dual_db_conflict 数据面拒绝同样作用于 agent 工具（结构化冲突，不静默选边）", async () => {
  const tool = findTool("vault_search");
  const context: ToolContext = {
    dataPlane: null,
    plan: {
      mode: "dual_db_conflict",
      legacyDatabasePath: "/tmp/legacy.sqlite",
      pluginDatabasePath: "/tmp/plugin.sqlite",
      pluginDataDir: "/tmp/plugin-data",
    },
  };
  await assert.rejects(
    () => tool.handler({ query: "苹果" }, context),
    (error: unknown) => {
      assert.ok(error instanceof DualDbConflictError);
      const payload = error.payload as { status: string };
      assert.equal(payload.status, "dual_db_conflict");
      return true;
    },
  );
});

test("P4-8：D15 常驻首发声明——manifest knowledge server alwaysLoad=true，无工具级 deferred", () => {
  const manifest = JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", ".zcode-plugin", "plugin.json"),
      "utf8",
    ),
  ) as {
    mcpServers: Record<string, { alwaysLoad?: boolean; tools?: Record<string, unknown> }>;
  };
  const knowledge = manifest.mcpServers.knowledge;
  assert.ok(knowledge, "knowledge server 声明应在 manifest");
  // D15（建议值先行）：常驻首发 = server 级 alwaysLoad；工具级 deferred 是收敛期
  // （双轨下线批次）加回的声明，此处不得提前置位。
  assert.equal(knowledge.alwaysLoad, true);
  assert.equal(knowledge.tools, undefined);
});
