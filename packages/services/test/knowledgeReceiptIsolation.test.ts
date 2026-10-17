/**
 * Regression coverage for G35/G42: receipt identity is scoped to the exact
 * source/run/session, not to a display citation number such as [1].
 *
 * Uses a real temporary Vault, SQLite-backed Knowledge services and the real
 * receipt issue/resolve path. No model, network, or user Vault is involved.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import { createKnowledgeServices, type KnowledgeServices } from "../src/knowledge/knowledgeServices.js";

interface TestEnv {
  root: string;
  vaultRoot: string;
  pluginDataDir: string;
  services: KnowledgeServices;
}

async function createEnv(): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), "drora-receipt-isolation-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vaultRoot = join(root, "vault");
  await mkdir(vaultRoot, { recursive: true });
  const services = createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir,
    leaseTtlMs: 2000,
    heartbeatIntervalMs: 250,
  });
  return { root, vaultRoot, pluginDataDir, services };
}

async function writeNote(vaultRoot: string, relativePath: string, text: string): Promise<void> {
  const path = join(vaultRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

async function waitForIndex(services: KnowledgeServices, jobId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await services.indexService.getStatus();
    if (status.job?.jobId === jobId && status.job.status !== "running") {
      assert.equal(status.job.status, "completed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Knowledge index did not finish: ${jobId}`);
}

async function queryAndPrepare(
  services: KnowledgeServices,
  query: string,
  sessionId: string,
) {
  const created = await services.queryService.createRun({
    query,
    sessionId,
    clientRequestId: `receipt-isolation-${randomUUID()}`,
  });
  assert.equal(created.status, "retrieving");
  const run = await services.queryService.search({ runId: created.runId });
  assert.equal(run.status, "ready");
  assert.equal(run.sessionId, sessionId);
  assert.equal(run.candidates.length, 1, `Expected one candidate for ${query}`);
  const candidate = run.candidates[0]!;
  const prepared = await services.queryService.prepareEvidence({
    runId: run.runId,
    articleId: candidate.articleId,
  });
  assert.equal(prepared.status, "current");
  assert.ok(prepared.receipt);
  return { run, candidate, receipt: prepared.receipt! };
}

test("G35/G42: equal display citation numbers cannot cross-bind distinct source Receipts", async () => {
  const env = await createEnv();
  try {
    const alphaPath = "notes/alpha.md";
    const betaPath = "notes/beta.md";
    await writeNote(
      env.vaultRoot,
      alphaPath,
      "# Alpha source\n\nAlphaReceiptIsolationToken is exclusive to the alpha note.\n",
    );
    await writeNote(
      env.vaultRoot,
      betaPath,
      "# Beta source\n\nBetaReceiptIsolationToken is exclusive to the beta note.\n",
    );
    const configured = await configureVaultAt(env.pluginDataDir, env.vaultRoot);
    assert.ok(configured.vaultId);
    const job = await env.services.indexService.startReconcile();
    await waitForIndex(env.services, job.jobId);

    const sessionId = "session-receipt-isolation";
    // These represent two turns in the same Session. Both answer renderers may
    // display their own source as [1], but their opaque Receipt IDs must differ.
    const alpha = await queryAndPrepare(env.services, "AlphaReceiptIsolationToken", sessionId);
    const beta = await queryAndPrepare(env.services, "BetaReceiptIsolationToken", sessionId);
    assert.equal(alpha.candidate.relativePath, alphaPath);
    assert.equal(beta.candidate.relativePath, betaPath);
    assert.notEqual(alpha.receipt.receiptId, beta.receipt.receiptId);

    const alphaResolved = await env.services.queryService.resolveCitation({
      receiptId: alpha.receipt.receiptId,
      sessionId,
    });
    const betaResolved = await env.services.queryService.resolveCitation({
      receiptId: beta.receipt.receiptId,
      sessionId,
    });
    assert.equal(alphaResolved.status, "current");
    assert.equal(betaResolved.status, "current");
    if (alphaResolved.status === "current" && betaResolved.status === "current") {
      assert.equal(alphaResolved.citation.relativePath, alphaPath);
      assert.equal(betaResolved.citation.relativePath, betaPath);
      assert.notEqual(alphaResolved.citation.articleId, betaResolved.citation.articleId);
    }

    // A Receipt from another Session cannot be made current by reusing the
    // same [1] display number or by asking the resolver under a different ID.
    const crossSession = await env.services.queryService.resolveCitation({
      receiptId: alpha.receipt.receiptId,
      sessionId: "different-session",
    });
    assert.equal(crossSession.status, "forbidden");
    if (crossSession.status === "forbidden") assert.equal(crossSession.reason, "cross_session");

    // Mutating one backing file invalidates only its own Receipt. It must not
    // redirect to the other turn's note or invalidate the independent Receipt.
    await writeNote(
      env.vaultRoot,
      alphaPath,
      "# Alpha source\n\nAlphaReceiptIsolationToken has changed after issue.\n",
    );
    const staleAlpha = await env.services.queryService.resolveCitation({
      receiptId: alpha.receipt.receiptId,
      sessionId,
    });
    const stillCurrentBeta = await env.services.queryService.resolveCitation({
      receiptId: beta.receipt.receiptId,
      sessionId,
    });
    assert.equal(staleAlpha.status, "stale");
    assert.equal(stillCurrentBeta.status, "current");
    if (stillCurrentBeta.status === "current") {
      assert.equal(stillCurrentBeta.citation.relativePath, betaPath);
    }
  } finally {
    env.services.dispose();
    await rm(env.root, { recursive: true, force: true });
  }
});
