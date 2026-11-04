/**
 * Jev 配置热生效 E2E（spec §5d.10 配置热生效；数据源 = 模型能力档案快照，
 * specs/model-capabilities.md §9 批次一 / MC-3）。
 *
 * 断言：configSource 装配下，变更档案快照（换端点到另一本地服务）+ refresh
 * RPC 后，**下一次检索的 Jev 出站打到新端点**——全程无需重建服务/重启。缓存随
 * 配置签名变更清空（旧端点评分不串味）。
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/knowledge/knowledgeServices.js";
import {
  resolveKnowledgeJevAssembly,
  type KnowledgeJevAssembly,
} from "../src/knowledge/decision/jevAssembly.js";
import type { ModelCapabilities } from "@drora/shared";

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

/** 假 Jev 端点：记录命中并返回合法 noul 评分。 */
function startJevStub(
  label: string,
): Promise<{ server: Server; port: number; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      hits += 1;
      const body = JSON.parse(raw || "{}") as { questions?: Record<string, unknown> };
      const questions = body.questions ?? {};
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: "jev-latest",
          answers: Object.fromEntries(
            Object.keys(questions).map((name) => [
              name,
              { type: "noul", noul: label === "A" ? 0.9 : 0.2 },
            ]),
          ),
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      resolve({ server, port: address.port, hits: () => hits });
    });
  });
}

it("配置热生效：换档案端点 + refresh RPC 后下一次检索打到新端点（免重启）", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-jev-hot-"));
  setDataBaseDir(root);
  const stubA = await startJevStub("A");
  const stubB = await startJevStub("B");
  // MC-3 改数据源：可变的是「模型能力档案快照」（UI 写 update 后 configSource 读到的新值），
  // 装配经真实 resolveKnowledgeJevAssembly 从快照 + 凭据解析——与生产 knowledgeHost 同路径。
  let snapshotCapabilities: Pick<ModelCapabilities, "decision-jev"> = {
    "decision-jev": {
      enabled: true,
      providerKind: "typesafe",
      baseUrl: `http://127.0.0.1:${stubA.port}`,
      modelId: "",
    },
  };
  const fakeCredentials = {
    load: async () => "sk-hot-test",
  };

  const services: KnowledgeServices = createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir: join(root, "plugin-data"),
    knowledgeJevConfigSource: async (): Promise<KnowledgeJevAssembly | null> =>
      resolveKnowledgeJevAssembly({
        modelCapabilities: snapshotCapabilities,
        credentialService: fakeCredentials,
      }),
    leaseTtlMs: 4000,
    heartbeatIntervalMs: 300,
  });
  try {
    const pluginDataDir = join(root, "plugin-data");
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    await writeFile(join(vault, "a.md"), "# A\n\n上下文窗口优化笔记。\n", "utf-8");
    await configureVaultAt(pluginDataDir, vault);
    const job = await services.indexService.startReconcile();
    await waitFor(async () => {
      const status = await services.indexService.getStatus();
      return status.job?.jobId === job.jobId && status.job.status !== "running";
    });

    // 首次检索 + 授权 → 出站打到端点 A。
    const run1 = await services.queryService.createRun({
      query: "上下文窗口",
      clientRequestId: "hot-1",
    });
    const finished1 = await services.queryService.search({ runId: run1.runId });
    assert.ok(finished1.candidates.length > 0, "应有本地候选供授权");
    const grant1 = await services.queryService.grantDecisionConsent({ runId: run1.runId });
    assert.equal(
      grant1.granted,
      true,
      `授权应成功：${grant1.granted === false ? grant1.reason : ""}`,
    );
    const searched1 = await services.queryService.search({
      runId: run1.runId,
      decisionConsentId: grant1.consentId,
    });
    assert.equal(searched1.decision?.status, "applied");
    assert.equal(stubA.hits() > 0, true, "端点 A 应收到出站");
    const hitsAAfterFirst = stubA.hits();

    // 档案换端点 B + refresh RPC（UI 写 update 后的确定性即时路径）→ 下一次检索打到 B。
    snapshotCapabilities = {
      "decision-jev": {
        ...snapshotCapabilities["decision-jev"],
        baseUrl: `http://127.0.0.1:${stubB.port}`,
      },
    };
    const refreshed = await services.indexService.refreshDecisionConfig();
    assert.equal(refreshed.refreshed, true);

    const run2 = await services.queryService.createRun({
      query: "上下文窗口",
      clientRequestId: "hot-2",
    });
    const finished2 = await services.queryService.search({ runId: run2.runId });
    const grant2 = await services.queryService.grantDecisionConsent({ runId: run2.runId });
    assert.equal(grant2.granted, true);
    const searched2 = await services.queryService.search({
      runId: run2.runId,
      decisionConsentId: grant2.consentId,
    });
    assert.equal(searched2.decision?.status, "applied");
    assert.equal(stubB.hits() > 0, true, "换端点后应打到端点 B");
    assert.equal(stubA.hits(), hitsAAfterFirst, "端点 A 不应再收到出站");
  } finally {
    services.dispose();
    stubA.server.close();
    stubB.server.close();
    await rm(root, { recursive: true, force: true });
  }
});
