/**
 * W04 智能问库 UI 调用编排集成测试（spec §5c.3/§5c.4 验收映射）。
 *
 * GUI E2E 在本环境不可行（无显示服务器/Electron 交互面）；本测试以真实
 * `createKnowledgeServices` 按组件的精确调用顺序驱动服务面，锁定 UI 契约：
 * 提交幂等、候选聚合、证据 Inspector（prepareEvidence→resolveCitation）、
 * 取消、过期/撤权（source_stale）。
 * 全部使用 mkdtemp 合成临时 Vault，绝不触碰用户真实 Vault。
 * 运行：node --import tsx --test packages/services/test/knowledgeAskUiFlow.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/knowledge/knowledgeServices.js";
import type { KnowledgeRunView } from "../src/knowledge/knowledgeTypes.js";

interface TestEnv {
  root: string;
  pluginDataDir: string;
  vaultA: string;
  vaultB: string;
  services: KnowledgeServices;
}

async function createEnv(): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), "drora-ask-ui-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vaultA = join(root, "vault-a");
  const vaultB = join(root, "vault-b");
  await mkdir(vaultA, { recursive: true });
  await mkdir(vaultB, { recursive: true });
  const services = createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir,
    leaseTtlMs: 2000,
    heartbeatIntervalMs: 250,
  });
  return { root, pluginDataDir, vaultA, vaultB, services };
}

async function destroyEnv(env: TestEnv): Promise<void> {
  env.services.dispose();
  await rm(env.root, { recursive: true, force: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeNote(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolute = join(vaultRoot, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf-8");
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

/** UI 的提交编排：createRun（retrieving 才 search）→ 落定视图。 */
async function uiSubmit(
  services: KnowledgeServices,
  query: string,
  clientRequestId: string,
  sessionId?: string,
): Promise<KnowledgeRunView> {
  const created = await services.queryService.createRun({ query, clientRequestId, sessionId });
  if (created.status !== "retrieving") return created;
  return services.queryService.search({ runId: created.runId });
}

test("UI 编排：状态条 → 建索引 → 提交 → 候选聚合 → 幂等重试", async () => {
  const env = await createEnv();
  try {
    // ① 无 Vault：UI 状态条显示「尚未连接」。
    const initial = await env.services.indexService.getStatus();
    assert.equal(initial.configured, false);

    // ② 连接 Vault 并建索引（「建立索引」按钮的 startReconcile）。
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "notes/a.md", "# A\n\n长期记忆不能替代上下文窗口 findmarker-a");
    await writeNote(env.vaultA, "notes/b.md", "# B\n\n上下文窗口的压缩策略 findmarker-b 正文");
    const job = await env.services.indexService.startReconcile();
    assert.equal(await waitForJobTerminal(env.services, job.jobId), "completed");
    const ready = await env.services.indexService.getStatus();
    assert.equal(ready.configured, true);
    assert.equal(ready.coverage.indexedFiles, 2);
    assert.equal(ready.semantic, "unavailable");

    // ③ UI 提交（含 sessionId）：候选按文章聚合且可核验字段齐备。
    const clientRequestId = randomUUID();
    const run = await uiSubmit(env.services, "上下文窗口", clientRequestId, "sess-ui-1");
    assert.equal(run.status, "ready");
    assert.ok(run.candidates.length >= 1);
    assert.ok(run.candidates.every((candidate) => candidate.evidenceStatus === "unverified"));
    assert.ok(run.candidates.every((candidate) => candidate.quote.startLine >= 1));
    // 同文档多 chunk 聚合为单候选（A06 的 UI 面）。
    const paths = run.candidates.map((candidate) => candidate.relativePath);
    assert.equal(new Set(paths).size, paths.length);

    // ④ 重试复用同一 clientRequestId：服务端幂等返回同一 run（Host 重连语义）。
    const retry = await env.services.queryService.createRun({
      query: "上下文窗口",
      clientRequestId,
      sessionId: "sess-ui-1",
    });
    assert.equal(retry.runId, run.runId);

    // ⑤ onRunUpdated 事件按 runGeneration+seq 递增（UI 订阅契约）。
    const events: Array<{ runId: string; runGeneration: number; seq: number }> = [];
    const subscription = env.services.queryService.onRunUpdated((event) => {
      events.push({ runId: event.runId, runGeneration: event.runGeneration, seq: event.seq });
    });
    try {
      await uiSubmit(env.services, "压缩策略", randomUUID(), "sess-ui-1");
      assert.ok(events.length >= 1);
      const seqs = events.map((event) => event.seq);
      assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, "seq 必须按发出顺序单调递增");
    } finally {
      subscription.dispose();
    }
  } finally {
    await destroyEnv(env);
  }
});

test("UI 编排：证据 Inspector（prepareEvidence → resolveCitation → 回跳数据）", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(
      env.vaultA,
      "inspector.md",
      "# 检验\n\n这是用于核验的原始句子 inspect-quote-marker。\n\n结尾段。",
    );
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    const run = await uiSubmit(env.services, "inspect-quote-marker", randomUUID(), "sess-ev-1");
    const candidate = run.candidates.find((entry) => entry.relativePath === "inspector.md");
    assert.ok(candidate, "候选必须命中 inspector.md");

    // ① prepareEvidence 签发（UI「核验」按钮）。
    const prepared = await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: candidate.articleId,
    });
    assert.equal(prepared.status, "current");
    assert.ok(prepared.receipt.receiptId.startsWith("evr_"));

    // ② resolveCitation 复验通过：current + 有界 excerpt + 行号（「跳到原文」数据）。
    const resolved = await env.services.queryService.resolveCitation({
      receiptId: prepared.receipt.receiptId,
      sessionId: "sess-ev-1",
    });
    assert.equal(resolved.status, "current");
    if (resolved.status !== "current") return;
    assert.equal(resolved.citation.relativePath, "inspector.md");
    assert.ok(resolved.citation.excerpt.length <= 240);
    assert.ok(resolved.citation.quote.endLine >= resolved.citation.quote.startLine);

    // ③ 跨会话解析被拒（追问不串会话，A19 的 UI 面）。
    const crossSession = await env.services.queryService.resolveCitation({
      receiptId: prepared.receipt.receiptId,
      sessionId: "sess-other",
    });
    assert.equal(crossSession.status, "forbidden");

    // ④ 伪造 receiptId：UI 如实透传 forbidden（A14）。
    const forged = await env.services.queryService.resolveCitation({
      receiptId: "evr_deadbeefdeadbeefdeadbeefdeadbeef",
      sessionId: "sess-ev-1",
    });
    assert.equal(forged.status, "forbidden");

    // ⑤ 原文修改后再核验：stale（UI「原文已变化」态）。
    await writeNote(
      env.vaultA,
      "inspector.md",
      "# 检验\n\n这是被改写过的句子，旧引用已失效。\n\n结尾段。",
    );
    const stalePrepared = await env.services.queryService.prepareEvidence({
      runId: run.runId,
      articleId: candidate.articleId,
    });
    assert.equal(stalePrepared.status, "stale");
  } finally {
    await destroyEnv(env);
  }
});

test("UI 编排：取消保留语义、无源 run、空查询拒绝与切库过期", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    await writeNote(env.vaultA, "solo.md", "# S\n\n唯一标记词 solomarker");
    const job = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, job.jobId);

    // ① 取消：run 落定为 cancelled；UI 保留上一轮可用结果（reducer 语义，服务侧锁定状态）。
    const cancellable = await env.services.queryService.createRun({
      query: "solomarker",
      clientRequestId: randomUUID(),
    });
    assert.equal(cancellable.status, "retrieving");
    const cancelResult = await env.services.queryService.cancelRun({ runId: cancellable.runId });
    assert.equal(cancelResult.cancelled, true);
    const cancelledView = await env.services.queryService.search({ runId: cancellable.runId });
    assert.equal(cancelledView.status, "cancelled");

    // ② 空查询：服务端拒绝 → UI 呈现 submitFailed（不产生半途 run）。
    await assert.rejects(
      () => env.services.queryService.createRun({ query: "   ", clientRequestId: randomUUID() }),
      /查询文本不能为空/,
    );

    // ③ 无 Vault 期间新 run：no_source（UI 连接引导态）。
    await unlink(join(env.pluginDataDir, "vault-config.json"));
    const noSourceRun = await uiSubmit(env.services, "solomarker", randomUUID());
    assert.equal(noSourceRun.status, "no_source");

    // ④ 切库后旧源失效（A22/A13 的 UI 面）。重新授权 A（configuredAt 变化 → epoch
    // 递增、旧缓存已清）→ 重建索引后 run 命中。
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    const reindexJob = await env.services.indexService.startReconcile();
    await waitForJobTerminal(env.services, reindexJob.jobId);
    const oldRun = await uiSubmit(env.services, "solomarker", randomUUID());
    assert.equal(oldRun.status, "ready");

    // 4a. 检索中切库：run 在 search 完成时重验 → source_stale 且丢弃候选。
    const pendingRun = await env.services.queryService.createRun({
      query: "solomarker",
      clientRequestId: randomUUID(),
    });
    assert.equal(pendingRun.status, "retrieving");
    await configureVaultAt(env.pluginDataDir, env.vaultB);
    const staleRetry = await env.services.queryService.search({ runId: pendingRun.runId });
    assert.equal(staleRetry.status, "source_stale");
    assert.equal(staleRetry.candidates.length, 0);

    // 4b. 已落定候选在切库后「核验」：prepareEvidence 每次重验源 → source_stale，
    // 旧候选禁止签发 receipt（UI 过期态的服务侧依据）。
    const candidate = oldRun.candidates[0];
    if (candidate) {
      const forbidden = await env.services.queryService.prepareEvidence({
        runId: oldRun.runId,
        articleId: candidate.articleId,
      });
      assert.equal(forbidden.status, "source_stale");
    }
  } finally {
    await destroyEnv(env);
  }
});
