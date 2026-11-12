// 迁自 packages/services/test/knowledgeJevConnection.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
/**
 * Jev 连接测试 RPC 测试（spec §5d.10 配置 UX）。
 *
 * 断言：2xx+合法答案 → ok（含延迟）；401 → Key 无效文案；装配缺失（开关未开/
 * 必填项缺失）→ 配置未完成提示；探测请求为最小 systemOne 形状。
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { setDataBaseDir } from "../src/server/platform/dataPaths.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/server/knowledge/knowledgeServices.js";
import type { KnowledgeJevAssembly } from "../src/server/knowledge/decision/jevAssembly.js";

function startStub(
  status: number,
  body: unknown,
): Promise<{ server: Server; port: number; bodies: unknown[] }> {
  const bodies: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      bodies.push(raw ? JSON.parse(raw) : null);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve({ server, port: address.port, bodies });
    });
  });
}

function createServicesWithSource(
  root: string,
  source: () => Promise<KnowledgeJevAssembly | null>,
): KnowledgeServices {
  return createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir: join(root, "plugin-data"),
    knowledgeJevConfigSource: source,
    leaseTtlMs: 4000,
    heartbeatIntervalMs: 300,
  });
}

it("testJevConnection：2xx+合法答案 → ok（最小 systemOne 探测形状）", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-jev-conn-"));
  setDataBaseDir(root);
  const stub = await startStub(200, {
    model: "jev-latest",
    answers: { relevance: { type: "noul", noul: 0.5 } },
  });
  let assembly: KnowledgeJevAssembly | null = {
    provider: "typesafe",
    apiKey: "sk-conn-test",
    baseUrl: `http://127.0.0.1:${stub.port}`,
  };
  const services = createServicesWithSource(root, async () => assembly);
  try {
    const result = await services.indexService.testJevConnection();
    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.ok(result.latencyMs >= 0);
    const probe = stub.bodies[0] as {
      state: Record<string, string>;
      questions: Record<string, unknown>;
    };
    assert.equal(probe.state.query, "连接测试");
    assert.ok(probe.questions.relevance, "探测应携带最小 relevance 问题");
  } finally {
    services.dispose();
    stub.server.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("testJevConnection：401 → 认证失败文案；装配缺失 → 配置未完成提示", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-jev-conn-401-"));
  setDataBaseDir(root);
  const stub = await startStub(401, { error: "unauthorized" });
  let assembly: KnowledgeJevAssembly | null = {
    provider: "typesafe",
    apiKey: "sk-bad",
    baseUrl: `http://127.0.0.1:${stub.port}`,
  };
  const services = createServicesWithSource(root, async () => assembly);
  try {
    const result = await services.indexService.testJevConnection();
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /认证失败/u);

    // 装配缺失（用户关闭开关/清空必填项）→ 结构化「配置未完成」。
    assembly = null;
    const missing = await services.indexService.testJevConnection();
    assert.equal(missing.ok, false);
    assert.match(missing.error ?? "", /配置未完成/u);
  } finally {
    services.dispose();
    stub.server.close();
    await rm(root, { recursive: true, force: true });
  }
});
