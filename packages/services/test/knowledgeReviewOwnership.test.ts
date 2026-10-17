import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import { setDataBaseDir } from "../src/paths.js";
import { createKnowledgeServices } from "../src/knowledge/knowledgeServices.js";

for (const action of ["apply", "undo"] as const) {
  for (const terminate of [false, true]) {
    test(`L2 真进程 ${action}: ${terminate ? "进程死亡后只读恢复" : "活跃期间不得 reconcile"}`, { timeout: 30_000 }, async () => {
      const root = await mkdtemp(join(tmpdir(), "drora-live-owner-"));
      setDataBaseDir(root);
      const vault = join(root, "vault");
      const pluginDataDir = join(root, "plugin-data");
      const databasePath = join(root, "knowledge.sqlite");
      await mkdir(vault);
      await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
      const services = createKnowledgeServices({ databasePath, pluginDataDir,
        reviewWriteSafetyGatePassed: true, reviewWritePathEnabled: true });
      let child: ReturnType<typeof fork> | undefined;
      try {
        await writeFile(join(vault, "a.md"), "base");
        const proposal = await services.reviewService.createProposal({
          title: "real owner", reason: "cannot settle an active writer",
          changes: [{ kind: "write", relativePath: "a.md", content: "next",
            baseSha256: createHash("sha256").update("base").digest("hex") }],
        });
        await services.reviewService.approveProposal({ proposalId: proposal.proposalId });
        const operationId = `rop-live-${action}`;
        if (action === "undo") assert.equal((await services.reviewService.applyProposal({
          proposalId: proposal.proposalId, operationId,
        })).outcome, "applied");
        child = fork(fileURLToPath(new URL("./fixtures/review-live-worker.ts", import.meta.url)),
          [databasePath, pluginDataDir, proposal.proposalId, operationId, action],
          { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
        const exit = once(child, "exit");
        assert.deepEqual(await once(child, "message"), ["ready", undefined]);
        const busy = await services.reviewService.reconcileOperation({ operationId });
        assert.equal(busy.outcome, "blocked");
        assert.equal(busy.reason, "operation_busy");
        assert.equal(await readFile(join(vault, "a.md"), "utf8"), action === "apply" ? "base" : "next");
        if (terminate) {
          child.kill("SIGKILL");
          await exit;
          const recovered = await services.reviewService.reconcileOperation({ operationId });
          assert.equal(recovered.outcome, "reconciled");
          assert.equal(await readFile(join(vault, "a.md"), "utf8"), action === "apply" ? "base" : "next");
          assert.equal(recovered.operation?.files[0]?.status, action === "apply" ? "not_landed" : "undo_conflict");
        } else {
          const result = once(child, "message");
          child.send("resume");
          assert.equal(((await result)[0] as { outcome: string }).outcome, "applied");
          await exit;
          assert.equal(await readFile(join(vault, "a.md"), "utf8"), action === "apply" ? "next" : "base");
        }
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
        }
        services.dispose();
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
