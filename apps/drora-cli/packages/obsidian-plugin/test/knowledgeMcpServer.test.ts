/**
 * knowledge MCP server stdio 冒烟（P3 gate，specs/obsidian-vault-phase2-true-extraction.md
 * §3/§10-P3）：经 @modelcontextprotocol/client 真实握手（modern era pin 2026-07-28，
 * node-repl-host bundle-smoke 同款路径），断言：
 * 1. 工具面完整（P3 四服务 51 方法 + 元状态工具 = 52；P4 追加 agent 工具
 *    vault_search/vault_neighbors = 54，映射清单 docs/knowledge-mcp-mapping.md）；
 * 2. run 订阅资源模板在册；
 * 3. D14 状态机：隔离数据根下无库 → ok/plugin（P6 起首建缺省落插件目录）；
 * 4. dual_db_conflict：两目录均有库 → 数据面结构化拒绝（fail-closed，不静默合并）；
 * 5. P6 首启自动搬迁：旧路径库在位 → server 启动自动搬至插件目录（migrating 收敛
 *    到 ok/plugin + completed），旧目录留空壳、数据计数一致（升级冒烟路径）。
 *
 * 运行：node --import tsx --test apps/drora-cli/packages/obsidian-plugin/test/knowledgeMcpServer.test.ts
 * （保留集发现走 .test.ts + node:test 内容判定；bundle 缺失时现场构建，保持可独立复跑。）
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { buildKnowledgeMcpBundle } from "../scripts/build-mcp.mjs";
import { openKnowledgeDatabase } from "../src/server/knowledge/store/knowledgeDatabase.js";

const packageRoot = join(import.meta.dirname, "..");
const serverBundle = join(packageRoot, "dist", "mcp", "server.js");

async function ensureBundle(): Promise<string> {
  if (!existsSync(serverBundle)) {
    await buildKnowledgeMcpBundle();
  }
  assert.ok(existsSync(serverBundle), "knowledge MCP bundle 构建失败");
  return serverBundle;
}

interface SpawnOptions {
  dataBaseDir: string;
  pluginDataDir: string;
}

async function withServer<T>(
  options: SpawnOptions,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const bundle = await ensureBundle();
  const transport = new StdioClientTransport({
    args: [bundle],
    command: process.execPath,
    cwd: packageRoot,
    stderr: "pipe",
    // D14 状态机的输入面：数据根经 env 跨进程对齐（与 services getDataBaseDir 同
    // 优先级中的 env 档）；插件数据目录用宿主注入的 DRORA_PLUGIN_DATA 同名键。
    env: {
      DRORA_DATA_BASE_DIR: options.dataBaseDir,
      DRORA_PLUGIN_DATA: options.pluginDataDir,
    },
  });
  const client = new Client(
    { name: "obsidian-knowledge-server-smoke", version: "0.4.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function callStatus(client: Client): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name: "knowledge_server_status", arguments: {} });
  const text = (result.content as Array<{ type: string; text?: string }> | undefined)?.[0]?.text;
  assert.ok(text, "knowledge_server_status 未返回 text 内容");
  return JSON.parse(text) as Record<string, unknown>;
}

test("握手 + 54 工具面（52 服务面 + 2 agent 工具） + 订阅资源模板 + 无库态 plugin（P6 首建缺省）", async () => {
  const root = join(tmpdir(), `p3-knowledge-smoke-${process.pid}-${Date.now()}`);
  const dataBaseDir = join(root, "base");
  const pluginDataDir = join(root, "plugin-data");
  mkdirSync(dataBaseDir, { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });
  try {
    await withServer({ dataBaseDir, pluginDataDir }, async (client) => {
      assert.equal(client.getProtocolEra(), "modern");
      assert.equal(client.getNegotiatedProtocolVersion(), "2026-07-28");

      const listed = await client.listTools();
      // 映射清单逐项对验收：51 服务面方法 + 1 元状态工具 + 2 agent 工具（P4 §4）。
      assert.equal(listed.tools.length, 54);
      const names = new Set(listed.tools.map((tool) => tool.name));
      // 四服务锚点各抽一件（完整清单见 docs/knowledge-mcp-mapping.md）。
      assert.ok(names.has("vault_read_file"));
      assert.ok(names.has("knowledge_index_get_status"));
      assert.ok(names.has("knowledge_query_get_run"));
      assert.ok(names.has("knowledge_review_apply_proposal"));
      assert.ok(names.has("knowledge_server_status"));
      // P4（§4/§10-P4）：agent 工具面随 server 常驻首发（D15）。
      assert.ok(names.has("vault_search"));
      assert.ok(names.has("vault_neighbors"));

      const templates = await client.listResourceTemplates();
      assert.equal(
        templates.resourceTemplates[0]?.uriTemplate,
        "vault://runs/{runId}",
        "onRunUpdated 订阅资源模板缺失",
      );

      // 无库态：P6 起首建缺省落插件目录（P7 后旧 host 已不存在，旧路径不再有人开库）。
      const status = await callStatus(client);
      assert.equal(status.status, "ok");
      assert.equal(status.mode, "plugin");
      assert.equal(status.databasePath, join(pluginDataDir, "knowledge", "knowledge-index.sqlite"));
      assert.equal(status.modelRoot, join(pluginDataDir, "knowledge", "models"));
      assert.equal(status.pluginDataDir, pluginDataDir);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dual_db_conflict：两库并存 → 数据面拒绝（fail-closed）", async () => {
  const root = join(tmpdir(), `p3-knowledge-conflict-${process.pid}-${Date.now()}`);
  const dataBaseDir = join(root, "base");
  const pluginDataDir = join(root, "plugin-data");
  const legacyDb = join(dataBaseDir, ".drora", "knowledge", "knowledge-index.sqlite");
  const pluginDb = join(pluginDataDir, "knowledge", "knowledge-index.sqlite");
  mkdirSync(join(legacyDb, ".."), { recursive: true });
  mkdirSync(join(pluginDb, ".."), { recursive: true });
  // 两侧各建真实库文件（KnowledgeDatabase 构造是惰性的，首访 .raw 才落盘开库——
  // 只 new 不触 .raw 不会创建文件，冲突态就绪假绿）。双库并存即冲突态。
  const legacyHandle = openKnowledgeDatabase(legacyDb);
  void legacyHandle.raw;
  legacyHandle.close();
  const pluginHandle = openKnowledgeDatabase(pluginDb);
  void pluginHandle.raw;
  pluginHandle.close();
  assert.ok(existsSync(legacyDb) && existsSync(pluginDb), "测试前置：双库文件未落盘");
  try {
    await withServer({ dataBaseDir, pluginDataDir }, async (client) => {
      const status = await callStatus(client);
      assert.equal(status.status, "dual_db_conflict");
      assert.equal(status.legacyDatabasePath, legacyDb);
      assert.equal(status.pluginDatabasePath, pluginDb);

      // 数据工具结构化拒绝：isError 携带冲突事实，不静默选边。
      const rejected = await client.callTool({ name: "vault_get_summary", arguments: {} });
      assert.equal(rejected.isError, true);
      const payload = JSON.parse(
        (rejected.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}",
      ) as Record<string, unknown>;
      assert.equal(payload.status, "dual_db_conflict");
      assert.equal(payload.legacyDatabasePath, legacyDb);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P6 首启自动搬迁：旧路径库在位 → server 启动自动搬迁（升级冒烟）", async () => {
  const root = join(tmpdir(), `p6-knowledge-upgrade-${process.pid}-${Date.now()}`);
  const dataBaseDir = join(root, "base");
  const pluginDataDir = join(root, "plugin-data");
  const legacyDir = join(dataBaseDir, ".drora", "knowledge");
  const legacyDb = join(legacyDir, "knowledge-index.sqlite");
  const pluginDb = join(pluginDataDir, "knowledge", "knowledge-index.sqlite");
  mkdirSync(legacyDir, { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });
  // 升级用户旧库：真实 sqlite（含 sources 行 + v6 owners 表）+ 模型文件。
  const db = openKnowledgeDatabase(legacyDb);
  let sourcesBefore: unknown[] = [];
  try {
    void db.raw;
    db.raw
      .prepare(
        "INSERT INTO sources(vault_id, display_name, fingerprint, current_epoch, updated_at_ms) VALUES (?, ?, ?, ?, ?)",
      )
      .run("vault-1", "升级库", "vault-1:1700000000000", 3, 1700000000000);
    sourcesBefore = db.raw.prepare("SELECT * FROM sources").all();
  } finally {
    db.close();
  }
  mkdirSync(join(legacyDir, "models", "bge-small-zh-v1.5"), { recursive: true });
  writeFileSync(join(legacyDir, "models", "bge-small-zh-v1.5", "model.onnx"), "model-bytes");
  try {
    await withServer({ dataBaseDir, pluginDataDir }, async (client) => {
      // 迁移可能先于首次 status 完成（小库毫秒级）也可能还在跑：轮询收敛到 ok/plugin。
      let status: Record<string, unknown> = {};
      for (let attempt = 0; attempt < 50; attempt += 1) {
        status = await callStatus(client);
        if (status.status === "ok" && status.mode === "plugin") break;
        assert.equal(status.status, "migrating", "收敛前只允许 migrating 态");
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      assert.equal(status.status, "ok");
      assert.equal(status.mode, "plugin");
      assert.equal(status.databasePath, pluginDb);
      const migration = status.migration as { phase: string; movedFiles?: number } | undefined;
      assert.equal(migration?.phase, "completed", "搬迁完成事实经元状态工具呈现");
      assert.ok(existsSync(pluginDb), "库已落插件目录");
      assert.ok(existsSync(join(pluginDataDir, "knowledge", "models", "bge-small-zh-v1.5", "model.onnx")));
      // 旧目录留空壳：0 数据文件（空目录壳保留，spec 不自动删本体数据根目录）。
      const countFiles = (dir: string): number => {
        let count = 0;
        const walk = (current: string) => {
          for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.isDirectory()) walk(join(current, entry.name));
            else if (entry.isFile() && entry.name !== ".drora-knowledge-migration.lock") count += 1;
          }
        };
        walk(dir);
        return count;
      };
      assert.equal(countFiles(legacyDir), 0, "旧目录应只剩空壳（0 数据文件）");
      // 数据计数一致：sources 行原样（fingerprint/sourceEpoch 不变 → 零重建）。
      const reopened = openKnowledgeDatabase(pluginDb);
      try {
        void reopened.raw;
        assert.deepEqual(reopened.raw.prepare("SELECT * FROM sources").all(), sourcesBefore);
      } finally {
        reopened.close();
      }
      // 数据面真实服务：vault 未配置 → getSummary 如实返回 null（成功调用，非拒绝）。
      const summary = await client.callTool({ name: "vault_get_summary", arguments: {} });
      assert.notEqual(summary.isError, true);
      const payload = JSON.parse(
        (summary.content as Array<{ type: string; text?: string }>)[0]?.text ?? "null",
      );
      assert.equal(payload, null);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
