// 迁自 packages/services/test/knowledgeReviewFreshApproval.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setDataBaseDir } from "../src/server/platform/dataPaths.js";
import { configureVaultAt } from "../src/server/vault/config.js";
import { createKnowledgeServices } from "../src/server/knowledge/knowledgeServices.js";

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
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const services = createKnowledgeServices({
      databasePath: join(root, "knowledge.sqlite"),
      pluginDataDir,
      reviewWriteSafetyGatePassed: true,
      reviewWritePathEnabled: true,
      reviewBeforeFileMutationForTest: async () => {
        entered();
        await hold;
      },
    });
    const review = services.reviewService;
    let pending: ReturnType<typeof review.applyProposal> | undefined;
    try {
      await writeFile(join(vault, "a.md"), "base");
      const proposal = await review.createProposal({
        title: "fresh approval",
        reason: "the current ledger owns approval",
        changes: [
          {
            kind: "write",
            relativePath: "a.md",
            content: "next",
            baseSha256: createHash("sha256").update("base").digest("hex"),
          },
        ],
      });
      await review.approveProposal({ proposalId: proposal.proposalId });
      pending = review.applyProposal({ proposalId: proposal.proposalId });
      await ready;
      if (change === "revise")
        await review.reviseProposal({
          proposalId: proposal.proposalId,
          reason: "re-review required",
        });
      if (change === "reject") await review.rejectProposal({ proposalId: proposal.proposalId });
      if (change === "expire")
        await review.approveProposal({ proposalId: proposal.proposalId, ttlMs: 0 });
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
