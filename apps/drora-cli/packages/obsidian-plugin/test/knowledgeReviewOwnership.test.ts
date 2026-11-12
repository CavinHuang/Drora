// 迁自 packages/services/test/knowledgeReviewOwnership.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { configureVaultAt } from "../src/server/vault/config.js";
import { setDataBaseDir } from "../src/server/platform/dataPaths.js";
import { createKnowledgeServices } from "../src/server/knowledge/knowledgeServices.js";

for (const action of ["apply", "undo"] as const) {
  for (const terminate of [false, true]) {
    test(
      `L2 真进程 ${action}: ${terminate ? "进程死亡后只读恢复" : "活跃期间不得 reconcile"}`,
      { timeout: 30_000 },
      async () => {
        const root = await mkdtemp(join(tmpdir(), "drora-live-owner-"));
        setDataBaseDir(root);
        const vault = join(root, "vault");
        const pluginDataDir = join(root, "plugin-data");
        const databasePath = join(root, "knowledge.sqlite");
        await mkdir(vault);
        await configureVaultAt(pluginDataDir, vault, { allowAgentWrites: true });
        const services = createKnowledgeServices({
          databasePath,
          pluginDataDir,
          reviewWriteSafetyGatePassed: true,
          reviewWritePathEnabled: true,
        });
        let child: ReturnType<typeof fork> | undefined;
        try {
          await writeFile(join(vault, "a.md"), "base");
          const proposal = await services.reviewService.createProposal({
            title: "real owner",
            reason: "cannot settle an active writer",
            changes: [
              {
                kind: "write",
                relativePath: "a.md",
                content: "next",
                baseSha256: createHash("sha256").update("base").digest("hex"),
              },
            ],
          });
          await services.reviewService.approveProposal({ proposalId: proposal.proposalId });
          const operationId = `rop-live-${action}`;
          if (action === "undo")
            assert.equal(
              (
                await services.reviewService.applyProposal({
                  proposalId: proposal.proposalId,
                  operationId,
                })
              ).outcome,
              "applied",
            );
          child = fork(
            fileURLToPath(new URL("./fixtures/review-live-worker.ts", import.meta.url)),
            [databasePath, pluginDataDir, proposal.proposalId, operationId, action],
            { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] },
          );
          const exit = once(child, "exit");
          assert.deepEqual(await once(child, "message"), ["ready", undefined]);
          const busy = await services.reviewService.reconcileOperation({ operationId });
          assert.equal(busy.outcome, "blocked");
          assert.equal(busy.reason, "operation_busy");
          assert.equal(
            await readFile(join(vault, "a.md"), "utf8"),
            action === "apply" ? "base" : "next",
          );
          if (terminate) {
            child.kill("SIGKILL");
            await exit;
            const recovered = await services.reviewService.reconcileOperation({ operationId });
            assert.equal(recovered.outcome, "reconciled");
            assert.equal(
              await readFile(join(vault, "a.md"), "utf8"),
              action === "apply" ? "base" : "next",
            );
            assert.equal(
              recovered.operation?.files[0]?.status,
              action === "apply" ? "not_landed" : "undo_conflict",
            );
          } else {
            const result = once(child, "message");
            child.send("resume");
            assert.equal(((await result)[0] as { outcome: string }).outcome, "applied");
            await exit;
            assert.equal(
              await readFile(join(vault, "a.md"), "utf8"),
              action === "apply" ? "next" : "base",
            );
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
      },
    );
  }
}
