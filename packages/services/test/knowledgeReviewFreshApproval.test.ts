import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import { createKnowledgeServices } from "../src/knowledge/knowledgeServices.js";

for (const change of ["revise", "reject", "expire", "revoke"] as const) {
  test(`L2 写前最新授权复验：等待期间 ${change} 后不得写入`, async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-fresh-approval-"));
    setDataBaseDir(root);
    const vault = join(root, "vault");
    const pluginDataDir = join(root, "plugin-data");
    await mkdir(vault);
    await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const services = createKnowledgeServices({
      databasePath: join(root, "knowledge.sqlite"), pluginDataDir,
      reviewWriteSafetyGatePassed: true, reviewWritePathEnabled: true,
      reviewBeforeFileMutationForTest: async () => { entered(); await hold; },
    });
    const review = services.reviewService;
    let pending: ReturnType<typeof review.applyProposal> | undefined;
    try {
      await writeFile(join(vault, "a.md"), "base");
      const proposal = await review.createProposal({
        title: "fresh approval", reason: "the current ledger owns approval",
        changes: [{ kind: "write", relativePath: "a.md", content: "next",
          baseSha256: createHash("sha256").update("base").digest("hex") }],
      });
      await review.approveProposal({ proposalId: proposal.proposalId });
      pending = review.applyProposal({ proposalId: proposal.proposalId });
      await ready;
      if (change === "revise") await review.reviseProposal({ proposalId: proposal.proposalId, reason: "re-review required" });
      if (change === "reject") await review.rejectProposal({ proposalId: proposal.proposalId });
      if (change === "expire") await review.approveProposal({ proposalId: proposal.proposalId, ttlMs: 0 });
      if (change === "revoke") await review.setWritePathEnabled(false);
      release();
      const result = await pending;
      assert.notEqual(result.outcome, "applied");
      assert.equal(await readFile(join(vault, "a.md"), "utf8"), "base");
    } finally {
      release();
      await pending;
      services.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
}
