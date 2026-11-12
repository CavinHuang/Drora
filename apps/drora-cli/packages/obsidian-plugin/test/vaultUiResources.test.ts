/**
 * Vault 面板 UI 资源面契约测试（P5 gate，specs/obsidian-vault-phase2-true-extraction.md
 * §2 数据通道、§10-P5）：经真实 stdio MCP client（knowledgeMcpServer.test.ts 同款
 * 路径）断言：
 * 1. 面板 HTML 资源：text/html;profile=mcp-app + `_meta.ui.backgroundRetention:true`
 *    （§2 display modes 段——后台保留申报）；conflict 态仍可打开（页面要能呈现冲突）；
 * 2. 数据端点封套/分页/分段：files offset/limit、file 分段窗口（sha256/hasMore）、
 *    status/insights/write-gate/proposals 只读面；
 * 3. N1 lookup（检索即终点）：返回 run 视图候选；
 * 4. D14：两库并存 → 数据端点 dual_db_conflict 封套（不静默合并）。
 *
 * 运行：node --import tsx --test apps/drora-cli/packages/obsidian-plugin/test/vaultUiResources.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { buildKnowledgeMcpBundle } from "../scripts/build-mcp.mjs";
import { buildVaultPanelBundle } from "../scripts/build-ui.mjs";
import { openKnowledgeDatabase } from "../src/server/knowledge/store/knowledgeDatabase.js";

const packageRoot = join(import.meta.dirname, "..");

async function ensureBundles(): Promise<void> {
  if (!existsSync(join(packageRoot, "dist", "mcp", "server.js"))) await buildKnowledgeMcpBundle();
  if (!existsSync(join(packageRoot, "dist", "ui", "panel.html"))) await buildVaultPanelBundle();
}

interface Fixture {
  root: string;
  vaultDir: string;
  dataBaseDir: string;
  pluginDataDir: string;
}

function makeFixture(): Fixture {
  const root = join(tmpdir(), `p5-vault-ui-${process.pid}-${Date.now()}`);
  const vaultDir = join(root, "vault");
  const dataBaseDir = join(root, "base");
  const pluginDataDir = join(root, "plugin-data");
  mkdirSync(join(vaultDir, "notes"), { recursive: true });
  mkdirSync(dataBaseDir, { recursive: true });
  mkdirSync(pluginDataDir, { recursive: true });
  writeFileSync(
    join(vaultDir, "notes", "alpha.md"),
    "# Alpha\n\n相关 [[notes/beta]] 的内容，包含足够长的正文用于分段读取验证。\n",
  );
  writeFileSync(
    join(vaultDir, "notes", "beta.md"),
    "# Beta\n\nBeta 笔记正文，含 wikilink [[alpha]]。\n",
  );
  writeFileSync(
    join(pluginDataDir, "vault-config.json"),
    JSON.stringify({
      rootPath: vaultDir,
      displayName: "P5 Fixture Vault",
      inboxPath: "Inbox",
      allowAgentWrites: true,
      configuredAt: Date.now(),
    }),
  );
  return { root, vaultDir, dataBaseDir, pluginDataDir };
}

async function withClient<T>(
  fixture: Fixture,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StdioClientTransport({
    args: [join(packageRoot, "dist", "mcp", "server.js")],
    command: process.execPath,
    cwd: packageRoot,
    stderr: "pipe",
    env: {
      DRORA_DATA_BASE_DIR: fixture.dataBaseDir,
      DRORA_PLUGIN_DATA: fixture.pluginDataDir,
    },
  });
  const client = new Client(
    { name: "p5-vault-ui-resources-test", version: "0.4.0" },
    // modern era pin 与 knowledgeMcpServer.test.ts 同款（2026-07-28）。
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; [key: string]: unknown };
}

async function readData(client: Client, suffix: string): Promise<Envelope> {
  const result = await client.readResource({ uri: `ui://obsidian/data/${suffix}` });
  const content = result.contents[0];
  assert.ok(content && "text" in content, `数据端点 ${suffix} 未返回 text`);
  return JSON.parse(content.text) as Envelope;
}

test("面板 HTML 资源：mcp-app profile + backgroundRetention 申报（conflict 态也可读）", async () => {
  await ensureBundles();
  const fixture = makeFixture();
  try {
    // conflict 态：两库并存 → 数据面拒绝，但面板本体必须可读（页面呈现冲突说明）。
    // KnowledgeDatabase 构造惰性：必须触 .raw 才落盘（P3 conflict 用例同款注记）。
    const legacyDb = join(fixture.dataBaseDir, ".drora", "knowledge", "knowledge-index.sqlite");
    const pluginDb = join(fixture.pluginDataDir, "knowledge", "knowledge-index.sqlite");
    mkdirSync(join(legacyDb, ".."), { recursive: true });
    mkdirSync(join(pluginDb, ".."), { recursive: true });
    const legacyHandle = openKnowledgeDatabase(legacyDb);
    void legacyHandle.raw;
    legacyHandle.close();
    const pluginHandle = openKnowledgeDatabase(pluginDb);
    void pluginHandle.raw;
    pluginHandle.close();
    assert.ok(existsSync(legacyDb) && existsSync(pluginDb), "测试前置：双库文件未落盘");

    await withClient(fixture, async (client) => {
      const panel = await client.readResource({ uri: "ui://obsidian/panel.html" });
      const content = panel.contents[0];
      assert.ok(content && "text" in content);
      assert.equal(content.mimeType, "text/html;profile=mcp-app");
      assert.equal(
        (content._meta as { ui?: { backgroundRetention?: boolean } } | undefined)?.ui
          ?.backgroundRetention,
        true,
      );
      assert.ok(content.text.includes("vault-shell"), "面板 HTML 应为构建产物（含壳结构）");

      const status = await readData(client, "status");
      assert.equal(status.ok, false);
      assert.equal(status.error?.code, "dual_db_conflict");
      assert.ok(typeof status.error?.legacyDatabasePath === "string");
      assert.ok(typeof status.error?.pluginDatabasePath === "string");

      const files = await readData(client, "files");
      assert.equal(files.ok, false);
      assert.equal(files.error?.code, "dual_db_conflict");
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("数据端点：status/files 分页/file 分段/insights/write-gate/proposals 只读面", async () => {
  await ensureBundles();
  const fixture = makeFixture();
  try {
    await withClient(fixture, async (client) => {
      const status = await readData(client, "status");
      assert.equal(status.ok, true);
      const data = status.data as {
        mode: string;
        vault: { displayName: string } | null;
        index: { configured: boolean; coverage: { indexedFiles: number } };
      };
      // P6 起无库首建缺省落插件目录（P7 后旧 host 已不存在，旧路径不再有人开库）。
      assert.equal(data.mode, "plugin");
      assert.equal(data.vault?.displayName, "P5 Fixture Vault");
      assert.equal(data.index.configured, true);

      // 分页：limit=1 → hasMore=true，第二页拿到 beta。
      const page1 = await readData(client, "files?offset=0&limit=1");
      assert.equal(page1.ok, true);
      const files1 = page1.data as {
        items: Array<{ kind: string; relativePath: string }>;
        total: number;
        hasMore: boolean;
      };
      assert.equal(files1.items.length, 1);
      assert.equal(files1.total, 3); // notes/alpha.md、notes/beta.md + folder notes
      assert.equal(files1.hasMore, true);
      const page2 = await readData(client, `files?offset=1&limit=200`);
      assert.equal((page2.data as { items: unknown[] }).items.length, 2);

      // 分段：limit=10 字符窗口 + sha256/totalChars/hasMore。
      const segment = await readData(client, "file?path=notes/alpha.md&offset=0&limit=10");
      assert.equal(segment.ok, true);
      const file = segment.data as {
        content: string;
        offset: number;
        totalChars: number;
        hasMore: boolean;
        sha256: string;
      };
      assert.equal(file.content.length, 10);
      assert.equal(file.offset, 0);
      assert.ok(file.totalChars > 10);
      assert.equal(file.hasMore, true);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      const second = await readData(client, "file?path=notes/alpha.md&offset=10&limit=100000");
      const file2 = second.data as { content: string; hasMore: boolean; offset: number };
      assert.equal(file2.offset, 10);
      assert.equal(file2.hasMore, false);

      // 未配置文件读取错误走封套（不炸整次读取）。
      const missing = await readData(client, "file?path=notes/none.md");
      assert.equal(missing.ok, false);
      assert.equal(missing.error?.code, "server_error");

      // insights / write-gate / proposals。
      const insights = await readData(client, "insights");
      assert.equal(insights.ok, true);
      assert.equal(
        (insights.data as { configured: boolean }).configured,
        true,
      );
      const gate = await readData(client, "write-gate");
      assert.equal(gate.ok, true);
      assert.equal((gate.data as { enabled: boolean }).enabled, false);
      const proposals = await readData(client, "proposals");
      assert.equal(proposals.ok, true);
      assert.equal((proposals.data as { items: unknown[]; total: number }).total, 0);
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("N1 lookup（检索即终点）：索引就绪后返回 run 视图候选；幂等键复跑同 run", async () => {
  await ensureBundles();
  const fixture = makeFixture();
  try {
    await withClient(fixture, async (client) => {
      // 等索引就绪（autoIndex「装配后延迟一次」触发；轮询有界）。
      const deadline = Date.now() + 30_000;
      let indexed = 0;
      while (Date.now() < deadline) {
        const status = await readData(client, "status");
        assert.equal(status.ok, true);
        indexed = (
          status.data as { index: { coverage: { indexedFiles: number } } }
        ).index.coverage.indexedFiles;
        if (indexed >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert.ok(indexed >= 2, `索引未就绪（indexedFiles=${indexed}）`);

      const lookup = await readData(
        client,
        `lookup?q=${encodeURIComponent("Beta 笔记正文")}&requestId=p5-lookup-1`,
      );
      assert.equal(lookup.ok, true);
      const run = lookup.data as {
        runId: string;
        status: string;
        candidates: Array<{ relativePath: string; quote: { startLine: number } }>;
      };
      assert.ok(["ready", "partial"].includes(run.status), `status=${run.status}`);
      assert.ok(
        run.candidates.some((candidate) => candidate.relativePath === "notes/beta.md"),
        "候选应命中 beta 笔记",
      );

      // 同 clientRequestId 幂等：同键返回同一 run。
      const repeat = await readData(
        client,
        `lookup?q=${encodeURIComponent("Beta 笔记正文")}&requestId=p5-lookup-1`,
      );
      assert.equal((repeat.data as { runId: string }).runId, run.runId);
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("citation 端点：未知 receipt 结构化落空（不抛错）；参数缺失 invalid_params", async () => {
  await ensureBundles();
  const fixture = makeFixture();
  try {
    await withClient(fixture, async (client) => {
      const resolved = await readData(client, "citation?receiptId=urn:unknown");
      assert.equal(resolved.ok, true);
      const citation = resolved.data as { status: string; citation: unknown };
      assert.notEqual(citation.status, "current");
      assert.equal(citation.citation, null);

      const invalid = await readData(client, "citation");
      assert.equal(invalid.ok, false);
      assert.equal(invalid.error?.code, "invalid_params");

      // 未知端点同样走 invalid_params 封套（readUiResource 不让开发期笔误炸协议层）。
      const unknown = await readData(client, "nope");
      assert.equal(unknown.ok, false);
      assert.equal(unknown.error?.code, "invalid_params");
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
